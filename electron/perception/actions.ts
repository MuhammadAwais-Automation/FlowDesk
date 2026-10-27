import type { WebContents } from 'electron'
import { whileAwake } from '../keepAwake'
import { liveFrames, pageSignature, snapshotPage, stateFor, withDebugger, type Send } from './capture'
import { confirmReason } from './safety'
import { diffMaps } from './serialize'
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

/** Runs the action; returns an error message when the page refused it. */
async function dispatch(send: Send, req: ActRequest, entry: RefEntry | undefined): Promise<string | null> {
  const id = entry?.backendNodeId
  switch (req.action) {
    case 'click': {
      const { x, y } = await centerOf(send, id!)
      const base = { x, y, button: 'left', clickCount: 1 }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
      return null
    }
    case 'type': {
      await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }).catch(() => {})
      await send('DOM.focus', { backendNodeId: id })
      if (req.clear) {
        await pressKey(send, 'a', process.platform === 'darwin' ? 4 : 2, ['selectAll'])
        await pressKey(send, 'Backspace')
      }
      await send('Input.insertText', { text: req.text })
      return null
    }
    case 'select': {
      const { object } = await send('DOM.resolveNode', { backendNodeId: id }) as { object: { objectId: string } }
      // callFunctionOn needs no Runtime.enable.
      const { result } = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: SELECT_OPTION, arguments: [{ value: req.value }], returnByValue: true }) as { result: { value?: string } }
      if (result.value === 'not-select') return 'not a native select: click it, then click the option ref'
      if (result.value === 'no-option') return `no option "${req.value}"`
      return null
    }
    case 'scroll': {
      if (id != null) { await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: id }); return null }
      const m = await send('Page.getLayoutMetrics') as { cssLayoutViewport?: { clientWidth: number; clientHeight: number } }
      const w = m.cssLayoutViewport?.clientWidth ?? 800, h = m.cssLayoutViewport?.clientHeight ?? 600
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: w / 2, y: h / 2, deltaX: 0, deltaY: (req.direction === 'up' ? -0.8 : 0.8) * h })
      return null
    }
    case 'key': {
      if (id != null) await send('DOM.focus', { backendNodeId: id })
      await pressKey(send, req.key!)
      return null
    }
  }
}

const quote = (e: Pick<RefEntry, 'role' | 'name'>) => `${e.role} "${e.name}"`

interface StepResult { error?: string; needsConfirm?: boolean; target?: string }

/** Checks the ref still points at the element the agent saw, asks for confirm when needed, then acts. */
async function runStep(send: Send, wc: WebContents, req: ActRequest): Promise<StepResult> {
  const state = stateFor(wc)
  let entry: RefEntry | undefined
  if (req.ref) {
    entry = state.refs.get(req.ref)
    if (!entry) return { error: `unknown ref ${req.ref}; take a new browser_snapshot` }
    const { frameId, loaderId, backendNodeId } = entry
    const frames = await liveFrames(send)
    if (!frames.some(f => f.id === frameId && f.loaderId === loaderId)) {
      return { error: `ref ${req.ref} belongs to a page that is gone; take a new browser_snapshot` }
    }
    await send('Accessibility.enable').catch(() => {})
    const ax = await send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false })
      .catch(() => ({ nodes: [] })) as { nodes: { role?: { value?: unknown }; name?: { value?: unknown }; backendDOMNodeId?: number }[] }
    const node = ax.nodes.find(n => n.backendDOMNodeId === backendNodeId)
    const mismatch = targetMismatch(entry, node ? { role: String(node.role?.value ?? ''), name: String(node.name?.value ?? '') } : null)
    if (mismatch) return { error: mismatch, target: quote(entry) }
  }
  const target = entry && quote(entry)

  const reason = confirmReason(req, entry)
  if (reason && !req.confirm) return { error: reason, needsConfirm: true, target }

  try {
    const error = await dispatch(send, req, entry)
    if (error) return { error, target }
  } catch (e) {
    return { error: `could not ${req.action}: ${e instanceof Error ? e.message : String(e)}`, target }
  }
  return { target }
}

/**
 * Runs one action or a list of them, then reads the page once. Between steps
 * only a ~1 ms signature is polled; the full map is captured a single time at
 * the end. A failing or unconfirmed step stops the list there.
 */
export async function actOnPage(wc: WebContents, reqs: ActRequest | ActRequest[]): Promise<ActionReceipt> {
  const list = Array.isArray(reqs) ? reqs : [reqs]
  const state = stateFor(wc)

  return whileAwake(wc, () => withDebugger(wc, async send => {
    const before: PageMap = state.last ?? await snapshotPage(wc)
    let done = 0
    let last: StepResult = {}
    for (const req of list) {
      last = await runStep(send, wc, req)
      if (last.error) break
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
