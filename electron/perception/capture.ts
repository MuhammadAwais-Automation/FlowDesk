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
  cssVisualViewport?: { pageX?: number; pageY: number; clientHeight: number }
  cssContentSize?: { height: number }
}

/** An out-of-process iframe (another site inside the page) reached through its own CDP session. */
export interface ChildFrame {
  frameId: string
  loaderId: string
  /** backendNodeId of the <iframe> element in the parent page. */
  ownerId: number
  send: Send
}

/**
 * Cross-site iframes run in their own process: they are missing from the
 * page's frame tree and answer only on their own target session (probe:
 * perception-research/bench/oopif-probe.mjs). Found via Target.getTargets by
 * parentFrameId; one level deep. Sessions are detached by `release`.
 */
export async function attachChildFrames(wc: WebContents, send: Send, parentIds: Set<string>): Promise<{ frames: ChildFrame[]; release: () => Promise<void> }> {
  const sessions: string[] = []
  const frames: ChildFrame[] = []
  const { targetInfos } = await send('Target.getTargets').catch(() => ({ targetInfos: [] })) as { targetInfos: { targetId: string; type: string; parentFrameId?: string }[] }
  for (const t of targetInfos) {
    if (t.type !== 'iframe' || !t.parentFrameId || !parentIds.has(t.parentFrameId)) continue
    try {
      const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true }) as { sessionId: string }
      sessions.push(sessionId)
      const childSend: Send = (method, params) => wc.debugger.sendCommand(method, params, sessionId)
      const { frameTree } = await childSend('Page.getFrameTree') as { frameTree: FrameTreeNode }
      const { backendNodeId } = await send('DOM.getFrameOwner', { frameId: frameTree.frame.id }) as { backendNodeId: number }
      frames.push({ frameId: frameTree.frame.id, loaderId: frameTree.frame.loaderId, ownerId: backendNodeId, send: childSend })
    } catch { /* the iframe went away while attaching */ }
  }
  const release = async () => { await Promise.all(sessions.map(sessionId => send('Target.detachFromTarget', { sessionId }).catch(() => {}))) }
  return { frames, release }
}

/** Top-left of an <iframe>'s content box in viewport coordinates; child-frame boxes are relative to it. */
export async function frameOrigin(send: Send, ownerId: number): Promise<{ x: number; y: number } | null> {
  const r = await send('DOM.getBoxModel', { backendNodeId: ownerId }).catch(() => null) as { model: { content: number[] } } | null
  return r ? { x: r.model.content[0], y: r.model.content[1] } : null
}

/** Items of the cross-site iframes, positioned on the parent page. */
async function childItems(wc: WebContents, send: Send, parentIds: Set<string>, state: PageState, page: { scrollX: number; scrollY: number; viewportHeight: number; pageHeight: number; url: string }): Promise<{ items: PageMap['items']; loaderIds: string[] }> {
  const { frames, release } = await attachChildFrames(wc, send, parentIds)
  const items: PageMap['items'] = []
  try {
    await Promise.all(frames.map(async f => {
      await f.send('Accessibility.enable').catch(() => {})
      const [tree, dom, origin] = await Promise.all([
        f.send('Accessibility.getFullAXTree') as Promise<{ nodes: AXNode[] }>,
        f.send('DOMSnapshot.captureSnapshot', { computedStyles: [] }) as Promise<DOMSnapshotResult>,
        frameOrigin(send, f.ownerId),
      ])
      if (!origin) return
      const top = origin.y + page.scrollY, left = origin.x + page.scrollX
      const sub = buildPageMap({
        url: page.url, title: '', frames: [{ frameId: f.frameId, loaderId: f.loaderId, nodes: tree.nodes }], dom: domFacts(dom),
        scrollY: page.scrollY - top, viewportHeight: page.viewportHeight, pageHeight: page.pageHeight,
      }, state.refs)
      for (const i of sub.items) {
        if (i.x != null) i.x += left
        if (i.y != null) i.y += top
        items.push(i)
      }
    }))
  } catch { /* an iframe that cannot be read leaves the parent map intact */ } finally {
    await release()
  }
  return { items, loaderIds: frames.map(f => f.loaderId) }
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
    const page = {
      url: wc.getURL(),
      scrollX: metrics.cssVisualViewport?.pageX ?? 0,
      scrollY: metrics.cssVisualViewport?.pageY ?? 0,
      viewportHeight: metrics.cssVisualViewport?.clientHeight ?? 0,
      pageHeight: metrics.cssContentSize?.height ?? 0,
    }
    const main = buildPageMap({ ...page, title: wc.getTitle(), frames: captured, dom: domFacts(dom) }, state.refs)
    const kids = await childItems(wc, send, new Set(frames.map(f => f.id)), state, page)
    main.items.push(...kids.items)
    main.iframes = kids.loaderIds.length
    // Only after the iframes were read: their refs would otherwise be dropped and renumbered on every snapshot.
    state.refs.forgetDocumentsExcept(new Set([...frames.map(f => f.loaderId), ...kids.loaderIds]))
    return main
  })
  map.ms = Date.now() - started
  state.last = map
  return map
}
