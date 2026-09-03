/**
 * The shape of a node's style, shared by the properties panel and the agent's
 * studio_* tools. Both must agree byte-for-byte, which is only achievable if
 * they narrow, diff and format through the same functions — so those live
 * here, pure and tested, rather than inside either consumer.
 */

export type NodeStyles = Record<string, string>

export interface NodeRef {
  artboardId: string
  elementId: string
}

export interface NodeSummary {
  elementId: string
  tag: string
  /** Text content or a generated name — what the layer tree shows. */
  label: string
  depth: number
  childCount: number
}

/**
 * A computed style dump has hundreds of entries, almost all of them defaults
 * nobody asked for. Writing all of them back would bloat every document and
 * make two edits to the same node produce different HTML. The panel edits
 * exactly these.
 */
export const PANEL_PROPERTIES = [
  'left', 'top', 'width', 'height', 'rotate',
  'display', 'flex-direction', 'align-items', 'justify-content',
  'gap', 'padding', 'overflow',
  'border-radius',
  'opacity', 'mix-blend-mode',
  'background-color', 'color', 'background', 'border',
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height',
  'margin-bottom', 'text-align', 'text-transform', 'font-style',
  'text-decoration-line', 'font-feature-settings',
  '-webkit-text-stroke', 'text-shadow',
] as const

const PANEL_SET = new Set<string>(PANEL_PROPERTIES)

export function pickPanelStyles(computed: Record<string, string>): NodeStyles {
  const out: NodeStyles = {}
  for (const key of Object.keys(computed)) {
    if (PANEL_SET.has(key)) out[key] = computed[key]
  }
  return out
}

/**
 * Only changed properties are written. An empty patch means no write at all —
 * which is what keeps a click that changes nothing out of the undo stack.
 */
export function stylePatch(before: NodeStyles, after: NodeStyles): NodeStyles {
  const patch: NodeStyles = {}
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) patch[key] = after[key]
  }
  return patch
}

const NUMERIC = /^-?\d+(\.\d+)?$/
const WITH_UNIT = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/

export function parseLength(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (NUMERIC.test(trimmed)) return `${trimmed}px`
  if (WITH_UNIT.test(trimmed)) return trimmed
  return null
}

export function formatLength(value: string): string {
  if (!value) return '—'
  return value.endsWith('px') ? value.slice(0, -2) : value
}

/**
 * Ruling D1: the panel cannot always tell a text node from a box just by
 * looking at styles, so the bridge's `selected` message carries the node's
 * tag and this decides what "text" means for controls like Stroke that
 * apply differently to each (`-webkit-text-stroke` vs `border`). This is a
 * heuristic over common HTML tags the agent and the document generator use
 * for copy, not an exhaustive content-model check — an unlisted tag (e.g. a
 * bespoke custom element) falls back to being treated as a box, which is the
 * safer default since `border` is meaningful on anything.
 */
const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'a', 'li', 'blockquote', 'figcaption', 'label',
  'strong', 'em', 'b', 'i', 'small', 'caption', 'q', 'cite', 'mark',
])

export function isTextTag(tag: string | null | undefined): boolean {
  return !!tag && TEXT_TAGS.has(tag.toLowerCase())
}
