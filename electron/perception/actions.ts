import type { WebContents } from 'electron'
import { whileAwake } from '../keepAwake'
import { attachChildFrames, frameOrigin, liveFrames, pageSignature, snapshotPage, stateFor, withDebugger, type Send } from './capture'
import { summarizeRequests, type SeenRequest } from './routes'
import { fillVars, refind, stableAttrs, StepRecorder, type Fingerprint, type RefindLevel, type Routine, type RoutineStep } from './routines'
import { confirmReason } from './safety'
import { diffMaps, maskValue } from './serialize'
import type { ActionKind, ActionReceipt, PageMap, RefEntry } from './types'

/**
 * Acts on an element by ref, the way a person would (real mouse and key events
 * through CDP), then waits for the page to settle and returns a receipt with
 * what changed. A ref that no longer points at the same element fails closed.
 */

export interface ActRequest {
  action: ActionKind
  ref?: string
  text?: string
  value?: string
  key?: string
  direction?: 'up' | 'down'
  /** type: replace what the field holds instead of adding to it. */
  clear?: boolean
  /** The user said yes to this exact action in chat. */
  confirm?: boolean
}

const ACTIONS: readonly ActionKind[] = ['click', 'type', 'select', 'scroll', 'key']
const NEEDS_REF: readonly ActionKind[] = ['click', 'type', 'select']

/** Validates gateway params; returns the request or an error message. */
export function parseActRequest(p: Record<string, unknown>): ActRequest | string {
  const action = p.action as ActionKind
  if (!ACTIONS.includes(action)) return `action must be one of ${ACTIONS.join(', ')}`
  const req: ActRequest = { action, clear: p.clear === true, confirm: p.confirm === true }
  if (p.ref != null) {
    if (typeof p.ref !== 'string' || !/^@?e\d+$/.test(p.ref.trim())) return 'ref must look like e12 (from browser_snapshot)'
    req.ref = p.ref.trim().replace(/^@/, '')
  }
  if (NEEDS_REF.includes(action) && !req.ref) return `${action} needs a ref`
  if (action === 'type') {
    if (typeof p.text !== 'string') return 'type needs text'
    if (p.text.length > 10_000) return 'text is longer than 10000 characters'
    req.text = p.text
  }
  if (action === 'select') {
    if (typeof p.value !== 'string' || !p.value) return 'select needs value (the option text or value)'
    req.value = p.value
  }
  if (action === 'key') {
    if (typeof p.key !== 'string' || !keyDef(p.key)) return `key must be one character or one of ${Object.keys(KEYS).join(', ')}`
    req.key = p.key
  }
  if (action === 'scroll') req.direction = p.direction === 'up' ? 'up' : 'down'
  return req
}

/** Most steps one browser_act call may carry. */
export const MAX_STEPS = 20

/**
 * One action, or `steps: [...]` run in order in a single call — one receipt
 * instead of a model round-trip per step (Comet's ComputerBatch; UFO2 saw
 * ~50% less inference with batched actions).
 */
export function parseActRequests(p: Record<string, unknown>): ActRequest[] | string {
  if (p.steps == null) {
    const one = parseActRequest(p)
    return typeof one === 'string' ? one : [one]
  }
  if (!Array.isArray(p.steps) || p.steps.length === 0) return 'steps must be a non-empty list'
  if (p.steps.length > MAX_STEPS) return `at most ${MAX_STEPS} steps per call`
  const out: ActRequest[] = []
  for (const [i, s] of p.steps.entries()) {
    if (!s || typeof s !== 'object') return `step ${i + 1}: must be an object`
    // confirm on the call applies to every step: the user said yes to the whole list.
    const one = parseActRequest({ ...(s as Record<string, unknown>), confirm: p.confirm === true || (s as Record<string, unknown>).confirm === true })
    if (typeof one === 'string') return `step ${i + 1}: ${one}`
    out.push(one)
  }
  return out
}

