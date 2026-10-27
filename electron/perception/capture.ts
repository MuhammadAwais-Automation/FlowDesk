import type { WebContents } from 'electron'
import { RefTable } from './refs'
import { buildPageMap, domFacts, type AXNode, type CapturedFrame, type DOMSnapshotResult } from './serialize'
import type { PageMap } from './types'

/**
 * Reads a page through the DevTools protocol in a few bulk calls: the AX tree
 * per frame, one DOM snapshot (rects, click listeners, shadow roots) and the
 * layout metrics. `Runtime.enable` is never sent — anti-bot scripts detect it.
 */

export type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>

/**
 * Runs `fn` with the debugger attached. Other FlowDesk code (keepAwake, capture
 * recorders) may already hold it: then it is borrowed and left attached.
 */
export async function withDebugger<T>(wc: WebContents, fn: (send: Send) => Promise<T>): Promise<T> {
  const attachedHere = !wc.debugger.isAttached()
  if (attachedHere) wc.debugger.attach('1.3')
  const send: Send = (method, params) => wc.debugger.sendCommand(method, params)
  try { return await fn(send) } finally {
    if (attachedHere && !wc.isDestroyed()) { try { wc.debugger.detach() } catch { /* already gone */ } }
  }
}

interface FrameTreeNode { frame: { id: string; loaderId: string }; childFrames?: FrameTreeNode[] }

export async function liveFrames(send: Send): Promise<{ id: string; loaderId: string }[]> {
  const { frameTree } = await send('Page.getFrameTree') as { frameTree: FrameTreeNode }
  const out: { id: string; loaderId: string }[] = []
  const walk = (n: FrameTreeNode) => { out.push({ id: n.frame.id, loaderId: n.frame.loaderId }); n.childFrames?.forEach(walk) }
  walk(frameTree)
  return out
}

interface PageState { refs: RefTable; last: PageMap | null }
const states = new Map<number, PageState>()

/** Refs and the last map the agent saw, one per page; dropped with the page. */
export function stateFor(wc: WebContents): PageState {
  let s = states.get(wc.id)
  if (!s) {
    s = { refs: new RefTable(), last: null }
    states.set(wc.id, s)
    const id = wc.id
    wc.once('destroyed', () => states.delete(id))
  }
  return s
}

interface LayoutMetrics {
  cssVisualViewport?: { pageY: number; clientHeight: number }
  cssContentSize?: { height: number }
}

/**
 * A cheap "did the page move" fingerprint for settle loops: url, title, element
 * count and text length. ~1 ms, versus a full map per poll (60–300 ms) — the
 * MVP's settle re-captured the whole page every 150 ms.
 */
export async function pageSignature(send: Send): Promise<string> {
  const expression = `location.href + '|' + document.title + '|' + document.getElementsByTagName('*').length + '|' + (document.body ? document.body.textContent.length : 0)`
  const r = await send('Runtime.evaluate', { expression, returnByValue: true }).catch(() => null) as { result?: { value?: string } } | null
  return r?.result?.value ?? ''
}

/** A fresh map of the page; it becomes the map later diffs compare against. */
export async function snapshotPage(wc: WebContents): Promise<PageMap> {
  const state = stateFor(wc)
  const started = Date.now()
  const map = await withDebugger(wc, async send => {
    const [frames] = await Promise.all([liveFrames(send), send('Accessibility.enable').catch(() => {})])
    // Every read in flight at once: the frames' AX trees no longer wait on each other or on the DOM snapshot.
    const [dom, metrics, ...trees] = await Promise.all([
      send('DOMSnapshot.captureSnapshot', { computedStyles: [] }) as Promise<DOMSnapshotResult>,
      send('Page.getLayoutMetrics') as Promise<LayoutMetrics>,
      ...frames.map(f => (send('Accessibility.getFullAXTree', { frameId: f.id }) as Promise<{ nodes: AXNode[] }>)
        // Out-of-process iframes answer only on their own target session.
        .catch(() => null)),
    ])
    const captured: CapturedFrame[] = []
    trees.forEach((t, i) => { if (t) captured.push({ frameId: frames[i].id, loaderId: frames[i].loaderId, nodes: t.nodes }) })
    state.refs.forgetDocumentsExcept(new Set(frames.map(f => f.loaderId)))
    return buildPageMap({
      url: wc.getURL(),
      title: wc.getTitle(),
      frames: captured,
      dom: domFacts(dom),
      scrollY: metrics.cssVisualViewport?.pageY ?? 0,
      viewportHeight: metrics.cssVisualViewport?.clientHeight ?? 0,
      pageHeight: metrics.cssContentSize?.height ?? 0,
    }, state.refs)
  })
  map.ms = Date.now() - started
  state.last = map
  return map
}
