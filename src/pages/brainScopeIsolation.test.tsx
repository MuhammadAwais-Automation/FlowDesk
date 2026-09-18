/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrainCandidate, BrainJob, BrainScope } from '@/types/brain'
import type { CompactionReport, DocumentSearchHit, KnowledgeCandidate, KnowledgeDocument, UnresolvedLink, VaultImportReport } from '@/types/brainKnowledge'
import Intelligence from './Intelligence'

const scopes: BrainScope[] = ['global', 'a', 'b'].map(id => ({
  id, type: id === 'global' ? 'global' : 'client', externalRef: id,
  name: id.toUpperCase(), parentId: null, createdAt: '2026-09-05T00:00:00.000Z',
}))
const job: BrainJob = {
  id: 'job-a', scopeId: 'a', recipeId: 'Private job A', recipeVersion: 1, accountId: null,
  status: 'running', parameters: {}, result: null, createdAt: scopes[0].createdAt, updatedAt: scopes[0].createdAt,
}
const candidate: BrainCandidate = {
  id: 'candidate-a', scopeId: 'a', kind: 'fact', text: 'Private candidate A',
  status: 'candidate', origin: 'external', createdAt: scopes[0].createdAt,
}
const knowledgeCandidate: KnowledgeCandidate = {
  id: 'knowledge-candidate-a', scopeId: 'a', targetPath: null, type: 'note',
  title: 'Private knowledge candidate A', summary: '', body: 'Private knowledge body A',
  origin: 'machine-inferred', sessionRef: 'agent-session://s1/t1', status: 'pending',
  createdAt: scopes[0].createdAt, decidedAt: null,
}
const knowledgeDocument: KnowledgeDocument = {
  id: 'doc-a', path: 'wiki/clients/private-a.md', scopeId: 'a', type: 'client',
  title: 'Private client A', summary: 'Scoped document', contentHash: 'hash-a', byteSize: 10,
  origin: 'curated', validFrom: scopes[0].createdAt, validTo: null,
  createdAt: scopes[0].createdAt, updatedAt: scopes[0].createdAt,
}
const searchHit: DocumentSearchHit = {
  path: 'wiki/clients/private-a.md', title: 'Private client A', type: 'client',
  snippet: 'Private [match] A', score: 1, updatedAt: scopes[0].createdAt,
}
const importReport: VaultImportReport = { scanned: 5, imported: 3, updated: 1, unchanged: 1, skipped: 0, failures: [], durationMs: 12 }
const compactionReport: CompactionReport = {
  scanned: 2, merged: 1, leftStandalone: 1,
  decisions: [{ capturePath: 'captures/x.md', outcome: 'merged', targetPath: 'wiki/clients/private-a.md', topScore: 0.5, secondScore: null }],
}
const answerPack = {
  question: 'Yasir Bhai?',
  evidence: 'Private [match] A',
  sections: [{ path: 'wiki/clients/private-a.md', title: 'Private client A', headingPath: 'Rates', text: 'Private [match] A', score: 1 }],
  pointerFollowed: null,
  strategy: 'ranked' as const,
  estimatedTokens: 20,
  candidatesConsidered: 3,
}
const unresolvedLink: UnresolvedLink = { documentPath: 'wiki/clients/private-a.md', documentTitle: 'Private client A', targetPath: 'wiki/people/ghost-a.md' }
const consent = { requiresConsent: true, provider: 'whatsapp', fields: ['body'], retentionDays: 30, destinationScopeId: 'a' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const api = {
  brainEnsureScope: vi.fn(), brainListScopes: vi.fn(), projectList: vi.fn(), storeGet: vi.fn(), storeSet: vi.fn(),
  brainGetStatus: vi.fn(), brainListCandidates: vi.fn(), brainDecideCandidate: vi.fn(),
  brainListJobs: vi.fn(), onBrainEvent: vi.fn(),
  brainRunSocialRecipe: vi.fn(), brainGrantConsent: vi.fn(),
  brainListOpportunities: vi.fn(), brainCountOpportunities: vi.fn(), brainGetOpportunityEvidence: vi.fn(), brainReviewOpportunity: vi.fn(),
  brainBuildDecisionBrief: vi.fn(), brainListSourceMetrics: vi.fn(), brainGetConsent: vi.fn(),
  brainListMonitors: vi.fn(), brainCreateMonitor: vi.fn(), brainSetMonitorStatus: vi.fn(), brainDeleteMonitor: vi.fn(),
  brainKnowledgeListCandidates: vi.fn(), brainKnowledgeDecideCandidate: vi.fn(), brainKnowledgeListUnresolvedLinks: vi.fn(),
  brainGetVaultRoot: vi.fn(), brainChooseVaultFolder: vi.fn(), brainKnowledgeList: vi.fn(),
  brainKnowledgeSearch: vi.fn(), brainKnowledgeRead: vi.fn(), brainKnowledgeManifest: vi.fn(),
  brainKnowledgeImportVault: vi.fn(), brainKnowledgeCompact: vi.fn(), brainKnowledgeMigrateMemories: vi.fn(),
  brainExportBackup: vi.fn(), brainImportBackup: vi.fn(),
  brainKnowledgeDailyNote: vi.fn(), brainListEvents: vi.fn(), brainKnowledgeNeighbors: vi.fn(), brainKnowledgeBuildVectors: vi.fn(), brainKnowledgeVectorStatus: vi.fn(),
  brainKnowledgeAnswerPack: vi.fn(), agentSessionTurns: vi.fn(),
  brainEntityList: vi.fn(), brainEntityBackfill: vi.fn(),
  brainKnowledgeGraph: vi.fn(),
}
let Brain: ComponentType

beforeAll(async () => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  Brain = (await import('./Brain')).default
})

