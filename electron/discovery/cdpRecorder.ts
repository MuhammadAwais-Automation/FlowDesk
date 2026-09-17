import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WebContents } from 'electron'

/**
 * Network recorder built on the Chrome DevTools Protocol.
 *
 * Replaces patching window.fetch/XHR/WebSocket from inside the page, which
 * had a blind spot that mattered: those hooks only exist on the main thread's
 * global object. A Web Worker has its own global scope with its own fetch, so
 * anything a site runs in a worker is invisible to them — and putting the
 * networking layer in a worker is exactly what a serious web app does.
 * WhatsApp does it (WAWebBackendWorkerV2Bundle), and LinkedIn appears to as
 * well: a session that browsed messaging, opened a thread and SENT a message
 * produced 201 captured calls with not one messaging request among them. A
 * sent message has to hit the network; it simply did not hit a hooked one.
 *
 * CDP sits under the renderer rather than inside the page, so it sees every
 * request regardless of which thread or worker issued it, plus document
 * navigations and server-sent events. It also cannot be defeated by the page,
 * and it survives reloads — page-level hooks die with the document.
 *
 * The trade-off, stated plainly: only one debugger client can attach to a
 * WebContents at a time, so opening DevTools on that view will conflict.
 * Attach failures are reported rather than swallowed.
 */

export interface CdpCapture {
  t: number
  method: string
  url: string
  status?: number
  mimeType?: string
  bytes?: number
  /** Which frame/worker issued it — the whole reason for using CDP. */
  from?: string
  preview?: string
  ids?: { urns?: string[]; threadLike?: string[] }
  postData?: string
  /**
   * Request headers, minus anything that authenticates. A bridge has to send
   * the same headers the site does — LinkedIn rejects calls missing
   * x-restli-protocol-version, and the tracking headers turned out to matter
   * on some routes — so guessing them is exactly the mistake to avoid.
   */
  reqHeaders?: Record<string, string>
  /**
   * Which CDP session REPORTED this request — not which context issued it.
   *
   * The distinction is not pedantic; reading it the other way caused a real
   * wrong turn. `/realtime/connect` is reported on the page session, so it was
   * taken to be a page request and a `window.fetch` hook was built to catch
   * it. The hook never fired, and the page's own
   * `performance.getEntriesByType('resource')` contained no `/realtime/` entry
   * at all — the page had not made the request. Chrome attributes some
   * requests to the page session that page JavaScript never issued.
   *
   * Treat this as a routing hint, and confirm origin from the page itself
   * before building on it.
   */
  target?: string
  /** Why the response body could not be read, when it could not. */
  bodyError?: string
  /** Set when consecutive identical stream frames were collapsed into this one. */
  repeated?: number
  /** Timestamp of the most recent frame folded into this entry. */
  lastSeenT?: number
}

interface PendingRequest {
  method: string
  url: string
  startedAt: number
  from?: string
  postData?: string
  status?: number
  mimeType?: string
  headers?: Record<string, string>
  target?: string
  /** Bytes delivered so far, for a response still streaming. */
  received?: number
  /** How many Network.dataReceived chunks have arrived. */
  chunks?: number
  /** When the most recent chunk arrived. */
  lastChunkAt?: number
  /** Decoded body of a still-open stream, accumulated as it arrives. */
  streamText?: string
  /**
   * Why a stream could not be read, recorded ALONGSIDE the entry rather than
   * only logged. An empty streamText with no explanation is indistinguishable
   * from a silent stream, and that ambiguity has cost a full restart cycle
   * more than once in this work.
   */
  streamError?: string
  /** Set once streamResourceContent was accepted, to tell "not tried" from "tried, nothing came". */
  streamRequested?: boolean
}

/**
 * Without an explicit `filter`, Chrome's default auto-attach set covers
 * dedicated workers and iframes but NOT service workers — confirmed the hard
 * way on Google Flow: the page's own Resource Timing API showed 31 real
 * calls to aisandbox-pa.googleapis.com in one session, and this recorder
 * captured zero of them, because Flow issues them from a service worker.
 * `exclude: false` on each entry means "attach to this type", matching the
 * shape Playwright/Puppeteer use for the same problem.
 */
