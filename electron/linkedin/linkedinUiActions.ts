/**
 * LinkedIn reactions.
 *
 * Like and unlike go over the wire now (reactionScript): the SDUI
 * server-request the like button itself sends, replayed from an in-page fetch.
 * Proven live — like count 2 → 3 → 2 — so no navigation, no click, and it
 * works from the hidden background window. See probes lk-05/07/08 and the
 * "Reactions over the wire" section of probes/FINDINGS-linkedin.md.
 *
 * The click-driving scripts below (FIND_BUTTON_FN, clickScript, …) are the
 * previous UI path, kept only for their tests until comment/reply move to the
 * API as well; nothing calls them.
 */

import { getLinkedInView } from './linkedin'
import type { LinkedInResult } from './linkedin'

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


// ── Reactions over the wire (probes lk-05, lk-07, lk-08) ─────────────────────
//
// The like button posts an SDUI server-request, and replaying that request
// works: like count 2 → 3 → 2 on a real post, from a plain in-page fetch, no
// click and no navigation. Earlier "reactions have no API" findings only ever
// tried the old voyager REST routes, never this one.
//
// requestMetadata.currentActor and onClientRequestFailureAction must be
// present — a body stripped to the payload answered 500 (lk-07). HTTP 200 is
// not success on its own: a bad id still answers 200 with a non-empty
// response.errors, so that array is the confirmation.
export function reactionRequestBody(activityId: string, kind: 'create' | 'delete'): string {
  const requestId = `com.linkedin.sdui.reactions.${kind}`
  const activityUrn = `urn:li:activity:${activityId}`
  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    requestedStateKeys: [],
    payload: {
      threadUrn: { threadUrnActivityThreadUrn: { activityUrn: { activityId } } },
      reactionType: 'ReactionType_LIKE',
      reactionSource: 'Update',
    },
    requestMetadata: {
      $type: 'proto.sdui.common.RequestMetadata',
      currentActor: {
        $type: 'proto.sdui.bindings.core.Bindable',
        key: { key: { value: { $case: 'id', id: `identitySwitcherActorContext-${activityUrn}` } } },
        content: { $case: 'stringBinding', stringBinding: {} },
      },
    },
  }
  return JSON.stringify({
    requestId,
    serverRequest: {
      requestId,
      requestedArguments,
      onClientRequestFailureAction: {
        actions: [{
          $type: 'proto.sdui.actions.core.RollbackStates',
          value: { keys: [{ key: { value: { $case: 'id', id: `reactionState-${activityUrn}` } } }] },
        }],
      },
      isApfcEnabled: false,
      isStreaming: false,
      rumPageKey: '',
    },
    states: [],
    // screenId and knownTemplateIds sit INSIDE this copy of requestedArguments
    // in the captured request; one level up the server answers 500.
    requestedArguments: {
      ...requestedArguments,
      states: [],
      screenId: 'com.linkedin.sdui.flagshipnav.feed.UpdateDetail',
      knownTemplateIds: [],
    },
  })
}

export function reactionScript(activityId: string, kind: 'create' | 'delete'): string {
  const url = `/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.reactions.${kind}`
  return `(async function () {
    try {
      var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
      if (!m) return { ok: false, error: 'no JSESSIONID cookie — not signed in to LinkedIn' }
      var res = await fetch(${JSON.stringify(url)}, {
        method: 'POST',
        credentials: 'include',
        headers: { 'csrf-token': m[1], 'content-type': 'application/json', 'x-li-rsc-stream': 'true' },
        body: ${JSON.stringify(reactionRequestBody(activityId, kind))},
      })
      var text = await res.text()
      // Streamed RSC: numbered lines, the response object on the "0:" line.
      var line = text.split('\\n').find(function (l) { return l.indexOf('0:') === 0 })
      var parsed = null
      try { parsed = line ? JSON.parse(line.slice(2)) : null } catch (e) {}
      var errors = parsed && parsed.response && parsed.response.errors
      if (res.status !== 200 || !Array.isArray(errors)) {
        return { ok: false, status: res.status, error: 'unexpected reaction response', snippet: text.slice(0, 300) }
      }
      if (errors.length) {
        return { ok: false, status: res.status, error: errors.map(function (e) { return e.message || JSON.stringify(e) }).join('; ').slice(0, 300) }
      }
      return { ok: true, status: res.status }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

async function react(activityId: string, kind: 'create' | 'delete', account?: string | number): Promise<LinkedInResult> {
  if (!/^[0-9]+$/.test(String(activityId))) {
    return { ok: false, error: `activityId must be the numeric id from linkedin_feed — got: ${activityId}` }
  }
  try {
    const view = await getLinkedInView(account)
    const outcome = await view.webContents.executeJavaScript(reactionScript(activityId, kind)) as LinkedInResult
    return { ...outcome, activityId, permalink: permalinkFor(activityId), via: 'api' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), activityId }
  }
}

/** Likes one post by activity id, over the API. Approval lives in the tool layer. */
export function liLikePost(activityId: string, account?: string | number): Promise<LinkedInResult> {
  return react(activityId, 'create', account)
}

/** Removes the user's like from a post by activity id, over the API. */
export function liUnlikePost(activityId: string, account?: string | number): Promise<LinkedInResult> {
  return react(activityId, 'delete', account)
}

export const __testing = { permalinkFor, READY_SCRIPT, clickScript, unclickScript, FIND_BUTTON_FN }
