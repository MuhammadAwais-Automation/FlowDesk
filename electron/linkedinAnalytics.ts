/**
 * Reading post/creator analytics.
 *
 * ── Why this is a DOM read and not an API call, unlike the rest of this batch ──
 *
 * Posting, deleting, scheduling and image upload all turned out to be plain
 * voyager API calls. Analytics did not. The creator analytics page is a
 * `/flagship-web/` route — Server-Driven UI — and a sweep of every queryId the
 * client ships (937 of them) found no voyager endpoint serving impressions.
 * The numbers exist only as rendered text on the page.
 *
 * So this navigates to the analytics page and reads what it rendered. That is
 * genuinely weaker than the API tools: the labels are LinkedIn's UI wording and
 * can change, and the figures are whatever the page chose to show for the
 * default window. It is reported as read-from-screen, not as structured data
 * the API guaranteed, so nothing downstream mistakes it for the latter.
 */

import { findViewByUrl } from './sessions'
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
 * Reads the creator content-analytics summary (impressions and engagement for
 * the default window).
 *
 * The LinkedIn tab visibly navigates to the analytics page and back.
 */
export async function liCreatorAnalytics(): Promise<LinkedInResult> {
  const view = findViewByUrl('linkedin.com')
  if (!view) return { ok: false, error: NOT_OPEN }
  const webContents = view.webContents

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
      via: 'dom-read',
      note: 'these figures were read from the analytics page as rendered, not from an API — LinkedIn exposes no analytics endpoint. Labels and the default window are LinkedIn\'s own.',
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (previousUrl && !previousUrl.includes('/analytics/')) {
      try { await webContents.loadURL(previousUrl) } catch { /* view gone */ }
    }
  }
}

export const __testing = { READ_ANALYTICS_SCRIPT }
