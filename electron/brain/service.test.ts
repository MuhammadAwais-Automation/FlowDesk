import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleBrainEvidence, type BrainNavigationMethod, readBrainDocument, readBrainNeighbors } from '../agent/brainNavigation'
import { __setExtractorForTests } from './knowledge/embeddings'
import { AUTO_VECTOR_LIMIT, BrainService } from './service'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('BrainService', () => {
  it('builds a scope-safe cited decision brief and ignores superseded claim evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'client', externalRef: 'brief-a', name: 'Brief A' })
      const other = service.database.ensureScope({ type: 'client', externalRef: 'brief-b', name: 'Brief B' })
      const opportunity = service.database.upsertOpportunity({
        scopeId: scope.id, fingerprint: 'support-backlog', category: 'direct_lead', title: 'Support backlog',
        summary: 'A support team needs help.', score: 84, confidence: 0.82, freshness: '2026-09-05T00:00:00.000Z',
      })
      service.database.recordOpportunityEvidence({
        opportunityId: opportunity.id, scopeId: scope.id, evidenceId: 'brief-evidence', sourceId: null,
        excerpt: 'Our support backlog blocks releases.', confidence: 0.9, sourceRef: 'https://example.test/brief', platform: 'linkedin',
      })
      const brief = service.handle({ id: '1', method: 'buildDecisionBrief', payload: { scopeId: scope.id, question: 'Should we pursue support backlog work?', tokenBudget: 1200 } }) as { supportingSignals: Array<{ citation: { scopeId: string; sourceRef: string } }> }
      expect(brief.supportingSignals).toMatchObject([{ citation: { scopeId: scope.id, sourceRef: 'https://example.test/brief' } }])
      expect(service.handle({ id: '2', method: 'buildDecisionBrief', payload: { scopeId: other.id, question: 'Should we pursue support backlog work?', tokenBudget: 1200 } })).toMatchObject({ supportingSignals: [], counterSignals: [] })
    } finally { service.close() }
  })

  it('exposes scoped opportunity list, evidence and review without public creation', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const a = service.database.ensureScope({ type: 'client', externalRef: 'service-a', name: 'A' })
      const b = service.database.ensureScope({ type: 'client', externalRef: 'service-b', name: 'B' })
      const opportunity = service.database.upsertOpportunity({
        scopeId: a.id, fingerprint: 'service-lead', category: 'warm_opportunity', title: 'Workflow pain',
        summary: 'A repeated workflow problem.', score: 74, confidence: 0.7, freshness: '2026-09-05T00:00:00.000Z',
      })
      service.database.recordOpportunityEvidence({
        opportunityId: opportunity.id, scopeId: a.id, evidenceId: 'service-evidence', sourceId: null,
        excerpt: 'Our workflow is slow', confidence: 0.7, sourceRef: 'https://example.test/service', platform: 'linkedin',
      })

      expect(service.handle({ id: '1', method: 'listOpportunities', payload: { scopeId: b.id } })).toEqual([])
      expect(() => service.handle({ id: '2', method: 'getOpportunityEvidence', payload: { id: opportunity.id, scopeId: b.id } })).toThrow('Opportunity not found')
      expect(service.handle({ id: '3', method: 'getOpportunityEvidence', payload: { id: opportunity.id, scopeId: a.id } })).toHaveLength(1)
      expect(service.handle({ id: '4', method: 'reviewOpportunity', payload: { id: opportunity.id, scopeId: a.id, decision: 'dismiss' } })).toMatchObject({ status: 'dismissed' })
      expect(() => service.handle({ id: '5', method: 'upsertOpportunity', payload: {} })).toThrow()
    } finally { service.close() }
  })

  it('reserves social capture and lifecycle mutations for the utility runner', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
      const social = service.database.enqueueJob({
        recipeId: 'linkedin.opportunity_scan', recipeVersion: 1, scopeId: scope.id, parameters: {},
      })
      expect(() => service.handle({ id: '1', method: 'completeJob', payload: { id: social.id, result: { raw: 'private' } } })).toThrow('runner-owned')
      expect(() => service.handle({ id: '2', method: 'failJob', payload: { id: social.id, error: 'external failure' } })).toThrow('runner-owned')
      expect(() => service.handle({ id: '3', method: 'ingestCaptureBatch', payload: {
        source: 'linkedin', jobId: social.id, stepId: 'capture', scopeId: scope.id,
        connectorVersion: 'external', records: [{ text: 'private' }],
      } })).toThrow('runner-owned')
      expect(service.database.getJob(social.id)?.status).toBe('queued')

      const notebook = service.database.enqueueJob({
        recipeId: 'notebooklm.research', recipeVersion: 1, scopeId: scope.id, parameters: {},
      })
      expect(service.handle({ id: '4', method: 'completeJob', payload: { id: notebook.id, result: { recordCount: 1 } } })).toMatchObject({ status: 'completed' })
    } finally { service.close() }
  })

  it('enforces the selected scope through vault conflict dispatch', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const a = service.database.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
      const b = service.database.ensureScope({ type: 'client', externalRef: 'b', name: 'B' })
      const memory = service.database.remember({ scopeId: a.id, kind: 'fact', text: 'Private A' })
      const id = service.database.addVaultConflict({ memoryId: memory.id, filePath: 'A.md', baseRevision: 1, databaseText: 'Private A', fileText: 'Changed A' })
      expect(service.handle({ id: '1', method: 'listVaultConflicts', payload: { scopeId: b.id } })).toEqual([])
      expect(service.handle({ id: '2', method: 'resolveVaultConflict', payload: { id, scopeId: b.id, resolution: 'file' } })).toBeNull()
      expect(service.database.getMemory(memory.id)?.text).toBe('Private A')
      expect(service.handle({ id: '3', method: 'listVaultConflicts', payload: { scopeId: a.id } })).toHaveLength(1)
      expect(service.handle({ id: '4', method: 'resolveVaultConflict', payload: { id, scopeId: a.id, resolution: 'file' } })).toMatchObject({ text: 'Changed A' })
    } finally { service.close() }
  })

  /**
   * Monitor mutation is the one v2 entity that took an id with no scope, so the
   * isolation invariant every opportunity API enforces at the repository
   * boundary stopped short of it. Ids are hard to discover today, but the next
   * caller — an Agent tool, a bulk action, a deep link — would inherit nothing.
   */
  it('refuses to mutate a monitor through the wrong scope', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-monitor-scope-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const mine = service.database.ensureScope({ type: 'client', externalRef: 'mine', name: 'Mine' })
      const theirs = service.database.ensureScope({ type: 'client', externalRef: 'theirs', name: 'Theirs' })
      const monitor = service.handle({ id: '1', method: 'createMonitor', payload: { scopeId: mine.id, recipeId: 'linkedin.opportunity_scan', intervalMinutes: 60, minimumScore: 70 } }) as { id: string }

      expect(service.handle({ id: '2', method: 'setMonitorStatus', payload: { id: monitor.id, scopeId: theirs.id, status: 'paused' } })).toBeNull()
      expect(service.database.getMonitor(monitor.id)?.status).toBe('active')
      expect(service.handle({ id: '3', method: 'deleteMonitor', payload: { id: monitor.id, scopeId: theirs.id } })).toBe(false)
      expect(service.database.getMonitor(monitor.id)).not.toBeNull()

      // The owning scope still works, so the guard is a scope check and not a
      // blanket refusal.
      expect(service.handle({ id: '4', method: 'setMonitorStatus', payload: { id: monitor.id, scopeId: mine.id, status: 'paused' } })).toMatchObject({ status: 'paused' })
      expect(service.handle({ id: '5', method: 'deleteMonitor', payload: { id: monitor.id, scopeId: mine.id } })).toBe(true)
      expect(service.database.getMonitor(monitor.id)).toBeNull()

      // Scope is required, not optional: an unscoped payload is refused.
      expect(() => service.handle({ id: '6', method: 'deleteMonitor', payload: { id: monitor.id } })).toThrow()
      expect(() => service.handle({ id: '7', method: 'setMonitorStatus', payload: { id: monitor.id, status: 'paused' } })).toThrow()
    } finally { service.close() }
  })

  /**
   * A rejected import must cost nothing. `importBackup` used to stop the vault
   * and close the database before any archive validation ran, so a truncated,
   * traversing or incompatible archive threw before the deliberate
   * `process.exit` — leaving the utility alive, serving requests against a
   * closed database, with no restart and no explanation.
   */
  it('rejects an invalid backup archive with the live database untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-import-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain', 'brain.sqlite'))
    try {
      const scope = service.handle({ id: '1', method: 'ensureScope', payload: { type: 'client', externalRef: 'import', name: 'Import' } }) as { id: string }
      service.handle({ id: '2', method: 'remember', payload: { scopeId: scope.id, kind: 'fact', text: 'Survives a refused import' } })

      const archive = join(root, 'bad.flowdesk-brain.zip')
      writeFileSync(archive, zipSync({
        'manifest.json': strToU8(JSON.stringify({ format: 'flowdesk-brain-backup', archiveFormatVersion: 1, databaseSchemaVersion: 1, createdAt: new Date().toISOString() })),
        'brain.sqlite': strToU8('not-a-database'),
        '../escape.md': strToU8('bad'),
      }))
      expect(() => service.handle({ id: '3', method: 'importBackup', payload: { inputPath: archive } })).toThrow(/unsafe backup entry/i)

      // The proof the database was never closed: it still serves reads and writes.
      expect(service.handle({ id: '4', method: 'listMemories', payload: { scopeId: scope.id } })).toHaveLength(1)
      service.handle({ id: '5', method: 'remember', payload: { scopeId: scope.id, kind: 'fact', text: 'Still writable' } })
      expect(service.handle({ id: '6', method: 'status', payload: {} })).toMatchObject({ ready: true })
    } finally { service.close() }
  })

  it('rejects a backup whose database fails its health probe before closing the live one', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-import-probe-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain', 'brain.sqlite'))
    try {
      const scope = service.handle({ id: '1', method: 'ensureScope', payload: { type: 'client', externalRef: 'probe', name: 'Probe' } }) as { id: string }
      const archive = join(root, 'corrupt.flowdesk-brain.zip')
      writeFileSync(archive, zipSync({
        'manifest.json': strToU8(JSON.stringify({ format: 'flowdesk-brain-backup', archiveFormatVersion: 1, databaseSchemaVersion: 2, createdAt: new Date().toISOString() })),
        'brain.sqlite': strToU8('this is not a SQLite file at all'),
      }))
      expect(() => service.handle({ id: '2', method: 'importBackup', payload: { inputPath: archive } })).toThrow()
      expect(service.handle({ id: '3', method: 'status', payload: {} })).toMatchObject({ ready: true })
      expect(service.handle({ id: '4', method: 'listMemories', payload: { scopeId: scope.id } })).toEqual([])
    } finally { service.close() }
  })

  it('validates and dispatches requests without exposing SQL', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    const scope = service.handle({ id: '1', method: 'ensureScope', payload: { type: 'workspace', externalRef: 'default', name: 'Default' } }) as { id: string }
    service.handle({ id: '2', method: 'remember', payload: { scopeId: scope.id, kind: 'fact', text: 'FlowDesk is local first' } })
    expect(service.handle({ id: '3', method: 'overview', payload: { scopeId: scope.id } })).toMatchObject({ memories: 1, candidates: 0, jobs: 0 })
    expect(() => service.handle({ id: '4', method: 'rawSql', payload: {} })).toThrow()
    service.close()
  })

  it('maps stored documents to the bounded public read contract used by agent navigation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-knowledge-read-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'workspace', externalRef: 'knowledge-read', name: 'Knowledge Read' })
      const updatedAt = '2026-09-13T00:00:00.000Z'
      service.documents.upsert({
        scopeId: scope.id,
        path: 'wiki/projects/flowdesk.md',
        type: 'project',
        title: 'FlowDesk',
        summary: 'Local-first AI workstation',
        body: 'abcdefghij',
        origin: 'curated',
        contentHash: 'knowledge-read-hash',
        updatedAt,
      })

      const request = async (method: BrainNavigationMethod, payload: unknown) => service.handle({
        id: 'knowledge-read',
        method,
        payload,
      })
      expect(await request('knowledge.read', {
        scopeId: scope.id,
        path: 'wiki/projects/flowdesk.md',
        tokenBudget: 2,
      })).toEqual({
        path: 'wiki/projects/flowdesk.md',
        title: 'FlowDesk',
        type: 'project',
        text: 'abcdefgh',
        updatedAt,
        estimatedTokens: 2,
        truncated: true,
      })

      const agentOutput = await readBrainDocument(request, scope.id, 'wiki/projects/flowdesk.md', 2)
      expect(agentOutput).toContain('FlowDesk (project)')
      expect(agentOutput).toContain('Path: wiki/projects/flowdesk.md')
      expect(agentOutput).toContain('abcdefgh')
      expect(agentOutput).toMatch(/truncated/i)
      expect(agentOutput).not.toMatch(/unavailable/i)
    } finally { service.close() }
  })

  describe('scope inheritance (the bug this regression test exists to catch)', () => {
    // Mirrors electron/main.ts's real runAgentMessage flow exactly:
    // ensureScope(global) -> ensureScope(project, parent=global) -> every
    // knowledge call uses the PROJECT scope, never a fresh per-session one.
    // A reproduction against the pre-fix code showed the agent's manifest
    // was always empty, brain_read_document/brain_search_documents always
    // came back empty, and "Learn" output landed in a scope nothing could
    // ever select in the UI. This test is red on that code and green here.
    it('gives an agent turn in the project scope full visibility into documents imported at the global scope', async () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-scope-inheritance-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const globalScope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const projectScope = service.database.ensureScope({ type: 'project', externalRef: 'proj-1', name: 'FlowDesk', parentId: globalScope.id })

        // The vault import a user actually runs lands in the global scope.
        service.documents.upsert({
          scopeId: globalScope.id, path: 'wiki/clients/yasir-bhai.md', type: 'client',
          title: 'Yasir Bhai', summary: 'Client contact',
          body: 'Yasir bhai runs Together We Go trade finance.',
          origin: 'curated', contentHash: 'vault-1', updatedAt: '2026-09-01T00:00:00.000Z',
        })

        // An Agent turn in the project scope -- the manifest must not be empty.
        const manifest = service.handle({
          id: '1', method: 'knowledge.manifest', payload: { scopeId: projectScope.id },
        }) as { entryCount: number; text: string }
        expect(manifest.entryCount).toBe(1)
        expect(manifest.text).toContain('wiki/clients/yasir-bhai.md')

        // Both navigation tools must actually reach the document.
        const request = async (method: BrainNavigationMethod, payload: unknown) => service.handle({ id: '2', method, payload })
        const read = await readBrainDocument(request, projectScope.id, 'wiki/clients/yasir-bhai.md')
        expect(read).toContain('Yasir bhai runs Together We Go trade finance.')
        const searchHits = service.handle({
          id: '3', method: 'knowledge.search', payload: { scopeId: projectScope.id, query: 'Yasir' },
        }) as Array<{ path: string }>
        expect(searchHits).toMatchObject([{ path: 'wiki/clients/yasir-bhai.md' }])

        // "Learn" output (explicit-user, written straight through) must land
        // somewhere the same project scope -- and therefore the Brain UI --
        // can immediately see, not an invisible per-session scope.
        const proposed = service.handle({
          id: '4', method: 'knowledge.proposeCandidate', payload: {
            scopeId: projectScope.id, type: 'note', title: 'Captured note', summary: '',
            body: 'Captured during an agent turn.', origin: 'explicit-user', sessionRef: 'agent-session://s/t1',
          },
        }) as { kind: string }
        expect(proposed.kind).toBe('written')
        const manifestAfterCapture = service.handle({
          id: '5', method: 'knowledge.manifest', payload: { scopeId: projectScope.id },
        }) as { entryCount: number }
        expect(manifestAfterCapture.entryCount).toBe(2)
      } finally { service.close() }
    })

    it('lets a project scope override a document it shares with the global scope, without hiding the rest of the global vault', () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-scope-inheritance-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const globalScope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const projectScope = service.database.ensureScope({ type: 'project', externalRef: 'proj-1', name: 'FlowDesk', parentId: globalScope.id })

        service.documents.upsert({
          scopeId: globalScope.id, path: 'wiki/me/skills.md', type: 'me', title: 'Skills', summary: '',
          body: 'Flutter, Supabase, Next.js.', origin: 'curated', contentHash: 'global-1', updatedAt: '2026-09-01T00:00:00.000Z',
        })
        service.documents.upsert({
          scopeId: globalScope.id, path: 'wiki/projects/flowdesk.md', type: 'project', title: 'FlowDesk (global draft)', summary: '',
          body: 'Stale global draft.', origin: 'curated', contentHash: 'global-2', updatedAt: '2026-09-01T00:00:00.000Z',
        })
        service.documents.upsert({
          scopeId: projectScope.id, path: 'wiki/projects/flowdesk.md', type: 'project', title: 'FlowDesk (project version)', summary: '',
          body: 'Current project-owned version.', origin: 'curated', contentHash: 'project-1', updatedAt: '2026-09-02T00:00:00.000Z',
        })

        const list = service.handle({ id: '1', method: 'knowledge.list', payload: { scopeId: projectScope.id } }) as Array<{ path: string; title: string }>
        expect(list).toHaveLength(2)
        expect(list.find(d => d.path === 'wiki/me/skills.md')).toBeTruthy()
        expect(list.find(d => d.path === 'wiki/projects/flowdesk.md')?.title).toBe('FlowDesk (project version)')

        const read = service.handle({ id: '2', method: 'knowledge.read', payload: { scopeId: projectScope.id, path: 'wiki/projects/flowdesk.md' } }) as { text: string }
        expect(read.text).toBe('Current project-owned version.')
      } finally { service.close() }
    })
  })

  describe('answer pack (the retrieval ladder)', () => {
    it('hands the agent the answering passage instead of the whole document', async () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-answer-pack-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const globalScope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const projectScope = service.database.ensureScope({ type: 'project', externalRef: 'proj-1', name: 'FlowDesk', parentId: globalScope.id })

        const body = [
          '# Yasir Bhai',
          'We met through Iftikhar in 2024 and talked for months before any work started.',
          '',
          '## Retainer',
          'PKR 40,000 monthly, invoiced on the first.',
          '',
          '## History',
          'Earlier engagements were one-off dashboards billed hourly.',
        ].join('\n')
        service.documents.upsert({
          scopeId: globalScope.id, path: 'wiki/clients/yasir-bhai.md', type: 'client',
          title: 'Yasir Bhai', summary: 'Client contact', body,
          origin: 'curated', contentHash: 'vault-1', updatedAt: '2026-09-01T00:00:00.000Z',
        })

        // Asked from the project scope, the way an Agent turn actually asks.
        const request = async (method: BrainNavigationMethod, payload: unknown) => service.handle({ id: '9', method, payload })
        const evidence = await assembleBrainEvidence(request, projectScope.id, 'Yasir ka retainer kitna hai?')

        expect(evidence).toContain('PKR 40,000 monthly')
        expect(evidence).toContain('wiki/clients/yasir-bhai.md#Yasir Bhai > Retainer')
        // The parts that do not answer stay out -- that is the whole saving.
        expect(evidence).not.toContain('met through Iftikhar')
        expect(evidence).not.toContain('billed hourly')

        // And it is cheaper than reading the document, which is the point.
        const whole = await readBrainDocument(request, projectScope.id, 'wiki/clients/yasir-bhai.md')
        expect(evidence.length).toBeLessThan(whole.length)
      } finally { service.close() }
    })
  })

  describe('activity timeline and the daily note', () => {
    it('materialises the day into a Library document, idempotently, and keeps it out of the index', () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-daily-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        service.documents.upsert({
          scopeId: scope.id, path: 'wiki/clients/yasir-bhai.md', type: 'client',
          title: 'Yasir Bhai', summary: 'Client', body: ['# Yasir Bhai', 'Retainer PKR 40,000.'].join(String.fromCharCode(10)),
          origin: 'curated', contentHash: 'v1', updatedAt: '2026-09-01T00:00:00.000Z',
        })

        service.handle({ id: '1', method: 'recordEvent', payload: {
          scopeId: scope.id, action: 'agent.turn', targetId: 'turn-1',
          metadata: {
            prompt: 'Yasir ka retainer kitna hai?',
            documentsRead: ['wiki/clients/yasir-bhai.md'],
            inputTokens: 1200, outputTokens: 300, totalCostUsd: 0.01,
          },
        } })

        const first = service.handle({ id: '2', method: 'knowledge.dailyNote', payload: { scopeId: scope.id } }) as
          { path: string; written: boolean; eventCount: number }
        expect(first.written).toBe(true)
        expect(first.eventCount).toBe(1)

        // Readable and searchable like any other document...
        const read = service.handle({ id: '3', method: 'knowledge.read', payload: { scopeId: scope.id, path: first.path } }) as { text: string }
        expect(read.text).toContain('Yasir ka retainer kitna hai?')
        expect(read.text).toContain('1,500 tokens')

        // ...but deliberately absent from the index every agent turn carries.
        const manifest = service.handle({ id: '4', method: 'knowledge.manifest', payload: { scopeId: scope.id } }) as { text: string }
        expect(manifest.text).toContain('wiki/clients/yasir-bhai.md')
        expect(manifest.text).not.toContain(first.path)

        // The wiki link the renderer wrote resolves, so the note joins the graph.
        const links = service.database.handle
          .prepare('SELECT target_path, resolved FROM knowledge_links WHERE target_path = ?')
          .all('wiki/clients/yasir-bhai.md')
        expect(links).toContainEqual({ target_path: 'wiki/clients/yasir-bhai.md', resolved: 1 })

        // Re-running the same day must not create a second version.
        service.handle({ id: '5', method: 'knowledge.dailyNote', payload: { scopeId: scope.id } })
        const versions = service.database.handle
          .prepare('SELECT COUNT(*) AS n FROM knowledge_documents WHERE path = ?')
          .get(first.path) as { n: number }
        expect(versions.n).toBe(1)
      } finally { service.close() }
    })

    it('writes nothing for a day with no activity', () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-daily-empty-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const result = service.handle({ id: '1', method: 'knowledge.dailyNote', payload: { scopeId: scope.id } }) as { written: boolean }

        expect(result.written).toBe(false)
        expect(service.handle({ id: '2', method: 'knowledge.list', payload: { scopeId: scope.id } })).toEqual([])
      } finally { service.close() }
    })

    it('records an event when a vault import runs', () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-daily-import-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const vault = join(root, 'vault')
        mkdirSync(vault, { recursive: true })
        writeFileSync(join(vault, 'note.md'), ['# A note', 'Something.'].join(String.fromCharCode(10)))
        service.handle({ id: '1', method: 'knowledge.importVault', payload: { scopeId: scope.id, vaultRoot: vault } })

        const note = service.handle({ id: '2', method: 'knowledge.dailyNote', payload: { scopeId: scope.id } }) as { body: string }
        expect(note.body).toContain('Imported 1 documents from the vault')
      } finally { service.close() }
    })
  })

  describe('link neighbourhood', () => {
    it('walks links through the scope chain and refuses a traversal path', async () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-neighbors-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const globalScope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const projectScope = service.database.ensureScope({ type: 'project', externalRef: 'p1', name: 'P', parentId: globalScope.id })
        const put = (path: string, body: string) => service.documents.upsert({
          scopeId: globalScope.id, path, type: 'note', title: path, summary: '', body,
          origin: 'curated', contentHash: `${path}-1`, updatedAt: '2026-09-01T00:00:00.000Z',
        })
        put('wiki/clients/yasir-bhai.md', 'Retainer PKR 40,000.')
        put('wiki/index/clients.md', 'See [[yasir-bhai]].')

        // Asked from the project scope: the chain must reach global.
        const request = async (method: BrainNavigationMethod, payload: unknown) => service.handle({ id: 'n', method, payload })
        const output = await readBrainNeighbors(request, projectScope.id, 'wiki/clients/yasir-bhai.md', 2)
        expect(output).toContain('wiki/index/clients.md')
        expect(output).toContain('1 hop')

        expect(await readBrainNeighbors(request, projectScope.id, '../secrets.md', 1)).toMatch(/refused/i)
      } finally { service.close() }
    })
  })

  /**
   * The Health tab's button was the only thing that ever called buildVectors,
   * so a document written after the last click stayed invisible to meaning
   * search until someone clicked again. These cover the refresh that now runs
   * on the write paths, and both guards that keep it from being a surprise.
   */
  describe('automatic vector refresh', () => {
    const NL = String.fromCharCode(10)

    /** Counts calls, so a test can prove the model was never reached. */
    function countingExtractor() {
      const state = { calls: 0 }
      __setExtractorForTests(text => {
        state.calls += 1
        const raw = ['note', 'second', 'third'].map(word => (String(text).toLocaleLowerCase().includes(word) ? 1 : 0))
        const length = Math.hypot(...raw) || 1
        return Promise.resolve({ data: raw.map(value => value / length) })
      })
      return state
    }

    afterEach(() => { __setExtractorForTests(null) })

    it('indexes a newly imported document when an index already exists', async () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-auto-vectors-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const vault = join(root, 'vault')
        mkdirSync(vault, { recursive: true })
        writeFileSync(join(vault, 'note.md'), ['# A note', 'Something.'].join(NL))
        countingExtractor()

        await service.handle({ id: '1', method: 'knowledge.importVault', payload: { scopeId: scope.id, vaultRoot: vault } })
        // The owner opts in once, the way the Health tab button does.
        await service.documents.buildVectors([scope.id])
        expect(service.documents.vectorCoverage([scope.id])).toEqual({ documents: 1, vectors: 1 })

        writeFileSync(join(vault, 'second.md'), ['# Second', 'More.'].join(NL))
        await service.handle({ id: '2', method: 'knowledge.importVault', payload: { scopeId: scope.id, vaultRoot: vault } })

        expect(service.documents.vectorCoverage([scope.id])).toEqual({ documents: 2, vectors: 2 })
      } finally { service.close() }
    })

    it('never loads the model for an install that has no index', async () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-auto-vectors-off-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const vault = join(root, 'vault')
        mkdirSync(vault, { recursive: true })
        writeFileSync(join(vault, 'note.md'), ['# A note', 'Something.'].join(NL))
        const extractor = countingExtractor()

        await service.handle({ id: '1', method: 'knowledge.importVault', payload: { scopeId: scope.id, vaultRoot: vault } })

        expect(extractor.calls).toBe(0)
        expect(service.documents.vectorCoverage([scope.id])).toEqual({ documents: 1, vectors: 0 })
      } finally { service.close() }
    })

    it('leaves a backlog past the cap to the Health tab rather than stalling the import', async () => {
      const root = mkdtempSync(join(tmpdir(), 'flowdesk-auto-vectors-cap-'))
      roots.push(root)
      const service = new BrainService(join(root, 'brain.sqlite'))
      try {
        const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
        const vault = join(root, 'vault')
        mkdirSync(vault, { recursive: true })
        writeFileSync(join(vault, 'note.md'), ['# A note', 'Something.'].join(NL))
        countingExtractor()

        await service.handle({ id: '1', method: 'knowledge.importVault', payload: { scopeId: scope.id, vaultRoot: vault } })
        await service.documents.buildVectors([scope.id])

        const added = AUTO_VECTOR_LIMIT + 1
        for (let index = 0; index < added; index += 1) {
          writeFileSync(join(vault, `bulk-${index}.md`), [`# Bulk ${index}`, 'Body.'].join(NL))
        }
        await service.handle({ id: '2', method: 'knowledge.importVault', payload: { scopeId: scope.id, vaultRoot: vault } })

        expect(service.documents.vectorCoverage([scope.id])).toEqual({ documents: added + 1, vectors: 1 })
      } finally { service.close() }
    })
  })
})
