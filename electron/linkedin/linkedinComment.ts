/**
 * Commenting on a LinkedIn post.
 *
 * liCommentOnPost now goes over the API (see its own comment, and
 * linkedinSdui.ts). The UI-driving scripts below are the previous path; they
 * stay because linkedinReply still drives the reply box through them until the
 * reply request is captured too. What follows describes that UI path.
 *
 * ── The anchors, and why they are not the ones this file used to name ──
 *
 * The first version used the feed page's `data-view-name` anchors
 * (feed-comment-button, comment-box, comment-post). Probe li-24 showed the
 * permalink page carries none of them — it tags eight elements in total — so
 * every run failed at the very first check while the page itself had loaded
 * fine (200, 180KB, in the network capture). Probe li-26 then read the real
 * structure off that page, with a throwaway character typed and cleared and
 * nothing submitted:
 *
 *   the box itself   [contenteditable="true"][role="textbox"]
 *                    aria-label "Text editor for creating content"
 *                    data-placeholder "Add a comment..."
 *                    ALREADY PRESENT — no button has to be clicked to open it
 *   submit           a button whose text is "Comment" and whose aria-label is
 *                    EMPTY, inside the form above the editor
 *
 * That last distinction carries real weight. The post's action bar also holds a
 * button reading "Comment" — but it has aria-label "Comment", and it opens the
 * box rather than submitting it. Matching on the visible text alone would click
 * the wrong one; the empty aria-label is what separates them, and it was read
 * off the page rather than assumed.
 *
 * The box is a contenteditable div holding a paragraph, not a textarea — it has
 * no `value` property at all. That matters more than it looks: assigning
 * textContent puts the words on screen while React continues to believe the box
 * is empty, so the submit control stays inert and nothing is ever sent. Text is
 * therefore inserted through CDP, which produces the events real typing does,
 * and which also cannot take focus from whatever the user is doing.
 *
 * Success is not claimed from the screen. The box clearing is the client's own
 * doing; whether the comment exists is a question only the server answers, and
 * the result says so rather than implying otherwise.
 */

import { getLinkedInView } from './linkedin'
import type { LinkedInResult } from './linkedin'
import { __testing as likeInternals } from './linkedinUiActions'
import { postCommentsScript } from './linkedinReadBridge'
import { commentRequestBody, sduiRequestScript } from './linkedinSdui'

const { permalinkFor } = likeInternals

const COMMENT_EDITOR_SELECTOR = '[contenteditable="true"][role="textbox"]'
export const MAX_COMMENT_LENGTH = 1250

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

/**
 * Is this node inside somebody else's comment?
 *
 * A permalink page renders the post and its comments, and each comment has its
 * own reply box and its own buttons. Without this, "the first comment button"
 * is a reply to a stranger rather than a comment on the post.
 *
 * Kept as a guard even though the permalink page carries neither componentkey
 * nor comment data-view-names today (li-24), so it currently answers false for
 * everything there. It is cheap, it is correct on the feed page, and the cost
 * of it being absent if LinkedIn starts tagging again is a reply posted under a
 * stranger's comment. The per-control checks below do the real separating.
 */
export const INSIDE_COMMENT_FN = `
  function insideAComment(node) {
    for (var n = node; n && n !== document.body; n = n.parentElement) {
      var key = n.getAttribute && n.getAttribute('componentkey')
      if (key && key.indexOf('replaceableComment') === 0) return true
      var view = n.getAttribute && n.getAttribute('data-view-name')
      if (view && (view === 'comment-container' || view === 'comment-body')) return true
    }
    return false
  }
`

/**
 * The post's own comment editor, wherever it is.
 *
 * Two wordings are accepted because the two pages differ: the feed labels it
 * "Text editor for creating comment" (li-23) and the permalink page labels it
 * "Text editor for creating content" (li-26). Requiring the feed's wording is
 * what made this step unreachable on a permalink.
 */
