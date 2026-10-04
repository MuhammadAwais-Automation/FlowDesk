/**
 * Replying to a specific comment on a post.
 *
 * ── Why this is UI-driven, like commenting ──
 *
 * Comments and replies go through LinkedIn's Server-Driven UI
 * (`/flagship-web/rsc-action/`), whose requests carry page-bound keys rather
 * than data — re-verified in this batch, along with the fact that reactions
 * have no replayable REST API either (eight shapes, all 400). So a reply is
 * made the way a person makes one: open the target comment's reply box, type,
 * submit.
 *
 * ── How the target comment is identified, and why it refuses when unsure ──
 *
 * A post can have many comments, each with its own reply box. Getting the wrong
 * one means replying publicly under a stranger's comment. The target is matched
 * by a text snippet (from linkedin_post_comments), and optionally the
 * commenter's name — and if that does not resolve to EXACTLY ONE comment, the
 * reply is refused rather than aimed at a guess. A reply that does not happen is
 * recoverable; one under the wrong comment is not.
 *
 * Text is inserted through CDP (the same mechanism the comment tool uses),
 * because assigning it directly leaves React believing the box is empty and the
 * submit control inert.
 */

import { getLinkedInView } from './linkedin'
import { __testing as likeInternals } from './linkedinUiActions'
import { INSIDE_COMMENT_FN } from './linkedinComment'
import type { LinkedInResult } from './linkedin'

const { permalinkFor, READY_SCRIPT } = likeInternals

const RENDER_TIMEOUT_MS = 15_000
const RENDER_POLL_MS = 400
export const MAX_REPLY_LENGTH = 1250
const REPLY_EDITOR_SELECTOR = '[contenteditable="true"][role="textbox"]'

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

/**
 * Scrolls the comments into view and opens the reply box on the comment that
 * uniquely matches the snippet. Refuses on zero or multiple matches.
 */
