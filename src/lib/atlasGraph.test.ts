import { describe, expect, it } from 'vitest'
import { buildAtlasGraph, neighborhoodPaths, nodeSize, TYPE_COLOR } from './atlasGraph'
import { KNOWLEDGE_DOC_TYPES, type KnowledgeDocType, type KnowledgeGraph } from '@/types/brainKnowledge'

const node = (path: string, degree: number, type: KnowledgeDocType = 'note') => ({
  path, title: path.replace(/\.md$/, ''), type, degree, updatedAt: '2026-09-18T00:00:00.000Z',
})

/** a — b — c — d, plus an unattached e. */
const CHAIN: KnowledgeGraph = {
  nodes: [node('a.md', 1), node('b.md', 2), node('c.md', 2), node('d.md', 1), node('e.md', 0)],
  edges: [{ from: 'a.md', to: 'b.md' }, { from: 'b.md', to: 'c.md' }, { from: 'c.md', to: 'd.md' }],
  unresolvedCount: 0,
}

describe('nodeSize', () => {
  // The real store's busiest document has 103 links and its median has two, so
  // a linear scale draws one disc and 160 identical dots.
  it('grows sublinearly so one hub cannot swallow the view', () => {
    expect(nodeSize(0)).toBeCloseTo(3)
    const hub = nodeSize(103)
    expect(hub).toBeLessThan(nodeSize(2) * 6)
    expect(hub).toBeGreaterThan(nodeSize(2))
  })
})

describe('TYPE_COLOR', () => {
  it('covers every document type, so no node falls back to grey by accident', () => {
    for (const type of KNOWLEDGE_DOC_TYPES) expect(TYPE_COLOR[type]).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(Object.values(TYPE_COLOR)).size).toBe(KNOWLEDGE_DOC_TYPES.length)
  })
})

describe('neighborhoodPaths', () => {
  it('walks the requested number of hops in both directions', () => {
    expect([...neighborhoodPaths(CHAIN, 'a.md', 1)].sort()).toEqual(['a.md', 'b.md'])
    expect([...neighborhoodPaths(CHAIN, 'a.md', 2)].sort()).toEqual(['a.md', 'b.md', 'c.md'])
    expect([...neighborhoodPaths(CHAIN, 'c.md', 1)].sort()).toEqual(['b.md', 'c.md', 'd.md'])
  })

  it('returns just the document when nothing links to it', () => {
    expect([...neighborhoodPaths(CHAIN, 'e.md', 2)]).toEqual(['e.md'])
  })
})

describe('buildAtlasGraph', () => {
  it('lays every node out somewhere finite, never stacked at the origin', () => {
    const graph = buildAtlasGraph(CHAIN, { minDegree: 0, types: [] })
    const positions = graph.nodes().map(path => `${graph.getNodeAttribute(path, 'x')},${graph.getNodeAttribute(path, 'y')}`)

    expect(graph.order).toBe(5)
    expect(graph.size).toBe(3)
    for (const path of graph.nodes()) {
      expect(Number.isFinite(graph.getNodeAttribute(path, 'x'))).toBe(true)
      expect(Number.isFinite(graph.getNodeAttribute(path, 'y'))).toBe(true)
    }
    expect(new Set(positions).size).toBe(5)
  })

  it('is deterministic, so the same store does not rearrange between visits', () => {
    const first = buildAtlasGraph(CHAIN, { minDegree: 0, types: [] })
    const second = buildAtlasGraph(CHAIN, { minDegree: 0, types: [] })

    for (const path of first.nodes()) {
      expect(second.getNodeAttribute(path, 'x')).toBeCloseTo(first.getNodeAttribute(path, 'x') as number)
    }
  })

  it('drops nodes below the degree floor, and the edges that hung off them', () => {
    const graph = buildAtlasGraph(CHAIN, { minDegree: 2, types: [] })

    expect(graph.nodes().sort()).toEqual(['b.md', 'c.md'])
    expect(graph.size).toBe(1)
  })

  it('keeps only the chosen types, and every type when none is chosen', () => {
    const typed: KnowledgeGraph = {
      nodes: [node('client.md', 1, 'client'), node('plain.md', 1)],
      edges: [{ from: 'client.md', to: 'plain.md' }],
      unresolvedCount: 0,
    }

    expect(buildAtlasGraph(typed, { minDegree: 0, types: ['client'] }).nodes()).toEqual(['client.md'])
    expect(buildAtlasGraph(typed, { minDegree: 0, types: [] }).order).toBe(2)
  })

  // The local view hands in its two hops; nothing outside them may appear.
  it('honours restrictTo over everything else in the graph', () => {
    const graph = buildAtlasGraph(CHAIN, { minDegree: 0, types: [], restrictTo: new Set(['a.md', 'b.md']) })

    expect(graph.nodes().sort()).toEqual(['a.md', 'b.md'])
    expect(graph.size).toBe(1)
  })

  it('colours each node by its type and sizes it by its links', () => {
    const graph = buildAtlasGraph({
      nodes: [node('c.md', 9, 'client')], edges: [], unresolvedCount: 0,
    }, { minDegree: 0, types: [] })

    expect(graph.getNodeAttribute('c.md', 'color')).toBe(TYPE_COLOR.client)
    expect(graph.getNodeAttribute('c.md', 'size')).toBeCloseTo(nodeSize(9))
  })

  it('ignores an edge whose ends are filtered out rather than inventing nodes', () => {
    const graph = buildAtlasGraph({
      nodes: [node('a.md', 1)],
      edges: [{ from: 'a.md', to: 'missing.md' }],
      unresolvedCount: 0,
    }, { minDegree: 0, types: [] })

    expect(graph.order).toBe(1)
    expect(graph.size).toBe(0)
  })

  it('handles an empty store without throwing', () => {
    const graph = buildAtlasGraph({ nodes: [], edges: [], unresolvedCount: 0 }, { minDegree: 0, types: [] })
    expect(graph.order).toBe(0)
  })
})
