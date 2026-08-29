// @target linkedin.com/feed/update
//
// READ-ONLY. Nothing is clicked.
//
// Targets a POST PERMALINK page specifically, not the feed.
//
// The like and comment tools were built on anchors read off /feed/ and then
// pointed at /feed/update/<id>/ without anyone checking that the same
// components render there. Both failed with reactionButtonsSeen: 0 — which is
// not "the page did not load", it is "the page loaded and does not contain the
// thing we were looking for".
//
// This reports what a permalink page actually contains, so the tools can be
// fixed against the real structure rather than a second assumption.

function attrs(el) {
  var out = {}
  if (!el || !el.attributes) return out
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i]
    if (a.name === 'class' || a.name === 'style') continue
    out[a.name] = String(a.value).slice(0, 70)
  }
  return out
}

// The full vocabulary this page uses, which is the fastest way to see whether
// the naming differs from the feed rather than the components being absent.
var viewNames = {}
var tagged = document.querySelectorAll('[data-view-name]')
for (var i = 0; i < tagged.length; i++) {
  var v = tagged[i].getAttribute('data-view-name')
  if (v) viewNames[v] = (viewNames[v] || 0) + 1
}

// Every button, by whatever it calls itself — so a renamed reaction control is
// still visible here.
var buttons = []
var all = document.querySelectorAll('button')
for (var i = 0; i < all.length && buttons.length < 30; i++) {
  var b = all[i]
  buttons.push({
    text: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    label: (b.getAttribute('aria-label') || '').slice(0, 55),
    viewName: b.getAttribute('data-view-name'),
    visible: !!(b.offsetParent || b.getClientRects().length),
  })
}

var reactionish = buttons.filter(function (b) {
  return /reaction|like|celebrate|support/i.test((b.label || '') + ' ' + (b.viewName || '') + ' ' + b.text)
})

return {
  href: location.href,
  // If this is not a permalink, the probe was pointed at the wrong page and
  // everything below is about the feed again.
  isPermalink: location.pathname.indexOf('/feed/update/') === 0,
  documentReadyState: document.readyState,
  totalButtons: all.length,
  totalTaggedElements: tagged.length,
  // The anchors the tools currently rely on. All zero means the tools are
  // looking for feed-page components on a page that does not have them.
  anchorsTheToolsUse: {
    reactionButton: document.querySelectorAll('button[data-view-name="reaction-button"]').length,
    feedFullUpdate: document.querySelectorAll('[data-view-name="feed-full-update"]').length,
    feedCommentButton: document.querySelectorAll('button[data-view-name="feed-comment-button"]').length,
    commentBox: document.querySelectorAll('[data-view-name="comment-box"]').length,
    commentEditor: document.querySelectorAll('[contenteditable="true"][role="textbox"]').length,
    commentPost: document.querySelectorAll('button[data-view-name="comment-post"]').length,
  },
  reactionLookingButtons: reactionish,
  allViewNames: Object.keys(viewNames).sort().map(function (v) { return v + ' x' + viewNames[v] }),
  buttons: buttons,
  bodyTextPreview: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
}

// re-save 1787481940
