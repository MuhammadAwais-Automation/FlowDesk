/**
 * Reading post/creator analytics.
 *
 * ── Primary path: one authenticated HTTP GET, no navigation ──
 *
 * There is no JSON analytics endpoint. Verified live (probes/lka-01..03): the
 * creator analytics page makes no voyager/graphql or rsc-action call carrying
 * impressions — its resource list is only global chrome (me, nav, badges). The
 * figures arrive server-rendered inside the HTML of
 * `GET https://www.linkedin.com/analytics/creator/content/` itself.
 *
 * So the "API" is that server response: fetched from inside the LinkedIn view
 * (session cookies ride along, same origin), tags stripped, figures parsed in
 * the main process. The LinkedIn tab no longer navigates away and back, and
 * nothing reads `body.innerText`.
 *
 * ── Fallback: the old DOM read ──
 *
 * If the GET fails or its HTML carries no impressions (markup change, redirect
 * to login), the previous behaviour runs: navigate to the page and read the
 * rendered text. Every result is tagged `source: 'api' | 'dom'`.
 */

import { getLinkedInView } from './linkedin'
import type { LinkedInResult } from './linkedin'

const RENDER_TIMEOUT_MS = 20_000
const RENDER_POLL_MS = 500
const ANALYTICS_URL = 'https://www.linkedin.com/analytics/creator/content/'

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

/**
 * Pulls labelled figures out of the analytics page text.
 *
 * The page runs inside a same-origin iframe (`/preload/?_bprMode=vanilla`), so
 * the visible numbers may be there rather than in the top document — verified
 * during discovery. Both are read, and the one that actually mentions
 * impressions is used.
 */
const READ_ANALYTICS_SCRIPT = `(function () {
  function textOf(doc) {
    try { return (doc.body && doc.body.innerText || '').replace(/\\s+/g, ' ') } catch (e) { return '' }
  }
  var texts = [textOf(document)]
  var frames = document.querySelectorAll('iframe')
  for (var i = 0; i < frames.length; i++) {
    try { if (frames[i].contentDocument) texts.push(textOf(frames[i].contentDocument)) } catch (e) {}
  }
  // Use whichever surface actually rendered the analytics.
  var text = ''
  for (var i = 0; i < texts.length; i++) { if (/impression/i.test(texts[i])) { text = texts[i]; break } }
  if (!text) text = texts[0] || ''

  // The two label styles on this page are NOT the same, and mixing them up
  // produces numbers that are confidently wrong rather than absent:
  //
  //   "99 Impressions"                       number BEFORE the label
  //   "Reactions 5 Comments 5 Reposts 0"     number AFTER the label
  //
  // A first version used number-before for everything. Impressions matched, and
  // the rest silently took the neighbouring metric's figure — it reported
  // reposts: 5 when the real value was 0. Verified against the live page.
  // Written with a space character class rather than a backslash escape, on
  // purpose. A lone backslash inside a template literal is swallowed before the
  // page ever sees it — this codebase has now been bitten by that three times,
  // most recently here, where the regex arrived as 's*' and matched the letter
  // s. The page text is already whitespace-collapsed above, so ' *' is exact.
  function before(label) { var m = text.match(new RegExp('([0-9,]+) *' + label, 'i')); return m ? m[1] : null }
  function after(label) { var m = text.match(new RegExp(label + ' *([0-9,]+)', 'i')); return m ? m[1] : null }

  return {
    rendered: /impression/i.test(text),
    impressions: before('Impressions'),
    reactions: after('Reactions'),
    comments: after('Comments'),
    reposts: after('Reposts'),
    saves: after('Saves'),
    socialEngagements: before('Social engagements'),
    // A short slice of the surrounding text, so a caller can see the context the
    // numbers came from rather than trusting a regex blindly.
    summaryText: text.slice(0, 400),
    url: location.href,
  }
})()`

/**
 * Fetches the analytics page HTML from inside the LinkedIn view. Same-origin,
 * `credentials: 'include'`, so it is the signed-in member's own session. A GET
 * only — nothing is written.
 */
const FETCH_ANALYTICS_SCRIPT = `(async function () {
  try {
    var r = await fetch(${JSON.stringify(ANALYTICS_URL)}, { credentials: 'include', headers: { accept: 'text/html' } })
    var html = await r.text()
    return { status: r.status, url: r.url, html: html }
  } catch (e) { return { status: 0, error: String(e) } }
})()`

