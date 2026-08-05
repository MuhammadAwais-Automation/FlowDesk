import { EventEmitter } from 'events'
import { ensureBackgroundView, getViewById } from '../sessions'
import { injectPrompt, type AITool } from '../injector'
import { PROVIDER_URLS } from '../providerUrls'

/**
 * Heartbeat for long-running worker calls. The Claude Agent SDK's own
 * tool_progress message (SDKToolProgressMessage) turns out to be a
 * Task/subagent-only signal — confirmed via real logs it never fires for
 * plain custom MCP tool calls like these 5 worker tools, so a call sitting
 * inside its up-to-60s TOOL_TIMEOUT_MS wait produces zero events for the
 * renderer, and its idle-reset watchdog can (and did) misfire on a turn
 * that was still genuinely working. Rather than depend on anything from
 * the SDK's message stream, browserWorkerQueue emits its own heartbeat
 * directly — main.ts's agent:sendMessage handler subscribes to it for the
 * duration of a turn and forwards each tick to the renderer as a
 * tool_progress-shaped agent:event, which Agent.tsx already resets its
 * watchdog on.
 */
export const workerProgress = new EventEmitter()
const HEARTBEAT_INTERVAL_MS = 7_000

/**
 * FlowDesk's capture pipeline (electron/main.ts's `capture:chunk` handler)
 * has no built-in "await this reply" mechanism — every existing consumer is
 * fire-and-forget, correlating replies to sends purely by provider name via
 * globally-broadcast capture:live/capture:complete events (confirmed: no
 * tabId anywhere in that pipeline, and no timeout — a hung stream just
 * leaks its buffer forever). This module is the first place that actually
 * waits for a specific reply as a Promise.
 *
 * The fix for the correlation problem: only ever allow ONE request per
 * provider in flight at a time (chained via `queues`), so "the next
 * capture:complete for this tool" is unambiguous by construction — no id
 * matching needed. Known accepted limitation: if something else in FlowDesk
 * (e.g. Universal Chat's own UI-driven send) hits the SAME provider tool at
 * the exact same moment a queued call here is waiting, the two could still
 * cross-talk, since capture:complete is broadcast globally with no tab
 * scoping at all — same limitation UniversalChat.tsx already documents for
 * AI-Browser overlap. Fixing this properly means threading tabId through
 * the whole capture pipeline, which is real work out of scope for MVP.
 */

const TOOL_TIMEOUT_MS = 60_000

// Even with each provider now in its own independent hidden BrowserWindow
// (fixing the sibling-focus-stealing bug), firing all 5 CDP dispatches at
// the exact same instant is still flaky in practice — confirmed via real
// terminal logs: one full run had 4 of 5 providers fail on their first
// (and only) attempt, no successful retry, immediately after a run where
// all 5 succeeded on identical code. Nothing in the earlier fix addresses
// *timing*, only *isolation*. A small stagger between dispatch starts
// removes the coincidental collision without giving up real concurrency —
// providers still overlap and finish close to worst-case-single-provider
// time, not sum-of-all-five.
const DISPATCH_STAGGER_MS = 600
let lastDispatchAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Reserves the next stagger slot and returns how long to wait before using it. */
function claimDispatchSlot(): number {
  const now = Date.now()
  const earliestStart = Math.max(now, lastDispatchAt + DISPATCH_STAGGER_MS)
  lastDispatchAt = earliestStart
  return Math.max(0, earliestStart - now)
}

