// @target linkedin.com
//
// ⚠ THIS PROBE WRITES. One like, on the one post the user approved. Delete
// after the run — a probe fires whenever its file is saved.
//
// Route B: drive the real UI. Five API variants were tried and refused; two of
// them reached LinkedIn's reaction service and were rejected on their contents,
// so the route is right and the payload is unknowable — the web client never
// sends it, so there is nothing to copy.
//
// Clicking the actual button sidesteps that entirely: it is what a person does.
// No mouse events and no CDP input are needed — a programmatic .click() on the
// element dispatches the same event React is listening for, and unlike real
// input it cannot steal focus from whatever the user is doing.
//
// If the post or the button cannot be found, this reports WHAT IT DID find
// rather than a bare failure, because the DOM shape is the thing worth learning
// from an unsuccessful run.

var ACTIVITY_ID = '7496815449049886720'

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

async function likeCount() {
  var r = await fetch('/voyager/api/feed/updatesV2?count=30&q=chronFeed&start=0', {
    credentials: 'include',
    headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0' },
  })
  var j = await r.json()
  var elements = j.elements || []
  for (var i = 0; i < elements.length; i++) {
    var urn = (elements[i].updateMetadata && elements[i].updateMetadata.urn) || ''
    if (urn.indexOf(ACTIVITY_ID) === -1) continue
    var counts = (elements[i].socialDetail && elements[i].socialDetail.totalSocialActivityCounts) || {}
    return { found: true, numLikes: counts.numLikes || 0 }
  }
  return { found: false }
}

// Locate the post's container. LinkedIn tags feed items with the urn on one of
// several attributes depending on the surface, so all of them are checked
// rather than assuming one.
function findPostElement() {
  var attrs = ['data-urn', 'data-id', 'data-activity-urn', 'data-chameleon-result-urn']
  for (var a = 0; a < attrs.length; a++) {
    var nodes = document.querySelectorAll('[' + attrs[a] + ']')
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i].getAttribute(attrs[a]) || '').indexOf(ACTIVITY_ID) !== -1) {
        return { el: nodes[i], via: attrs[a] }
      }
    }
  }
  return { el: null, via: null }
}

// The like control, by what it says rather than by class names — class names
// here are build-generated hashes and change constantly, while the accessible
// label is stable because screen readers depend on it.
function findLikeButton(root) {
  var buttons = root.querySelectorAll('button');
  var candidates = []
  for (var i = 0; i < buttons.length; i++) {
    var b = buttons[i]
    var label = (b.getAttribute('aria-label') || b.innerText || '').trim()
    if (/^(react )?like\b/i.test(label) || /\blike\b/i.test(b.getAttribute('aria-label') || '')) {
      candidates.push({ el: b, label: label.slice(0, 60), pressed: b.getAttribute('aria-pressed') })
    }
  }
  return candidates
}

var before = await likeCount()
if (!before.found) {
  return { ok: false, stopped: 'the post is no longer in the first 30 feed items — nothing was clicked' }
}

var post = findPostElement()
if (!post.el) {
  // Report the DOM shape so an unsuccessful run still teaches something.
  var sample = []
  var tagged = document.querySelectorAll('[data-urn],[data-id]')
  for (var i = 0; i < Math.min(tagged.length, 8); i++) {
    sample.push((tagged[i].getAttribute('data-urn') || tagged[i].getAttribute('data-id') || '').slice(0, 70))
  }
  return {
    ok: false,
    stopped: 'the post is not rendered on this page — open the LinkedIn feed and scroll until it is visible, then retry',
    href: location.href,
    taggedElementsFound: tagged.length,
    sampleAttributeValues: sample,
    likesBefore: before.numLikes,
  }
}

var candidates = findLikeButton(post.el)
if (!candidates.length) {
  var allButtons = []
  var bs = post.el.querySelectorAll('button')
  for (var i = 0; i < Math.min(bs.length, 12); i++) {
    allButtons.push((bs[i].getAttribute('aria-label') || bs[i].innerText || '').trim().slice(0, 50))
  }
  return {
    ok: false,
    stopped: 'found the post but no button that identifies itself as Like',
    foundVia: post.via,
    buttonsInPost: allButtons,
    likesBefore: before.numLikes,
  }
}

var target = candidates[0]
var alreadyPressed = target.pressed === 'true'
if (alreadyPressed) {
  return {
    ok: false,
    stopped: 'that post is already liked (aria-pressed=true) — clicking would UNLIKE it, so nothing was done',
    button: target.label,
    likesBefore: before.numLikes,
  }
}

target.el.click()

await new Promise(function (r) { setTimeout(r, 3000) })
var after = await likeCount()
var changed = after.found && after.numLikes !== before.numLikes

return {
  ok: true,
  foundVia: post.via,
  buttonLabel: target.label,
  otherLikeCandidates: candidates.length - 1,
  ariaPressedAfter: target.el.getAttribute('aria-pressed'),
  likesBefore: before.numLikes,
  likesAfter: after.numLikes,
  likesChanged: changed,
  // A click that dispatches cleanly proves nothing on its own; only the
  // server-side count does.
  verdict: changed
    ? 'CONFIRMED — the click registered and the like count changed'
    : 'UNCONFIRMED — the click dispatched but the count did not change; treat this as NOT a working like',
}
