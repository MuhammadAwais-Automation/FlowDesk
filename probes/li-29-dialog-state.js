// @target linkedin.com
//
// READ-ONLY. Nothing is clicked, nothing is closed.
//
// li-28 clicked the trigger, then found a [role="dialog"] that contained no
// buttons, no editor and no tagged elements — and reported the dialog still
// present after Escape. Two readings fit that: the composer renders somewhere
// other than the element matched, or the element matched was an empty dialog
// that was already on the page before the click and has nothing to do with the
// composer.
//
// Guessing between them is how the last two anchors went wrong. This just
// looks at what is on the page right now.

function outline(el, depth) {
  return {
    tag: el.tagName.toLowerCase(),
    viewName: el.getAttribute('data-view-name'),
    label: (el.getAttribute('aria-label') || '').slice(0, 60),
    open: el.hasAttribute('open') ? true : null,
    childElements: el.children.length,
    buttons: el.querySelectorAll('button').length,
    editors: el.querySelectorAll('[contenteditable="true"]').length,
    rect: (function () {
      try { var r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) } catch (e) { return null }
    })(),
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
  }
}

var dialogs = []
var found = document.querySelectorAll('[role="dialog"], dialog')
for (var i = 0; i < found.length && i < 10; i++) dialogs.push(outline(found[i]))

// Every editable box on the page, wherever it lives. If the composer opened,
// its editor is in here even if no dialog wraps it.
var editors = []
var eds = document.querySelectorAll('[contenteditable="true"]')
for (var i = 0; i < eds.length && i < 10; i++) {
  var e = eds[i]
  editors.push({
    label: e.getAttribute('aria-label'),
    placeholder: e.getAttribute('data-placeholder'),
    viewName: e.getAttribute('data-view-name'),
    role: e.getAttribute('role'),
    visible: !!(e.offsetParent || e.getClientRects().length),
    text: (e.innerText || '').slice(0, 40),
    // Where it sits, so a composer editor can be told apart from the comment
    // box on some post further down the feed.
    ancestry: (function () {
      var names = []
      for (var n = e; n && n !== document.body && names.length < 12; n = n.parentElement) {
        var v = n.getAttribute && n.getAttribute('data-view-name')
        if (v) names.push(v)
      }
      return names
    })(),
  })
}

// Anything that reads like the composer, by tag name, wherever it is.
var shareish = []
var tagged = document.querySelectorAll('[data-view-name]')
for (var i = 0; i < tagged.length; i++) {
  var v = tagged[i].getAttribute('data-view-name') || ''
  if (/share|editor|composer|creation|modal/i.test(v)) shareish.push(v)
}
var counts = {}
for (var i = 0; i < shareish.length; i++) counts[shareish[i]] = (counts[shareish[i]] || 0) + 1

return {
  href: location.href,
  dialogs: dialogs,
  editors: editors,
  shareRelatedViewNames: Object.keys(counts).sort().map(function (k) { return k + ' x' + counts[k] }),
  bodyOverflowHidden: getComputedStyle(document.body).overflow === 'hidden',
}
