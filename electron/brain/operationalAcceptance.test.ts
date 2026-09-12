import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainBackupManager } from './backup'
import type { BrainCapabilityEnvelope, BrainCapabilityResult } from './capabilityProtocol'
import { BrainJobRunner } from './jobRunner'
import { BrainService } from './service'
import { configureBrainTools, createBrainTools } from '../agent/brainTools'
import type { BrainDecisionBrief, BrainOpportunity } from '../../src/types/brain'

/**
 * Task 8 release gate: the whole operational loop, proven end to end against a
 * fixture connector and a throwaway profile. Nothing here touches a real
 * account, the packaged user data directory, or the network — the capability
 * executor is a local function and every root is an `mkdtemp` directory that is
 * removed again in `afterEach`.
 */

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.useRealTimers()
})

function profile(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), `flowdesk-acceptance-${prefix}-`))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function openService(root: string) {
  const service = new BrainService(join(root, 'brain.sqlite'))
  cleanups.push(() => { try { service.close() } catch { /* already closed by the test */ } })
  return service
}

/** A fixture connector. Real capture is a main-process capability; this is not. */
function fixtureConnector(recordsFor: (envelope: BrainCapabilityEnvelope) => Array<Record<string, unknown>>) {
  const calls: string[] = []
  const execute = async (envelope: BrainCapabilityEnvelope): Promise<BrainCapabilityResult> => {
    calls.push(envelope.recipeId)
    return { id: envelope.request.id, ok: true, records: recordsFor(envelope) }
  }
  return { execute, calls }
}

const LEAD_TEXT = 'Looking for a React developer to fix our urgent support backlog dashboard.'
const NOISE_TEXT = 'Good morning everyone, happy Friday.'

function leadRecords(host: string, marker: string) {
  return [
    { id: `${marker}-lead`, text: LEAD_TEXT, url: `https://${host}/posts/${marker}-lead`, createdAt: '2026-09-05T09:00:00.000Z', reactions: 14 },
    { id: `${marker}-noise`, text: NOISE_TEXT, url: `https://${host}/posts/${marker}-noise`, createdAt: '2026-09-05T09:05:00.000Z', reactions: 2 },
  ]
}

