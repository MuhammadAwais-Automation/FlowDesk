// @target linkedin.com
//
// READ-ONLY. Nothing is clicked.
//
// Lists the posts actually rendered on the page right now, each with its
// activity id and the state of its reaction button, so a like can be aimed at a
// post the user has seen and named — rather than at whatever happens to be on
// screen when a click fires.
//
// Anchors used, all found by walking up from real reaction buttons (probe
// li-15) rather than guessed:
//   post container   div[data-view-name="feed-full-update"]
//   post identity    span[data-sdui-anchor-id="feed-header-urn:li:activity:<id>-0"]
//   reaction button  button[data-view-name="reaction-button"]
//                    aria-label carries the state in words
// None of these are class names, which LinkedIn regenerates every deploy.

var containers = document.querySelectorAll('[data-view-name="feed-full-update"]')

function activityIdIn(root) {
  var anchors = root.querySelectorAll('[data-sdui-anchor-id]')
  for (var i = 0; i < anchors.length; i++) {
    var v = anchors[i].getAttribute('data-sdui-anchor-id') || ''
    var m = /urn:li:activity:([0-9]+)/.exec(v)
    if (m) return m[1]
  }
  return null
}

function firstText(root, selector, max) {
  var el = root.querySelector(selector)
  if (!el) return null
  var t = (el.innerText || '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max || 120) : null
}

var posts = []
for (var i = 0; i < containers.length; i++) {
  var c = containers[i]
  var button = c.querySelector('button[data-view-name="reaction-button"]')
  var label = button ? (button.getAttribute('aria-label') || '') : null
  var text = (c.innerText || '').replace(/\s+/g, ' ').trim()

  posts.push({
    index: i + 1,
    activityId: activityIdIn(c),
    // The button says its own state in words; "no reaction" means a click would
    // like it, anything else means a click would REMOVE an existing reaction.
    reactionState: label,
    alreadyReacted: label ? !/no reaction/i.test(label) : null,
    hasReactionButton: !!button,
    author: firstText(c, '[data-view-name="feed-actor-name"], a[href*="/in/"]', 60),
    preview: text.slice(0, 160),
  })
}

return {
  href: location.href,
  renderedPosts: posts.length,
  // Only a handful are ever in the DOM at once: LinkedIn discards posts that
  // scroll out, so a post read from the API minutes ago is usually not here.
  note: 'LinkedIn keeps only the posts near the viewport in the DOM; anything scrolled past is gone',
  posts: posts,
}
