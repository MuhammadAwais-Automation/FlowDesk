import { EventEmitter } from 'events'
import { ensureBackgroundView, getViewById } from '../sessions'
import { injectPrompt, type AITool } from '../injector'
import { PROVIDER_URLS } from '../providerUrls'
import {
  classifyAccountFailure,
  maskAccountEmail,
  type AccountFailure,
  type BrowserAccount,
} from './accountFailover'

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

export type WorkerProgress =
  | { type: 'heartbeat'; tool: string; elapsedSeconds: number }
  | { type: 'account_retry'; tool: string; elapsedSeconds: number; reason: AccountFailure; accountEmailMasked: string }

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

// A fixed 60s timeout used to kill image-generation turns outright: real
// captures (probes/out/_chatgpt-image-compare-debug.log) confirmed the
// image event's SSE stream is still alive and correctly shaped well past
// 60s for these — the provider just takes longer to render an image than to
// answer a text prompt. Rather than raise one fixed number (which would
// make an actually-stuck provider take 4x longer to report failure), the
// timeout is now two-tier: IDLE_TIMEOUT_MS is reset on every live chunk (see
// notifyCaptureActivity, called from main.ts's emitCaptureLive on every
// capture:live tick), so a stream that is still producing SOMETHING keeps
// its waiter alive; HARD_CEILING_MS is an absolute cap that never resets,
// so a provider that streams forever without ever truly finishing still
// gets cut off.
// Real captured evidence (probes/out/_chatgpt-image-compare-debug.log) shows
// ChatGPT's own server can go 130-220s between genuinely finished image
// events on the SAME conversation, with nothing but SSE keep-alive pings in
// between — a direct-probe test at IDLE_TIMEOUT_MS=60_000 still failed with
// "went idle for 60s, 131s after the prompt was sent" even with the
// activity-reset mechanism working correctly. 60s of true silence is simply
// within ChatGPT's normal range for image generation, not a sign of a stuck
// provider.
//
// Raised again after directly observing a real image-generation call end to
// end (probes/out/cg-08-observe-real-generation.json, cg-10, cg-11 —
// discovery probes watching the exact hidden worker window via
// findWorkerViewByTool, not a guess): the composer showed ChatGPT actively
// "Stop answering" for ~60s, then went fully idle — yet notifyCaptureActivity
// was never called even once in the following 2 minutes (confirmed:
// IDLE_TIMEOUT_MS fired at exactly 120s with zero partial content), while a
// same-account, same-session plain text prompt on the SAME code path
// answered correctly in under 8s. That rules out a broken account, a broken
// capture pipeline, or a stuck provider — image generation is evidently a
// single atomic server-side job with no streaming activity at all until it
// finishes, so the "idle" model (built for a text stream that ticks and can
// stall mid-stream) doesn't actually apply to it; there is nothing to reset
// on. ChatGPT's own sidebar history for this account shows the same image
// prompt silently failing this exact way 5+ times before this investigation
// — i.e. every previous attempt was being killed by too-short a ceiling, not
// by a real provider failure. The user's own real-world experience generating
// images by hand in ChatGPT (not through FlowDesk) is that it can genuinely
// take up to 10-15 minutes on a slow connection. Both numbers below are
// raised to give a real job that much room; the existing heartbeat (fired
// every HEARTBEAT_INTERVAL_MS below and forwarded to the renderer as
// tool_progress) is what keeps the agent from looking like it's "just
// sitting there" during that window — see its own comment.
const IDLE_TIMEOUT_MS = 600_000
const HARD_CEILING_MS = 900_000

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
  idleTimer: ReturnType<typeof setTimeout>
  hardTimer: ReturnType<typeof setTimeout>
  heartbeat: ReturnType<typeof setInterval>
  startedAt: number
  /**
   * Latest textSoFar seen for this tool, fed by notifyCaptureActivity.
   *
   * Exists because ChatGPT's image-generation stream is confirmed (via real
   * captures + saved files on disk) to deliver a complete, successfully
   * downloaded image and then simply go quiet — no `done`, no error, so
   * emitCaptureComplete never fires for that turn at all. Without keeping
   * the partial here, the idle timeout rejected and threw away an image
   * that had already been fetched and written to disk.
   */
  partialText: string
}

function clearWaiter(tool: string, waiter: PendingWaiter) {
  pendingWaiters.delete(tool)
  clearTimeout(waiter.idleTimer)
  clearTimeout(waiter.hardTimer)
  clearInterval(waiter.heartbeat)
}

/**
 * Called from main.ts's emitCaptureLive on every capture:live tick (i.e.
 * every SSE chunk received for ANY provider) — proof the stream is still
 * alive, not stuck. Resets this tool's idle timer so a slow-but-working
 * image generation isn't killed at a fixed 60s just because that's longer
 * than a typical text reply takes. A no-op if there's no pending waiter for
 * this tool (the common case — most chunks arrive outside any awaited call).
 */