describe('Brain operational acceptance: capture to cited Agent action', () => {
  it('survives a mid-job restart and ends at one cited brief and exactly one continuation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'))
    const root = profile('loop')
    let service = openService(root)
    const scope = service.database.ensureScope({ type: 'project', externalRef: 'acceptance', name: 'Acceptance' })
    const recipeId = 'linkedin.opportunity_scan'

    // 1. Consent is a precondition, not a formality: without it the runner parks
    //    the job instead of calling the connector.
    const withoutConsent = service.database.enqueueJob({ recipeId, recipeVersion: 1, scopeId: scope.id, parameters: { query: 'developer' } })
    const blocked = fixtureConnector(() => leadRecords('acme.test', 'blocked'))
    const blockedRunner = new BrainJobRunner(service.database, service.artifacts, root, blocked.execute)
    cleanups.push(() => blockedRunner.stop())
    await blockedRunner.runOnce()
    expect(service.database.getJob(withoutConsent.id)?.status).toBe('waiting_for_approval')
    expect(blocked.calls).toEqual([])
    service.database.cancelJob(withoutConsent.id)

    // 2. Grant consent, then enqueue the real job with an interactive continuation.
    service.handle({ id: 'consent', method: 'grantConsent', payload: { scopeId: scope.id, recipeId, provider: 'local-brain', fields: ['post_text'] } })
    const job = service.database.enqueueJob({
      recipeId, recipeVersion: 1, scopeId: scope.id, parameters: { query: 'developer backlog' },
      continuation: { sessionId: 'session-acceptance', mode: 'interactive', contextBudget: 1200 },
    })

    // 3. Run capture and normalize, then kill the process mid-job.
    const before = fixtureConnector(() => leadRecords('acme.test', 'loop'))
    const firstRunner = new BrainJobRunner(service.database, service.artifacts, root, before.execute)
    await firstRunner.runOnce()
    await firstRunner.runOnce()
    firstRunner.stop()
    service.close()
    expect(before.calls).toEqual([recipeId])

    // 4. Restart. The expired lease is recovered and capture is NOT repeated.
    await vi.advanceTimersByTimeAsync(31_000)
    service = openService(root)
    const after = fixtureConnector(() => leadRecords('acme.test', 'loop'))
    const secondRunner = new BrainJobRunner(service.database, service.artifacts, root, after.execute)
    cleanups.push(() => secondRunner.stop())
    for (let index = 0; index < 5; index += 1) await secondRunner.runOnce()
    expect(after.calls).toEqual([])
    expect(service.database.getJob(job.id)?.status).toBe('completed')
    expect(service.database.listCheckpoints(job.id)).toHaveLength(5)

    // 5. The opportunity persisted, and its evidence resolves to a stored source.
    const opportunities = service.database.listOpportunities({ scopeId: scope.id })
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0]).toMatchObject({ category: 'direct_lead', status: 'new', evidenceCount: 1 })
    const evidence = service.database.getOpportunityEvidence({ id: opportunities[0].id, scopeId: scope.id })
    expect(evidence[0]).toMatchObject({
      sourceId: expect.any(String), platform: 'linkedin', stale: false,
      sourceRef: 'https://acme.test/posts/loop-lead',
    })

    // 6. A reviewer qualifies it, and the Agent-facing brief cites that evidence
    //    and nothing else. Raw provider text never appears.
    const qualified = service.handle({ id: 'review', method: 'reviewOpportunity', payload: { id: opportunities[0].id, scopeId: scope.id, decision: 'qualify' } }) as BrainOpportunity
    expect(qualified.status).toBe('qualified')
    const brief = service.handle({
      id: 'brief', method: 'buildDecisionBrief',
      payload: { question: 'Should I pitch a developer retainer for their backlog?', scopeId: scope.id, tokenBudget: 1200 },
    }) as BrainDecisionBrief
    expect(brief.supportingSignals.length).toBeGreaterThan(0)
    expect(brief.supportingSignals.map(signal => signal.citation.sourceRef)).toEqual(['https://acme.test/posts/loop-lead'])
    expect(brief.supportingSignals.every(signal => signal.citation.scopeId === scope.id)).toBe(true)
    expect(brief.estimatedTokens).toBeLessThanOrEqual(1200)
    expect(JSON.stringify(brief)).not.toContain('React developer')

    // 7. Exactly one continuation is queued, and it is consumable exactly once.
    const queued = service.database.listQueuedContinuations()
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ jobId: job.id, sessionId: 'session-acceptance', mode: 'interactive', contextBudget: 1200 })
    expect(service.handle({ id: 'consume', method: 'consumeContinuation', payload: { id: queued[0].id } })).toBe(true)
    expect(service.handle({ id: 'consume-again', method: 'consumeContinuation', payload: { id: queued[0].id } })).toBe(false)
    expect(service.database.listQueuedContinuations()).toEqual([])
  })

  it('keeps durable Brain writes out of a temporary Agent turn while explicit reads still work', async () => {
    const calls: Array<[string, unknown]> = []
    const request = async (method: string, payload: unknown) => { calls.push([method, payload]); return { ok: true } }
    configureBrainTools({ request: request as never, getScopeId: () => 'scope-temporary', allowWrites: () => false })
    const tools = createBrainTools(async () => true) as unknown as Array<{ name: string; handler: (input: Record<string, unknown>) => Promise<unknown> }>
    const tool = (name: string) => tools.find(item => item.name === name)!

    for (const [name, input] of [
      ['brain_remember', { kind: 'fact', text: 'Durable write attempt' }],
      ['brain_run_recipe', { recipeId: 'linkedin.opportunity_scan', recipeVersion: 1, parameters: {}, mode: 'interactive', sessionId: 'temporary' }],
      ['brain_review_opportunity', { id: 'opportunity-a', decision: 'qualify' }],
    ] as const) {
      await expect(tool(name).handler(input as Record<string, unknown>)).rejects.toThrow(/learning is disabled/i)
    }
    expect(calls).toEqual([])

    // Explicit read-only search and briefing remain available in temporary mode.
    await tool('brain_search').handler({ text: 'backlog' })
    await tool('brain_build_decision_brief').handler({ question: 'Should I pitch?' })
    expect(calls.map(([method]) => method)).toEqual(['search', 'buildDecisionBrief'])
  })
})

