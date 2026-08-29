// @target linkedin.com
// READ-ONLY. The comments route answered 200 with an empty collection, which
// proves it is alive but not that it works — the post it was asked about had
// no comments. This picks a post that demonstrably HAS comments, so an empty
// result can no longer be mistaken for a working one.
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
  return { status: r.status, bytes: t.length, json: j, raw: j ? null : t.slice(0, 200) }
}

var feed = await get('/voyager/api/feed/updatesV2?count=20&q=chronFeed&start=0')
var posts = (feed.json && feed.json.elements) || []

var withComments = []
for (var i = 0; i < posts.length; i++) {
  var p = posts[i]
  var sd = p.socialDetail || {}
  var counts = sd.totalSocialActivityCounts || {}
  var n = counts.numComments || 0
  var urn = (p.updateMetadata && p.updateMetadata.urn) || p.entityUrn || ''
  var id = (/activity:(\d+)/.exec(urn) || [])[1]
  if (n > 0 && id) {
    withComments.push({
      activityId: id,
      numComments: n,
      numLikes: counts.numLikes || (counts.reactionTypeCounts || []).length,
      author: (p.actor && p.actor.name && p.actor.name.text) || null,
      preview: (p.commentary && p.commentary.text && p.commentary.text.text || '').slice(0, 80),
    })
  }
}

if (!withComments.length) {
  return {
    scannedPosts: posts.length,
    note: 'no post in the current feed page has comments — cannot verify the shape, only that the route answers',
    postShapeSample: posts[0] ? Object.keys(posts[0]) : null,
    socialDetailSample: posts[0] && posts[0].socialDetail ? Object.keys(posts[0].socialDetail) : null,
  }
}

var target = withComments[0]
var res = await get('/voyager/api/feed/comments?count=10&q=comments&sortOrder=RELEVANCE&updateId=' + enc('activity:' + target.activityId))
var els = (res.json && res.json.elements) || []

return {
  scannedPosts: posts.length,
  postsWithComments: withComments.length,
  target: target,
  commentsCall: {
    status: res.status,
    bytes: res.bytes,
    returned: els.length,
    firstCommentKeys: els[0] ? Object.keys(els[0]) : null,
  },
  comments: els.slice(0, 3).map(function (c) {
    var commenter = c.commenter || {}
    var mini = commenter.miniProfile || (commenter.com && commenter.com.linkedin) || {}
    return {
      author: [mini.firstName, mini.lastName].filter(Boolean).join(' ') || commenter.title || null,
      text: (c.comment && c.comment.values && c.comment.values[0] && c.comment.values[0].value) || (c.commentV2 && c.commentV2.text) || null,
      createdAt: c.createdTime || null,
      likes: (c.socialDetail && c.socialDetail.totalSocialActivityCounts && c.socialDetail.totalSocialActivityCounts.numLikes) || 0,
    }
  }),
}