const AUTO_ATTACH_PARAMS = {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
  filter: [
    { type: 'worker', exclude: false },
    { type: 'shared_worker', exclude: false },
    { type: 'service_worker', exclude: false },
    { type: 'iframe', exclude: false },
  ],
}

const BODY_SKIP_MIME = /^(image|font|video|audio)\//
const STREAM_MIME = /event-stream|x-ndjson|application\/stream/
/**
 * Cap on how much of a live stream is kept. A push channel stays open for the
 * whole session, so this is a window on recent events rather than a transcript.
 */
const MAX_STREAM_TEXT = 60_000
const MAX_BODY_SCAN = 200_000

/**
 * Identifier-shaped strings, scanned from the whole body but stored without
 * it. Keeping bodies would mean holding megabytes of RSC payload per call;
 * keeping only a 300-char preview proved too little — searching previews for
 * an open conversation's id found nothing across 200 calls, which reads as
 * "the data never came" but only meant "not in the first 300 characters".
 */
function decodeChunk(base64: string): string {
  try { return Buffer.from(base64, 'base64').toString('utf8') } catch { return '' }
}

function scanIds(body: string): CdpCapture['ids'] | undefined {
  if (!body || body.length < 20) return undefined
  const slice = body.length > MAX_BODY_SCAN ? body.slice(0, MAX_BODY_SCAN) : body
  const found: NonNullable<CdpCapture['ids']> = {}
  const urns = slice.match(/urn:li:[a-zA-Z]+:[^\s"'\\,)\]}]{4,80}/g)
  if (urns) found.urns = Array.from(new Set(urns)).slice(0, 25)
  const threads = slice.match(/2-[A-Za-z0-9+/=_-]{20,}/g)
  if (threads) found.threadLike = Array.from(new Set(threads)).slice(0, 15)
  return Object.keys(found).length ? found : undefined
}

/**
 * Credentials are dropped rather than captured. The capture file holds real
 * session material as it is (message text, contact names), which is why
 * probes/out/ is gitignored; a live cookie or csrf token in there would be a
 * different order of problem, since it is replayable by anyone who reads it.
 */
const SECRET_HEADER = /^(cookie|set-cookie|authorization|csrf-token|x-li-identity)$/i

/**
 * A few headers are not metadata but the payload itself. LinkedIn ships its
 * realtime topic→queryId routing table inside x-li-query-map and its decoration
 * ids inside x-li-recipe-map — several kilobytes each, and precisely the thing
 * worth capturing. A flat 300-char cap cut both off mid-object and hid the
 * messaging topic's query id behind an ellipsis.
 */
const LARGE_HEADER = /^x-li-(query|recipe)-map$/i
const HEADER_CAP = 300
const LARGE_HEADER_CAP = 8_000

function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (SECRET_HEADER.test(key)) { out[key] = '[redacted]'; continue }
    out[key] = String(value).slice(0, LARGE_HEADER.test(key) ? LARGE_HEADER_CAP : HEADER_CAP)
  }
  return Object.keys(out).length ? out : undefined
}

export interface CdpRecorderOptions {
  webContents: WebContents
  /**
   * Only record requests whose URL contains this substring — OR, for a site
   * whose real API lives on a different host than the tab's own (Google
   * Flow's page is labs.google, but the actual generation calls go to
   * aisandbox-pa.googleapis.com), an array of substrings, matched as OR.
   * A single string kept every one of Flow's real requests out of the
   * capture: the tab's own host was the only thing checked, so every call
   * to a genuinely different domain was silently dropped, indistinguishable
   * from "never happened" until the page's own Resource Timing API was
   * checked directly and showed 28 of them in one session.
   */
  urlMatch: string | string[]
  /** Where the rolling capture is written. */
  outFile: string
  bufferLimit?: number
  onAttach?: (info: string) => void
}