describe('Brain operational acceptance: privacy and scope isolation', () => {
  it('keeps one client out of another client search, brief, graph, list and backup', async () => {
    const root = profile('isolation')
    const service = openService(root)
    const recipeId = 'linkedin.opportunity_scan'
    const clientA = service.database.ensureScope({ type: 'client', externalRef: 'client-a', name: 'Client A' })
    const clientB = service.database.ensureScope({ type: 'client', externalRef: 'client-b', name: 'Client B' })
    for (const scope of [clientA, clientB]) {
      service.database.grantConsent({ scopeId: scope.id, recipeId, provider: 'local-brain', fields: ['post_text'] })
    }
    const jobA = service.database.enqueueJob({ recipeId, recipeVersion: 1, scopeId: clientA.id, parameters: { query: 'alpha developer' } })
    const jobB = service.database.enqueueJob({ recipeId, recipeVersion: 1, scopeId: clientB.id, parameters: { query: 'beta developer' } })
    const connector = fixtureConnector(envelope => envelope.scopeId === clientA.id
      ? [{ id: 'alpha', text: 'Alpharetta Labs needs a React developer for their support backlog.', url: 'https://alpha-secret.test/posts/alpha', createdAt: '2026-09-05T09:00:00.000Z', reactions: 30 }]
      : [{ id: 'beta', text: 'Betagrid needs a React developer for their support backlog.', url: 'https://beta-open.test/posts/beta', createdAt: '2026-09-05T09:00:00.000Z', reactions: 30 }])
    const runner = new BrainJobRunner(service.database, service.artifacts, root, connector.execute)
    cleanups.push(() => runner.stop())
    for (let index = 0; index < 10; index += 1) await runner.runOnce()
    expect(service.database.getJob(jobA.id)?.status).toBe('completed')
    expect(service.database.getJob(jobB.id)?.status).toBe('completed')

    // Curated, shareable-looking memory and a graph node exist on both sides.
    service.handle({ id: 'memory-a', method: 'remember', payload: { scopeId: clientA.id, kind: 'fact', text: 'Alpharetta Labs pays net 15', shareable: true } })
    service.handle({ id: 'memory-b', method: 'remember', payload: { scopeId: clientB.id, kind: 'fact', text: 'Betagrid pays net 60', shareable: true } })
    const entityA = service.database.createEntity({ scopeId: clientA.id, type: 'organization', name: 'Alpharetta Labs' })
    const entityB = service.database.createEntity({ scopeId: clientB.id, type: 'organization', name: 'Betagrid' })
    service.database.createEntity({ scopeId: clientA.id, type: 'person', name: 'Alpha Contact' })
    expect(() => service.database.linkEntities({
      fromEntityId: entityA.id, toEntityId: entityB.id, relation: 'partner', confidence: 1, sourceRef: 'test://cross',
    })).toThrow(/inside one scope/i)

    // Opportunity lists and evidence reads are hard filtered by scope.
    const opportunitiesA = service.database.listOpportunities({ scopeId: clientA.id })
    const opportunitiesB = service.database.listOpportunities({ scopeId: clientB.id })
    expect(opportunitiesA).toHaveLength(1)
    expect(opportunitiesB).toHaveLength(1)
    expect(opportunitiesA[0].id).not.toBe(opportunitiesB[0].id)
    expect(() => service.database.getOpportunityEvidence({ id: opportunitiesA[0].id, scopeId: clientB.id })).toThrow(/not found/i)
    expect(() => service.database.reviewOpportunity({ id: opportunitiesA[0].id, scopeId: clientB.id, decision: 'qualify' })).toThrow(/not found/i)
    const evidenceA = service.database.getOpportunityEvidence({ id: opportunitiesA[0].id, scopeId: clientA.id })
    expect(() => service.database.recordOpportunityEvidence({
      opportunityId: opportunitiesB[0].id, scopeId: clientB.id, evidenceId: evidenceA[0].evidenceId, sourceId: null,
      excerpt: 'stolen', confidence: 0.9, sourceRef: evidenceA[0].sourceRef, platform: 'linkedin',
    })).toThrow(/another scope/i)

    // Graph reads see only their own scope.
    const graphB = service.database.getGraph(clientB.id)
    expect(graphB.nodes.map(node => node.name)).toEqual(['Betagrid'])
    expect(JSON.stringify(graphB)).not.toContain('Alpharetta')

    // The Client B brief and the Client B prompt pack cite nothing from Client A.
    const briefB = service.handle({
      id: 'brief-b', method: 'buildDecisionBrief',
      payload: { question: 'Which developer backlog opportunity should I pursue?', scopeId: clientB.id, tokenBudget: 1200 },
    }) as BrainDecisionBrief
    const citedB = [...briefB.supportingSignals, ...briefB.counterSignals].map(signal => signal.citation)
    expect(citedB.length).toBeGreaterThan(0)
    expect(citedB.every(citation => citation.scopeId === clientB.id)).toBe(true)
    expect(JSON.stringify(briefB)).not.toContain('alpha-secret.test')
    expect(JSON.stringify(briefB)).not.toContain('Alpharetta')

    const packB = service.handle({
      id: 'search-b', method: 'search',
      payload: { text: 'Alpharetta Labs net 15 payment terms', scopeId: clientB.id, includeParents: true, tokenBudget: 1200, limit: 12 },
    }) as { citations: Array<{ scopeId: string }>; summary: string }
    expect(packB.citations.every(citation => citation.scopeId === clientB.id)).toBe(true)
    expect(packB.summary).not.toContain('Alpharetta')

    // Raw provider text reached neither the prompt pack nor the portable backup.
    const archive = join(root, 'isolation.flowdesk-brain.zip')
    service.handle({ id: 'export', method: 'exportBackup', payload: { outputPath: archive } })
    const bytes = readFileSync(archive)
    for (const secret of ['Alpharetta Labs needs a React developer', 'Betagrid needs a React developer', 'alpha-secret.test']) {
      expect(bytes.includes(Buffer.from(secret))).toBe(false)
    }
  })
})

