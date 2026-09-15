/**
 * Lays a document's link neighbourhood out in rings — origin at the centre,
 * one-hop documents on the inner circle, two-hop on the outer.
 *
 * No graph library and no physics. A neighbourhood is bounded at two hops and
 * is typically a handful of nodes, where a force simulation buys nothing but a
 * dependency, a settling animation, and a layout that differs every time you
 * open it. Concentric rings are deterministic, so the same document always
 * looks the same, and depth is readable straight off the picture.
 */

export interface LayoutNode {
  path: string
  title: string
  type: string
  depth: number
  x: number
  y: number
}

export interface LayoutEdge {
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface NeighborhoodLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
}

interface NeighborhoodInput {
  origin: string
  nodes: { path: string; title: string; type: string; depth: number }[]
  edges: { from: string; to: string }[]
}

const RING_RADIUS = [0, 90, 170]

export function layoutNeighborhood(neighborhood: NeighborhoodInput, size = 400): NeighborhoodLayout {
  const centre = size / 2
  const positioned = new Map<string, LayoutNode>()

  const byDepth = new Map<number, NeighborhoodInput['nodes']>()
  for (const node of neighborhood.nodes) {
    const depth = Math.min(node.depth, RING_RADIUS.length - 1)
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), node])
  }

  for (const [depth, nodes] of byDepth) {
    const radius = RING_RADIUS[depth]
    // Sorted by path so the ring order is stable across reloads rather than
    // following whatever order the query happened to return.
    const ordered = [...nodes].sort((left, right) => left.path < right.path ? -1 : 1)
    ordered.forEach((node, index) => {
      // Start at the top and go clockwise; the half-step offset keeps the inner
      // and outer rings from lining up into spokes.
      const angle = radius === 0 ? 0 : (index / ordered.length) * Math.PI * 2 - Math.PI / 2 + (depth % 2) * (Math.PI / ordered.length)
      positioned.set(node.path, {
        path: node.path,
        title: node.title,
        type: node.type,
        depth: node.depth,
        x: centre + Math.cos(angle) * radius,
        y: centre + Math.sin(angle) * radius,
      })
    })
  }

  const edges: LayoutEdge[] = []
  for (const edge of neighborhood.edges) {
    const from = positioned.get(edge.from)
    const to = positioned.get(edge.to)
    // An edge to a document outside the neighbourhood has nowhere to land.
    if (!from || !to) continue
    edges.push({ from: edge.from, to: edge.to, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
  }

  return { nodes: [...positioned.values()], edges, width: size, height: size }
}
