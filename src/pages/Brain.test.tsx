/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrainScope } from '@/types/brain'
import type { BrainEvent, DocumentReadResult, KnowledgeDocument } from '@/types/brainKnowledge'

// sigma's entry module reads `WebGL2RenderingContext` at evaluation time, which
// jsdom does not define -- importing the canvas at all kills the test file. The
// shell under test only passes props down to it, so a stub is the whole of it.
vi.mock('@/components/brain/atlas/AtlasCanvas', () => ({ AtlasCanvas: () => null }))

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
  metadata: { sessionId: 's1', prompt: 'mere clients kaun hain', documentsRead: [document.path], totalCostUsd: 0.0123, durationMs: 4200 },
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
  api.brainEntityList.mockResolvedValue([])
  // The graph is what the map -- and so the command bar's result list -- is
  // built from, so the one document has to be in it for anything to be
  // openable at all now that the Library list is gone.
  api.brainKnowledgeGraph.mockResolvedValue({
    nodes: [{ path: document.path, title: document.title, type: document.type, degree: 7, updatedAt: document.updatedAt }],
    edges: [], unresolvedCount: 0,
  })
})

afterEach(cleanup)

async function mount() {
  render(<Brain />)
  await waitFor(() => expect(screen.getByText('Client · A')).toBeTruthy())
}

const detail = () => screen.getByRole('complementary', { name: 'Detail' })

/** The map is the only way in now: type, then open the hit. */
async function openFromMap(term: string, name: RegExp) {
  fireEvent.change(await screen.findByRole('searchbox'), { target: { value: term } })
  fireEvent.click(await screen.findByRole('button', { name }))
}

describe('Brain shell', () => {
  it('has no tabs — the map is the page', async () => {
    await mount()
    expect(screen.queryByRole('navigation', { name: 'Brain sections' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
  })

  it('names the scope once, not twice', async () => {
    await mount()
    expect(screen.getAllByText(/Global/)).toHaveLength(1)
  })

  it('opens a panel from the status strip and closes it again', async () => {
    // `mount` first on purpose: the page is keyed by scope, so anything
    // clicked before the scope resolves is thrown away by the remount.
    await mount()
    const pill = screen.getByRole('button', { name: /review/ })
    fireEvent.click(pill)
    expect(screen.getByRole('complementary', { name: 'Review' })).toBeTruthy()
    fireEvent.click(pill)
    expect(screen.queryByRole('complementary', { name: 'Review' })).toBeNull()
  })

  // `panel` lives above the scope-keyed remount for this reason: which surface
  // you are looking at is not scope data, and the old design kept `tab` across
  // a scope switch too. The drawer is the deliberate opposite -- see below.
  it('keeps the open panel across a scope change', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /review/ }))
    expect(screen.getByRole('complementary', { name: 'Review' })).toBeTruthy()

    fireEvent.change(screen.getByRole('combobox', { name: 'Brain scope' }), { target: { value: 'b' } })

    expect(screen.getByRole('complementary', { name: 'Review' })).toBeTruthy()
  })

  it('shows no drawer until something is selected', async () => {
    await mount()
    expect(screen.queryByRole('complementary', { name: 'Detail' })).toBeNull()
  })

  // The one behaviour worth carrying over from the describe block this
  // replaces: a document belonging to one client must never stay on screen
  // under another. The other three tests in that block existed only to prove
  // the old tab nav preserved a selection across a tab switch -- a nav that
  // no longer exists -- so they have no equivalent here.
  it('clears the drawer when the scope changes', async () => {
    await mount()
    await openFromMap('Yasir', /Yasir Bhai/)
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Detail' })).toBeTruthy())

    fireEvent.change(screen.getByRole('combobox', { name: 'Brain scope' }), { target: { value: 'b' } })

    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Detail' })).toBeNull())
  })
})

