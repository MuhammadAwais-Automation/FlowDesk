// @target linkedin.com
//
// READ-ONLY. Nothing is clicked.
//
// Checks whether the like placed earlier actually stuck. A click producing a
// 200 says the server accepted the request at the time; it does not say the
// reaction is still there now. Those are different claims and only the second
// one is what "is like working" means.
//
// Two independent checks, because either alone can mislead:
//   1. the post as the API reports it — was it liked by this account
//   2. the reaction button on screen, if that post happens to be rendered

var ACTIVITY_ID = '7496815490305171457'   // Aqil Awan — the post that was liked

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

async function get(path) {
  var r = await fetch(path, {
    credentials: 'include',
    headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0' },
  })
  var t = await r.text()
  var j = null
  try { j = JSON.parse(t) } catch (e) {}
  return { status: r.status, json: j }
}

// ── 1. what the API says about that post ──
var feed = await get('/voyager/api/feed/updatesV2?count=60&q=chronFeed&start=0')
var elements = (feed.json && feed.json.elements) || []
var apiView = { found: false }
for (var i = 0; i < elements.length; i++) {
  var urn = (elements[i].updateMetadata && elements[i].updateMetadata.urn) || ''
  if (urn.indexOf(ACTIVITY_ID) === -1) continue
  var social = elements[i].socialDetail || {}
  var counts = social.totalSocialActivityCounts || {}
  apiView = {
    found: true,
    numLikes: counts.numLikes || 0,
    reactionTypeCounts: (counts.reactionTypeCounts || []).map(function (r) {
      return { type: r.reactionType, count: r.count }
    }),
    // The field that answers the actual question, when LinkedIn includes it.
    myReaction: social.reactionByOrganizationActor || counts.reactedByCurrentUser
      || social.likedByCurrentUser || social.reacted || null,
  }
  break
}

// ── 2. what the page says, if the post is on screen ──
function insideAComment(node) {
  for (var n = node; n && n !== document.body; n = n.parentElement) {
    var key = n.getAttribute && n.getAttribute('componentkey')
    if (key && key.indexOf('replaceableComment') === 0) return true
  }
  return false
}

var domView = { rendered: false }
var containers = document.querySelectorAll('[data-view-name="feed-full-update"]')
for (var i = 0; i < containers.length; i++) {
  var text = (containers[i].innerText || '').replace(/\s+/g, ' ')
  if (text.indexOf('Aqil Awan') === -1) continue
  var buttons = containers[i].querySelectorAll('button[data-view-name="reaction-button"]')
  for (var j = 0; j < buttons.length; j++) {
    if (insideAComment(buttons[j])) continue
    var label = buttons[j].getAttribute('aria-label') || ''
    domView = {
      rendered: true,
      buttonLabel: label,
      // "no reaction" means it is NOT liked; anything else means it is.
      showsAReaction: !/no reaction/i.test(label),
      preview: text.slice(0, 120),
    }
    break
  }
  break
}

return {
  activityId: ACTIVITY_ID,
  href: location.href,
  api: apiView,
  dom: domView,
  verdict: domView.rendered
    ? (domView.showsAReaction
      ? 'LIKED — the reaction button on the live page shows a reaction'
      : 'NOT LIKED — the button shows "no reaction", so it did not stick')
    : (apiView.found
      ? 'the post is in the API feed but not rendered on this page; the API response alone does not say whether YOU reacted'
      : 'the post is neither rendered nor in the first 60 feed items — open its permalink to check'),
}