const ANNOUNCE_ROLES = new Set(['alert', 'alertdialog', 'dialog', 'status'])

/** Alert, toast, status and dialog lines that are new since `before` — what a screen reader would speak. */
export function announcements(before: PageMap, after: PageMap): string[] {
  const seen = new Set(before.items.filter(i => ANNOUNCE_ROLES.has(i.role)).map(i => `${i.role}|${i.name}`))
  return after.items
    .filter(i => ANNOUNCE_ROLES.has(i.role) && !seen.has(`${i.role}|${i.name}`))
    .map(i => `${i.role}: ${i.name}`)
}

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  Space: { code: 'Space', vk: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
}

/** The CDP key event fields for a named key or a single character. */
export function keyDef(key: string): { key: string; code: string; vk: number; text?: string } | null {
  const named = KEYS[key]
  if (named) return { key: key === 'Space' ? ' ' : key, ...named }
  if ([...key].length !== 1) return null
  const upper = key.toUpperCase()
  const letter = /[A-Z]/.test(upper)
  const digit = /[0-9]/.test(key)
  return { key, code: letter ? `Key${upper}` : digit ? `Digit${key}` : '', vk: letter || digit ? upper.charCodeAt(0) : 0, text: key }
}

/**
 * Null when the element now in place is still the one the agent saw, else why
 * not. An empty live name is accepted: inputs named from their shadow host
 * have no AX name of their own.
 */
export function targetMismatch(entry: Pick<RefEntry, 'role' | 'name'>, now: { role: string; name: string } | null): string | null {
  if (!now) return 'the element is gone; take a new browser_snapshot'
  if (now.role !== entry.role) return `the element changed (was ${entry.role} "${entry.name}", now ${now.role} "${now.name}"); take a new browser_snapshot`
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  if (now.name && entry.name && !norm(now.name).startsWith(norm(entry.name).replace(/…$/, ''))) {
    return `the element changed (was ${entry.role} "${entry.name}", now "${now.name}"); take a new browser_snapshot`
  }
  return null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Reads until two reads in a row agree (the page went quiet), at most `capMs`.
 * No fixed long sleep: a page that is already done answers in ~2 reads.
 */
export async function settle<T>(read: () => Promise<T>, same: (a: T, b: T) => boolean, opts = { firstMs: 100, quietMs: 150, capMs: 750 }): Promise<T> {
  const start = Date.now()
  await sleep(opts.firstMs)
  let prev = await read()
  while (Date.now() - start < opts.capMs) {
    await sleep(opts.quietMs)
    const next = await read()
    if (same(prev, next)) return next
    prev = next
  }
  return prev
}

function waitLoaded(wc: WebContents, ms = 5000): Promise<void> {
  if (!wc.isLoading()) return Promise.resolve()
  return new Promise(resolve => {
    const done = () => { clearTimeout(t); wc.removeListener('did-stop-loading', done); resolve() }
    const t = setTimeout(done, ms)
    wc.once('did-stop-loading', done)
  })
}

async function centerOf(send: Send, backendNodeId: number): Promise<{ x: number; y: number }> {
  await send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
  const { model } = await send('DOM.getBoxModel', { backendNodeId }) as { model: { content: number[] } }
  const q = model.content
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 }
}