describe('Brain document reader', () => {
  async function openDocument() {
    await mount()
    await openFromMap('Yasir', /Yasir Bhai/)
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

describe('Brain turn reader', () => {
  const conversation = [
    { id: 'turn-1', role: 'user' as const, content: 'mere clients kaun hain', toolCalls: [], createdAt: turnEvent.createdAt },
    { id: 'turn-2', role: 'assistant' as const, content: 'Yasir aur Bilal.', toolCalls: [], createdAt: turnEvent.createdAt },
  ]

  /** The timeline is a panel now, so it has to be opened before a turn is. */
  async function openTimeline() {
    await mount()
    fireEvent.click(await screen.findByRole('button', { name: /documents$/ }))
    return screen.getByRole('complementary', { name: 'Timeline' })
  }

  async function openTurn() {
    await openTimeline()
    fireEvent.click(await screen.findByRole('button', { name: /mere clients kaun hain/ }))
  }

  it('shows the conversation behind an agent turn', async () => {
    api.agentSessionTurns.mockResolvedValue(conversation)
    await openTurn()
    await waitFor(() => expect(within(detail()).getByText('Yasir aur Bilal.')).toBeTruthy())
    expect(api.agentSessionTurns).toHaveBeenCalledWith('s1')
    expect(within(detail()).getAllByText('mere clients kaun hain').length).toBeGreaterThan(0)
  })

  it('shows what the turn cost', async () => {
    api.agentSessionTurns.mockResolvedValue(conversation)
    await openTurn()
    await waitFor(() => expect(within(detail()).getByText(/\$0\.0123/)).toBeTruthy())
    expect(within(detail()).getByText(/4\.2s/)).toBeTruthy()
  })

  it('says so plainly when a turn was temporary rather than showing an empty box', async () => {
    api.brainListEvents.mockResolvedValue([{
      ...turnEvent,
      metadata: { sessionId: 's1', totalCostUsd: 0.002, durationMs: 1000 },
    }])
    await openTimeline()
    fireEvent.click(await screen.findByRole('button', { name: /Agent turn/ }))
    await waitFor(() => expect(within(detail()).getByText(/Temporary mode/)).toBeTruthy())
    // The session store must not even be asked for a turn that was never kept.
    expect(api.agentSessionTurns).not.toHaveBeenCalled()
  })
})

describe('Brain Ask', () => {
  const pack = {
    question: 'Yasir ka rate kya hai',
    evidence: 'PKR 40,000 monthly.',
    sections: [{ path: document.path, title: document.title, headingPath: 'Rates', text: 'PKR 40,000 monthly.', score: 2.4 }],
    pointerFollowed: null,
    strategy: 'ranked' as const,
    estimatedTokens: 120,
    candidatesConsidered: 5,
  }

  it('answers from the retrieval ladder and shows how it found the answer', async () => {
    api.brainKnowledgeAnswerPack.mockResolvedValue(pack)
    await mount()
    // Asking is the same one box that searches the map -- Enter is the ask.
    const box = await screen.findByPlaceholderText(/poochein/)
    fireEvent.change(box, { target: { value: 'Yasir ka rate kya hai' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(within(detail()).getByText('PKR 40,000 monthly.')).toBeTruthy())
    expect(api.brainKnowledgeAnswerPack).toHaveBeenCalledWith({ scopeId: 'a', question: 'Yasir ka rate kya hai' })
    // The page must no longer run the keyword path the agent stopped using.
    expect(api.brainKnowledgeSearch).not.toHaveBeenCalled()

    const pane = detail()
    expect(within(pane).getByRole('button', { name: `${document.path}#Rates` })).toBeTruthy()
    expect(within(pane).getByText(/rank kiya/)).toBeTruthy()
    expect(within(pane).getByText('5')).toBeTruthy()
  })
})

describe('Brain Health entities', () => {
  it('finds the people and projects in the Library and reports what it did', async () => {
    api.brainEntityBackfill.mockResolvedValue({ scanned: 157, created: 24, linked: 24 })
    await mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Health' }))

    expect(screen.getByText('0 pehchani hui cheezein')).toBeTruthy()
    api.brainEntityList.mockResolvedValue([
      { id: 'e1', scopeId: 'a', type: 'org', name: 'TWG Trade Finance', createdAt: '', updatedAt: '' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Log dhoondein' }))

    await waitFor(() => expect(api.brainEntityBackfill).toHaveBeenCalledWith({ scopeId: 'a' }))
    await waitFor(() => expect(screen.getByText(/Naye 24/)).toBeTruthy())
    // The count comes from a refresh, so the button proves it ran rather than
    // just reporting a number back to itself.
    await waitFor(() => expect(screen.getByText('1 pehchani hui cheezein')).toBeTruthy())
  })

  it('says plainly when a second run found nothing new', async () => {
    api.brainEntityBackfill.mockResolvedValue({ scanned: 157, created: 0, linked: 0 })
    await mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Health' }))
    fireEvent.click(screen.getByRole('button', { name: 'Log dhoondein' }))

    await waitFor(() => expect(screen.getByText(/sab pehle se maujood tha/)).toBeTruthy())
  })
})
