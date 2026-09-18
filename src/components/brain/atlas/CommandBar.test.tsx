/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandBar } from './CommandBar'
import type { KnowledgeGraph } from '@/types/brainKnowledge'

afterEach(cleanup)

const GRAPH: KnowledgeGraph = {
  nodes: [
    { path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai', type: 'client', degree: 7, updatedAt: '2026-09-18T00:00:00.000Z' },
    { path: 'wiki/projects/zapzone.md', title: 'Zap Zone Marketplace App', type: 'project', degree: 25, updatedAt: '2026-09-18T00:00:00.000Z' },
  ],
  edges: [],
  unresolvedCount: 0,
}

function setup(overrides: Partial<Parameters<typeof CommandBar>[0]> = {}) {
  const props = {
    graph: GRAPH, query: '', onQueryChange: vi.fn(), onOpen: vi.fn(), onAsk: vi.fn(), asking: false,
    ...overrides,
  }
  render(<CommandBar {...props} />)
  return props
}

describe('CommandBar', () => {
  it('reports every keystroke so the map can follow along', async () => {
    const props = setup()
    await userEvent.type(screen.getByRole('searchbox'), 'y')
    expect(props.onQueryChange).toHaveBeenCalledWith('y')
  })

  it('lists matches for the current query and opens the one you pick', async () => {
    const props = setup({ query: 'zap' })
    await userEvent.click(screen.getByRole('button', { name: /Zap Zone Marketplace App/ }))
    expect(props.onOpen).toHaveBeenCalledWith('wiki/projects/zapzone.md')
  })

  it('asks the Brain on Enter rather than just filtering', async () => {
    const props = setup({ query: 'yasir bhai ka scope kya tha' })
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}')
    expect(props.onAsk).toHaveBeenCalledWith('yasir bhai ka scope kya tha')
  })

  it('does not ask an empty question', async () => {
    const props = setup({ query: '   ' })
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}')
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('clears the query on Escape', async () => {
    const props = setup({ query: 'zap' })
    await userEvent.type(screen.getByRole('searchbox'), '{Escape}')
    expect(props.onQueryChange).toHaveBeenCalledWith('')
  })

  // The map is the real result list; this is a shortcut, not a browser.
  it('lists no more than five matches', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      path: `p${index}.md`, title: `Zap ${index}`, type: 'note' as const, degree: index, updatedAt: '2026-09-18T00:00:00.000Z',
    }))
    setup({ graph: { nodes: many, edges: [], unresolvedCount: 0 }, query: 'zap' })
    expect(screen.getAllByRole('button', { name: /^Zap / })).toHaveLength(5)
  })

  it('says so while an answer is on its way', () => {
    setup({ query: 'anything', asking: true })
    expect(screen.getByText('Poochh raha hai…')).toBeTruthy()
  })
})
