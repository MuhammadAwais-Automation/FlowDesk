// @target linkedin.com
// READ-ONLY. Every request here is a GET. No invitation is sent, accepted or
// withdrawn.
//
// The capture already showed these work and return plain JSON:
//   relationships/connectionsSummary   -> numConnections
//   relationships/invitationsSummary   -> numPendingInvitations, numNewInvitations
//   relationships/invitationViews      -> q=receivedInvitation lists them
//
// What is still unknown, and is what this asks:
//   1. Which query lists the invitations the user has SENT.
//   2. Whether anything reports the weekly invite allowance — how many are
//      left before LinkedIn starts refusing.
//
// (2) matters more than it looks. LinkedIn caps invites per week and penalises
// accounts that keep hitting the wall, so a tool that can send without being
// able to see the remaining allowance is one that can quietly damage the
// account it is meant to help. If no such endpoint exists, that is worth
// knowing before building the send, not after.
function csrf(){var m=document.cookie.match(/JSESSIONID="?([^";]+)"?/);return m?m[1]:null}
async function api(url) {
  var r = await fetch(url, {
    credentials: 'include',
    headers: {
      'csrf-token': csrf(),
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
    },
  })
  var t = await r.text()
  var j = null
  try { j = JSON.parse(t) } catch (e) {}
  return { status: r.status, json: j, raw: t }
}

var routes = [
  // Known-good baseline, so a total failure is distinguishable from a bad guess.
  { name: 'connectionsSummary (known good)', url: '/voyager/api/relationships/connectionsSummary' },
  { name: 'invitationsSummary (known good)', url: '/voyager/api/relationships/invitationsSummary' },

  // SENT invitations — which query name does this build use?
  { name: 'invitationViews q=sentInvitation', url: '/voyager/api/relationships/invitationViews?q=sentInvitation&start=0&count=5' },
  { name: 'invitationViews q=sentInvitations', url: '/voyager/api/relationships/invitationViews?q=sentInvitations&start=0&count=5' },
  { name: 'invitationViews q=invitation&type=SENT', url: '/voyager/api/relationships/invitationViews?q=invitation&invitationType=SENT&start=0&count=5' },
  { name: 'growth/normInvitations q=sent', url: '/voyager/api/growth/normInvitations?q=sent&start=0&count=5' },

  // The allowance.
  { name: 'growth/invitationLimits', url: '/voyager/api/growth/invitationLimits' },
  { name: 'growth/invitationsQuota', url: '/voyager/api/growth/invitationsQuota' },
  { name: 'relationships/invitationLimit', url: '/voyager/api/relationships/invitationLimit' },
  { name: 'voyagerRelationshipsDashInvitationLimits', url: '/voyager/api/voyagerRelationshipsDashInvitationLimits' },
  { name: 'growth/normInvitations?action=verifyQuota', url: '/voyager/api/growth/normInvitations?action=verifyQuotaNullable' },
]

var results = []
for (var i = 0; i < routes.length; i++) {
  var r = await api(routes[i].url)
  var blob = r.raw || ''
  var data = (r.json && r.json.data) || r.json || {}
  results.push({
    name: routes[i].name,
    status: r.status,
    // Described, not dumped: an invitation list is other people's names and
    // does not belong in a probe file committed to disk.
    elementCount: (data.elements && data.elements.length) != null ? data.elements.length : null,
    total: (data.paging && data.paging.total) != null ? data.paging.total : null,
    dataKeys: r.json && r.json.data ? Object.keys(r.json.data).slice(0, 14) : null,
    // Any number sitting next to a limit-ish word is what an allowance looks
    // like; reported as found rather than assumed into a fixed field.
    limitish: (blob.match(/"[a-zA-Z]*([Ll]imit|[Qq]uota|[Rr]emaining)[a-zA-Z]*":[0-9]+/g) || []).slice(0, 8),
    preview: r.status !== 200 ? blob.slice(0, 120) : null,
  })
}

return { href: location.href, routes: results }

// run 1787534121
