import { documentsRead } from './brainFormat'
import type { BrainEvent, KnowledgeGraph } from '@/types/brainKnowledge'

export type AtlasOverlay = 'new' | 'trail' | 'orphans'

export interface OverlayInput {
  graph: KnowledgeGraph
  /** When this scope was last looked at, or null on a first visit. */
  since: string | null
  events: BrainEvent[]
}

/**
 * Documents created or changed since the given moment.
 *
 * An unusable `since` — absent, or not a date — highlights nothing rather than
 * everything. On a first visit every document is new, and a map with all 163
 * nodes ringed carries no more information than one with none.
 */
export function changedSince(graph: KnowledgeGraph, sinceIso: string | null): Set<string> {
  const since = sinceIso === null ? Number.NaN : Date.parse(sinceIso)
  if (!Number.isFinite(since)) return new Set()
  return new Set(graph.nodes.filter(node => Date.parse(node.updatedAt) > since).map(node => node.path))
}

/**
 * Documents the agent actually opened, across these events.
 *
 * The one overlay that shows which part of the store is doing work, rather than
 * which part exists. A turn run in temporary mode records no `documentsRead`,
 * so it contributes nothing — which is correct, not a gap.
 */
export function readInEvents(events: BrainEvent[]): Set<string> {
  const paths = new Set<string>()
  for (const event of events) for (const path of documentsRead(event)) paths.add(path)
  return paths
}

/** Documents with no link in or out — the parts of the store nothing reaches. */
export function orphanPaths(graph: KnowledgeGraph): Set<string> {
  return new Set(graph.nodes.filter(node => node.degree === 0).map(node => node.path))
}

/** The documents an overlay highlights. */
export function overlayPaths(overlay: AtlasOverlay, input: OverlayInput): Set<string> {
  if (overlay === 'new') return changedSince(input.graph, input.since)
  if (overlay === 'trail') return readInEvents(input.events)
  return orphanPaths(input.graph)
}
