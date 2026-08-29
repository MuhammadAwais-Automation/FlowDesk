// @target linkedin.com
//
// READ-ONLY. Nothing is clicked, no composer is opened.
//
// First question for posting: what opens the composer, and is it on the feed
// page at all. The comment work taught the lesson this probe is built around —
// /feed/ and /feed/update/<id>/ are different component trees, and an anchor
// read on one is not evidence about the other. So this reports which page it
// actually ran on, first, before anything else is worth reading.
//
// Also worth knowing early: the feed page IS richly tagged with data-view-name
// (unlike a permalink), so anchors here may be attribute-based rather than
// aria-label based. Which of the two is available decides how the tool is
// written, so both are reported rather than one being assumed.

function describe(el) {
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').replace(/[ ]+/g, ' ').trim().slice(0, 40),
    label: (el.getAttribute('aria-label') || '').slice(0, 60),
    viewName: el.getAttribute('data-view-name'),
    placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || null,
    visible: !!(el.offsetParent || el.getClientRects().length),
  }
}

var pathname = location.pathname

// Everything that looks like it starts a post, by any of the three things it
// could be: a button, a tagged element, or a text box acting as a trigger.
var candidates = []
var all = document.querySelectorAll('button, [data-view-name], [role="textbox"], [contenteditable="true"]')
for (var i = 0; i < all.length; i++) {
  var el = all[i]
  var hay = (
    (el.innerText || '') + ' ' +
    (el.getAttribute('aria-label') || '') + ' ' +
    (el.getAttribute('data-view-name') || '') + ' ' +
    (el.getAttribute('data-placeholder') || '')
  ).toLowerCase()
  if (/start a post|share|post|write|create/.test(hay)) {
    candidates.push(describe(el))
    if (candidates.length >= 30) break
  }
}

// The page's whole tagged vocabulary, filtered to what could plausibly relate
// to composing. Cheaper to read than a full dump and it is where the real
// anchor name will be if there is one.
var viewNames = {}
var tagged = document.querySelectorAll('[data-view-name]')
for (var i = 0; i < tagged.length; i++) {
  var v = tagged[i].getAttribute('data-view-name')
  if (v) viewNames[v] = (viewNames[v] || 0) + 1
}
var composerish = []
for (var name in viewNames) {
  if (/share|post|create|editor|composer|box/i.test(name)) composerish.push(name + ' x' + viewNames[name])
}

return {
  href: location.href,
  // If this is not the feed, everything below describes some other page and
  // the probe needs re-aiming rather than interpreting.
  isFeed: pathname === '/feed/' || pathname === '/feed',
  pathname: pathname,
  documentReadyState: document.readyState,
  totalTaggedElements: tagged.length,
  composerRelatedViewNames: composerish.sort(),
  candidates: candidates,
}