interface PendingWaiter {
  resolve: (text: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  heartbeat: ReturnType<typeof setInterval>
}

function clearWaiter(tool: string, waiter: PendingWaiter) {
  pendingWaiters.delete(tool)
  clearTimeout(waiter.timer)
  clearInterval(waiter.heartbeat)
}

const pendingWaiters = new Map<string, PendingWaiter>()

// Per-provider queues — different providers now run genuinely concurrently.
// (Earlier this was one single global chain forcing every provider to run
// one-at-a-time: real terminal logs showed CDP typing silently failing
// across several SIBLING WebContentsViews of one shared hidden host window
// when driven at once. Root cause fixed at the source — sessions.ts now
// gives each provider its own independent hidden BrowserWindow — so that
// blunt global lock is no longer needed. What still has to stay per-tool:
// two calls to the SAME provider must not overlap, since only one
// capture:complete waiter can be pending per tool at a time — see
// notifyCaptureComplete below.)
const queues = new Map<string, Promise<unknown>>()

let getPartitionImpl: () => string | null = () => null

/** Called once from main.ts after `store` exists, to avoid a circular import. */
export function configureBrowserWorkerQueue(opts: { getPartition: () => string | null }) {
  getPartitionImpl = opts.getPartition
}

/**
 * Called by main.ts's emitCaptureComplete() alongside the existing
 * renderer-facing capture:complete broadcast — resolves/rejects the
 * matching pending waiter for this tool, if one exists. A completion
 * arriving after its waiter already timed out and was removed is a safe
 * no-op (the browser tab keeps working even after FlowDesk gives up on it).
 */
export function notifyCaptureComplete(tool: string, text: string, error?: string) {
  const waiter = pendingWaiters.get(tool)
  if (!waiter) return

  // Same "ignore incidental empty completions" guard UniversalChat.tsx
  // already needs — a single turn on some providers fires several
  // independent network calls (title generation, moderation, etc), each
  // producing its own harmless empty capture:complete before the real
  // answer's call finishes.
  if (!text.trim() && !error) return

  clearWaiter(tool, waiter)
  if (error || !text.trim()) waiter.reject(new Error(error || `${tool} returned an empty response`))
  else waiter.resolve(text)
}

async function runOne(tool: AITool, prompt: string): Promise<string> {
  const staggerWait = claimDispatchSlot()
  if (staggerWait > 0) await sleep(staggerWait)

  const url = PROVIDER_URLS[tool]
  if (!url) throw new Error(`Unknown provider: ${tool}`)

  const partition = getPartitionImpl()
  if (!partition) throw new Error('No Google account configured — add one on the Accounts page first.')

  const tabId = `universalchat-${tool}`
  await ensureBackgroundView(tabId, partition, url)
  const view = getViewById(tabId)
  if (!view) throw new Error(`Could not open a browser session for ${tool}`)

  return new Promise<string>((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setTimeout(() => {
      const w = pendingWaiters.get(tool)
      if (w) clearWaiter(tool, w)
      reject(new Error(`${tool} did not respond within ${TOOL_TIMEOUT_MS / 1000}s`))
    }, TOOL_TIMEOUT_MS)
    // See workerProgress above — the SDK's own tool_progress never fires
    // for these custom tools, so this heartbeat is the only signal the
    // renderer gets that a slow provider is still being waited on, not stuck.
    const heartbeat = setInterval(() => {
      workerProgress.emit('progress', { tool, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) })
    }, HEARTBEAT_INTERVAL_MS)
    pendingWaiters.set(tool, { resolve, reject, timer, heartbeat })

    injectPrompt(view.webContents, prompt, tool, true).then(ok => {
      if (!ok) {
        const w = pendingWaiters.get(tool)
        if (w) {
          clearWaiter(tool, w)
          reject(new Error(`Could not submit the message to ${tool}`))
        }
      }
      // else: wait for notifyCaptureComplete() to be called by main.ts's
      // capture:chunk handler once the reply streams in.
    }).catch(err => {
      const w = pendingWaiters.get(tool)
      if (w) {
        clearWaiter(tool, w)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}

/**
 * Sends `prompt` to `tool`'s browser session and resolves with its reply
 * text. Only one call per PROVIDER is ever in flight at a time — a second
 * call to the same provider waits for the first to settle before starting.
 * Different providers now run concurrently (each has its own independent
 * hidden BrowserWindow — see sessions.ts).
 */
export function askBrowserProvider(tool: AITool, prompt: string): Promise<string> {
  const prev = queues.get(tool) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(() => runOne(tool, prompt))
  queues.set(tool, next.catch(() => {}))
  return next
}
