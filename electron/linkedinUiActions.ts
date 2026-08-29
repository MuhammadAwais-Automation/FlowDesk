/**
 * LinkedIn actions that can only be done by driving the real UI.
 *
 * ── Why this exists ──
 *
 * Liking, commenting, posting and connecting are served by Server-Driven UI.
 * Their requests carry no data, only pointers into the rendered page:
 * `createComment` does not contain the comment text, it contains a binding key
 * derived from that page load. There is nothing to replay.
 *
 * Eight direct API attempts were made and refused. Two of them reached
 * LinkedIn's reaction service and were rejected on their contents
 * ("Couldn't react to this post"), which means the route exists and the payload
 * is unknowable — the web client never sends it, so there is nothing to copy
 * from a capture either.
 *
 * Clicking the actual control sidesteps all of that: it is what a person does.
 * Verified end to end on a real post — the click produced
 * `POST com.linkedin.sdui.reactions.create → 200` in the network capture.
 *
 * ── Why it navigates to the post's own page ──
 *
 * Only 2 of 28 rendered feed posts carry an activity id anywhere in their DOM
 * attributes, so a post read from the API cannot reliably be matched to a post
 * on screen. Matching by text was tried and works, but "works" there means
 * "usually" — and a like landing on the wrong post cannot be quietly undone.
 *
 * Opening `/feed/update/urn:li:activity:<id>/` removes the ambiguity entirely:
 * the page is addressed by the id itself. It also removes the requirement that
 * the post be scrolled into view.
 *
 * The cost, stated plainly: the LinkedIn tab visibly navigates. The previous
 * URL is restored afterwards, but the user will see it move.
 *
 * ── No mouse, no focus ──
 *
 * The click is `element.click()` evaluated in the page, not a synthesised input
 * event. Nothing is typed, no pointer moves, and focus is never taken from
 * whatever the user is doing.
 */

import { findViewByUrl } from './sessions'
import type { LinkedInResult } from './linkedin'

const RENDER_TIMEOUT_MS = 15_000
const RENDER_POLL_MS = 400
/** How long to let an optimistic UI update be reverted by a server rejection. */
const SETTLE_MS = 3_000