beforeEach(() => {
  vi.resetAllMocks()
  api.brainEnsureScope.mockResolvedValue(scopes[0])
  api.brainListScopes.mockImplementation(async () => [...scopes])
  api.projectList.mockResolvedValue({ projects: [], activeProjectId: null })
  api.storeGet.mockResolvedValue('a')
  api.storeSet.mockResolvedValue(undefined)
  api.brainGetStatus.mockResolvedValue({ ready: true, degraded: false, fts5: true, schemaVersion: 1 })
  api.brainListCandidates.mockImplementation(async (id: string) => id === 'a' ? [candidate] : [])
  api.brainKnowledgeListCandidates.mockImplementation(async ({ scopeId }: { scopeId: string }) => scopeId === 'a' ? [knowledgeCandidate] : [])
  api.brainKnowledgeDecideCandidate.mockResolvedValue({ candidate: { ...knowledgeCandidate, status: 'accepted' }, document: null })
  api.brainKnowledgeListUnresolvedLinks.mockImplementation(async ({ scopeId }: { scopeId: string }) => scopeId === 'a' ? [unresolvedLink] : [])
  api.brainGetVaultRoot.mockResolvedValue(null)
  api.brainKnowledgeList.mockResolvedValue([])
  api.brainKnowledgeDailyNote.mockResolvedValue({ date: '2026-09-15', path: 'daily/2026-09-15.md', written: false, eventCount: 0, body: '' })
  api.brainListEvents.mockResolvedValue([])
  api.brainKnowledgeNeighbors.mockResolvedValue({ origin: '', nodes: [], edges: [] })
  api.brainKnowledgeVectorStatus.mockResolvedValue({ documents: 0, vectors: 0, model: 'test', failed: false })
  api.brainListJobs.mockResolvedValue([job])
  api.onBrainEvent.mockReturnValue(() => undefined)
  api.brainListOpportunities.mockResolvedValue([])
  api.brainCountOpportunities.mockResolvedValue(0)
  api.brainListMonitors.mockResolvedValue([])
  api.brainGetOpportunityEvidence.mockResolvedValue([])
  api.brainListSourceMetrics.mockResolvedValue([])
  api.brainGetConsent.mockResolvedValue(false)
  api.brainEntityList.mockResolvedValue([])
  api.brainKnowledgeGraph.mockResolvedValue({ nodes: [], edges: [], unresolvedCount: 0 })
})

afterEach(cleanup)

async function mount(Page: ComponentType) {
  render(<Page />)
  await waitFor(() => expect(screen.getByText('Client · A')).toBeTruthy())
}

function switchScope(id = 'b') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Brain scope' }), { target: { value: id } })
}