/**
 * Appends one line about whether this recorder actually attached.
 *
 * Attach status only ever went to console.log, which is invisible to anyone
 * reading the capture afterwards -- a missing capture file looked identical
 * whether the recorder failed to attach, attached and saw nothing matching, or
 * was never asked to run. Same shape as logLinkRoutingDecision in sessions.ts.
 */
function note(outFile: string, line: string): void {
  try {
    const fs: typeof import('node:fs') = require('node:fs')
    fs.mkdirSync(dirname(outFile), { recursive: true })
    fs.appendFileSync(join(dirname(outFile), '_cdp-attach.log'), `${new Date().toISOString()} ${line}
`)
  } catch { /* discovery aid only */ }
}

const attached = new WeakSet<WebContents>()

export function startCdpRecorder(options: CdpRecorderOptions): () => void {
  const { webContents, outFile } = options
  const urlMatches = Array.isArray(options.urlMatch) ? options.urlMatch : [options.urlMatch]
  const urlMatch = urlMatches[0]
  const matchesUrl = (url: string) => urlMatches.some(m => url.includes(m))
  const bufferLimit = options.bufferLimit ?? 1500

  if (attached.has(webContents)) {
    note(outFile, `already attached, skipping: ${urlMatch}`)
    return () => {}
  }

  try {
    if (webContents.debugger.isAttached()) {
      // Someone else holds the one debugger slot -- DevTools, most likely.
      // Worth recording rather than proceeding silently: commands sent over a
      // session this recorder did not open produce no capture and no error.
      note(outFile, `another debugger already holds ${urlMatch}; recording anyway`)
    } else {
      webContents.debugger.attach('1.3')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.onAttach?.(`FAILED to attach: ${message}`)
    note(outFile, `FAILED to attach to ${urlMatch}: ${message}`)
    return () => {}
  }
  attached.add(webContents)
  note(outFile, `attached to ${urlMatch}`)

  const log: CdpCapture[] = []
  const pending = new Map<string, PendingRequest>()
  const startedAt = Date.now()
  let writeTimer: NodeJS.Timeout | null = null

  function scheduleWrite() {
    if (writeTimer) return
    // Debounced rather than per-event: a busy page fires hundreds of events a
    // second, and rewriting the file on each would cost more than the capture.
    writeTimer = setTimeout(() => {
      writeTimer = null
      void mkdir(dirname(outFile), { recursive: true })
        .then(() => writeFile(outFile, JSON.stringify({
          capturedAt: new Date().toISOString(),
          recordingForSeconds: Math.round((Date.now() - startedAt) / 1000),
          capturedCalls: log.length,
          via: 'cdp',
          // Requests that have NOT finished, which is the only place a
          // long-lived stream can appear. Recording solely on loadingFinished
          // means a connection that never closes is structurally invisible —
          // and that is exactly what a realtime push channel is. A LinkedIn
          // session with a message genuinely arriving showed no realtime
          // connection at all for this reason; it was sitting in `pending`
          // the whole time.
          inFlight: inFlightSnapshot(),
          calls: log,
        }, null, 2), 'utf8'))
        .catch(() => {})
    }, 1500)
  }

  /**
   * Collapses a repeating stream event instead of recording every occurrence.
   *
   * Not a nicety. LinkedIn's SDUI realtime handler emits an identical 553-byte
   * frame every 8 seconds; over a 73-minute session that filled 201 of 500 slots
   * and pushed the buffer's window down to the last 27 minutes, silently
   * evicting the request that was actually being looked for. A rolling buffer
   * whose contents are decided by the noisiest endpoint is not a recording.
   */
  function pushCollapsible(entry: CdpCapture) {
    const previous = log[log.length - 1]
    if (
      previous &&
      previous.method === entry.method &&
      previous.url === entry.url &&
      previous.bytes === entry.bytes &&
      previous.preview === entry.preview
    ) {
      previous.repeated = (previous.repeated ?? 1) + 1
      previous.lastSeenT = entry.t
      scheduleWrite()
      return
    }
    push(entry)
  }

  /**
   * The unfinished requests, oldest first. Anything open for more than a few
   * seconds is either a stream or a hang, and both are worth seeing.
   */
  function inFlightSnapshot() {
    const now = Date.now()
    return Array.from(pending.entries())
      .map(([key, entry]) => ({
        key,
        openForSeconds: Math.round((now - entry.startedAt) / 100) / 10,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        mimeType: entry.mimeType,
        target: entry.target,
        bytesReceived: entry.received,
        chunks: entry.chunks,
        secondsSinceLastChunk: entry.lastChunkAt ? Math.round((now - entry.lastChunkAt) / 100) / 10 : undefined,
        streamRequested: entry.streamRequested,
        streamError: entry.streamError,
        streamText: entry.streamText,
        streamIds: entry.streamText ? scanIds(entry.streamText) : undefined,
        postData: entry.postData,
        reqHeaders: entry.headers,
      }))
      .sort((a, b) => b.openForSeconds - a.openForSeconds)
      .slice(0, 40)
  }

  function push(entry: CdpCapture) {
    if (log.length >= bufferLimit) log.shift()
    log.push(entry)
    scheduleWrite()
  }

  /**
   * Worker targets, keyed by the flattened session id CDP assigns them.
   *
   * Attaching to the page target alone is not enough, and that is the same
   * mistake as page-level fetch hooks — one level up. A worker is a separate
   * CDP target with its own Network domain, so its requests never reach the
   * page session's Network events. LinkedIn's realtime messaging connection
   * is nowhere in a page-only capture even though its 60-second heartbeat
   * (carrying a realtimeSessionId) proves a connection exists somewhere.
   */
  const workerTargets = new Map<string, string>()

  /**
   * Electron rejects an empty session id outright ("Empty session id is not
   * allowed"), and the page target's session id is `undefined` — so a command
   * meant for the page must be sent with NO third argument, not with an
   * undefined one. Passing it through blindly broke every getResponseBody call
   * on the page target, and the failure was invisible because the catch
   * discarded it. This helper is the single place that distinction is made.
   */
  function send(method: string, params: Record<string, unknown>, sessionId?: string) {
    return sessionId
      ? webContents.debugger.sendCommand(method, params, sessionId)
      : webContents.debugger.sendCommand(method, params)
  }

  function enableNetworkOn(sessionId: string, label: string) {
    workerTargets.set(sessionId, label)
    // Each attached target needs its own Network.enable; and each may itself
    // spawn further workers, so auto-attach is set recursively.
    void send('Network.enable', {}, sessionId).catch(() => {})
    void send('Target.setAutoAttach', AUTO_ATTACH_PARAMS, sessionId)
      .catch(() => {})
    // Workers start paused when the debugger attaches; without this they never
    // run, which would break the page rather than merely fail to record it.
    void send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
    options.onAttach?.(`attached to ${label}`)
  }

  const onMessage = (_event: unknown, method: string, params: Record<string, unknown>, sessionId?: string) => {
    try {
      if (method === 'Target.attachedToTarget') {
        const info = params.targetInfo as { type?: string; url?: string } | undefined
        const childSession = String(params.sessionId ?? '')
        if (childSession) enableNetworkOn(childSession, `${info?.type ?? 'target'} ${info?.url ?? ''}`.trim())
        return
      }
      if (method === 'Target.detachedFromTarget') {
        workerTargets.delete(String(params.sessionId ?? ''))
        return
      }

      const origin = sessionId ? workerTargets.get(sessionId) ?? `session ${sessionId}` : 'page'
      // requestIds are unique per TARGET, not globally, so now that several
      // targets report into one recorder the session has to be part of the key
      // — otherwise a worker's request could overwrite the page's.
      const key = `${sessionId ?? 'page'}:${String(params.requestId ?? '')}`

      if (method === 'Network.requestWillBeSent') {
        const request = params.request as { url?: string; method?: string; postData?: string; headers?: Record<string, unknown> } | undefined
        const url = request?.url ?? ''
        if (!matchesUrl(url)) return
        pending.set(key, {
          method: request?.method ?? 'GET',
          url,
          startedAt: Date.now(),
          // Present when the request came from a worker rather than the page —
          // precisely the case page-level hooks could never see.
          from: (params.frameId as string | undefined) ?? undefined,
          target: origin,
          // 2000 was long enough for LinkedIn's JSON payloads but silently ate the
          // useful part of Facebook's: its form-encoded body leads with tens of
          // thousands of characters of obfuscated __dyn/__csr routing state, so
          // fb_dtsg, doc_id and variables — the fields that actually matter —
          // never made it into the capture at all. Not an error, just an empty
          // hole where the answer should have been. Matched to MAX_BODY_SCAN's
          // order of magnitude rather than guessed a second time.
          postData: request?.postData ? String(request.postData).slice(0, MAX_BODY_SCAN) : undefined,
          headers: redactHeaders(request?.headers),
        })
        return
      }

      if (method === 'Network.responseReceived') {
        const entry = pending.get(key)
        if (!entry) return
        const response = params.response as { status?: number; mimeType?: string } | undefined
        entry.status = response?.status
        entry.mimeType = response?.mimeType

        // getResponseBody only works once a request has finished, so it can
        // never read a push channel. streamResourceContent hands back what has
        // buffered so far AND makes every later Network.dataReceived carry the
        // actual bytes — the only way to see inside a connection that stays
        // open for the whole session.
        if (response?.mimeType && STREAM_MIME.test(response.mimeType)) {
          entry.streamRequested = true
          send('Network.streamResourceContent', { requestId: String(params.requestId) }, sessionId)
            .then((res: { bufferedData?: string }) => {
              if (!res?.bufferedData) {
                entry.streamError = 'streamResourceContent returned no bufferedData'
                return
              }
              entry.streamText = decodeChunk(res.bufferedData).slice(-MAX_STREAM_TEXT)
            })
            .catch(error => {
              entry.streamError = error instanceof Error ? error.message : String(error)
              options.onAttach?.(`streamResourceContent failed for ${entry.url.slice(0, 80)}: ${entry.streamError}`)
            })
        }
        return
      }

      // A streaming response delivers data over a connection that never
      // finishes. Counting chunks is what distinguishes a live stream still
      // pushing data from a request that merely stalled.
      if (method === 'Network.dataReceived') {
        const entry = pending.get(key)
        if (!entry) return
        entry.received = (entry.received ?? 0) + (typeof params.dataLength === 'number' ? params.dataLength : 0)
        entry.chunks = (entry.chunks ?? 0) + 1
        entry.lastChunkAt = Date.now()
        // Present only after streamResourceContent was accepted for this request.
        if (typeof params.data === 'string' && params.data) {
          const text = (entry.streamText ?? '') + decodeChunk(params.data)
          // Keep the TAIL: on a channel open for hours the newest events are
          // the ones being looked for, and the oldest are long since stale.
          entry.streamText = text.length > MAX_STREAM_TEXT ? text.slice(-MAX_STREAM_TEXT) : text
        }
        return
      }

      if (method === 'Network.loadingFinished') {
        const requestId = String(params.requestId)
        const entry = pending.get(key)
        if (!entry) return
        pending.delete(key)

        const record: CdpCapture = {
          t: Math.round((entry.startedAt - startedAt) / 100) / 10,
          method: entry.method,
          url: entry.url,
          status: entry.status,
          mimeType: entry.mimeType,
          bytes: typeof params.encodedDataLength === 'number' ? params.encodedDataLength : undefined,
          from: entry.from,
          postData: entry.postData,
          reqHeaders: entry.headers,
          target: entry.target,
        }

        // Bodies are fetched only for things that could carry data. Images,
        // fonts and video are large and never the answer.
        if (entry.mimeType && BODY_SKIP_MIME.test(entry.mimeType)) {
          push(record)
          return
        }

        send('Network.getResponseBody', { requestId }, sessionId)
          .then((result: { body?: string; base64Encoded?: boolean }) => {
            const body = result.base64Encoded ? '' : (result.body ?? '')
            record.preview = body.slice(0, 400)
            record.ids = scanIds(body)
            push(record)
          })
          .catch(error => {
            // Recorded rather than discarded. Swallowing this hid a real
            // regression: passing an undefined session id made EVERY body
            // fetch on the page target fail, and the only symptom was
            // previews quietly going missing.
            record.bodyError = error instanceof Error ? error.message : String(error)
            push(record)
          })
        return
      }

      if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
        const payload = (params.response as { payloadData?: string } | undefined)?.payloadData ?? ''
        const url = String(params.url ?? '')
        if (url && !matchesUrl(url)) return
        // Only Received was ever handled here, so every outgoing frame — the
        // actual send-a-message payload, not the server's replies — went
        // uncaptured. Messenger sends over this channel, not GraphQL; without
        // this branch there is nothing to read for it at all.
        //
        // The 400-char preview that works for GraphQL bodies is too short
        // here: payloadData is base64 of a binary MQTT frame, and a short
        // plaintext field (like a message's own text) can sit well past byte
        // 400 in a frame that also carries telemetry batches. Same lesson as
        // the GraphQL body cap — matched to MAX_BODY_SCAN rather than
        // guessing a size that happens to fit today's frames.
        pushCollapsible({
          t: Math.round((Date.now() - startedAt) / 100) / 10,
          method: method === 'Network.webSocketFrameSent' ? 'WS-SENT' : 'WS',
          url: url || '(websocket)',
          target: origin,
          bytes: payload.length,
          preview: payload.slice(0, MAX_BODY_SCAN),
          ids: scanIds(payload),
        })
        return
      }

      if (method === 'Network.eventSourceMessageReceived') {
        const data = String(params.data ?? '')
        // An SSE stream never fires loadingFinished, so its request is still
        // sitting in `pending` — which is the only place its URL exists. The
        // first capture recorded the event NAME as the url and left us unable
        // to say which endpoint LinkedIn's realtime push actually comes from.
        const source = pending.get(key)
        pushCollapsible({
          t: Math.round((Date.now() - startedAt) / 100) / 10,
          method: 'SSE',
          url: source?.url ?? String(params.eventName ?? 'sse'),
          from: params.eventName ? `event:${String(params.eventName)}` : undefined,
          target: origin,
          reqHeaders: source?.headers,
          bytes: data.length,
          preview: data.slice(0, 400),
          ids: scanIds(data),
        })
      }
    } catch { /* a recorder must never take the page down with it */ }
  }

  webContents.debugger.on('message', onMessage)
  webContents.debugger.sendCommand('Network.enable')
    .then(() => webContents.debugger.sendCommand('Target.setAutoAttach', AUTO_ATTACH_PARAMS))
    .then(() => options.onAttach?.(`attached (page + workers + service workers), recording ${urlMatch} -> ${outFile}`))
    .then(() => attachExistingServiceWorkers())
    .catch(error => options.onAttach?.(`Network.enable FAILED: ${error instanceof Error ? error.message : String(error)}`))

  /**
   * `Target.setAutoAttach` only reports targets created AFTER it is set. A
   * service worker registered on an earlier visit to this origin — likely
   * here, since each platform's partition persists across app restarts —
   * is already running by the time this recorder attaches, so it never
   * fires as "newly created" and needs to be found and attached explicitly.
   */
  function attachExistingServiceWorkers() {
    return webContents.debugger.sendCommand('Target.getTargets', {})
      .then(result => {
        const targets = (result as { targetInfos?: { targetId: string; type: string; url: string }[] })
          .targetInfos ?? []
        for (const t of targets) {
          if (t.type !== 'service_worker' && t.type !== 'shared_worker') continue
          if (!matchesUrl(t.url)) continue
          void webContents.debugger.sendCommand('Target.attachToTarget', { targetId: t.targetId, flatten: true })
            .catch(() => {})
        }
      })
      .catch(() => {})
  }

  return () => {
    if (writeTimer) clearTimeout(writeTimer)
    webContents.debugger.off('message', onMessage)
    try { if (webContents.debugger.isAttached()) webContents.debugger.detach() } catch { /* already gone */ }
    attached.delete(webContents)
  }
}