function permalinkFor(activityId: string): string {
  return `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
}

/**
 * Finds the MAIN post's reaction button on a permalink page.
 *
 * A permalink page renders the post and its comments, and every comment has its
 * own reaction button — so "the first reaction button" is not necessarily the
 * post's. Comment subtrees are identifiable by a componentkey beginning
 * `replaceableComment_`, so buttons inside one are excluded rather than hoped
 * against.
 */
/**
 * Finds the MAIN post's reaction control on a permalink page.
 *
 * ── Why this had to be rewritten ──
 *
 * It used to look for `button[data-view-name="reaction-button"]`. That anchor
 * was read off `/feed/` and pointed at `/feed/update/<id>/` without anyone
 * checking it existed there. Probe li-24, run on the real permalink page,
 * settled it: the page carries EIGHT tagged elements in total, and the only
 * three names present are feed-full-update, premium-upsell-link and
 * search-global-typeahead-input. reaction-button, comment-box and comment-post
 * are absent entirely. So the check never passed, and the tool reported "the
 * page did not render" for a page that had rendered perfectly — the network
 * capture shows it returning 200 with 180KB, twice.
 *
 * What the permalink page does carry is aria-labels, and they separate the post
 * from its comments unambiguously:
 *
 *   post      "React Like"
 *   comments  "React Like to Ralph Kleinschmidt's comment"
 *
 * The " to " is the discriminator, and it is a property of the label's meaning
 * rather than of a build-specific attribute name, so it is the more durable of
 * the two anchors available.
 */
const FIND_BUTTON_FN = `
  function labelOf(el) {
    return (el && el.getAttribute('aria-label')) || ''
  }

  // The reaction toggle in either state. LinkedIn rewords the label once a
  // reaction exists, so matching only the un-reacted wording would lose the
  // control exactly when the result needs to be verified.
  // "32 reactions" and "See 26 more reactions" are counts, not controls; they
  // do not begin with the word, which is why this is anchored to the start.
  function isReactionToggle(label) {
    return /^(un)?react /i.test(label) && label.indexOf(' to ') === -1
  }

  // True only when clicking ADDS a reaction. Anything else and a click removes
  // one, which is not what was asked for and cannot be quietly undone.
  function addsReaction(label) {
    return /^react /i.test(label)
  }

  function mainReactionButton() {
    var buttons = document.querySelectorAll('button[aria-label]')
    for (var i = 0; i < buttons.length; i++) {
      if (isReactionToggle(labelOf(buttons[i]))) return buttons[i]
    }
    return null
  }

  function countReactionButtons() {
    var buttons = document.querySelectorAll('button[aria-label]')
    var n = 0
    for (var i = 0; i < buttons.length; i++) {
      if (/^(un)?react /i.test(labelOf(buttons[i]))) n++
    }
    return n
  }
`

const READY_SCRIPT = `(function () {
${FIND_BUTTON_FN}
  var button = mainReactionButton()
  return {
    ready: !!button,
    label: button ? labelOf(button) : null,
    totalReactionButtons: countReactionButtons(),
    url: location.href,
  }
})()`

function clickScript(): string {
  return `(async function () {
${FIND_BUTTON_FN}
  try {
    var button = mainReactionButton()
    if (!button) return { ok: false, error: 'the post rendered but no reaction control belongs to it (only comment controls were found)' }

    var before = labelOf(button)
    if (!addsReaction(before)) {
      // Any other wording means a reaction already exists and a click would
      // REMOVE it. Refusing is the only safe reading of an ambiguous request,
      // and it is also the safe default for a label this code has not seen —
      // an unknown state stops the action rather than guessing through it.
      return { ok: false, alreadyReacted: true, state: before,
        error: 'this post is not in a state where clicking adds a reaction (control reads "' + before + '") — nothing was done' }
    }

    button.click()
    await new Promise(function (r) { setTimeout(r, ${SETTLE_MS}) })

    // Re-queried rather than reusing the reference: React may replace the node
    // when the label changes, and a stale node keeps its old attributes, which
    // would report success for a click that did nothing.
    var afterButton = mainReactionButton()
    var after = afterButton ? labelOf(afterButton) : '[control not found after click]'
    var stillAdds = afterButton ? addsReaction(after) : true

    return {
      ok: !stillAdds,
      before: before,
      after: after,
      // React updates optimistically, so a label change alone proves only that
      // the click was received. What makes it meaningful is that it is read
      // AFTER a settle delay: a server rejection reverts the control, so a
      // label that has stopped offering to add a reaction by then means the
      // server accepted it.
      error: stillAdds
        ? 'the control still reads "' + after + '" after ' + ${SETTLE_MS} + 'ms, which means the reaction did not stick'
        : undefined,
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

function unclickScript(): string {
  return `(async function () {
${FIND_BUTTON_FN}
  try {
    var button = mainReactionButton()
    if (!button) return { ok: false, error: 'the post rendered but no reaction control belongs to it' }

    var before = labelOf(button)
    if (addsReaction(before)) {
      // The control is offering to ADD a reaction, which means none exists.
      // There is nothing to remove — and clicking would add one, the opposite
      // of what was asked. Refusing is the safe reading.
      return { ok: false, notReacted: true, state: before,
        error: 'there is no reaction on this post to remove (control reads "' + before + '") — nothing was done' }
    }

    // Any non-"react" wording ("Unreact Like", "Unreact Celebrate", ...) means a
    // reaction exists and clicking removes it.
    button.click()
    await new Promise(function (r) { setTimeout(r, ${SETTLE_MS}) })

    var afterButton = mainReactionButton()
    var after = afterButton ? labelOf(afterButton) : '[control not found after click]'
    // Success is the control now OFFERING to add a reaction again — i.e. the
    // existing one was removed and stayed removed past the settle delay.
    var nowAdds = afterButton ? addsReaction(after) : false

    return {
      ok: nowAdds,
      before: before,
      after: after,
      error: nowAdds ? undefined
        : 'the control still reads "' + after + '" after ' + ${SETTLE_MS} + 'ms, which means the reaction was not removed',
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

/**
 * Likes one post, addressed by its activity id.
 *
 * Approval happens in the tool layer above this, which is the only place that
 * can show the user which post and get a real answer.
 */
export async function liLikePost(activityId: string): Promise<LinkedInResult> {
  if (!/^[0-9]+$/.test(String(activityId))) {
    return { ok: false, error: `activityId must be the numeric id from linkedin_feed — got: ${activityId}` }
  }

  const view = findViewByUrl('linkedin.com')
  if (!view) return { ok: false, error: NOT_OPEN }

  const webContents = view.webContents
  let previousUrl = ''
  try { previousUrl = webContents.getURL() } catch { /* destroyed */ }

  try {
    await webContents.loadURL(permalinkFor(activityId))

    // Poll rather than guess a fixed delay: render time varies with network and
    // with how much of the page LinkedIn decides to stream.
    const deadline = Date.now() + RENDER_TIMEOUT_MS
    let ready: { ready?: boolean; totalReactionButtons?: number; url?: string } = {}
    for (;;) {
      ready = await webContents.executeJavaScript(READY_SCRIPT)
      if (ready?.ready) break
      if (Date.now() > deadline) {
        return {
          ok: false,
          error: `the post page did not render a reaction control within ${RENDER_TIMEOUT_MS}ms`,
          url: ready?.url,
          reactionButtonsSeen: ready?.totalReactionButtons ?? 0,
          hint: 'the post may be deleted, private, or the id may be wrong',
        }
      }
      await new Promise(resolve => setTimeout(resolve, RENDER_POLL_MS))
    }

    const outcome = await webContents.executeJavaScript(clickScript()) as {
      ok: boolean; before?: string; after?: string; error?: string; alreadyReacted?: boolean
    }

    return {
      ...outcome,
      activityId,
      permalink: permalinkFor(activityId),
      via: 'ui-click',
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), activityId }
  } finally {
    // Put the tab back where the user left it, whatever happened above — an
    // action that silently relocates someone's browser is its own bug.
    if (previousUrl && !previousUrl.includes('/feed/update/')) {
      try { await webContents.loadURL(previousUrl) } catch { /* view gone */ }
    }
  }
}

/**
 * Removes the user's reaction from a post, addressed by its activity id.
 *
 * The mirror of liLikePost: same navigate-and-poll, but it clicks only when a
 * reaction already exists and refuses when none does — so it can never add a
 * reaction by accident. Reactions are Server-Driven UI with no replayable API
 * (re-verified: eight REST shapes all returned 400), which is why this drives
 * the control rather than calling an endpoint.
 */
export async function liUnlikePost(activityId: string): Promise<LinkedInResult> {
  if (!/^[0-9]+$/.test(String(activityId))) {
    return { ok: false, error: `activityId must be the numeric id from linkedin_feed — got: ${activityId}` }
  }

  const view = findViewByUrl('linkedin.com')
  if (!view) return { ok: false, error: NOT_OPEN }

  const webContents = view.webContents
  let previousUrl = ''
  try { previousUrl = webContents.getURL() } catch { /* destroyed */ }

  try {
    await webContents.loadURL(permalinkFor(activityId))

    const deadline = Date.now() + RENDER_TIMEOUT_MS
    let ready: { ready?: boolean; totalReactionButtons?: number; url?: string } = {}
    for (;;) {
      ready = await webContents.executeJavaScript(READY_SCRIPT)
      if (ready?.ready) break
      if (Date.now() > deadline) {
        return {
          ok: false,
          error: `the post page did not render a reaction control within ${RENDER_TIMEOUT_MS}ms`,
          url: ready?.url,
          hint: 'the post may be deleted, private, or the id may be wrong',
        }
      }
      await new Promise(resolve => setTimeout(resolve, RENDER_POLL_MS))
    }

    const outcome = await webContents.executeJavaScript(unclickScript()) as {
      ok: boolean; before?: string; after?: string; error?: string; notReacted?: boolean
    }

    return { ...outcome, activityId, permalink: permalinkFor(activityId), via: 'ui-click' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), activityId }
  } finally {
    if (previousUrl && !previousUrl.includes('/feed/update/')) {
      try { await webContents.loadURL(previousUrl) } catch { /* view gone */ }
    }
  }
}

export const __testing = { permalinkFor, READY_SCRIPT, clickScript, unclickScript, FIND_BUTTON_FN }
