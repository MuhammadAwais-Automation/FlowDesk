// @target linkedin.com
//
// READ-ONLY. Nothing is deleted.
//
// The problem this solves, and it is a real one: delete was verified against
// urn:li:share:7497263200586039296, but linkedin_my_posts reports that same
// post as activity 7497263203417169921. Different numbers. So an agent that can
// only see activity ids cannot be handed a delete tool that needs share urns —
// and guessing at the mapping is not acceptable when the operation is a
// permanent delete.
//
// This looks for a read that returns both for a post the account owns.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

function enc(v) {
  return encodeURIComponent(String(v)).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

async function api(url) {
  var res = await fetch(url, {
    credentials: 'include',
    headers: {
      'csrf-token': csrf(),
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
    },
  })
  var text = await res.text()
  var json = null
  try { json = JSON.parse(text) } catch (e) {}
  return { status: res.status, json: json, raw: text }
}

var ACTIVITY = '7497263203417169921'
var EXPECTED_SHARE = 'urn:li:share:7497263200586039296'

var routes = [
  { name: 'feed/updatesV2 by activity', url: '/voyager/api/feed/updatesV2/' + enc('urn:li:activity:' + ACTIVITY) },
  { name: 'contentcreation/normShares by activity', url: '/voyager/api/contentcreation/normShares/' + enc('urn:li:activity:' + ACTIVITY) },
  { name: 'contentcreation/shareDetails by activity', url: '/voyager/api/contentcreation/shareDetails/' + enc('urn:li:activity:' + ACTIVITY) },
  { name: 'feed/updates by activity', url: '/voyager/api/feed/updates/' + enc('urn:li:activity:' + ACTIVITY) },
]

var results = []
for (var i = 0; i < routes.length; i++) {
  var r = await api(routes[i].url)
  var shares = (r.raw.match(/urn:li:share:[0-9]+/g) || [])
  var unique = []
  for (var j = 0; j < shares.length; j++) if (unique.indexOf(shares[j]) === -1) unique.push(shares[j])
  results.push({
    name: routes[i].name,
    status: r.status,
    shareUrnsFound: unique.slice(0, 5),
    // The check that matters: not just that a share urn appeared, but that it is
    // the RIGHT one. A route returning some other post's urn would be worse than
    // one returning nothing.
    matchesExpected: unique.indexOf(EXPECTED_SHARE) !== -1,
    preview: r.status !== 200 ? r.raw.slice(0, 150) : null,
  })
}

return { activity: ACTIVITY, expectedShare: EXPECTED_SHARE, routes: results }
