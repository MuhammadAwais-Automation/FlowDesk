// @target linkedin.com
//
// READ-ONLY.
//
// Delete was verified against a SHARE urn (urn:li:share:...), but every read
// tool in this codebase reports an ACTIVITY id (urn:li:activity:...). If those
// two numbers are not the same, a delete tool driven by what the agent can see
// would target the wrong thing — and a wrong delete is not recoverable.
//
// The post published a few minutes ago has a known share id, so this looks for
// it among the account's own posts and compares.

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
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
  return { status: res.status, json: json, text: json ? null : text.slice(0, 200) }
}

var KNOWN_SHARE_ID = '7497263200586039296'

var me = await api('/voyager/api/me')
var found = JSON.stringify(me.json || {}).match(/ACoAA[A-Za-z0-9_-]+/)
if (!found) return { ok: false, error: 'could not read own profile id', status: me.status }
var profileUrn = 'urn:li:fsd_profile:' + found[0]

// The same call linkedin_my_posts makes.
var url = '/voyager/api/graphql?variables=(profileUrn:' + encodeURIComponent(profileUrn) +
  ',count:10,start:0)&queryId=voyagerFeedDashProfileUpdates.d2b4a5b9e3f5a2b6d5f5a5b3c1d2e3f4'

var posts = await api(url)

// The queryId above is a placeholder and will very likely 400 — what matters is
// whether the ids can be correlated at all, so the raw urns are pulled out of
// whatever comes back, including from the feed if that path fails.
var blob = JSON.stringify(posts.json || {})
var activityIds = (blob.match(/urn:li:activity:[0-9]+/g) || []).slice(0, 10)
var shareUrns = (blob.match(/urn:li:share:[0-9]+/g) || []).slice(0, 10)

return {
  knownShareId: KNOWN_SHARE_ID,
  profileUrn: profileUrn,
  myPostsStatus: posts.status,
  myPostsDetail: posts.text,
  activityIdsSeen: activityIds,
  shareUrnsSeen: shareUrns,
  // The direct question: does the published post appear under an activity id
  // carrying the same number as its share id?
  sameNumberAppearsAsActivity: activityIds.indexOf('urn:li:activity:' + KNOWN_SHARE_ID) !== -1,
}
