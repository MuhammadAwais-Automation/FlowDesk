import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { readBrainDocument } from '../agent/brainNavigation'
import { BrainService } from './service'

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

      const request = async (method: 'knowledge.read' | 'knowledge.search', payload: unknown) => service.handle({
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
        const request = async (method: 'knowledge.read' | 'knowledge.search', payload: unknown) => service.handle({ id: '2', method, payload })
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
})