export type AnalyticsFigures = {
  rendered: boolean
  impressions: string | null
  reactions: string | null
  comments: string | null
  reposts: string | null
  saves: string | null
  socialEngagements: string | null
  summaryText: string
}

/** Server HTML -> collapsed visible text (scripts, styles and tags removed). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parses the figures out of the page text. Same label rules the DOM read uses,
 * verified live on the server HTML ("33 Impressions ... Reactions 0 Comments 0
 * Reposts 0 Saves 0"): impressions and social engagements carry the number
 * BEFORE the label, the engagement breakdown carries it AFTER.
 */
export function parseAnalyticsText(fullText: string): AnalyticsFigures {
  // Start at the analytics section so the nav bar ("22 Notifications") and
  // experiment flags cannot be mistaken for a figure.
  const at = fullText.search(/Content performance|Impressions/i)
  const text = at >= 0 ? fullText.slice(at) : fullText
  const before = (label: string) => text.match(new RegExp(`([0-9][0-9,]*) *${label}`, 'i'))?.[1] ?? null
  const after = (label: string) => text.match(new RegExp(`${label} *([0-9][0-9,]*)`, 'i'))?.[1] ?? null
  return {
    rendered: /impression/i.test(text),
    impressions: before('Impressions'),
    reactions: after('Reactions'),
    comments: after('Comments'),
    reposts: after('Reposts'),
    saves: after('Saves'),
    socialEngagements: before('Social engagements'),
    summaryText: text.slice(0, 400),
  }
}

type FetchedPage = { status?: number; url?: string; html?: string; error?: string }

/** Reads via the server response. Returns null when that path is unusable. */
async function readViaHttp(webContents: Electron.WebContents): Promise<LinkedInResult | null> {
  let page: FetchedPage
  try {
    page = await webContents.executeJavaScript(FETCH_ANALYTICS_SCRIPT)
  } catch { return null }
  if (!page || page.status !== 200 || typeof page.html !== 'string') return null
  if (page.url && !page.url.includes('/analytics/')) return null // bounced to login/checkpoint
  const figures = parseAnalyticsText(htmlToText(page.html))
  if (!figures.rendered || figures.impressions === null) return null
  return {
    ok: true,
    ...figures,
    url: ANALYTICS_URL,
    source: 'api',
    via: 'http-get',
    note: 'read from the server response of GET /analytics/creator/content/ (LinkedIn has no JSON analytics endpoint; the figures are server-rendered into that response). No navigation. Labels and the default 7-day window are LinkedIn’s own.',
  }
}

/** The previous behaviour: navigate to the page and read the rendered text. */
async function readViaDom(webContents: Electron.WebContents): Promise<LinkedInResult> {
  let previousUrl = ''
  try { previousUrl = webContents.getURL() } catch { /* destroyed */ }

  try {
    await webContents.loadURL(ANALYTICS_URL)

    const deadline = Date.now() + RENDER_TIMEOUT_MS
    let data: { rendered?: boolean; impressions?: string | null } = {}
    for (;;) {
      data = await webContents.executeJavaScript(READ_ANALYTICS_SCRIPT)
      if (data?.rendered) break
      if (Date.now() > deadline) {
        return {
          ok: false,
          error: `the analytics page did not render within ${RENDER_TIMEOUT_MS}ms`,
          hint: 'creator analytics needs a LinkedIn account that has posted; a brand-new account may have none',
        }
      }
      await new Promise(resolve => setTimeout(resolve, RENDER_POLL_MS))
    }

    return {
      ok: true,
      ...data,
      source: 'dom',
      via: 'dom-read',
      note: 'fallback: the direct HTTP read failed, so these figures were read from the analytics page as rendered. Labels and the default window are LinkedIn’s own.',
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (previousUrl && !previousUrl.includes('/analytics/')) {
      try { await webContents.loadURL(previousUrl) } catch { /* view gone */ }
    }
  }
}

/**
 * Reads the creator content-analytics summary (impressions and engagement for
 * the default window). HTTP read first; the visible DOM read only if that fails.
 */
export async function liCreatorAnalytics(): Promise<LinkedInResult> {
  const view = await getLinkedInView().catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }
  const viaHttp = await readViaHttp(view.webContents)
  if (viaHttp) return viaHttp
  return readViaDom(view.webContents)
}

export const __testing = { READ_ANALYTICS_SCRIPT, FETCH_ANALYTICS_SCRIPT }