async function pressKey(send: Send, key: string, modifiers = 0, commands?: string[]): Promise<void> {
  const d = keyDef(key)!
  const base = { key: d.key, code: d.code, windowsVirtualKeyCode: d.vk, modifiers }
  const withText = !!d.text && !modifiers
  await send('Input.dispatchKeyEvent', { type: withText ? 'keyDown' : 'rawKeyDown', ...base, ...(withText ? { text: d.text } : {}), ...(commands ? { commands } : {}) })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

const SELECT_OPTION = `function (want) {
  if (!(this instanceof HTMLSelectElement)) return 'not-select'
  const o = Array.from(this.options).find(o => o.value === want || o.label.trim() === want || o.text.trim() === want)
  if (!o) return 'no-option'
  this.value = o.value
  this.dispatchEvent(new Event('input', { bubbles: true }))
  this.dispatchEvent(new Event('change', { bubbles: true }))
  return 'ok'
}`

/** The element lives in a cross-site iframe: DOM calls go to its session, input to the page at an offset. */
interface InFrame { send: Send; ownerId: number }

/**
 * Runs the action; returns an error message when the page refused it. `send`
 * is the page session (mouse and keys always go there); `dom` is the session
 * of the frame that owns the element.
 */
async function dispatch(send: Send, req: ActRequest, entry: RefEntry | undefined, frame?: InFrame): Promise<string | null> {
  const id = entry?.backendNodeId
  const dom = frame?.send ?? send
  switch (req.action) {
    case 'click': {
      if (frame) {
        await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: frame.ownerId }).catch(() => {})
        const local = await centerOf(dom, id!)
        const origin = await frameOrigin(send, frame.ownerId)
        if (!origin) return 'the iframe holding this element is gone; take a new browser_snapshot'
        const x = local.x + origin.x, y = local.y + origin.y
        const base = { x, y, button: 'left', clickCount: 1 }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
        return null
      }
      const { x, y } = await centerOf(send, id!)
      const base = { x, y, button: 'left', clickCount: 1 }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
      return null
    }
    case 'type': {
      if (frame) await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: frame.ownerId }).catch(() => {})
      await dom('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }).catch(() => {})
      await dom('DOM.focus', { backendNodeId: id })
      if (req.clear) {
        await pressKey(send, 'a', process.platform === 'darwin' ? 4 : 2, ['selectAll'])
        await pressKey(send, 'Backspace')
      }
      await send('Input.insertText', { text: req.text })
      return null
    }
    case 'select': {
      const { object } = await dom('DOM.resolveNode', { backendNodeId: id }) as { object: { objectId: string } }
      // callFunctionOn needs no Runtime.enable.
      const { result } = await dom('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: SELECT_OPTION, arguments: [{ value: req.value }], returnByValue: true }) as { result: { value?: string } }
      if (result.value === 'not-select') return 'not a native select: click it, then click the option ref'
      if (result.value === 'no-option') return `no option "${req.value}"`
      return null
    }
    case 'scroll': {
      if (id != null) { await dom('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }); return null }
      const m = await send('Page.getLayoutMetrics') as { cssLayoutViewport?: { clientWidth: number; clientHeight: number } }
      const w = m.cssLayoutViewport?.clientWidth ?? 800, h = m.cssLayoutViewport?.clientHeight ?? 600
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: w / 2, y: h / 2, deltaX: 0, deltaY: (req.direction === 'up' ? -0.8 : 0.8) * h })
      return null
    }
    case 'key': {
      if (id != null) await dom('DOM.focus', { backendNodeId: id })
      await pressKey(send, req.key!)
      return null
    }
  }
}

const quote = (e: Pick<RefEntry, 'role' | 'name'>) => `${e.role} "${e.name}"`

const MARK = { borderColor: { r: 217, g: 119, b: 6, a: 0.95 }, contentColor: { r: 245, g: 158, b: 11, a: 0.22 }, showInfo: false }
export const MARK_MS = 350

/**
 * Outlines the element an agent is about to use, so a user watching sees where
 * it acts. Drawn by the browser's own overlay (like DevTools' inspect box): not
 * part of the page, invisible to its scripts and to the next snapshot.
 */
