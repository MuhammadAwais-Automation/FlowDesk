import type { WebContents } from 'electron'
import { parseStreamChunk } from './linkedinRealtimeParse'
import { recordLinkedInEvent, type LinkedInRealtimeEvent } from './linkedinEvents'

/**
 * Watches LinkedIn's realtime message channel over the Chrome DevTools Protocol.
 *
 * ── Why not a page hook, which was tried first ──
 *
 * A `window.fetch` wrapper was built and injected, and it never saw the
 * connection. Three pieces of evidence, all from the live page:
 *
 *   - the hook was installed (`fetch` was wrapped, no hook error) and counted
 *     zero `/realtime/connect` requests;
 *   - `performance.getEntriesByType('resource')` contained no `/realtime/`
 *     entry at all — the page's own timeline records every request it makes,
 *     whichever API made it;
 *   - injection happens at dom-ready, ~2.9s into the page, while the
 *     connection opens around 1.6s.
 *
 * So the page does not make this request, and even if it did, the hook would
 * arrive too late. The `target: page` label in the CDP capture was misleading:
 * it records which CDP *session reported* a request, not which context issued
 * it. Reading that field as "the page did this" was a mistake, and this comment
 * exists so the next person does not repeat it.
 *
 * ── The cost, stated plainly ──
 *
 * Only one debugger client may attach to a WebContents, so opening DevTools on
 * the LinkedIn view will conflict with this. That is a real trade-off, not an
 * oversight: it is the price of seeing a connection the page itself cannot.
 */

const REALTIME_URL = '/realtime/connect'
/** A push channel stays open for the session; only the tail is ever interesting. */
const MAX_BUFFER = 200_000

export interface LinkedInWatchStatus {
  attached: boolean
  attachedAt: number | null
  connectionsSeen: number
  streamRequested: boolean
  eventsParsed: number
  parseErrors: number
  lastEventAt: number | null
  lastChunkAt: number | null
  error: string | null
  /** Why nothing is being watched, when nothing is. */
  reason: string | null
}

const status: LinkedInWatchStatus = {
  attached: false,
  attachedAt: null,
  connectionsSeen: 0,
  streamRequested: false,
  eventsParsed: 0,
  parseErrors: 0,
  lastEventAt: null,
  lastChunkAt: null,
  error: null,
  reason: 'the LinkedIn realtime watcher has not been started — open LinkedIn in the Social page',
}

export function linkedInWatchStatus(): LinkedInWatchStatus {
  return { ...status }
}

const watched = new WeakSet<WebContents>()

