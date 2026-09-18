import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type { KnowledgeDocType, KnowledgeGraph } from '@/types/brainKnowledge'
import { OBSERVATORY, TYPE_COLOR } from './atlasTheme'

/**
 * Node radius from link count.
 *
 * Square root, not linear: the busiest document in a real store has 103 links
 * and the median has two, so a linear scale would draw one disc that swallows
 * the screen and 160 identical dots.
 */
export function nodeSize(degree: number): number {
  return 3 + Math.sqrt(degree) * 2.2
}

export interface AtlasFilters {
  /** Hide documents with fewer links than this. 0 keeps everything. */
  minDegree: number
  types: KnowledgeDocType[]
  /** Paths to keep regardless of the filters above — the local view's hops. */
  restrictTo?: Set<string>
}

/**
 * Builds the graphology graph sigma renders, already laid out.
 *
 * ForceAtlas2 runs here, synchronously, because it has to finish before the
 * first frame or the graph appears as a pile at the origin and springs apart
 * while the user is looking at it. At a few hundred nodes that is a few
 * milliseconds; past a few thousand this should move to the worker build.
 */
export function buildAtlasGraph(source: KnowledgeGraph, filters: AtlasFilters): Graph {
  const allowedTypes = new Set(filters.types)
  const visible = new Map(source.nodes
    .filter(node => (filters.restrictTo ? filters.restrictTo.has(node.path) : true))
    .filter(node => allowedTypes.size === 0 || allowedTypes.has(node.type))
    .filter(node => node.degree >= filters.minDegree)
    .map(node => [node.path, node]))

  const graph = new Graph({ type: 'undirected' })
  // Seeded on a circle rather than at random: ForceAtlas2 needs somewhere to
  // start, and a deterministic ring means the same store lays out the same way
  // every time instead of rearranging itself on each visit.
  const paths = [...visible.keys()]
  paths.forEach((path, index) => {
    const node = visible.get(path)!
    const angle = (index / Math.max(1, paths.length)) * Math.PI * 2
    graph.addNode(path, {
      label: node.title,
      size: nodeSize(node.degree),
      color: TYPE_COLOR[node.type] ?? OBSERVATORY.nodeDim,
      docType: node.type,
      degree: node.degree,
      updatedAt: node.updatedAt,
      x: Math.cos(angle) * 100,
      y: Math.sin(angle) * 100,
    })
  })

  for (const edge of source.edges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue
    if (graph.hasEdge(edge.from, edge.to)) continue
    graph.addEdge(edge.from, edge.to, { size: 0.6, color: OBSERVATORY.edge })
  }

  if (graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations: graph.order > 400 ? 120 : 260,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        // Hubs pushed outward rather than crowding the middle, and enough
        // repulsion that labels have somewhere to sit.
        outboundAttractionDistribution: true,
        scalingRatio: 12,
        gravity: 0.6,
        slowDown: 4,
      },
    })
  }
  return graph
}

/**
 * Paths within `depth` hops of `origin`, the origin included.
 *
 * The local view's whole job: a whole-store graph is a hairball past a couple
 * of hundred notes, and this store already has more than that.
 */
export function neighborhoodPaths(source: KnowledgeGraph, origin: string, depth: number): Set<string> {
  const adjacency = new Map<string, string[]>()
  for (const edge of source.edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to])
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from])
  }
  const seen = new Set([origin])
  let frontier = [origin]
  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = []
    for (const path of frontier) {
      for (const neighbor of adjacency.get(path) ?? []) {
        if (seen.has(neighbor)) continue
        seen.add(neighbor)
        next.push(neighbor)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return seen
}

export type ZoomBand = 'far' | 'mid' | 'near'

/**
 * What each band draws.
 *
 * `minDegree` gates which nodes exist on screen; `labelMinDegree` gates which
 * of those get a name, and `null` means none. Labels stop colliding because
 * each band renders only as many as fit, the way a map shows countries before
 * cities before streets.
 *
 * Tuned against the real store — 163 documents, median degree 2, maximum 103 —
 * so `far` resolves to roughly eighteen hubs.
 */
export const BAND_RULES: Record<ZoomBand, { minDegree: number; labelMinDegree: number | null; regionLabels: boolean }> = {
  far: { minDegree: 8, labelMinDegree: null, regionLabels: true },
  mid: { minDegree: 2, labelMinDegree: 6, regionLabels: false },
  near: { minDegree: 0, labelMinDegree: 0, regionLabels: false },
}

/**
 * Sigma's camera ratio grows as you zoom out, so the thresholds read backwards
 * from how it feels: a big ratio is far away.
 *
 * A ratio that is not a number falls to `mid` rather than throwing — a camera
 * mid-animation has produced one, and the middle band is the safe answer.
 */
export function bandForRatio(ratio: number): ZoomBand {
  if (!Number.isFinite(ratio)) return 'mid'
  if (ratio > 1.6) return 'far'
  if (ratio >= 0.6) return 'mid'
  return 'near'
}

export interface AtlasRegion {
  name: string
  x: number
  y: number
  count: number
}

/**
 * The part of the map a document belongs to.
 *
 * Two segments, because one is too coarse — the real store keeps 106 of its
 * 163 documents under `wiki/`, so a one-segment region would be the whole map.
 * `wiki` is dropped as a root for the same reason: it is where everything
 * lives, so it distinguishes nothing.
 */
export function regionOf(path: string): string {
  const segments = path.replaceAll('\\', '/').split('/').filter(Boolean)
  const hadWiki = segments[0] === 'wiki'
  const meaningful = hadWiki ? segments.slice(1) : segments
  // Only the last segment left is the filename, so there is no directory to
  // name: the document sits at the root of the vault.
  if (meaningful.length <= 1) return 'loose'
  // Remove the filename (last segment) to get just directories
  const directories = meaningful.slice(0, -1)
  // For wiki paths, take 1 segment (the region); for others, take up to 2
  const maxSegments = hadWiki ? 1 : 2
  return directories.slice(0, maxSegments).join('/')
}

/**
 * Where to write each region's name, and how big it is.
 *
 * Drawn only at the far band, where node labels are off, so this is what tells
 * you which part of the map you are looking at. A region holding one document
 * is skipped: its own label says more than the region's name would.
 *
 * Largest first, so a caller that has to drop some keeps the ones that matter.
 */
export function regionCentroids(graph: Graph): AtlasRegion[] {
  const members = new Map<string, { x: number; y: number; count: number }>()
  graph.forEachNode((path, attributes) => {
    const name = regionOf(path)
    const current = members.get(name) ?? { x: 0, y: 0, count: 0 }
    members.set(name, {
      x: current.x + Number(attributes.x ?? 0),
      y: current.y + Number(attributes.y ?? 0),
      count: current.count + 1,
    })
  })

  return [...members]
    .filter(([, total]) => total.count > 1)
    .map(([name, total]) => ({ name, x: total.x / total.count, y: total.y / total.count, count: total.count }))
    .sort((left, right) => right.count - left.count)
}