async function mark(dom: Send, backendNodeId: number): Promise<void> {
  try {
    await dom('DOM.enable')
    await dom('Overlay.enable')
    await dom('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
    await dom('Overlay.highlightNode', { highlightConfig: MARK, backendNodeId })
    await new Promise(r => setTimeout(r, MARK_MS))
  } catch { /* a missing outline must never stop the action */ }
}

const unmark = (dom: Send) => dom('Overlay.hideHighlight').catch(() => {})

interface StepResult { error?: string; needsConfirm?: boolean; target?: string; recorded?: RoutineStep }

/** Successful steps per page, for browser_routine_save. */
export const recorder = new StepRecorder()

const attrsOf = async (dom: Send, backendNodeId: number): Promise<Record<string, string>> => {
  const r = await dom('DOM.describeNode', { backendNodeId }).catch(() => null) as { node?: { attributes?: string[] } } | null
  const flat = r?.node?.attributes ?? []
  const out: Record<string, string> = {}
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i].toLowerCase()] = flat[i + 1]
  return out
}

/** What a routine keeps of a step. Text typed into a secret field is never stored: it becomes {{secret}}. */
async function recordStep(dom: Send, req: ActRequest, entry: RefEntry | undefined, at: { x?: number; y?: number } | undefined): Promise<RoutineStep> {
  const step: RoutineStep = { action: req.action }
  if (req.key) step.key = req.key
  if (req.value) step.value = req.value
  if (req.direction) step.direction = req.direction
  if (req.clear) step.clear = true
  if (entry) {
    const raw = await attrsOf(dom, entry.backendNodeId)
    const secretDom = raw.type?.toLowerCase() === 'password' || /one-time-code|cc-|password/i.test(raw.autocomplete ?? '')
    step.target = { role: entry.role, name: entry.name, attrs: stableAttrs(raw), x: at?.x, y: at?.y }
    if (req.text != null) step.text = maskValue('x', entry.name, secretDom) === 'x' ? req.text : '{{secret}}'
  } else if (req.text != null) {
    step.text = req.text
  }
  return step
}