describe('Brain scope transitions', () => {
  it('removes old Review actions while the new refresh is pending and after it fails', async () => {
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
    await waitFor(() => expect(screen.getByText('Private candidate A')).toBeTruthy())
    const refresh = deferred<never>()
    api.brainListCandidates.mockReturnValue(refresh.promise)
    switchScope()
    expect(screen.queryByText('Private candidate A')).toBeNull()
    await act(async () => refresh.reject(new Error('Refresh unavailable')))
    expect(screen.queryByText('Private candidate A')).toBeNull()
    expect(screen.getByText('Refresh unavailable')).toBeTruthy()
  })

  it('shows knowledge candidates alongside memory candidates and unresolved links in Review, tagged by system, and accepts via the knowledge decide call', async () => {
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: /^Review/ }))
    await waitFor(() => expect(screen.getByText('Private knowledge candidate A')).toBeTruthy())
    expect(screen.getByText('Private candidate A')).toBeTruthy()
    expect(screen.getByText('Memory')).toBeTruthy()
    const knowledgeCard = screen.getByText('Private knowledge candidate A').closest('section')!
    expect(within(knowledgeCard).getByText('Knowledge')).toBeTruthy()
    const [acceptButton] = within(knowledgeCard).getAllByRole('button')
    fireEvent.click(acceptButton)
    await waitFor(() => expect(api.brainKnowledgeDecideCandidate).toHaveBeenCalledWith({ id: 'knowledge-candidate-a', decision: 'accept' }))
    expect(screen.getByText(/Private client A/)).toBeTruthy()
    expect(screen.getByText(/wiki\/people\/ghost-a\.md/)).toBeTruthy()
  })

  it('loads the knowledge document list and unresolved links only for the selected scope, discarding a stale response after switching', async () => {
    const response = deferred<KnowledgeDocument[]>()
    api.brainKnowledgeList.mockReturnValueOnce(response.promise).mockResolvedValue([])
    await mount(Brain)
    expect(api.brainKnowledgeList).toHaveBeenCalledWith({ scopeId: 'a', limit: 200 })
    switchScope()
    await act(async () => response.resolve([knowledgeDocument]))
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.queryByText('Private client A')).toBeNull()
  })

  it('shows recently updated documents on Today and opens the reader from there', async () => {
    api.brainKnowledgeList.mockResolvedValue([knowledgeDocument])
    api.brainKnowledgeRead.mockResolvedValue({
      path: knowledgeDocument.path, title: knowledgeDocument.title, type: 'client',
      text: 'Full private body A', updatedAt: knowledgeDocument.updatedAt, estimatedTokens: 5, truncated: false,
    })
    await mount(Brain)
    await waitFor(() => expect(screen.getByText('Private client A')).toBeTruthy())
    fireEvent.click(screen.getByText('Private client A'))
    await waitFor(() => expect(screen.getByText('Full private body A')).toBeTruthy())
    expect(api.brainKnowledgeRead).toHaveBeenCalledWith({ scopeId: 'a', path: knowledgeDocument.path })
  })

  it('searches the Library and shows matching hits with their snippet', async () => {
    api.brainKnowledgeSearch.mockResolvedValue([searchHit])
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    fireEvent.change(screen.getByPlaceholderText('Search documents…'), { target: { value: 'private' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Search documents…'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Private client A')).toBeTruthy())
    expect(api.brainKnowledgeSearch).toHaveBeenCalledWith({ scopeId: 'a', query: 'private', types: undefined, limit: 30 })
    expect(screen.getByText('Private [match] A')).toBeTruthy()
  })

  it('asks a question on Ask and shows a cited passage, independent of the Library search state', async () => {
    api.brainKnowledgeAnswerPack.mockResolvedValue(answerPack)
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: /^Ask/ }))
    fireEvent.change(screen.getByPlaceholderText(/poochein/), { target: { value: 'Yasir Bhai?' } })
    fireEvent.keyDown(screen.getByPlaceholderText(/poochein/), { key: 'Enter' })
    await waitFor(() => expect(screen.getAllByText(/wiki\/clients\/private-a\.md/).length).toBeGreaterThan(0))
    expect(api.brainKnowledgeAnswerPack).toHaveBeenCalledWith({ scopeId: 'a', question: 'Yasir Bhai?' })
    fireEvent.click(screen.getByRole('button', { name: /^Library/ }))
    expect(screen.queryByPlaceholderText('Search documents…')).toBeTruthy()
  })

  it('shows a vault import report after Import now, scoped to the selected scope', async () => {
    api.brainChooseVaultFolder.mockResolvedValue('E:/vault')
    api.brainKnowledgeImportVault.mockResolvedValue(importReport)
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Health' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await waitFor(() => expect(screen.getByText('E:/vault')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Import now' }))
    await waitFor(() => expect(api.brainKnowledgeImportVault).toHaveBeenCalledWith({ scopeId: 'a', vaultRoot: 'E:/vault' }))
    await waitFor(() => expect(screen.getByText(/Scanned 5/)).toBeTruthy())
  })

  it('refuses picking the legacy memory-vault folder and surfaces the error', async () => {
    api.brainChooseVaultFolder.mockRejectedValue(new Error("That folder is FlowDesk's internal memory vault, not a folder to import from. Choose your own notes folder instead."))
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Health' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await waitFor(() => expect(screen.getByText(/internal memory vault/)).toBeTruthy())
  })

  it('shows a compaction report with its per-capture decisions after Run cleanup now', async () => {
    api.brainKnowledgeCompact.mockResolvedValue(compactionReport)
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Health' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run cleanup now' }))
    await waitFor(() => expect(api.brainKnowledgeCompact).toHaveBeenCalledWith({ scopeId: 'a' }))
    await waitFor(() => expect(screen.getByText(/Merged 1/)).toBeTruthy())
    expect(screen.getByText('captures/x.md')).toBeTruthy()
    expect(screen.getByText(/merged into wiki\/clients\/private-a\.md/)).toBeTruthy()
  })

  it('runs a dry-run and a real memories migration and shows the report', async () => {
    api.brainKnowledgeMigrateMemories.mockResolvedValueOnce({ scanned: 3, migrated: 3, unchanged: 0, dryRun: true })
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Health' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check (dry run)' }))
    await waitFor(() => expect(api.brainKnowledgeMigrateMemories).toHaveBeenCalledWith({ dryRun: true }))
    await waitFor(() => expect(screen.getByText(/Migrated 3/)).toBeTruthy())
    expect(screen.getByText(/kuch likha nahi gaya/)).toBeTruthy()

    api.brainKnowledgeMigrateMemories.mockResolvedValueOnce({ scanned: 3, migrated: 3, unchanged: 0, dryRun: false })
    fireEvent.click(screen.getByRole('button', { name: 'Migrate now' }))
    await waitFor(() => expect(api.brainKnowledgeMigrateMemories).toHaveBeenCalledWith({ dryRun: false }))
  })
})