export function notifyCaptureActivity(tool: string, textSoFar?: string) {
  const waiter = pendingWaiters.get(tool)
  if (!waiter) return
  if (textSoFar && textSoFar.trim()) waiter.partialText = textSoFar
  clearTimeout(waiter.idleTimer)
  waiter.idleTimer = setTimeout(() => settleIdle(tool), IDLE_TIMEOUT_MS)
}

/**
 * An idle stream that already produced content is a SUCCESS, not a failure.
 *
 * Confirmed against real runs: an image-generation turn detected the image,
 * fetched its bytes through /backend-api/files/download (bearer token
 * required — cookies alone return 401) and wrote a 2.2MB PNG to disk, all
 * well before this fired — yet the turn was still reported to the agent as
 * "did not respond", purely because ChatGPT never closed the stream.
 */
function settleIdle(tool: string) {
  const waiter = pendingWaiters.get(tool)
  if (!waiter) return
  clearWaiter(tool, waiter)
  const elapsed = Math.round((Date.now() - waiter.startedAt) / 1000)
  if (waiter.partialText.trim()) {
    waiter.resolve(waiter.partialText)
    return
  }
  waiter.reject(new Error(
    `${tool} went idle for ${IDLE_TIMEOUT_MS / 1000}s mid-reply (no content at all), ` +
    `${elapsed}s after the prompt was sent`
  ))
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

let getAccountsImpl: () => BrowserAccount[] = () => []

/** Called once from main.ts after `store` exists, to avoid a circular import. */
export function configureBrowserWorkerQueue(opts: { getAccounts: () => BrowserAccount[] }) {
  getAccountsImpl = opts.getAccounts
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

async function runOne(tool: AITool, prompt: string, account: BrowserAccount): Promise<string> {
  const staggerWait = claimDispatchSlot()
  if (staggerWait > 0) await sleep(staggerWait)

  const url = PROVIDER_URLS[tool]
  if (!url) throw new Error(`Unknown provider: ${tool}`)

  const partition = account.partition

  // A provider window belongs to one authenticated Electron partition. Keep
  // the partition in its identity so selecting a different AI Agent account
  // cannot reuse a hidden window that is still logged into the old account.
  const tabId = `agent-${partition}-${tool}`
  await ensureBackgroundView(tabId, partition, url)
  const view = getViewById(tabId)
  if (!view) throw new Error(`Could not open a browser session for ${tool}`)

  return new Promise<string>((resolve, reject) => {
    const startedAt = Date.now()
    const idleTimer = setTimeout(() => settleIdle(tool), IDLE_TIMEOUT_MS)
    // The hard ceiling settles the same way: a turn that streamed real
    // content for minutes without ever closing still has that content, and
    // discarding it would repeat exactly the bug settleIdle exists to fix.
    const hardTimer = setTimeout(() => settleIdle(tool), HARD_CEILING_MS)
    // See workerProgress above — the SDK's own tool_progress never fires
    // for these custom tools, so this heartbeat is the only signal the
    // renderer gets that a slow provider is still being waited on, not stuck.
    const heartbeat = setInterval(() => {
      const progress: WorkerProgress = {
        type: 'heartbeat',
        tool,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      }
      workerProgress.emit('progress', progress)
    }, HEARTBEAT_INTERVAL_MS)
    pendingWaiters.set(tool, { resolve, reject, idleTimer, hardTimer, heartbeat, startedAt, partialText: '' })

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
  const next = prev.catch(() => {}).then(async () => {
    const accounts = getAccountsImpl()
    const candidates = accounts.length > 0 ? accounts : [{ email: 'default', partition: 'default' }]
    const failures: { account: BrowserAccount; reason: AccountFailure }[] = []

    for (const [index, account] of candidates.entries()) {
      try {
        return await runOne(tool, prompt, account)
      } catch (error) {
        const reason = classifyAccountFailure(error)
        if (!reason) throw error
        failures.push({ account, reason })
        const nextAccount = candidates[index + 1]
        if (!nextAccount) {
          throw new Error(
            `${tool} is unavailable on every connected account: ${failures
              .map(failure => `${maskAccountEmail(failure.account.email)} (${failure.reason === 'quota_exhausted' ? 'limit reached' : 'login required'})`)
              .join(', ')}`
          )
        }
        const progress: WorkerProgress = {
          type: 'account_retry',
          tool,
          elapsedSeconds: 0,
          reason,
          accountEmailMasked: maskAccountEmail(nextAccount.email),
        }
        workerProgress.emit('progress', progress)
      }
    }

    throw new Error(`No connected account is available for ${tool}`)
  })
  queues.set(tool, next.catch(() => {}))
  return next
}
