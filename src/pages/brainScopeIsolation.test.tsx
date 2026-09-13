/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrainCandidate, BrainContextPack, BrainJob, BrainMemory, BrainScope } from '@/types/brain'
import type { CompactionReport, DocumentSearchHit, KnowledgeCandidate, KnowledgeDocument, VaultImportReport } from '@/types/brainKnowledge'
import Intelligence from './Intelligence'

const scopes: BrainScope[] = ['global', 'a', 'b'].map(id => ({
  id, type: id === 'global' ? 'global' : 'client', externalRef: id,
  name: id.toUpperCase(), parentId: null, createdAt: '2026-09-05T00:00:00.000Z',
}))
const memory: BrainMemory = {
  id: 'memory-a', scopeId: 'a', kind: 'fact', text: 'Private memory A', status: 'accepted',
  shareable: false, importance: 50, subject: null, predicate: null, sourceRef: 'user://a',
  createdAt: scopes[0].createdAt, updatedAt: scopes[0].createdAt,
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
const job: BrainJob = {
  id: 'job-a', scopeId: 'a', recipeId: 'Private job A', recipeVersion: 1, accountId: null,
  status: 'running', parameters: {}, result: null, createdAt: scopes[0].createdAt, updatedAt: scopes[0].createdAt,
}
const pack: BrainContextPack = {
  summary: 'Answer A', citations: [{ id: 'citation-a', memoryId: memory.id, text: 'Private answer A', kind: 'fact', scopeId: 'a', sourceRef: 'user://a', score: 1 }],
  conflicts: [], scopePath: ['a'], estimatedTokens: 20,
}
const conflict = { id: 'conflict-a', memory_id: memory.id, file_path: 'a.md', base_revision: 1, database_text: 'Private vault A', file_text: 'File A', status: 'pending', created_at: scopes[0].createdAt, resolved_at: null }
const consent = { requiresConsent: true, provider: 'whatsapp', fields: ['body'], retentionDays: 30, destinationScopeId: 'a' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const api = {
  brainEnsureScope: vi.fn(), brainListScopes: vi.fn(), projectList: vi.fn(), storeGet: vi.fn(), storeSet: vi.fn(),
  brainGetStatus: vi.fn(), brainGetOverview: vi.fn(), brainListMemories: vi.fn(), brainListCandidates: vi.fn(),
  brainListJobs: vi.fn(), onBrainEvent: vi.fn(), brainSearch: vi.fn(), brainGetArtifactManifest: vi.fn(),
  brainGetVaultStatus: vi.fn(), brainListVaultConflicts: vi.fn(), brainResolveVaultConflict: vi.fn(),
  brainRunSocialRecipe: vi.fn(), brainGrantConsent: vi.fn(),
  brainListOpportunities: vi.fn(), brainCountOpportunities: vi.fn(), brainGetOpportunityEvidence: vi.fn(), brainReviewOpportunity: vi.fn(),
  brainBuildDecisionBrief: vi.fn(), brainListSourceMetrics: vi.fn(), brainGetConsent: vi.fn(),
  brainListMonitors: vi.fn(), brainCreateMonitor: vi.fn(), brainSetMonitorStatus: vi.fn(), brainDeleteMonitor: vi.fn(),
  brainKnowledgeListCandidates: vi.fn(), brainKnowledgeDecideCandidate: vi.fn(),
  brainGetVaultRoot: vi.fn(), brainChooseVaultFolder: vi.fn(), brainKnowledgeList: vi.fn(),
  brainKnowledgeSearch: vi.fn(), brainKnowledgeRead: vi.fn(), brainKnowledgeManifest: vi.fn(),
  brainKnowledgeImportVault: vi.fn(), brainKnowledgeCompact: vi.fn(),
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
  api.brainGetOverview.mockResolvedValue({ memories: 1, candidates: 1, jobs: 1, activeJobs: 1 })
  api.brainListMemories.mockImplementation(async (id: string) => id === 'a' ? [memory] : [])
  api.brainListCandidates.mockImplementation(async (id: string) => id === 'a' ? [candidate] : [])
  api.brainKnowledgeListCandidates.mockImplementation(async ({ scopeId }: { scopeId: string }) => scopeId === 'a' ? [knowledgeCandidate] : [])
  api.brainKnowledgeDecideCandidate.mockResolvedValue({ candidate: { ...knowledgeCandidate, status: 'accepted' }, document: null })
  api.brainGetVaultRoot.mockResolvedValue(null)
  api.brainKnowledgeList.mockResolvedValue([])
  api.brainListJobs.mockResolvedValue([job])
  api.onBrainEvent.mockReturnValue(() => undefined)
  api.brainGetVaultStatus.mockResolvedValue({ root: 'vault', watching: true, conflicts: 1 })
  api.brainListVaultConflicts.mockImplementation(async (scopeId: string) => scopeId === 'b' ? [] : [conflict])
  api.brainResolveVaultConflict.mockResolvedValue(memory)
  api.brainListOpportunities.mockResolvedValue([])
  api.brainCountOpportunities.mockResolvedValue(0)
  api.brainListMonitors.mockResolvedValue([])
  api.brainGetOpportunityEvidence.mockResolvedValue([])
  api.brainListSourceMetrics.mockResolvedValue([])
  api.brainGetConsent.mockResolvedValue(false)
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
  it('shows opportunities only from the selected Brain scope', async () => {
    api.brainListOpportunities.mockImplementation(async ({ scopeId }: { scopeId: string }) => scopeId === 'a' ? [{
      id: 'brain-opportunity-a', scopeId: 'a', category: 'direct_lead', title: 'Private lead A',
      summary: 'Scoped lead', score: 81, confidence: 0.8, freshness: scopes[0].createdAt,
      status: 'new', evidenceCount: 1, createdAt: scopes[0].createdAt, updatedAt: scopes[0].createdAt,
    }] : [])
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))
    await waitFor(() => expect(screen.getByText('Private lead A')).toBeTruthy())
    switchScope()
    expect(screen.queryByText('Private lead A')).toBeNull()
  })

  it.each([
    ['Memories', 'Private memory A'], ['Review Inbox', 'Private candidate A'], ['Jobs', 'Private job A'],
  ])('removes old %s actions while the new refresh is pending and after it fails', async (tab, text) => {
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: tab }))
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy())
    const refresh = deferred<never>()
    api.brainGetOverview.mockReturnValue(refresh.promise)
    switchScope()
    expect(screen.queryByText(text)).toBeNull()
    await act(async () => refresh.reject(new Error('Refresh unavailable')))
    expect(screen.queryByText(text)).toBeNull()
    expect(screen.getByText('Refresh unavailable')).toBeTruthy()
  })

  it('shows knowledge candidates alongside memory candidates in Review Inbox, tagged by system, and accepts via the knowledge decide call', async () => {
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Review Inbox' }))
    await waitFor(() => expect(screen.getByText('Private knowledge candidate A')).toBeTruthy())
    expect(screen.getByText('Private candidate A')).toBeTruthy()
    expect(screen.getByText('Memory')).toBeTruthy()
    const knowledgeCard = screen.getByText('Private knowledge candidate A').closest('section')!
    expect(within(knowledgeCard).getByText('Knowledge')).toBeTruthy()
    const [acceptButton] = within(knowledgeCard).getAllByRole('button')
    fireEvent.click(acceptButton)
    await waitFor(() => expect(api.brainKnowledgeDecideCandidate).toHaveBeenCalledWith({ id: 'knowledge-candidate-a', decision: 'accept' }))
  })

  it('does not restore an answer from the previous scope', async () => {
    const response = deferred<BrainContextPack>()
    api.brainSearch.mockReturnValueOnce(response.promise).mockResolvedValueOnce({ ...pack, citations: [{ ...pack.citations[0], scopeId: 'b', text: 'Current answer B' }] })
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Brain' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    switchScope()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'current' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Current answer B')).toBeTruthy())
    await act(async () => response.resolve(pack))
    expect(screen.queryByText('Private answer A')).toBeNull()
    expect(screen.getByText('Current answer B')).toBeTruthy()
  })

  it('keeps the newest search when responses arrive out of order', async () => {
    const first = deferred<BrainContextPack>()
    api.brainSearch.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ...pack, citations: [{ ...pack.citations[0], text: 'New answer A' }] })
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Brain' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'first' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'second' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('New answer A')).toBeTruthy())
    await act(async () => first.resolve(pack))
    expect(screen.getByText('New answer A')).toBeTruthy()
    expect(screen.queryByText('Private answer A')).toBeNull()
  })

  it('does not restore an artifact from the previous scope', async () => {
    const response = deferred<Record<string, unknown>>()
    api.brainGetArtifactManifest.mockReturnValue(response.promise)
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Jobs' }))
    await waitFor(() => expect(screen.getByText('Private job A')).toBeTruthy())
    fireEvent.click(screen.getByTitle('Artifact manifest'))
    switchScope()
    await act(async () => response.resolve({ privateArtifact: 'Artifact A' }))
    expect(screen.queryByText(/Artifact A/)).toBeNull()
  })

  it('loads and resolves vault conflicts only in the selected scope and clears on switch', async () => {
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await waitFor(() => expect(screen.getByText('Private vault A')).toBeTruthy())
    expect(api.brainListVaultConflicts).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByRole('button', { name: 'Keep Brain' }))
    await waitFor(() => expect(api.brainResolveVaultConflict).toHaveBeenCalledWith({ id: 'conflict-a', scopeId: 'a', resolution: 'database' }))
    switchScope()
    expect(screen.queryByText('Private vault A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    await waitFor(() => expect(api.brainListVaultConflicts).toHaveBeenLastCalledWith('b'))
    expect(screen.queryByText('Private vault A')).toBeNull()
  })

  it('ignores a vault response that completes after a scope switch', async () => {
    const response = deferred<Array<Record<string, unknown>>>()
    api.brainListVaultConflicts.mockReturnValue(response.promise)
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    switchScope()
    await act(async () => response.resolve([conflict]))
    expect(screen.queryByText('Private vault A')).toBeNull()
  })

  it('loads the knowledge document list only for the selected scope and discards a stale response after switching', async () => {
    const response = deferred<KnowledgeDocument[]>()
    api.brainKnowledgeList.mockReturnValueOnce(response.promise).mockResolvedValue([])
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    expect(api.brainKnowledgeList).toHaveBeenCalledWith({ scopeId: 'a', limit: 200 })
    switchScope()
    await act(async () => response.resolve([knowledgeDocument]))
    expect(screen.queryByText('Private client A')).toBeNull()
  })

  it('searches knowledge documents and shows matching hits with their snippet', async () => {
    api.brainKnowledgeSearch.mockResolvedValue([searchHit])
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    fireEvent.change(screen.getByPlaceholderText('Search knowledge documents…'), { target: { value: 'private' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Search knowledge documents…'), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Private client A')).toBeTruthy())
    expect(api.brainKnowledgeSearch).toHaveBeenCalledWith({ scopeId: 'a', query: 'private', types: undefined, limit: 20 })
    expect(screen.getByText('Private [match] A')).toBeTruthy()
  })

  it('reads a document on click and shows its full text', async () => {
    api.brainKnowledgeList.mockResolvedValue([knowledgeDocument])
    api.brainKnowledgeRead.mockResolvedValue({
      path: knowledgeDocument.path, title: knowledgeDocument.title, type: 'client',
      text: 'Full private body A', updatedAt: knowledgeDocument.updatedAt, estimatedTokens: 5, truncated: false,
    })
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    await waitFor(() => expect(screen.getByText('Private client A')).toBeTruthy())
    fireEvent.click(screen.getByText('Private client A'))
    await waitFor(() => expect(screen.getByText('Full private body A')).toBeTruthy())
    expect(api.brainKnowledgeRead).toHaveBeenCalledWith({ scopeId: 'a', path: knowledgeDocument.path })
  })

  it('shows a vault import report after Import now, scoped to the selected scope', async () => {
    api.brainChooseVaultFolder.mockResolvedValue('E:/vault')
    api.brainKnowledgeImportVault.mockResolvedValue(importReport)
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await waitFor(() => expect(screen.getByText('E:/vault')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Import now' }))
    await waitFor(() => expect(api.brainKnowledgeImportVault).toHaveBeenCalledWith({ scopeId: 'a', vaultRoot: 'E:/vault' }))
    await waitFor(() => expect(screen.getByText(/Scanned 5/)).toBeTruthy())
  })

  it('shows a compaction report with its per-capture decisions after Run cleanup now', async () => {
    api.brainKnowledgeCompact.mockResolvedValue(compactionReport)
    await mount(Brain)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run cleanup now' }))
    await waitFor(() => expect(api.brainKnowledgeCompact).toHaveBeenCalledWith({ scopeId: 'a' }))
    await waitFor(() => expect(screen.getByText(/Merged 1/)).toBeTruthy())
    expect(screen.getByText('captures/x.md')).toBeTruthy()
    expect(screen.getByText(/merged into wiki\/clients\/private-a\.md/)).toBeTruthy()
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
