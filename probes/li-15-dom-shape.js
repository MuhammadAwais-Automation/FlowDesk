// @target linkedin.com
//
// READ-ONLY. Nothing is clicked.
//
// The first UI attempt looked for posts by data-urn / data-id and found zero
// such elements: LinkedIn's rebuilt feed does not tag posts that way any more.
// Rather than guess another attribute, this walks up from the Like buttons
// themselves — those definitely exist — and reports what identifies the post
// they belong to.

function attrsOf(el) {
  var out = {}
  if (!el || !el.attributes) return out
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i]
    // Class names here are build-generated hashes; they change every deploy and
    // are worthless as anchors, so they are skipped to keep the output readable.
    if (a.name === 'class' || a.name === 'style') continue
    out[a.name] = String(a.value).slice(0, 90)
  }
  return out
}

// Buttons that identify themselves as a reaction control, found by accessible
// label rather than class — labels are stable because assistive tech needs them.
var likeButtons = []
var buttons = document.querySelectorAll('button')
for (var i = 0; i < buttons.length && likeButtons.length < 5; i++) {
  var b = buttons[i]
  var label = (b.getAttribute('aria-label') || '').trim()
  var textLabel = (b.innerText || '').trim()
  if (!/\blike\b/i.test(label) && !/^like$/i.test(textLabel)) continue
  likeButtons.push({ el: b, label: label || textLabel })
}

var reports = likeButtons.map(function (entry) {
  var chain = []
  var node = entry.el
  // Ten levels is enough to reach the post container without dumping the page.
  for (var depth = 0; depth < 10 && node && node !== document.body; depth++) {
    var attrs = attrsOf(node)
    var interesting = Object.keys(attrs).filter(function (k) {
      return k !== 'tabindex' && k !== 'type' && k !== 'role'
    })
    chain.push({
      depth: depth,
      tag: node.tagName.toLowerCase(),
      attrs: interesting.length ? attrs : null,
      // Anything urn-shaped anywhere in this element's own attributes is the
      // thing worth finding.
      urnLike: (function () {
        var joined = Object.keys(attrs).map(function (k) { return attrs[k] }).join(' ')
        var m = joined.match(/urn:li:[a-zA-Z_]+:[^\s"']{4,60}/)
        return m ? m[0] : null
      })(),
    })
    node = node.parentElement
  }
  return {
    buttonLabel: entry.label,
    ariaPressed: entry.el.getAttribute('aria-pressed'),
    buttonAttrs: attrsOf(entry.el),
    ancestors: chain,
  }
})

// Second angle: does any element anywhere carry an activity urn in an attribute?
var urnCarriers = []
var all = document.querySelectorAll('*')
for (var i = 0; i < all.length && urnCarriers.length < 10; i++) {
  var el = all[i]
  if (!el.attributes || !el.attributes.length) continue
  for (var j = 0; j < el.attributes.length; j++) {
    var a = el.attributes[j]
    if (a.name === 'class' || a.name === 'style') continue
    if (String(a.value).indexOf('urn:li:activity') === -1) continue
    urnCarriers.push({ tag: el.tagName.toLowerCase(), attr: a.name, value: String(a.value).slice(0, 90) })
    break
  }
}

// Third angle: permalinks. Every post links to itself somewhere, and that href
// carries the activity id even when no attribute does.
var permalinks = []
var links = document.querySelectorAll('a[href*="/feed/update/"]')
for (var i = 0; i < links.length && permalinks.length < 6; i++) {
  permalinks.push(links[i].getAttribute('href').slice(0, 110))
}

return {
  href: location.href,
  totalButtons: buttons.length,
  likeButtonsFound: likeButtons.length,
  reports: reports,
  elementsCarryingAnActivityUrn: urnCarriers,
  postPermalinksOnPage: permalinks,
}