export const FIND_EDITOR_FN = `
${INSIDE_COMMENT_FN}
  function isCommentEditor(el) {
    if (insideAComment(el)) return false
    var label = el.getAttribute('aria-label') || ''
    var placeholder = el.getAttribute('data-placeholder') || ''
    return /creating (comment|content)/i.test(label) || /add a comment/i.test(placeholder)
  }
  function commentEditor() {
    var editors = document.querySelectorAll('${COMMENT_EDITOR_SELECTOR}')
    for (var i = 0; i < editors.length; i++) {
      if (isCommentEditor(editors[i])) return editors[i]
    }
    return null
  }
`

/**
 * Ensures the comment box exists.
 *
 * On a permalink the editor is already rendered (li-26 found it with nothing
 * clicked), so the common path here clicks nothing at all. The click is kept
 * for the case where it is not — and it is aimed at aria-label exactly
 * "Comment", which is the post's action-bar control; a comment's own control
 * reads "Reply to <name>'s comment" and so cannot be hit by this.
 */
export const OPEN_BOX_SCRIPT = `(function () {
${FIND_EDITOR_FN}
  if (commentEditor()) return { ok: true, opened: false, alreadyOpen: true }

  var buttons = document.querySelectorAll('button[aria-label="Comment"]')
  for (var i = 0; i < buttons.length; i++) {
    if (insideAComment(buttons[i])) continue
    buttons[i].click()
    return { ok: true, opened: true }
  }
  return { ok: false, error: 'the comment box is not present and no control belonging to the post opens one' }
})()`

/** Focuses the post's own editor and reports whether it actually took focus. */
export const FOCUS_EDITOR_SCRIPT = `(function () {
${FIND_EDITOR_FN}
  var editor = commentEditor()
  if (!editor) return { ok: false, error: 'the comment box did not appear' }
  editor.focus()
  return { ok: true, focused: document.activeElement === editor, existingText: (editor.innerText || '').trim() }
})()`

