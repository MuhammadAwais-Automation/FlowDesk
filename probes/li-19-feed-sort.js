// @target linkedin.com
//
// READ-ONLY.
//
// The user's screen shows "Sort by: Top" while the API call asked for
// q=chronFeed — chronological. Different orderings return different posts, which
// is why a post plainly visible on screen was absent from the tool's output.
//
// This checks two things rather than assuming either: which q values the
// endpoint actually accepts, and whether the specific post the user is looking
// at appears in any of them.

var LOOKING_FOR = 'Sadik Mohammad'   // the post visible on the user's screen

function csrf() {
  var m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
  return m ? m[1] : null
}

async function feed(q) {
  var t0 = Date.now()
  try {
    var r = await fetch('/voyager/api/feed/updatesV2?count=20&q=' + encodeURIComponent(q) + '&start=0', {
      credentials: 'include',
      headers: { 'csrf-token': csrf(), 'accept': 'application/json', 'x-restli-protocol-version': '2.0.0' },
    })
    var text = await r.text()
    var json = null
    try { json = JSON.parse(text) } catch (e) {}
    var elements = (json && json.elements) || []
    var authors = elements.map(function (p) {
      var a = p.actor || {}
      return (a.name && (a.name.text || a.name)) || null
    }).filter(Boolean)
    return {
      q: q,
      status: r.status,
      ms: Date.now() - t0,
      posts: elements.length,
      containsTarget: authors.some(function (n) { return n.indexOf(LOOKING_FOR) !== -1 }),
      firstFive: authors.slice(0, 5),
    }
  } catch (e) {
    return { q: q, status: 'threw', error: String(e && e.message) }
  }
}

// chronFeed is the one already known to work; the rest are the plausible
// alternatives for a relevance-ordered feed. A 400 here means "wrong argument,
// route is fine"; a 404 would mean the route itself is gone.
var results = []
var candidates = ['chronFeed', 'feed', 'relevanceFeed', 'topFeed', 'mainFeed']
for (var i = 0; i < candidates.length; i++) {
  results.push(await feed(candidates[i]))
}

var working = results.filter(function (r) { return r.status === 200 })

return {
  lookingFor: LOOKING_FOR,
  results: results,
  // The point of the whole probe: is the post the user can see reachable at all
  // through this endpoint, under any ordering?
  foundUnder: working.filter(function (r) { return r.containsTarget }).map(function (r) { return r.q }),
  workingSorts: working.map(function (r) { return r.q }),
  note: 'a 400 means the argument is wrong but the route is alive; a 404 would mean the route is gone',
}
