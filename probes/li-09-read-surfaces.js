// @target linkedin.com
//
// READ-ONLY. Maps what else can be read beyond messaging.
//
// Every request is a GET; nothing likes, comments, connects or posts.
//
// Two kinds of entry, labelled in the output:
//   DERIVED   — built from a real urn this probe just fetched, so a failure
//               means the route is wrong, not the arguments.
//   CANDIDATE — a guessed path. A 404 is a real answer ("that route is gone"),
//               not a bug. Eight of eighteen guesses failed last time, which is
//               why anything that matters gets observed on the wire instead.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}
function enc(v) { return encodeURIComponent(String(v)).replace(/\(/g, '%28').replace(/\)/g, '%29') }

async function get(name, path, kind) {
  var t0 = Date.now()
  try {
    var r = await fetch(path, {
      credentials: 'include',
      headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0', 'x-li-lang': 'en_US' },
    })
    var text = await r.text()
    var json = null
    try { json = JSON.parse(text) } catch (e) {}
    var els = json && (json.elements || (json.data && (json.data.elements || json.data)))
    var count = Array.isArray(els) ? els.length : (els && Array.isArray(els.elements) ? els.elements.length : undefined)
    return {
      name: name, kind: kind, status: r.status, ms: Date.now() - t0, bytes: text.length,
      elementCount: count,
      topKeys: json ? Object.keys(json).slice(0, 8) : undefined,
      firstElementKeys: Array.isArray(els) && els[0] ? Object.keys(els[0]).slice(0, 18) : undefined,
      sample: json ? JSON.stringify(json).slice(0, 260) : text.slice(0, 160),
    }
  } catch (e) {
    return { name: name, kind: kind, status: 'threw', error: String(e && e.message) }
  }
}

// ── a real post to ask questions about ───────────────────────────────
var feed = await get('feedUpdates', '/voyager/api/feed/updatesV2?count=5&q=chronFeed&start=0', 'CONFIRMED')
var feedJson = null
try {
  var fr = await fetch('/voyager/api/feed/updatesV2?count=5&q=chronFeed&start=0', {
    credentials: 'include',
    headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0' },
  })
  feedJson = await fr.json()
} catch (e) {}

var post = (feedJson && feedJson.elements && feedJson.elements[0]) || null
var updateUrn = post ? (post.updateMetadata && post.updateMetadata.urn) || post.entityUrn || null : null
var activityId = null
if (updateUrn) {
  var am = /activity:(\d+)/.exec(updateUrn)
  activityId = am ? am[1] : null
}
var socialDetailUrn = post && post.socialDetail ? post.socialDetail.entityUrn || post.socialDetail.urn : null

var results = [feed]

// ── comments and reactions on that real post ─────────────────────────
if (activityId) {
  var activityUrn = 'urn:li:activity:' + activityId
  results.push(await get('comments_legacy',
    '/voyager/api/feed/comments?count=10&q=comments&sortOrder=RELEVANCE&updateId=' + enc('activity:' + activityId), 'DERIVED'))
  results.push(await get('comments_dash',
    '/voyager/api/voyagerSocialDashComments?count=10&q=comments&sortOrder=RELEVANCE&threadUrn=' + enc(activityUrn), 'DERIVED'))
  results.push(await get('reactions_dash',
    '/voyager/api/voyagerSocialDashReactions?count=10&q=reactionType&threadUrn=' + enc(activityUrn), 'DERIVED'))
  results.push(await get('socialActivityCounts',
    '/voyager/api/voyagerSocialDashSocialActivityCounts/' + enc(activityUrn), 'DERIVED'))
}

// ── my network ───────────────────────────────────────────────────────
results.push(await get('invitationsReceived', '/voyager/api/relationships/invitationViews?count=10&q=receivedInvitation&start=0', 'CONFIRMED'))
results.push(await get('invitationsSentV2', '/voyager/api/relationships/sentInvitationViewsV2?count=10&q=all&start=0', 'CANDIDATE'))
results.push(await get('invitationsSummary', '/voyager/api/voyagerRelationshipsDashInvitationsSummary', 'CANDIDATE'))
results.push(await get('invitationsDash', '/voyager/api/voyagerRelationshipsDashInvitationViews?count=10&q=receivedInvitation&start=0', 'CANDIDATE'))

// ── search ───────────────────────────────────────────────────────────
results.push(await get('searchBlended', '/voyager/api/search/blended?count=5&keywords=developer&origin=GLOBAL_SEARCH_HEADER&q=all&start=0', 'CANDIDATE'))
results.push(await get('searchClusters', '/voyager/api/search/hits?count=5&keywords=developer&origin=GLOBAL_SEARCH_HEADER&q=all&start=0', 'CANDIDATE'))
results.push(await get('typeaheadDash', '/voyager/api/voyagerSearchDashTypeahead?keywords=dev&q=globalTypeahead', 'CANDIDATE'))

// ── jobs ─────────────────────────────────────────────────────────────
results.push(await get('jobsDashCards', '/voyager/api/voyagerJobsDashJobCards?count=5&q=jobCollections&start=0', 'CANDIDATE'))
results.push(await get('jobsSavedDash', '/voyager/api/voyagerJobsDashJobSeekerSavedSearches?count=5&q=all&start=0', 'CANDIDATE'))

// ── own posts / activity ─────────────────────────────────────────────
results.push(await get('myPosts', '/voyager/api/identity/profileUpdatesV2?count=5&includeLongTermHistory=true&moduleKey=member-shares%3Aphone&numComments=0&numLikes=0&q=memberShareFeed', 'CANDIDATE'))

var ok = results.filter(function (r) { return r.status === 200 })
var dead = results.filter(function (r) { return r.status !== 200 })

return {
  href: location.href,
  postUsedForComments: { updateUrn: updateUrn, activityId: activityId, socialDetailUrn: socialDetailUrn },
  feedPostShape: post ? Object.keys(post) : null,
  working: ok.map(function (r) { return r.name + ' [' + r.kind + '] ' + r.bytes + 'b ' + (r.elementCount === undefined ? '' : r.elementCount + ' elements') }),
  failing: dead.map(function (r) { return r.name + ' [' + r.kind + '] -> ' + r.status }),
  results: results,
}