export function verifyAndSubmitScript(expected: string): string {
  return `(async function () {
${FIND_EDITOR_FN}
  try {
    var editor = commentEditor()
    if (!editor) return { ok: false, error: 'the comment box vanished before it could be submitted' }

    var typed = (editor.innerText || '').trim()
    var expected = ${JSON.stringify(expected)}.trim()
    if (typed !== expected) {
      // Refusing here is the point of the check. Submitting a box holding
      // something other than what was approved would publish text the user
      // never saw.
      return { ok: false, error: 'the box holds different text than was approved, so nothing was submitted',
        inBox: typed.slice(0, 200), approved: expected.slice(0, 200) }
    }

    // The submit control reads "Comment" and carries NO aria-label. The action
    // bar's control reads "Comment" too but has aria-label "Comment" — it opens
    // the box instead of submitting it, so the visible text alone cannot tell
    // them apart. Verified on the live permalink page (li-26).
    function isSubmit(b) {
      if (insideAComment(b)) return false
      if ((b.getAttribute('aria-label') || '').trim() !== '') return false
      return (b.innerText || '').replace(/[ ]+/g, ' ').trim() === 'Comment'
    }

    // Scoped outward from the editor, so a control belonging to some other
    // composer on the page cannot be picked up. li-26 found it six levels up,
    // inside the form that wraps the editor.
    function findSubmit() {
      var scope = editor
      for (var depth = 0; depth < 10 && scope && scope !== document.body; depth++) {
        var found = scope.querySelectorAll('button')
        for (var j = 0; j < found.length; j++) {
          if (isSubmit(found[j])) return { button: found[j], depth: depth }
        }
        scope = scope.parentElement
      }
      return null
    }

    // Polled, not read once. The submit control does not exist while React
    // considers the box empty — li-26 only saw it because it slept after
    // typing. The first live run of this tool looked immediately after the CDP
    // insertText and found nothing, which read as "the anchor is wrong" when
    // the anchor was right and the button had simply not rendered yet.
    var hit = null
    var submitDeadline = Date.now() + 6000
    for (;;) {
      hit = findSubmit()
      if (hit) break
      if (Date.now() > submitDeadline) break
      await new Promise(function (r) { setTimeout(r, 250) })
    }

    if (!hit) {
      // Reported with what WAS around the box. A bare "not found" on a page
      // nobody can inspect afterwards — the tool restores the previous URL on
      // its way out — is a dead end, and that is what cost the last two runs.
      var nearby = []
      var scan = editor
      for (var d = 0; d < 10 && scan && scan !== document.body; d++) {
        var bs = scan.querySelectorAll('button')
        for (var k = 0; k < bs.length && nearby.length < 12; k++) {
          nearby.push({
            depth: d,
            text: (bs[k].innerText || '').replace(/[ ]+/g, ' ').trim().slice(0, 24),
            label: (bs[k].getAttribute('aria-label') || '').slice(0, 40),
            disabled: bs[k].disabled === true,
          })
        }
        if (nearby.length) break
        scan = scan.parentElement
      }
      return { ok: false,
        error: 'the submit control (a button reading "Comment" with no aria-label) never appeared, so nothing was submitted',
        textStillInBox: (editor.innerText || '').trim().slice(0, 200),
        buttonsNearTheBox: nearby }
    }

    var button = hit.button
    var foundAtDepth = hit.depth

    if (button.disabled === true || button.getAttribute('aria-disabled') === 'true') {
      // The exact signal that inserted text never reached React: the words are
      // on screen but the component still considers the box empty.
      return { ok: false, error: 'the submit control is disabled, which means the text never registered with the page' }
    }

    button.click()
    await new Promise(function (r) { setTimeout(r, 2500) })

    return { ok: true, submitted: true, submitFoundAtDepth: foundAtDepth, boxClearedAfter: (editor.innerText || '').trim().length === 0 }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

/**
 * Comments on one post, addressed by its activity id.
 *
 * Approval happens in the tool layer above this — the only place that can show
 * the user the exact text and get a real answer.
 */
type ListedComment = { commentId?: string | null; text?: string | null }

async function listCommentIds(webContents: Electron.WebContents, activityId: string): Promise<ListedComment[] | null> {
  const res = await webContents.executeJavaScript(postCommentsScript({ activityId, limit: 50 })) as { ok?: boolean; comments?: ListedComment[] }
  return res?.ok ? res.comments ?? [] : null
}

/**
 * Comments on a post over LinkedIn's SDUI createComment request — no page
 * navigation, no typing, works from the hidden background window.
 *
 * The request carries the text itself, in the `states` array its
 * commentFieldBinding points at (probe lkc-02), so FlowDesk names its own
 * binding key. LinkedIn writes the comment and then often answers 500 while
 * rendering the reply (lkc-03, lkc-09: 500, comment present) — so the HTTP
 * answer is never the verdict. The verdict is the comment list: a comment
 * with this exact text whose id was not there before. That also means a 500
 * is never retried blindly into a duplicate.
 *
 * Approval happens in the tool layer above this.
 */
export async function liCommentOnPost(activityId: string, text: string): Promise<LinkedInResult> {
  if (!/^[0-9]+$/.test(String(activityId))) {
    return { ok: false, error: `activityId must be the numeric id from linkedin_feed — got: ${activityId}` }
  }
  const comment = String(text ?? '').trim()
  if (!comment) return { ok: false, error: 'refusing to submit an empty comment' }
  if (comment.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: `comment is ${comment.length} characters; the LinkedIn limit is ${MAX_COMMENT_LENGTH}` }
  }

  const view = await getLinkedInView().catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }
  const wc = view.webContents

  try {
    const before = await listCommentIds(wc, activityId)
    if (!before) return { ok: false, error: 'could not read the post\'s comments — is the id right?', activityId }
    const known = new Set(before.map(c => c.commentId))

    const stateId = `flowdesk${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    const sent = await wc.executeJavaScript(
      sduiRequestScript('com.linkedin.sdui.comments.createComment', commentRequestBody(activityId, comment, stateId)),
    ) as LinkedInResult

    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 800 : 1500))
      const after = await listCommentIds(wc, activityId)
      const created = after?.find(c => c.commentId && !known.has(c.commentId) && (c.text ?? '').trim() === comment)
      if (created) {
        return { ok: true, commented: true, via: 'api', activityId, commentId: created.commentId, permalink: permalinkFor(activityId) }
      }
    }
    return {
      ok: false,
      error: 'the comment did not appear on the post',
      requestStatus: sent?.status,
      requestError: sent?.ok ? undefined : sent?.error,
      activityId,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), activityId }
  }
}