/** Checks the ref still points at the element the agent saw, asks for confirm when needed, then acts. */
async function runStep(send: Send, wc: WebContents, req: ActRequest, highlight = false): Promise<StepResult> {
  const state = stateFor(wc)
  let entry: RefEntry | undefined
  let frame: InFrame | undefined
  let release: (() => Promise<void>) | undefined
  try {
    if (req.ref) {
      entry = state.refs.get(req.ref)
      if (!entry) return { error: `unknown ref ${req.ref}; take a new browser_snapshot` }
      const { frameId, loaderId, backendNodeId } = entry
      const frames = await liveFrames(send)
      if (!frames.some(f => f.id === frameId && f.loaderId === loaderId)) {
        // Not in the page's own frames: maybe a cross-site iframe, which has its own session.
        const kids = await attachChildFrames(wc, send, new Set(frames.map(f => f.id)))
        release = kids.release
        const kid = kids.frames.find(k => k.frameId === frameId && k.loaderId === loaderId)
        if (!kid) return { error: `ref ${req.ref} belongs to a page that is gone; take a new browser_snapshot` }
        frame = { send: kid.send, ownerId: kid.ownerId }
      }
      const dom = frame?.send ?? send
      await dom('Accessibility.enable').catch(() => {})
      const ax = await dom('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false })
        .catch(() => ({ nodes: [] })) as { nodes: { role?: { value?: unknown }; name?: { value?: unknown }; backendDOMNodeId?: number }[] }
      const node = ax.nodes.find(n => n.backendDOMNodeId === backendNodeId)
      const mismatch = targetMismatch(entry, node ? { role: String(node.role?.value ?? ''), name: String(node.name?.value ?? '') } : null)
      if (mismatch) return { error: mismatch, target: quote(entry) }
    }
    const target = entry && quote(entry)

    const reason = confirmReason(req, entry)
    if (reason && !req.confirm) return { error: reason, needsConfirm: true, target }

    const dom = frame?.send ?? send
    if (highlight && entry) await mark(dom, entry.backendNodeId)
    try {
      const error = await dispatch(send, req, entry, frame)
      if (error) return { error, target }
    } catch (e) {
      return { error: `could not ${req.action}: ${e instanceof Error ? e.message : String(e)}`, target }
    } finally {
      if (highlight && entry) await unmark(dom)
    }
    const seen = req.ref ? state.last?.items.find(i => i.ref === req.ref) : undefined
    const recorded = await recordStep(frame?.send ?? send, req, entry, seen).catch(() => undefined)
    return { target, recorded }
  } finally {
    await release?.()
  }
}

/**
 * Runs one action or a list of them, then reads the page once. Between steps
 * only a ~1 ms signature is polled; the full map is captured a single time at
 * the end. A failing or unconfirmed step stops the list there.
 */
/**
 * Collects the page's own requests while `fn` runs. Network is never disabled
 * afterwards: other FlowDesk code (Live Capture) may rely on it being on.
 */
async function watchNetwork<T>(wc: WebContents, send: Send, fn: () => Promise<T>): Promise<[T, SeenRequest[]]> {
  const seen = new Map<string, SeenRequest>()
  interface NetEvent {
    requestId: string
    type?: string
    request?: { method: string; url: string }
    response?: { status: number; mimeType: string }
    encodedDataLength?: number
  }
  const onMessage = (_e: unknown, method: string, params: NetEvent, sessionId?: string) => {
    if (sessionId) return
    if (method === 'Network.requestWillBeSent' && params.request) seen.set(params.requestId, { method: params.request.method, url: params.request.url, type: params.type ?? '' })
    else if (method === 'Network.responseReceived') { const r = seen.get(params.requestId); if (r) { r.status = params.response?.status; r.mime = params.response?.mimeType } }
    else if (method === 'Network.loadingFinished') { const r = seen.get(params.requestId); if (r) r.bytes = params.encodedDataLength }
  }
  wc.debugger.on('message', onMessage)
  try {
    await send('Network.enable').catch(() => {})
    const out = await fn()
    return [out, [...seen.values()]]
  } finally {
    wc.debugger.removeListener('message', onMessage)
  }
}

export async function actOnPage(wc: WebContents, reqs: ActRequest | ActRequest[], opts: { network?: boolean; highlight?: boolean } = {}): Promise<ActionReceipt> {
  if (opts.network) {
    return whileAwake(wc, () => withDebugger(wc, async send => {
      const [receipt, seen] = await watchNetwork(wc, send, () => actOnPage(wc, reqs, { highlight: opts.highlight }))
      return { ...receipt, requests: summarizeRequests(seen) }
    }))
  }
  const list = Array.isArray(reqs) ? reqs : [reqs]
  const state = stateFor(wc)

  return whileAwake(wc, () => withDebugger(wc, async send => {
    const before: PageMap = state.last ?? await snapshotPage(wc)
    let done = 0
    let last: StepResult = {}
    const host = hostOf(before.url)
    for (const req of list) {
      last = await runStep(send, wc, req, opts.highlight)
      if (last.error) break
      if (last.recorded) recorder.add(wc.id, host, last.recorded)
      done++
      await waitLoaded(wc)
      await settle(() => pageSignature(send), (a, b) => a === b)
    }
    const failed = !!last.error
    const at = failed ? list[done] : list[list.length - 1]
    const after = await snapshotPage(wc)
    const receipt: ActionReceipt = {
      ok: !failed,
      action: at.action,
      target: last.target,
      url: after.url,
      navigated: after.url !== before.url,
      diff: diffMaps(before, after),
    }
    if (failed) {
      receipt.error = last.error
      if (last.needsConfirm) receipt.needsConfirm = true
    }
    const news = announcements(before, after)
    if (news.length) receipt.announce = news
    if (list.length > 1) {
      receipt.steps = done
      if (failed) receipt.failedStep = done + 1
    }
    return receipt
  }))
}

export const hostOf = (url: string): string => { try { return new URL(url).host } catch { return '' } }

/** CSS attribute selector for a stable attribute, quoted for the DOM. */
const attrSelector = (k: string, v: string) => `[${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`

/**
 * Level 0 of the re-finder: a stable attribute (id, data-testid, name, aria-label,
 * placeholder) that matches exactly one element in the live page.
 */
async function findByAttrs(send: Send, wc: WebContents, map: PageMap, fp: Fingerprint): Promise<string | null> {
  const state = stateFor(wc)
  const { root } = await send('DOM.getDocument', { depth: 0 }).catch(() => ({ root: null })) as { root: { nodeId: number } | null }
  if (!root) return null
  for (const k of ['data-testid', 'data-test', 'data-qa', 'id', 'name', 'aria-label', 'placeholder']) {
    const v = fp.attrs[k]
    if (!v) continue
    const r = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: attrSelector(k, v) }).catch(() => null) as { nodeIds: number[] } | null
    if (r?.nodeIds.length !== 1) continue
    const d = await send('DOM.describeNode', { nodeId: r.nodeIds[0] }).catch(() => null) as { node?: { backendNodeId: number } } | null
    const item = d?.node && map.items.find(i => state.refs.get(i.ref)?.backendNodeId === d.node!.backendNodeId && i.role === fp.role)
    if (item) return item.ref
  }
  return null
}

