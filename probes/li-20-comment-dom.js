// @target linkedin.com
//
// READ-ONLY. Nothing is clicked and nothing is typed.
//
// Learns the anchors a comment tool will need. Commenting is three steps where
// liking was one — open the box, put text in it, submit — and each step needs
// its own anchor. Guessing any of them would repeat the mistake that made every
// comment author come back null.
//
// Also checks the harder question: is the comment box a real <textarea>, or a
// contenteditable div? React drives contenteditable through its own event
// plumbing, so assigning textContent leaves the component believing the box is
// still empty and the submit button disabled.

function attrs(el) {
  var out = {}
  if (!el || !el.attributes) return out
  for (var i = 0; i < el.attributes.length; i++) {
    var a = el.attributes[i]
    // Class names are build-generated hashes here and useless as anchors.
    if (a.name === 'class' || a.name === 'style') continue
    out[a.name] = String(a.value).slice(0, 80)
  }
  return out
}

function describe(el) {
  return {
    tag: el.tagName.toLowerCase(),
    attrs: attrs(el),
    label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.innerText || '').trim()).slice(0, 60),
    visible: !!(el.offsetParent || el.getClientRects().length),
  }
}

// ── every button whose purpose mentions comments ──
var commentButtons = []
var buttons = document.querySelectorAll('button')
for (var i = 0; i < buttons.length && commentButtons.length < 8; i++) {
  var b = buttons[i]
  var view = b.getAttribute('data-view-name') || ''
  var label = b.getAttribute('aria-label') || ''
  if (!/comment/i.test(view) && !/comment/i.test(label)) continue
  commentButtons.push(describe(b))
}

// ── anything that could hold typed text ──
var editors = []
var candidates = document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')
for (var i = 0; i < candidates.length && editors.length < 8; i++) {
  editors.push(describe(candidates[i]))
}

// ── distinct data-view-name values, which is the vocabulary this page uses ──
var viewNames = {}
var tagged = document.querySelectorAll('[data-view-name]')
for (var i = 0; i < tagged.length; i++) {
  var v = tagged[i].getAttribute('data-view-name')
  if (v) viewNames[v] = (viewNames[v] || 0) + 1
}
var commentish = Object.keys(viewNames).filter(function (v) {
  return /comment|reply|submit|post|editor|box/i.test(v)
}).map(function (v) { return v + ' x' + viewNames[v] })

return {
  href: location.href,
  commentButtons: commentButtons,
  // Empty here is expected on the feed: LinkedIn renders the box only after
  // the Comment button is pressed. Its absence is information, not a failure.
  textEditorsPresent: editors,
  commentishViewNames: commentish.sort(),
  totalDistinctViewNames: Object.keys(viewNames).length,
  note: 'the comment box usually does not exist until the Comment button is clicked, so an empty textEditorsPresent is expected here',
}
