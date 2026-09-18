import type { KnowledgeGraph, KnowledgeGraphNode } from '@/types/brainKnowledge'

export interface AtlasSearchResult {
  /** Every match, for dimming the rest of the map. */
  matches: Set<string>
  /** The few worth listing under the bar. */
  top: KnowledgeGraphNode[]
}

export interface FitBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Finds documents by title or path, over the graph already in memory.
 *
 * No IPC: the whole store is a few hundred nodes and is already loaded for
 * drawing, so a keystroke filters it in place rather than waiting on a round
 * trip. `brainKnowledgeSearch` still exists for full-text over bodies; this is
 * the map's own filter, and it has to keep up with typing.
 *
 * An empty query returns no matches rather than all of them, because the caller
 * reads a non-empty `matches` set as "dim everything else".
 */
export function searchAtlas(graph: KnowledgeGraph, query: string, limit = 5): AtlasSearchResult {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { matches: new Set(), top: [] }

  const found = graph.nodes.filter(node => (
    node.title.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)
  ))
  return {
    matches: new Set(found.map(node => node.path)),
    top: [...found].sort((left, right) => right.degree - left.degree).slice(0, limit),
  }
}

/**
 * The rectangle the camera should fit, in graph coordinates.
 *
 * Padded, so matched nodes do not sit against the edge of the viewport, and
 * never zero-sized — a single match would otherwise ask the camera to fit a
 * point, which reads as a jump to maximum zoom.
 */
export function fitBox(positions: Array<{ x: number; y: number }>, padding = 30): FitBox | null {
  if (positions.length === 0) return null
  const xs = positions.map(position => position.x)
  const ys = positions.map(position => position.y)
  const x = Math.min(...xs) - padding
  const y = Math.min(...ys) - padding
  return {
    x,
    y,
    width: Math.max(...xs) + padding - x,
    height: Math.max(...ys) + padding - y,
  }
}
