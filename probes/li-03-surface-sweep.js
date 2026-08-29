// @target linkedin.com
//
// READ-ONLY endpoint sweep for the parts of LinkedIn the CDP capture never
// touched, because that session only browsed messaging.
//
// Two kinds of entry below:
//   CONFIRMED — seen on the wire in probes/out/_network-linkedin-com.json.
//               A failure here means our headers or auth are wrong.
//   CANDIDATE — not yet observed. A 404 is a real answer ("that route is
//               gone"), not a bug. Anything that 200s is a route we can use
//               without needing LinkedIn's build-specific queryId hashes.
//
// Every request is a GET. Nothing here writes, likes, connects, or sends.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

async function probe(name, path, kind) {
  var t0 = Date.now()
  try {
    var r = await fetch(path, {
      credentials: 'include',
      headers: {
        'csrf-token': csrf(),
        'accept': 'application/json',
        'x-restli-protocol-version': '2.0.0',
      },
    })
    var text = await r.text()
    var json = null
    try { json = JSON.parse(text) } catch (e) {}
    // elements[] is the Rest.li collection shape; its length is the single
    // most useful signal that a route returned real data rather than an
    // empty-but-successful envelope.
    var elements = json && (json.elements || (json.data && json.data.elements))
    return {
      name: name, kind: kind, status: r.status, ms: Date.now() - t0, bytes: text.length,
      elementCount: Array.isArray(elements) ? elements.length : undefined,
      topKeys: json ? Object.keys(json).slice(0, 10) : undefined,
      firstElementKeys: Array.isArray(elements) && elements[0] ? Object.keys(elements[0]).slice(0, 20) : undefined,
      sample: json ? JSON.stringify(json).slice(0, 300) : text.slice(0, 200),
    }
  } catch (e) {
    return { name: name, kind: kind, status: 'threw', error: String(e && e.message) }
  }
}

var me = await fetch('/voyager/api/me', { credentials: 'include', headers: { 'csrf-token': csrf(), 'x-restli-protocol-version': '2.0.0' } })
var meText = await me.text()
var idMatch = meText.match(/ACoAA[A-Za-z0-9_-]+/)
var selfId = idMatch ? idMatch[0] : null
var selfUrn = selfId ? 'urn:li:fsd_profile:' + selfId : null

var targets = [
  // ── confirmed on the wire ──
  ['notifications', '/voyager/api/voyagerIdentityDashNotificationCards?decorationId=com.linkedin.voyager.dash.deco.identity.notifications.CardsCollection-80&count=10&filterUrn=' + encodeURIComponent('urn:li:fsd_notificationFilter:ALL') + '&q=notifications&start=0', 'CONFIRMED'],
  ['notificationFilters', '/voyager/api/voyagerNotificationsDashPill?decorationId=com.linkedin.voyager.dash.deco.notifications.FullNotificationPillsCollection-4&q=filterVanityName', 'CONFIRMED'],
  ['globalAlerts', '/voyager/api/voyagerGlobalAlerts?adHocAlerts=true&alertWithActions=true&q=findAlerts', 'CONFIRMED'],
  ['secondaryInbox', '/voyager/api/voyagerMessagingDashSecondaryInbox?q=previewBanner', 'CONFIRMED'],
  ['emailHandles', '/voyager/api/voyagerOnboardingDashMemberHandles?primary=true&q=criteria&type=EMAIL', 'CONFIRMED'],

  // ── my network ──
  ['invitationsReceived', '/voyager/api/relationships/invitationViews?count=20&q=receivedInvitation&start=0', 'CANDIDATE'],
  ['invitationsSent', '/voyager/api/relationships/sentInvitationViews?count=20&q=all&start=0', 'CANDIDATE'],
  ['invitationsDash', '/voyager/api/voyagerRelationshipsDashInvitations?count=20&q=receivedInvitation&start=0', 'CANDIDATE'],
  ['invitationCount', '/voyager/api/relationships/invitationsSummary?q=invitationSummary', 'CANDIDATE'],
  ['connections', '/voyager/api/relationships/connections?count=20&q=viewer&sortType=RECENTLY_ADDED&start=0', 'CANDIDATE'],
  ['connectionsDash', '/voyager/api/voyagerRelationshipsDashConnections?count=20&q=search&sortType=RECENTLY_ADDED&start=0', 'CANDIDATE'],

  // ── feed ──
  ['feedUpdates', '/voyager/api/feed/updatesV2?count=10&q=chronFeed&start=0', 'CANDIDATE'],
  ['feedDash', '/voyager/api/voyagerFeedDashMainFeedUpdates?count=10&q=feed&start=0', 'CANDIDATE'],

  // ── jobs ──
  ['jobsSaved', '/voyager/api/voyagerJobsDashJobSeekerSavedJobs?count=10&q=savedJobs&start=0', 'CANDIDATE'],
  ['jobApplications', '/voyager/api/voyagerJobsDashJobSeekerJobApplications?count=10&q=jobSeeker&start=0', 'CANDIDATE'],

  // ── search ──
  ['searchTypeahead', '/voyager/api/typeahead/hitsV2?keywords=a&origin=GLOBAL_SEARCH_HEADER&q=blended&queryContext=List(geoVersion-%3E3)', 'CANDIDATE'],
]

if (selfUrn) {
  targets.push(['ownProfileFull', '/voyager/api/identity/dash/profiles/' + encodeURIComponent(selfUrn) + '?decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfile-76', 'CONFIRMED'])
}

var results = []
for (var i = 0; i < targets.length; i++) {
  results.push(await probe(targets[i][0], targets[i][1], targets[i][2]))
}

var ok = results.filter(function (r) { return r.status === 200 })
var dead = results.filter(function (r) { return r.status !== 200 })

return {
  href: location.href,
  selfUrn: selfUrn,
  summary: {
    working: ok.map(function (r) { return r.name + ' (' + r.bytes + 'b, ' + (r.elementCount === undefined ? 'no elements[]' : r.elementCount + ' elements') + ')' }),
    failing: dead.map(function (r) { return r.name + ' -> ' + r.status }),
  },
  results: results,
}
