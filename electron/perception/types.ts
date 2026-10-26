/**
 * Shared shapes of the perception engine: the page map an agent reads instead
 * of a screenshot, and the receipts actions return.
 */

/** One thing on the page an agent can act on or needs to read. */
export interface PageItem {
  /** Stable ref (`e12`) — valid until the document it came from is replaced. */
  ref: string
  role: string
  name: string
  /** Current value of an input; masked for passwords, card numbers and one-time codes. */
  value?: string
  states: string[]
  /** Heading level, when role is heading. */
  level?: number
  /** Top-left and size in page CSS pixels, when the element has layout. */
  x?: number
  y?: number
  w?: number
  h?: number
  inViewport: boolean
  frameId: string
}

export interface PageMap {
  url: string
  title: string
  /** Scroll position and viewport size in CSS pixels. */
  scrollY: number
  viewportHeight: number
  pageHeight: number
  landmarks: string[]
  items: PageItem[]
}

/** What changed since the map the agent last saw. */
export interface SnapshotDiff {
  mode: 'unchanged' | 'delta' | 'full'
  text: string
}

export type ActionKind = 'click' | 'type' | 'select' | 'scroll' | 'key'

/** What an action did, checked on the page afterwards — never just "sent". */
export interface ActionReceipt {
  ok: boolean
  action: ActionKind
  /** `button "Send"` — the element acted on, as the agent saw it. */
  target?: string
  error?: string
  /** True when the action was refused until the user confirms it. */
  needsConfirm?: boolean
  url?: string
  navigated?: boolean
  diff?: SnapshotDiff
}

/** Where a ref points, kept by the engine; never sent to the agent. */
export interface RefEntry {
  ref: string
  frameId: string
  loaderId: string
  backendNodeId: number
  role: string
  name: string
}
