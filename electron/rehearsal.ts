/**
 * Rehearsal: let a tool (or the site's own page) build a real request, read it
 * at the network layer, and stop it before it leaves the machine.
 *
 * CDP's Fetch domain pauses every request matching `Fetch.enable` patterns
 * until the client answers continueRequest, failRequest or fulfillRequest
 * (chromedevtools.github.io/devtools-protocol/tot/Fetch). Matching requests are
 * recorded and failed with BlockedByClient, so the platform never receives
 * them; everything else is continued untouched. Only the Fetch domain is used,
 * not Runtime.enable, whose console side effects are a known detection signal.
 *
 * Use it to check that a write tool still builds the request it should
 * (endpoint, method, body shape, tokens) without posting anything, and to
 * capture a new write by driving the page with the real request blocked.
 */
import type { WebContents } from 'electron'

export interface RehearsedRequest {
  method: string
  url: string
  headers: Record<string, string>
  postData: string | null
  /** True when the body exists but CDP did not inline it (large or multipart). */
  bodyNotInlined: boolean
}

export interface RehearsalMatch {
  /** CDP glob, e.g. "*://gumroad.com/links/*". */
  urlPattern: string
  /** Only block this method; other methods matching the pattern continue. */
  method?: string
}

export interface RehearsalResult<T> {
  blocked: RehearsedRequest[]
  /** Requests that matched the pattern but not the method, let through. */
  passed: { method: string; url: string }[]
  result?: T
  error?: string
}

/** Headers that carry credentials are shown by name only. */
const SECRET_HEADER = /^(cookie|authorization|x-csrf-token|x-csrftoken|csrf-token|x-goog-authuser|x-client-data|proxy-authorization)$/i

export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) out[k] = SECRET_HEADER.test(k) ? '[redacted]' : v
  return out
}

interface PausedParams {
  requestId: string
  request: { url: string; method: string; headers: Record<string, string>; postData?: string; hasPostData?: boolean }
  responseStatusCode?: number
  responseErrorReason?: string
}

export async function rehearse<T>(wc: WebContents, match: RehearsalMatch, run: () => Promise<T>, timeoutMs = 120_000): Promise<RehearsalResult<T>> {
  if (!match.urlPattern) throw new Error('rehearse needs a urlPattern')
  const dbg = wc.debugger
  const wasAttached = dbg.isAttached()
  if (!wasAttached) dbg.attach('1.3')
  const blocked: RehearsedRequest[] = []
  const passed: { method: string; url: string }[] = []
  const wantMethod = match.method?.toUpperCase()

  const onMessage = (_e: unknown, method: string, params: PausedParams) => {
    if (method !== 'Fetch.requestPaused') return
    const r = params.request
    // Only request-stage pauses are asked for; anything else just continues.
    const atResponse = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined
    if (atResponse || (wantMethod && r.method.toUpperCase() !== wantMethod)) {
      passed.push({ method: r.method, url: r.url })
      void dbg.sendCommand('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {})
      return
    }
    blocked.push({
      method: r.method, url: r.url, headers: redactHeaders(r.headers ?? {}),
      postData: r.postData ?? null, bodyNotInlined: !!r.hasPostData && r.postData === undefined,
    })
    void dbg.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
  }

  dbg.on('message', onMessage as never)
  try {
    await dbg.sendCommand('Fetch.enable', { patterns: [{ urlPattern: match.urlPattern, requestStage: 'Request' }] })
    let timer: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([
        run(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`rehearsal timed out after ${timeoutMs / 1000} s`)), timeoutMs) }),
      ])
      return { blocked, passed, result }
    } catch (e) {
      return { blocked, passed, error: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
    }
  } finally {
    await dbg.sendCommand('Fetch.disable').catch(() => {})
    dbg.removeListener('message', onMessage as never)
    if (!wasAttached) { try { dbg.detach() } catch { /* gone */ } }
  }
}