export interface RoutineReceipt extends ActionReceipt {
  /** How each step's element was found again, in order. */
  found?: (RefindLevel | 'attribute' | 'no target')[]
}

/**
 * Replays a saved routine: per step a fresh map, the element found again
 * (stable attribute, then refind), then the same checks and confirm rules as
 * browser_act. Stops at the first step whose element is missing or ambiguous.
 */
export async function runRoutine(wc: WebContents, routine: Routine, vars: Record<string, string>, confirm: boolean): Promise<RoutineReceipt> {
  const first = routine.steps[0]?.action ?? 'click'
  if (hostOf(wc.getURL()) !== routine.host) {
    return { ok: false, action: first, error: `routine "${routine.name}" was recorded on ${routine.host}; this view is on ${hostOf(wc.getURL()) || 'no page'}` }
  }
  return whileAwake(wc, () => withDebugger(wc, async send => {
    const before = await snapshotPage(wc)
    const found: NonNullable<RoutineReceipt['found']> = []
    let done = 0
    let error: string | undefined
    let needsConfirm = false
    let target: string | undefined
    for (const [n, step] of routine.steps.entries()) {
      const map = n === 0 ? before : await snapshotPage(wc)
      const req: ActRequest = { action: step.action, key: step.key, value: step.value, direction: step.direction, clear: step.clear === true, confirm }
      if (step.text != null) {
        const filled = fillVars(step.text, vars)
        if (typeof filled !== 'string') { error = `step ${n + 1} needs vars.${filled.missing}`; break }
        req.text = filled
      }
      if (step.target) {
        const byAttr = await findByAttrs(send, wc, map, step.target)
        const hit = byAttr ? null : refind(map.items, step.target)
        const ref = byAttr ?? hit?.item.ref
        if (!ref) { error = `step ${n + 1}: ${step.target.role} "${step.target.name}" not found (or not unique) on the page; do it by hand and save the routine again`; break }
        found.push(byAttr ? 'attribute' : hit!.level)
        req.ref = ref
      } else {
        found.push('no target')
      }
      const r = await runStep(send, wc, req)
      target = r.target
      if (r.error) { error = r.error; needsConfirm = !!r.needsConfirm; break }
      done++
      await waitLoaded(wc)
      await settle(() => pageSignature(send), (a, b) => a === b)
    }
    const after = await snapshotPage(wc)
    const receipt: RoutineReceipt = {
      ok: !error,
      action: routine.steps[Math.min(done, routine.steps.length - 1)]?.action ?? first,
      target,
      url: after.url,
      navigated: after.url !== before.url,
      diff: diffMaps(before, after),
      steps: done,
      found,
    }
    if (error) { receipt.error = error; receipt.failedStep = done + 1 }
    if (needsConfirm) receipt.needsConfirm = true
    const news = announcements(before, after)
    if (news.length) receipt.announce = news
    return receipt
  }))
}
