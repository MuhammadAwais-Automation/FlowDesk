import type { KnowledgeDocType } from '@/types/brainKnowledge'

/**
 * The Atlas canvas is a screen inset into FlowDesk's cream housing.
 *
 * Dark because a node-link graph reads best on it — luminous points against
 * near-black separate at a glance where ink on paper does not. The housing's
 * amber reappears as `accent` inside the screen, so the two surfaces belong to
 * one object instead of meeting at a seam.
 */
export const OBSERVATORY = {
  canvas: '#0d0f14',
  raised: '#141824',
  border: '#1e2330',
  text: '#cbd5e1',
  muted: '#8b98b5',
  dim: '#4a5568',
  edge: '#2a3142',
  edgeDim: '#171b26',
  nodeDim: '#262d3d',
  accent: '#d97706',
} as const

/**
 * The type that holds the majority, and therefore the one that must stay quiet.
 *
 * 106 of the real store's 163 documents are skills. A palette that gives the
 * majority its loudest colour produces a map that is two thirds one hue, where
 * colour distinguishes nothing.
 */
export const GROUND_TYPE: KnowledgeDocType = 'skill'

/**
 * One colour per document type, ordered by how much attention it deserves.
 *
 * `skill` and `note` are the floor — desaturated slate, read as texture. The
 * rarer a type is, the stronger its accent, because a rare thing on a map is
 * the thing you are looking for.
 */
export const TYPE_COLOR: Record<KnowledgeDocType, string> = {
  skill: '#5b6b84',
  note: '#6b7a91',
  source: '#3f9e8c',
  research: '#6366f1',
  person: '#0ea5e9',
  decision: '#f97316',
  me: '#f0b429',
  project: '#8b5cf6',
  client: '#ff2255',
}
