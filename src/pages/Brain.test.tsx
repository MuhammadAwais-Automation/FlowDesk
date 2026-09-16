/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrainScope } from '@/types/brain'
import type { BrainEvent, DocumentReadResult, KnowledgeDocument } from '@/types/brainKnowledge'

const NL = String.fromCharCode(10)

const scopes: BrainScope[] = ['global', 'a', 'b'].map(id => ({
  id, type: id === 'global' ? 'global' : 'client', externalRef: id,
  name: id.toUpperCase(), parentId: null, createdAt: '2026-09-05T00:00:00.000Z',
}))

const document: KnowledgeDocument = {
  id: 'doc-a', path: 'wiki/clients/yasir.md', scopeId: 'a', type: 'client',
  title: 'Yasir Bhai', summary: 'Retainer client', contentHash: 'hash-a', byteSize: 20,
  origin: 'curated', validFrom: scopes[0].createdAt, validTo: null,
  createdAt: scopes[0].createdAt, updatedAt: '2026-09-15T10:00:00.000Z',
}

const documentRead: DocumentReadResult = {
  path: document.path, title: document.title, type: document.type,
  text: ['# Rates', '', 'PKR 40,000 monthly.', '', '## Scope', '', 'Two revisions.'].join(NL),
  truncated: false, estimatedTokens: 12, updatedAt: document.updatedAt,
}

const turnEvent: BrainEvent = {
  id: 'event-turn', scopeId: 'a', action: 'agent.turn', targetId: 'turn-2',
  metadata: { sessionId: 's1', prompt: 'mere clients kaun hain', documentsRead: [document.path], total_cost_usd: 0.0123, duration_ms: 4200 },
  createdAt: '2026-09-15T10:05:00.000Z',
}

const api = {
  brainEnsureScope: vi.fn(), brainListScopes: vi.fn(), projectList: vi.fn(), storeGet: vi.fn(), storeSet: vi.fn(),
  brainGetStatus: vi.fn(), brainListCandidates: vi.fn(), brainDecideCandidate: vi.fn(), onBrainEvent: vi.fn(),
  brainKnowledgeListCandidates: vi.fn(), brainKnowledgeDecideCandidate: vi.fn(), brainKnowledgeListUnresolvedLinks: vi.fn(),
  brainGetVaultRoot: vi.fn(), brainChooseVaultFolder: vi.fn(), brainKnowledgeList: vi.fn(),
  brainKnowledgeSearch: vi.fn(), brainKnowledgeRead: vi.fn(), brainKnowledgeManifest: vi.fn(),
  brainKnowledgeImportVault: vi.fn(), brainKnowledgeCompact: vi.fn(), brainKnowledgeMigrateMemories: vi.fn(),
  brainExportBackup: vi.fn(), brainImportBackup: vi.fn(), brainKnowledgeDailyNote: vi.fn(),
  brainListEvents: vi.fn(), brainKnowledgeNeighbors: vi.fn(), brainKnowledgeBuildVectors: vi.fn(),
  brainKnowledgeVectorStatus: vi.fn(), brainKnowledgeAnswerPack: vi.fn(), agentSessionTurns: vi.fn(),
}

let Brain: ComponentType

beforeAll(async () => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  Brain = (await import('./Brain')).default
})

beforeEach(() => {
  vi.resetAllMocks()
  api.brainEnsureScope.mockResolvedValue(scopes[1])
  api.brainListScopes.mockImplementation(async () => [...scopes])
  api.projectList.mockResolvedValue({ projects: [], activeProjectId: null })
  api.storeGet.mockResolvedValue('a')
  api.storeSet.mockResolvedValue(undefined)
  api.brainGetStatus.mockResolvedValue({ ready: true, degraded: false, fts5: true, schemaVersion: 6 })
  api.brainListCandidates.mockResolvedValue([])
  api.brainKnowledgeListCandidates.mockResolvedValue([])
  api.brainKnowledgeListUnresolvedLinks.mockResolvedValue([])
  api.brainGetVaultRoot.mockResolvedValue(null)
  api.brainKnowledgeList.mockResolvedValue([document])
  api.brainKnowledgeRead.mockResolvedValue(documentRead)
  api.brainKnowledgeNeighbors.mockResolvedValue({ origin: document.path, nodes: [], edges: [] })
  api.brainKnowledgeDailyNote.mockResolvedValue({ date: '2026-09-15', path: 'daily/2026-09-15.md', written: false, eventCount: 0, body: '' })
  api.brainListEvents.mockResolvedValue([turnEvent])
  api.brainKnowledgeVectorStatus.mockResolvedValue({ documents: 1, vectors: 0, model: 'test', failed: false })
  api.onBrainEvent.mockReturnValue(() => undefined)
  api.agentSessionTurns.mockResolvedValue([])
})