export function startLinkedInRealtimeWatch(
  webContents: WebContents,
  onEvent?: (event: LinkedInRealtimeEvent) => void,
): () => void {
  if (watched.has(webContents)) return () => {}

  try {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
  } catch (error) {
    status.error = `could not attach debugger: ${error instanceof Error ? error.message : String(error)}`
    status.reason = 'another debugger client (usually DevTools) is already attached to the LinkedIn view'
    console.log(`[FlowDesk linkedin] realtime watcher could NOT start: ${status.error}`)
    return () => {}
  }
  watched.add(webContents)

  /** Buffers, keyed by session+requestId — request ids are unique per target only. */
  const buffers = new Map<string, string>()

  function send(method: string, params: Record<string, unknown>, sessionId?: string) {
    // Electron rejects an empty session id, and the page target's is undefined,
    // so the argument must be omitted rather than passed as undefined.
    return sessionId
      ? webContents.debugger.sendCommand(method, params, sessionId)
      : webContents.debugger.sendCommand(method, params)
  }

  const onMessage = (_e: unknown, method: string, params: Record<string, unknown>, sessionId?: string) => {
    try {
      const key = `${sessionId ?? 'page'}:${String(params.requestId ?? '')}`

      if (method === 'Network.responseReceived') {
        const url = String((params.response as { url?: string } | undefined)?.url ?? '')
        if (!url.includes(REALTIME_URL)) return
        status.connectionsSeen++
        buffers.set(key, '')
        console.log('[FlowDesk linkedin] realtime connection found — streaming')

        // getResponseBody cannot read a request that never completes, and a
        // push channel never does. streamResourceContent returns what has
        // buffered and makes every later dataReceived carry the real bytes.
        send('Network.streamResourceContent', { requestId: String(params.requestId) }, sessionId)
          .then((result: { bufferedData?: string }) => {
            status.streamRequested = true
            status.reason = null
            console.log('[FlowDesk linkedin] realtime stream attached')
            if (result?.bufferedData) consume(key, decode(result.bufferedData), onEvent)
          })
          .catch(error => {
            status.error = error instanceof Error ? error.message : String(error)
            status.reason = `the realtime stream could not be read: ${status.error}`
            console.log(`[FlowDesk linkedin] realtime stream FAILED: ${status.error}`)
          })
        return
      }

      if (method === 'Network.dataReceived') {
        if (!buffers.has(key)) return
        status.lastChunkAt = Date.now()
        if (typeof params.data === 'string' && params.data) consume(key, decode(params.data), onEvent)
        return
      }

      if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
        if (buffers.delete(key)) {
          status.reason = 'the realtime connection closed; LinkedIn normally reopens it within seconds'
        }
      }
    } catch (error) {
      // A watcher must never take the browsing session down with it.
      status.error = error instanceof Error ? error.message : String(error)
    }
  }

  function consume(key: string, text: string, emit?: (event: LinkedInRealtimeEvent) => void) {
    const pending = (buffers.get(key) ?? '') + text
    const { events, remainder, parseErrors } = parseStreamChunk(pending)
    // Keep the tail: a frame split across chunks must survive to the next one,
    // but an unbounded buffer on a session-long connection must not.
    buffers.set(key, remainder.length > MAX_BUFFER ? remainder.slice(-MAX_BUFFER) : remainder)
    status.parseErrors += parseErrors

    for (const event of events) {
      status.eventsParsed++
      status.lastEventAt = Date.now()
      // Content here is written by other people. It is stored and reported;
      // nothing acts on it.
      if (!recordLinkedInEvent(event)) continue
      emit?.(event)
      if (event.kind === 'message') {
        const preview = (event.text ?? '').slice(0, 60).replace(/\s+/g, ' ')
        // The user's own messages are logged too, marked as theirs. They are
        // still excluded from the agent's new-message feed — but a channel that
        // is working and merely quiet looks identical to one that is broken,
        // and that ambiguity has cost several diagnosis cycles here. Seeing
        // your own sent message appear is the cheapest proof it is alive.
        console.log(event.fromMe
          ? `[FlowDesk linkedin] you sent: ${preview}`
          : `[FlowDesk linkedin] message from ${event.from ?? event.fromUrn ?? 'someone'}: ${preview}`)
      }
    }
  }

  webContents.debugger.on('message', onMessage)
  send('Network.enable', {})
    .then(() => {
      status.attached = true
      status.attachedAt = Date.now()
      console.log('[FlowDesk linkedin] realtime watcher ready — waiting for LinkedIn to open its channel')
      status.reason = 'attached, waiting for LinkedIn to open its realtime connection (reload the tab if nothing arrives)'
    })
    .catch(error => {
      status.error = error instanceof Error ? error.message : String(error)
      status.reason = `Network.enable failed: ${status.error}`
    })

  return () => {
    webContents.debugger.off('message', onMessage)
    try { if (webContents.debugger.isAttached()) webContents.debugger.detach() } catch { /* already gone */ }
    watched.delete(webContents)
    status.attached = false
    status.reason = 'the watcher was stopped'
  }
}

function decode(base64: string): string {
  try { return Buffer.from(base64, 'base64').toString('utf8') } catch { return '' }
}