function openReplyScript(snippet: string, commenter: string | undefined): string {
  return `(async function () {
${INSIDE_COMMENT_FN}
  try {
    // Comments render lazily; nudge the page so they exist before matching.
    window.scrollTo(0, document.body.scrollHeight * 0.7)
    await new Promise(function (r) { setTimeout(r, 1500) })

    var snippet = ${JSON.stringify(snippet)}.toLowerCase().replace(/\\s+/g, ' ').trim()
    var commenter = ${JSON.stringify(commenter || '')}.toLowerCase().trim()

    // Each "Reply to <name>'s comment" button anchors one comment. Walk up from
    // it to the comment container and read that comment's text, so matching is
    // against the comment the button actually belongs to.
    var buttons = document.querySelectorAll('button[aria-label]')
    var candidates = []
    for (var i = 0; i < buttons.length; i++) {
      var label = buttons[i].getAttribute('aria-label') || ''
      if (!/^Reply to /i.test(label)) continue
      // Finding the comment this button belongs to.
      //
      // The first version looked for an ancestor tagged data-view-name
      // ~ /comment/ or componentkey ~ replaceableComment. On a permalink page
      // neither exists — verified: the walk terminated on the button itself,
      // whose text is just "Reply", so no snippet could ever match. That is the
      // same wrong assumption that broke the like and comment tools, which is
      // why this now uses structure that is true regardless of tagging.
      //
      // The rule: the comment's container is the SMALLEST ancestor that still
      // contains exactly one "Reply to" button. Grow past that and it swallows
      // the neighbouring comment, which is precisely the mix-up that would post
      // a reply under the wrong person.
      var container = buttons[i]
      for (var n = buttons[i].parentElement, hops = 0; n && n !== document.body && hops < 12; n = n.parentElement, hops++) {
        var replyButtonsInside = 0
        var inside = n.querySelectorAll('button[aria-label]')
        for (var k = 0; k < inside.length; k++) {
          if (/^Reply to /i.test(inside[k].getAttribute('aria-label') || '')) replyButtonsInside++
        }
        if (replyButtonsInside !== 1) break
        container = n
      }
      var text = (container.innerText || '').toLowerCase().replace(/\\s+/g, ' ')
      var matchesText = snippet && text.indexOf(snippet) !== -1
      var matchesWho = !commenter || label.toLowerCase().indexOf(commenter) !== -1
      if (matchesText && matchesWho) candidates.push({ button: buttons[i], label: label })
    }

    if (candidates.length === 0) {
      return { ok: false, error: 'no comment on this post matched the snippet' + (commenter ? ' from that commenter' : '') + ', so nothing was opened' }
    }
    if (candidates.length > 1) {
      // Refusing on ambiguity is the safety property. Replying under the wrong
      // comment is public and cannot be undone.
      return { ok: false, ambiguous: true, matchCount: candidates.length,
        error: 'the snippet matched ' + candidates.length + ' comments — narrow it (add the commenter name or more text) so exactly one matches' }
    }

    candidates[0].button.click()
    await new Promise(function (r) { setTimeout(r, 1200) })
    return { ok: true, targetLabel: candidates[0].label }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

/** The reply editor that just opened. Broadened wording to include "reply". */
const FOCUS_REPLY_SCRIPT = `(function () {
${INSIDE_COMMENT_FN}
  var editors = document.querySelectorAll('${REPLY_EDITOR_SELECTOR}')
  // The reply editor is the one most recently focused/opened; pick the last
  // matching editor whose label mentions creating a comment/content/reply,
  // since a reply box renders after the post's own comment box in the DOM.
  var chosen = null
  for (var i = 0; i < editors.length; i++) {
    var label = editors[i].getAttribute('aria-label') || ''
    var placeholder = editors[i].getAttribute('data-placeholder') || ''
    if (/creating (comment|content|reply)/i.test(label) || /add a (comment|reply)/i.test(placeholder)) chosen = editors[i]
  }
  if (!chosen) return { ok: false, error: 'the reply box did not appear' }
  chosen.focus()
  return { ok: true, focused: document.activeElement === chosen, existingText: (chosen.innerText || '').trim(), label: chosen.getAttribute('aria-label') }
})()`

/**
 * Verifies the box holds the approved reply and submits it.
 *
 * `mentionPrefix` exists because LinkedIn pre-fills a reply box with an
 * @mention of the person being replied to — verified live: the box read
 * "Awais Mushtaq <the reply>" when only the reply had been typed. An exact
 * comparison therefore refuses every real reply, which is what happened on the
 * first run.
 *
 * The relaxation is deliberately narrow: the text must be EITHER exactly what
 * was approved, or exactly the mention followed by what was approved. Anything
 * else — a stale draft, a partial insertion, extra words — still refuses, so
 * nothing is published that the user did not see.
 */
function verifyAndSubmitReplyScript(expected: string, mentionPrefix = ''): string {
  return `(async function () {
  try {
    var editors = document.querySelectorAll('${REPLY_EDITOR_SELECTOR}')
    var editor = null
    for (var i = 0; i < editors.length; i++) {
      var label = editors[i].getAttribute('aria-label') || ''
      var placeholder = editors[i].getAttribute('data-placeholder') || ''
      if (/creating (comment|content|reply)/i.test(label) || /add a (comment|reply)/i.test(placeholder)) editor = editors[i]
    }
    if (!editor) return { ok: false, error: 'the reply box vanished before it could be submitted' }

    var typed = (editor.innerText || '').replace(/\s+/g, ' ').trim()
    var expected = ${JSON.stringify(expected)}.replace(/\s+/g, ' ').trim()
    var mention = ${JSON.stringify(mentionPrefix)}.replace(/\s+/g, ' ').trim()
    var withMention = mention ? (mention + ' ' + expected) : null
    if (typed !== expected && typed !== withMention) {
      return { ok: false, error: 'the box holds different text than was approved, so nothing was submitted',
        inBox: typed.slice(0, 200), approved: expected.slice(0, 200), allowedMention: mention || null }
    }

    // The reply submit reads "Reply" (the post's own submit reads "Comment").
    // Both carry an empty aria-label. Scoped outward from the editor so another
    // composer's button cannot be picked up.
    function isReplySubmit(b) {
      if ((b.getAttribute('aria-label') || '').trim() !== '') return false
      return (b.innerText || '').replace(/[ ]+/g, ' ').trim() === 'Reply'
    }
    var button = null
    var scope = editor
    for (var d = 0; d < 10 && scope && scope !== document.body; d++) {
      var found = scope.querySelectorAll('button')
      for (var j = 0; j < found.length; j++) { if (isReplySubmit(found[j])) { button = found[j]; break } }
      if (button) break
      scope = scope.parentElement
    }
    if (!button) return { ok: false, error: 'the reply submit control (a button reading "Reply" with no aria-label) was not found near the box' }
    if (button.disabled === true || button.getAttribute('aria-disabled') === 'true') {
      return { ok: false, error: 'the reply submit is disabled, which means the text never registered with the page' }
    }

    button.click()
    await new Promise(function (r) { setTimeout(r, 2500) })
    return { ok: true, submitted: true, boxClearedAfter: (editor.innerText || '').trim().length === 0 }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

export async function liReplyToComment(
  activityId: string,
  commentSnippet: string,
  replyText: string,
  commenter?: string,
): Promise<LinkedInResult> {
  if (!/^[0-9]+$/.test(String(activityId))) {
    return { ok: false, error: `activityId must be the numeric id from linkedin_feed — got: ${activityId}` }
  }
  const snippet = String(commentSnippet ?? '').trim()
  if (snippet.length < 8) {
    return { ok: false, error: 'commentSnippet must be at least 8 characters, so it can identify one comment unambiguously' }
  }
  const reply = String(replyText ?? '').trim()
  if (!reply) return { ok: false, error: 'refusing to submit an empty reply' }
  if (reply.length > MAX_REPLY_LENGTH) {
    return { ok: false, error: `reply is ${reply.length} characters; the LinkedIn limit is ${MAX_REPLY_LENGTH}` }
  }

  const view = await getLinkedInView().catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }
  const webContents = view.webContents

  let previousUrl = ''
  try { previousUrl = webContents.getURL() } catch { /* destroyed */ }
  const steps: string[] = []

  try {
    await webContents.loadURL(permalinkFor(activityId))

    const deadline = Date.now() + RENDER_TIMEOUT_MS
    for (;;) {
      const ready = await webContents.executeJavaScript(READY_SCRIPT)
      if (ready?.ready) break
      if (Date.now() > deadline) {
        return { ok: false, error: `the post page did not render within ${RENDER_TIMEOUT_MS}ms`, activityId, steps }
      }
      await new Promise(resolve => setTimeout(resolve, RENDER_POLL_MS))
    }
    steps.push('post rendered')

    const opened = await webContents.executeJavaScript(openReplyScript(snippet, commenter)) as {
      ok: boolean; error?: string; ambiguous?: boolean; matchCount?: number; targetLabel?: string
    }
    if (!opened.ok) return { ...opened, activityId, steps }
    steps.push(`reply box opened on: ${opened.targetLabel}`)

    let focused: { ok?: boolean; focused?: boolean; error?: string } = {}
    const focusDeadline = Date.now() + RENDER_TIMEOUT_MS
    for (;;) {
      focused = await webContents.executeJavaScript(FOCUS_REPLY_SCRIPT)
      if (focused?.ok && focused.focused) break
      if (Date.now() > focusDeadline) {
        return { ok: false, error: focused?.error ?? 'the reply box never took focus', activityId, steps }
      }
      await new Promise(resolve => setTimeout(resolve, RENDER_POLL_MS))
    }
    steps.push('reply box focused')

    try {
      if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3')
      await webContents.debugger.sendCommand('Input.insertText', { text: reply })
    } catch (e) {
      return { ok: false, error: `could not type into the reply box: ${e instanceof Error ? e.message : String(e)}`, activityId, steps }
    }
    steps.push('text inserted')

    // "Reply to Jane Doe's comment" -> "Jane Doe", the mention LinkedIn inserts.
    const mentionMatch = /^Reply to (.+?)(?:’s|'s) comment/i.exec(opened.targetLabel || '')
    const mention = mentionMatch ? mentionMatch[1] : ''

    const outcome = await webContents.executeJavaScript(verifyAndSubmitReplyScript(reply, mention)) as {
      ok: boolean; error?: string; boxClearedAfter?: boolean
    }
    if (!outcome.ok) return { ...outcome, activityId, steps }
    steps.push('submitted')

    return {
      ok: true,
      activityId,
      reply,
      repliedTo: opened.targetLabel,
      permalink: permalinkFor(activityId),
      via: 'ui-click',
      steps,
      note: 'submitted — call linkedin_post_comments on this activityId to confirm the server kept it',
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), activityId, steps }
  } finally {
    if (previousUrl && !previousUrl.includes('/feed/update/')) {
      try { await webContents.loadURL(previousUrl) } catch { /* view gone */ }
    }
  }
}

export const __testing = { openReplyScript, FOCUS_REPLY_SCRIPT, verifyAndSubmitReplyScript }