afterEach(cleanup)

async function mount() {
  render(<Brain />)
  await waitFor(() => expect(screen.getByText('Client · A')).toBeTruthy())
}

const nav = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const detail = () => screen.getByRole('complementary', { name: 'Detail' })

describe('Brain three-column layout', () => {
  it('keeps the active nav item when a library row is selected', async () => {
    await mount()
    fireEvent.click(nav('Library'))
    fireEvent.click(await screen.findByRole('button', { name: /Yasir Bhai/ }))

    await waitFor(() => expect(within(detail()).getByText('Yasir Bhai')).toBeTruthy())
    // The complaint this closes: selecting a document used to call setTab.
    expect(nav('Library').getAttribute('aria-current')).toBe('page')
  })

  it('keeps the selection when the nav item changes', async () => {
    await mount()
    fireEvent.click(nav('Library'))
    fireEvent.click(await screen.findByRole('button', { name: /Yasir Bhai/ }))
    await waitFor(() => expect(within(detail()).getByText('Yasir Bhai')).toBeTruthy())

    fireEvent.click(nav('Today'))

    expect(nav('Today').getAttribute('aria-current')).toBe('page')
    expect(within(detail()).getByText('Yasir Bhai')).toBeTruthy()
  })

  it('shows the counters in the detail pane when nothing is selected', async () => {
    await mount()
    const pane = detail()
    expect(within(pane).getByText('Documents')).toBeTruthy()
    expect(within(pane).getByText('Review inbox')).toBeTruthy()
    expect(within(pane).getByText('Unresolved links')).toBeTruthy()
  })

  it('clears the detail pane when the scope changes', async () => {
    await mount()
    fireEvent.click(nav('Library'))
    fireEvent.click(await screen.findByRole('button', { name: /Yasir Bhai/ }))
    await waitFor(() => expect(within(detail()).getByText('Yasir Bhai')).toBeTruthy())

    // A document belonging to one client must never stay on screen under
    // another -- the pane surviving nav changes must not mean surviving this.
    fireEvent.change(screen.getByRole('combobox', { name: 'Brain scope' }), { target: { value: 'b' } })

    await waitFor(() => expect(within(detail()).queryByText('Yasir Bhai')).toBeNull())
    expect(within(detail()).getByText('Documents')).toBeTruthy()
  })
})

describe('Brain document reader', () => {
  async function openDocument() {
    await mount()
    fireEvent.click(nav('Library'))
    fireEvent.click(await screen.findByRole('button', { name: /Yasir Bhai/ }))
    await waitFor(() => expect(within(detail()).getByText('Yasir Bhai')).toBeTruthy())
  }

  it('renders the body as markdown rather than raw text', async () => {
    await openDocument()
    const pane = detail()
    expect(within(pane).getByRole('heading', { name: 'Rates' })).toBeTruthy()
    expect(pane.querySelector('pre')).toBeNull()
  })

  it('lists the document headings as an outline', async () => {
    await openDocument()
    const outline = within(detail()).getByRole('navigation', { name: 'Outline' })
    expect(within(outline).getByRole('button', { name: 'Rates' })).toBeTruthy()
    expect(within(outline).getByRole('button', { name: 'Scope' })).toBeTruthy()
  })

  it('names the turns that read this document and opens one', async () => {
    await openDocument()
    const chip = within(detail()).getByRole('button', { name: /mere clients kaun hain/ })
    fireEvent.click(chip)
    await waitFor(() => expect(within(detail()).queryByRole('navigation', { name: 'Outline' })).toBeNull())
  })
})
