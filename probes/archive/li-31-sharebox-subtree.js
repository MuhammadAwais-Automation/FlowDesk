// @target linkedin.com
//
// READ-ONLY. Nothing is clicked.
//
// li-30 settled that the composer never opened: no overlay, no input, and none
// of the composer's own wording anywhere in the page text. So `element.click()`
// on the share-sharebox-focus div did nothing.
//
// That is worth knowing precisely rather than working around. `.click()` fires
// a click event but no pointer sequence, and React handlers bound to
// mousedown/pointerdown never see it. It is also possible the div is only a
// wrapper and the real control is a child button or an anchor with an href
// that would navigate instead.
//
// This reads the subtree so the next step is aimed rather than tried.

function describe(el, depth) {
  var rect = el.getBoundingClientRect()
  var attrs = {}
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i]
    if (a.name === 'style') continue
    attrs[a.name] = String(a.value).slice(0, 60)
  }
  return {
    depth: depth,
    tag: el.tagName.toLowerCase(),
    attrs: attrs,
    rect: Math.round(rect.width) + 'x' + Math.round(rect.height),
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    childElements: el.children.length,
  }
}

var root = document.querySelector('[data-view-name="share-sharebox-focus"]')
if (!root) return { ok: false, error: 'share-sharebox-focus is gone from this page', href: location.href }

// The whole subtree, small enough to read in full.
var subtree = []
;(function walk(el, depth) {
  subtree.push(describe(el, depth))
  if (subtree.length > 40 || depth > 5) return
  for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1)
})(root, 0)

// And upward, because the clickable thing may be an ancestor that wraps this
// label rather than anything inside it.
var ancestors = []
for (var n = root.parentElement, d = 1; n && n !== document.body && d <= 5; n = n.parentElement, d++) {
  ancestors.push(describe(n, -d))
}

return {
  ok: true,
  href: location.href,
  // Which of these exist decides how the control has to be driven: a real
  // button can be clicked, an anchor should be navigated, and a bare div needs
  // a full pointer sequence.
  interactive: {
    buttonsInside: root.querySelectorAll('button').length,
    anchorsInside: root.querySelectorAll('a[href]').length,
    ownRole: root.getAttribute('role'),
    ownTabIndex: root.getAttribute('tabindex'),
    nearestButtonAncestor: (function () {
      for (var n = root; n && n !== document.body; n = n.parentElement) {
        if (n.tagName === 'BUTTON' || n.getAttribute('role') === 'button') return n.tagName.toLowerCase() + (n.getAttribute('role') ? '[role=button]' : '')
      }
      return null
    })(),
  },
  subtree: subtree,
  ancestors: ancestors,
}
