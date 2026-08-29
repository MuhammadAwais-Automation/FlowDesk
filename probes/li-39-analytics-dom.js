// @target linkedin.com
//
// READ-ONLY.
//
// The analytics route turned out to be /flagship-web/..., which is the
// Server-Driven UI stack rather than the voyager REST/GraphQL one — the same
// stack that made liking and commenting unreplayable. So before assuming an API
// exists, this reads what the page actually renders.
//
// If the numbers are in the DOM, a read tool can be built on that; SDUI pages
// are a poor thing to bind to, but reading rendered text is far safer than
// clicking rendered controls.

function scan(doc, where) {
  var out = { where: where }
  try {
    var text = (doc.body && doc.body.innerText || '').replace(/\s+/g, ' ')
    out.textHead = text.slice(0, 700)
    out.mentionsImpressions = /impression/i.test(text)
    var counts = {}
    var tagged = doc.querySelectorAll('[data-view-name]')
    for (var i = 0; i < tagged.length; i++) {
      var v = tagged[i].getAttribute('data-view-name')
      if (v && /analytic|insight|impress|metric|card|chart|surface/i.test(v)) counts[v] = (counts[v] || 0) + 1
    }
    out.analyticsViewNames = Object.keys(counts).sort().map(function (k) { return k + ' x' + counts[k] })
    out.totalTagged = tagged.length
  } catch (e) { out.error = String((e && e.message) || e) }
  return out
}

var scans = [scan(document, 'top')]
var frames = document.querySelectorAll('iframe')
for (var i = 0; i < frames.length; i++) {
  try {
    var doc = frames[i].contentDocument
    if (doc) scans.push(scan(doc, 'iframe:' + String(frames[i].getAttribute('src') || '').slice(0, 40)))
  } catch (e) {}
}

return { href: location.href, scans: scans }
