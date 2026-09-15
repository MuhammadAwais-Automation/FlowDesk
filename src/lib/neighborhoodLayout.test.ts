import { describe, expect, it } from 'vitest'
import { layoutNeighborhood } from './neighborhoodLayout'

function node(path: string, depth: number) {
  return { path, title: path, type: 'note', depth }
}

describe('layoutNeighborhood', () => {
  it('puts the origin dead centre', () => {
    const layout = layoutNeighborhood({ origin: 'a.md', nodes: [node('a.md', 0)], edges: [] }, 400)

    expect(layout.nodes[0]).toMatchObject({ path: 'a.md', x: 200, y: 200 })
  })

  it('places deeper documents on a wider ring', () => {
    const layout = layoutNeighborhood({
      origin: 'a.md',
      nodes: [node('a.md', 0), node('b.md', 1), node('c.md', 2)],
      edges: [],
    })
    const distance = (path: string) => {
      const found = layout.nodes.find(candidate => candidate.path === path)!
      return Math.hypot(found.x - 200, found.y - 200)
    }

    expect(distance('a.md')).toBe(0)
    expect(distance('c.md')).toBeGreaterThan(distance('b.md'))
  })

  it('is deterministic — the same input lays out identically every time', () => {
    const input = { origin: 'a.md', nodes: [node('a.md', 0), node('c.md', 1), node('b.md', 1)], edges: [] }

    expect(layoutNeighborhood(input)).toEqual(layoutNeighborhood(input))
  })

  it('does not depend on the order nodes arrive in', () => {
    const forward = layoutNeighborhood({ origin: 'a.md', nodes: [node('a.md', 0), node('b.md', 1), node('c.md', 1)], edges: [] })
    const reversed = layoutNeighborhood({ origin: 'a.md', nodes: [node('c.md', 1), node('b.md', 1), node('a.md', 0)], edges: [] })

    expect(forward.nodes.find(n => n.path === 'b.md')).toEqual(reversed.nodes.find(n => n.path === 'b.md'))
  })

  it('gives every edge real endpoints', () => {
    const layout = layoutNeighborhood({
      origin: 'a.md',
      nodes: [node('a.md', 0), node('b.md', 1)],
      edges: [{ from: 'a.md', to: 'b.md' }],
    })

    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]).toMatchObject({ x1: 200, y1: 200 })
    expect(layout.edges[0].x2).not.toBeNaN()
  })

  it('drops an edge pointing outside the neighbourhood rather than drawing it to nowhere', () => {
    const layout = layoutNeighborhood({
      origin: 'a.md',
      nodes: [node('a.md', 0)],
      edges: [{ from: 'a.md', to: 'not-loaded.md' }],
    })

    expect(layout.edges).toEqual([])
  })

  it('keeps nodes inside the canvas', () => {
    const layout = layoutNeighborhood({
      origin: 'a.md',
      nodes: [node('a.md', 0), ...Array.from({ length: 12 }, (_, i) => node(`n${i}.md`, 2))],
      edges: [],
    }, 400)

    for (const item of layout.nodes) {
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.x).toBeLessThanOrEqual(400)
      expect(item.y).toBeGreaterThanOrEqual(0)
      expect(item.y).toBeLessThanOrEqual(400)
    }
  })
})
