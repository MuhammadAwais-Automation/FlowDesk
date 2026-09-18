import { describe, expect, it } from 'vitest'
import { fitBox, searchAtlas } from './atlasSearch'
import type { KnowledgeDocType, KnowledgeGraph } from '@/types/brainKnowledge'

const node = (path: string, title: string, degree = 1, type: KnowledgeDocType = 'note') => ({
  path, title, type, degree, updatedAt: '2026-09-18T00:00:00.000Z',
})

const STORE: KnowledgeGraph = {
  nodes: [
    node('wiki/clients/yasir-bhai.md', 'Yasir Bhai', 7, 'client'),
    node('wiki/projects/zapzone.md', 'Zap Zone Marketplace App', 25, 'project'),
    node('wiki/projects/zapzone-proposal.md', 'Zap Zone Proposal Plan', 14, 'project'),
    node('wiki/me/positioning.md', 'Positioning', 14, 'me'),
  ],
  edges: [],
  unresolvedCount: 0,
}

describe('searchAtlas', () => {
  it('matches on the title, ignoring case', () => {
    expect([...searchAtlas(STORE, 'yasir').matches]).toEqual(['wiki/clients/yasir-bhai.md'])
    expect([...searchAtlas(STORE, 'YASIR').matches]).toEqual(['wiki/clients/yasir-bhai.md'])
  })

  it('matches on the path too, so a folder finds its documents', () => {
    expect([...searchAtlas(STORE, 'projects/').matches].sort()).toEqual([
      'wiki/projects/zapzone-proposal.md', 'wiki/projects/zapzone.md',
    ])
  })

  // The list under the bar is short, so the best-connected match goes first.
  it('lists the most connected matches first, capped', () => {
    const result = searchAtlas(STORE, 'zap', 1)
    expect(result.top.map(item => item.title)).toEqual(['Zap Zone Marketplace App'])
    expect(result.matches.size).toBe(2)
  })

  // An empty query means "no filter", which is different from "nothing matched" —
  // the map must not dim itself while the box is empty.
  it('matches nothing and highlights nothing for an empty query', () => {
    const result = searchAtlas(STORE, '   ')
    expect(result.matches.size).toBe(0)
    expect(result.top).toEqual([])
  })

  it('reports no matches for a query nothing satisfies', () => {
    expect(searchAtlas(STORE, 'zzzz').matches.size).toBe(0)
  })
})

describe('fitBox', () => {
  it('covers every position with padding around it', () => {
    expect(fitBox([{ x: 0, y: 0 }, { x: 10, y: 20 }], 5))
      .toEqual({ x: -5, y: -5, width: 20, height: 30 })
  })

  // One match still needs a box, or the camera has nothing to fit and jumps.
  it('gives a single position a box of its own', () => {
    expect(fitBox([{ x: 4, y: 4 }], 3)).toEqual({ x: 1, y: 1, width: 6, height: 6 })
  })

  it('has nothing to fit when there are no positions', () => {
    expect(fitBox([])).toBeNull()
  })
})