describe('Brain operational acceptance: retention and deletion', () => {
  it('purges expired raw capture, stales its evidence, reopens the opportunity and keeps memory provenance', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'))
    const root = profile('retention')
    const service = openService(root)
    const recipeId = 'linkedin.opportunity_scan'
    const scope = service.database.ensureScope({ type: 'client', externalRef: 'retention', name: 'Retention' })
    service.database.grantConsent({ scopeId: scope.id, recipeId, provider: 'local-brain', fields: ['post_text'] })
    const job = service.database.enqueueJob({ recipeId, recipeVersion: 1, scopeId: scope.id, parameters: { query: 'developer' } })
    const connector = fixtureConnector(() => leadRecords('retention.test', 'keep'))
    const runner = new BrainJobRunner(service.database, service.artifacts, root, connector.execute)
    cleanups.push(() => runner.stop())
    for (let index = 0; index < 5; index += 1) await runner.runOnce()

    const [opportunity] = service.database.listOpportunities({ scopeId: scope.id })
    expect(opportunity.status).toBe('new')
    const [citation] = service.database.getOpportunityEvidence({ id: opportunity.id, scopeId: scope.id })
    expect(citation.stale).toBe(false)
    expect(citation.sourceId).toEqual(expect.any(String))

    // An accepted memory records the capture locator and its content hash.
    const manifest = service.database.getArtifactManifest(job.id) as { hashes: { intelligence: string } }
    const provenance = `${citation.sourceRef}#sha256=${manifest.hashes.intelligence}`
    const memory = service.handle({
      id: 'accept', method: 'remember',
      payload: { scopeId: scope.id, kind: 'opportunity', text: 'Retention Ltd wants a developer retainer', sourceRef: provenance },
    }) as { id: string }

    const rawArtifact = join(root, 'artifacts', job.id, 'raw')
    expect(existsSync(rawArtifact)).toBe(true)
    const rawFile = JSON.parse(String(service.database.listCheckpoints(job.id)[0].checkpoint_json)) as { dataRef: string }
    const rawPath = rawFile.dataRef.slice('file://'.length)
    expect(existsSync(rawPath)).toBe(true)

    // Default retention is 30 days, so at day 31 the capture is expired.
    vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'))
    service.runMaintenance()

    expect(existsSync(rawPath)).toBe(false)
    const afterPurge = service.database.getOpportunityEvidence({ id: opportunity.id, scopeId: scope.id })
    expect(afterPurge[0].stale).toBe(true)
    expect(afterPurge[0].sourceId).toBeNull()
    expect(service.database.listOpportunities({ scopeId: scope.id })[0].status).toBe('reviewing')

    // Accepted knowledge survives the purge with its locator and hash intact.
    const preserved = service.database.getMemory(memory.id)
    expect(preserved).toMatchObject({ status: 'accepted', sourceRef: provenance })
    expect(preserved?.sourceRef).toContain('sha256=')

    // A stale citation becomes a counter-signal rather than silent support.
    const brief = service.handle({
      id: 'brief-stale', method: 'buildDecisionBrief',
      payload: { question: 'Should I still chase the developer backlog lead?', scopeId: scope.id, tokenBudget: 1200 },
    }) as BrainDecisionBrief
    expect(brief.supportingSignals).toEqual([])
    expect(brief.counterSignals.length).toBeGreaterThan(0)
    expect(brief.risks).toContain('Current evidence contains conflicting or stale signals.')

    // One sweep consumes every expired envelope, so a second sweep is a no-op.
    // The durability of a dismissal is proven in the next test, where both
    // opportunities are still backed by unexpired rows when the sweep runs.
    expect(service.database.purgeExpiredCaptures()).toEqual([])
  })

  it('returns only open opportunities to review in a single sweep and leaves a dismissal alone', () => {
    const root = profile('retention-guard')
    const service = openService(root)
    const scope = service.database.ensureScope({ type: 'client', externalRef: 'guard', name: 'Guard' })

    /** One expired capture, its own source, its own evidence, its own opportunity. */
    const seed = (marker: string, status: 'new' | 'qualified' | 'dismissed') => {
      const capturedAt = '2020-01-01T00:00:00.000Z'
      const rawPayloadRef = `artifact://job-${marker}/raw/${marker}.jsonl.gz`
      expect(service.database.storeCaptureEnvelope({
        envelopeVersion: 1, source: 'linkedin', captureType: 'scan', connectorId: 'flowdesk', connectorVersion: 'v1',
        jobId: `job-${marker}`, stepId: `step-${marker}`, scopeId: scope.id, accountId: null,
        externalId: `external-${marker}`, parentExternalId: null,
        canonicalUrl: `https://guard.test/posts/${marker}`, observedAt: capturedAt, capturedAt,
        cursor: null, contentHash: `hash-${marker}`, rawPayloadRef, schemaHint: null,
      })).toBe(true)
      const sourceId = service.database.findCaptureSource({
        scopeId: scope.id, jobId: `job-${marker}`, platform: 'linkedin',
        externalId: `external-${marker}`, canonicalUrl: `https://guard.test/posts/${marker}`,
      })
      expect(sourceId).toEqual(expect.any(String))
      const opportunity = service.database.upsertOpportunity({
        scopeId: scope.id, fingerprint: `fingerprint-${marker}`, category: 'direct_lead',
        title: `direct lead signal for ${marker}`, summary: '1 cited signal across 1 platform.',
        score: 80, confidence: 0.7, freshness: capturedAt,
      })
      service.database.recordOpportunityEvidence({
        opportunityId: opportunity.id, scopeId: scope.id, evidenceId: `evidence-${marker}`, sourceId,
        excerpt: `direct lead signal for ${marker}`, confidence: 0.8,
        sourceRef: `https://guard.test/posts/${marker}`, platform: 'linkedin', observedAt: capturedAt,
      })
      if (status !== 'new') {
        service.database.reviewOpportunity({ id: opportunity.id, scopeId: scope.id, decision: status === 'qualified' ? 'qualify' : 'dismiss' })
      }
      return opportunity.id
    }

    const openId = seed('open', 'new')
    const qualifiedId = seed('qualified', 'qualified')
    const dismissedId = seed('dismissed', 'dismissed')
    const statusOf = (id: string) => service.database.listOpportunities({ scopeId: scope.id }).find(item => item.id === id)?.status
    const staleOf = (id: string) => service.database.getOpportunityEvidence({ id, scopeId: scope.id })[0]
    expect([statusOf(openId), statusOf(qualifiedId), statusOf(dismissedId)]).toEqual(['new', 'qualified', 'dismissed'])
    expect([staleOf(openId).stale, staleOf(qualifiedId).stale, staleOf(dismissedId).stale]).toEqual([false, false, false])

    // Exactly one sweep, and it really did process all three expired sources.
    const purged = service.database.purgeExpiredCaptures()
    expect(purged.sort()).toEqual([
      'artifact://job-dismissed/raw/dismissed.jsonl.gz',
      'artifact://job-open/raw/open.jsonl.gz',
      'artifact://job-qualified/raw/qualified.jsonl.gz',
    ])

    // Every citation lost its source in that same pass — including the dismissed
    // one. So the guard did run over the dismissed row and chose not to reopen it,
    // rather than never having been reached at all.
    for (const id of [openId, qualifiedId, dismissedId]) {
      expect(staleOf(id)).toMatchObject({ stale: true, sourceId: null })
    }
    expect(statusOf(openId)).toBe('reviewing')
    expect(statusOf(qualifiedId)).toBe('reviewing')
    expect(statusOf(dismissedId)).toBe('dismissed')
  })

  it('keeps a restored backup free of the raw artifacts the purge is meant to delete', async () => {
    const root = profile('purge-backup')
    const service = openService(root)
    const scope = service.database.ensureScope({ type: 'client', externalRef: 'purge', name: 'Purge' })
    const memory = service.handle({ id: 'm', method: 'remember', payload: { scopeId: scope.id, kind: 'fact', text: 'Curated only' } }) as { id: string }
    const archive = join(root, 'purge.flowdesk-brain.zip')
    service.handle({ id: 'export', method: 'exportBackup', payload: { outputPath: archive } })
    const restored = join(root, 'restored')
    BrainBackupManager.extractArchive(archive, restored)
    expect(existsSync(join(restored, 'artifacts'))).toBe(false)
    expect(existsSync(join(restored, 'brain.sqlite'))).toBe(true)
    expect(memory.id).toEqual(expect.any(String))
  })
})
