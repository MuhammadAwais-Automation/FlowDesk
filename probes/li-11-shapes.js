// @target linkedin.com
// READ-ONLY. Dumps the field paths of the three responses whose shape is not
// yet known, so the tools can read verified paths instead of guessed ones.
// A guessed path already produced `author: null` on every comment while the
// data sat right there under a different key.
function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}
function enc(v) { return encodeURIComponent(String(v)).replace(/\(/g, '%28').replace(/\)/g, '%29') }
async function get(path) {
  var r = await fetch(path, {
    credentials: 'include',
    headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0' },
  })
  var t = await r.text()
  var j = null
  try { j = JSON.parse(t) } catch (e) {}
  return { status: r.status, bytes: t.length, json: j }
}
// Walks an object and returns "a.b.c = value" for scalar leaves, so the real
// path to a name or a piece of text is visible rather than inferred.
function paths(v, prefix, out, depth) {
  out = out || []; prefix = prefix || ''; depth = depth || 0
  if (out.length > 90 || depth > 7 || v === null || v === undefined) return out
  if (typeof v !== 'object') {
    var s = String(v)
    if (s && s !== 'false' && s.length < 90) out.push(prefix + ' = ' + s.slice(0, 70))
    return out
  }
  if (Array.isArray(v)) { if (v.length) paths(v[0], prefix + '[0]', out, depth + 1); return out }
  Object.keys(v).forEach(function (k) {
    if (k.charAt(0) === '$' || k === '_type' || k === '_recipeType') return
    paths(v[k], prefix ? prefix + '.' + k : k, out, depth + 1)
  })
  return out
}

var me = await get('/voyager/api/me')
var self = 'urn:li:fsd_profile:' + JSON.stringify(me.json).match(/ACoAA[A-Za-z0-9_-]+/)[0]

// ── comments: find a post that has some ──
var feed = await get('/voyager/api/feed/updatesV2?count=20&q=chronFeed&start=0')
var posts = (feed.json && feed.json.elements) || []
var target = null
for (var i = 0; i < posts.length; i++) {
  var counts = (posts[i].socialDetail && posts[i].socialDetail.totalSocialActivityCounts) || {}
  var urn = (posts[i].updateMetadata && posts[i].updateMetadata.urn) || ''
  var id = (/activity:(\d+)/.exec(urn) || [])[1]
  if ((counts.numComments || 0) > 0 && id) { target = id; break }
}
var comments = target
  ? await get('/voyager/api/feed/comments?count=5&q=comments&sortOrder=RELEVANCE&updateId=' + enc('activity:' + target))
  : { json: null }

// ── search ──
var searchVars = '(start:0,origin:GLOBAL_SEARCH_HEADER,query:(keywords:developer,flagshipSearchIntent:SEARCH_SRP,'
  + 'queryParameters:List((key:resultType,value:List(ALL))),includeFiltersInResponse:false,spellCorrectionEnabled:false))'
var search = await get('/voyager/api/graphql?includeWebMetadata=true&variables=' + searchVars
  + '&queryId=voyagerSearchDashClusters.a7a0567fa66c52d645b5ff2f960b92aa')

// ── own posts ──
var mine = await get('/voyager/api/graphql?includeWebMetadata=true&variables=(count:5,start:0,profileUrn:'
  + enc(self) + ')&queryId=voyagerFeedDashProfileUpdates.20c70fe0314184158516a7ec004c0408')

function firstElement(j) {
  if (!j) return null
  if (Array.isArray(j.elements)) return j.elements[0]
  var d = j.data
  if (!d) return null
  var key = Object.keys(d).filter(function (k) { return d[k] && (d[k].elements || Array.isArray(d[k])) })[0]
  if (!key) return { __dataKeys: Object.keys(d) }
  var block = d[key]
  return Array.isArray(block) ? block[0] : (block.elements || [])[0]
}

return {
  comments: {
    status: comments.status, bytes: comments.bytes,
    activityUsed: target,
    firstCommentPaths: paths(firstElement(comments.json)),
  },
  search: {
    status: search.status, bytes: search.bytes,
    dataKeys: search.json && search.json.data ? Object.keys(search.json.data) : null,
    firstElementPaths: paths(firstElement(search.json)),
  },
  myPosts: {
    status: mine.status, bytes: mine.bytes,
    dataKeys: mine.json && mine.json.data ? Object.keys(mine.json.data) : null,
    firstElementPaths: paths(firstElement(mine.json)),
  },
  feedPost: { firstPostPaths: paths(posts[0]) },
}