describe('Intelligence scope transitions', () => {
  it('grants and completes a capture when the originating scope remains selected', async () => {
    api.brainRunSocialRecipe.mockResolvedValueOnce(consent).mockResolvedValueOnce({ requiresConsent: false, job: { id: 'job-queued', status: 'queued' } })
    api.brainGrantConsent.mockResolvedValue(true)
    await mount(Intelligence)
    fireEvent.click(screen.getByRole('button', { name: 'Scan unread' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Grant consent & run once' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Grant consent & run once' }))
    await waitFor(() => expect(screen.getByText('Job queued: job-queued · queued')).toBeTruthy())
    expect(api.brainGrantConsent).toHaveBeenCalledWith({ scopeId: 'a', recipeId: 'whatsapp.unread_intelligence', provider: 'whatsapp', fields: ['body'] })
    expect(api.brainRunSocialRecipe).toHaveBeenLastCalledWith(expect.objectContaining({ scopeId: 'a' }))
    switchScope()
    expect(screen.queryByText('Job queued: job-queued · queued')).toBeNull()
  })

  it('reports enqueue status and never claims a zero-record capture completed', async () => {
    api.brainRunSocialRecipe.mockResolvedValue({ requiresConsent: false, job: { id: 'job-42', status: 'queued' } })
    await mount(Intelligence)
    fireEvent.click(screen.getByRole('button', { name: 'Scan unread' }))
    await waitFor(() => expect(screen.getByText('Job queued: job-42 · queued')).toBeTruthy())
    expect(screen.queryByText(/Capture complete/)).toBeNull()
  })

  it('ignores an old capture even after switching away and back to its scope', async () => {
    const response = deferred<typeof consent>()
    api.brainRunSocialRecipe.mockReturnValue(response.promise)
    await mount(Intelligence)
    fireEvent.click(screen.getByRole('button', { name: 'Scan unread' }))
    switchScope()
    switchScope('a')
    await act(async () => response.resolve(consent))
    expect(screen.queryByText('Private source consent required')).toBeNull()
  })

  it.each([consent, { requiresConsent: false, manifest: { recordCount: 99 } }])('ignores a late capture response from the previous scope: %j', async result => {
    const response = deferred<typeof result>()
    api.brainRunSocialRecipe.mockReturnValue(response.promise)
    await mount(Intelligence)
    fireEvent.click(screen.getByRole('button', { name: 'Scan unread' }))
    switchScope()
    await act(async () => response.resolve(result))
    expect(screen.queryByText('Private source consent required')).toBeNull()
    expect(screen.queryByText('Capture complete: 99 records')).toBeNull()
  })

  it('does not run the old capture after a pending consent grant completes in another scope', async () => {
    const grant = deferred<unknown>()
    api.brainRunSocialRecipe.mockResolvedValue(consent)
    api.brainGrantConsent.mockReturnValue(grant.promise)
    await mount(Intelligence)
    fireEvent.click(screen.getByRole('button', { name: 'Scan unread' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Grant consent & run once' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Grant consent & run once' }))
    switchScope()
    await act(async () => grant.resolve(true))
    expect(api.brainRunSocialRecipe).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Private source consent required')).toBeNull()
  })

  it('rejects consent whose destination does not match the originating scope', async () => {
    api.brainRunSocialRecipe.mockResolvedValue({ ...consent, destinationScopeId: 'b' })
    await mount(Intelligence)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Scan unread' })))
    expect(screen.queryByRole('button', { name: 'Grant consent & run once' })).toBeNull()
  })
})
