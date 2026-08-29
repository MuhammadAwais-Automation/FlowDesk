// @target linkedin.com
//
// READ-ONLY. Nothing is clicked and nothing is submitted.
//
// Runs against a comment box the user has typed into by hand. That state is the
// only one that reveals the submit control: LinkedIn renders it on demand, so
// with an empty box there is nothing to find. Two earlier guesses about it were
// wrong — `data-urn` for posts, and a page-level `type="submit"` that turned out
// to belong to a hidden dialog — so this reads the real thing instead.
//
// It records three things a comment tool needs and cannot safely assume:
//   1. where the submit control is, relative to the editor that has text
//   2. how the typed text is actually held (innerText / textContent / value)
//   3. which nearby controls exist, so the wrong one is not clicked

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

function describe(el) {
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    label: (el.getAttribute('aria-label') || '').slice(0, 45),
    viewName: el.getAttribute('data-view-name'),
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    visible: !!(el.offsetParent || el.getClientRects().length),
    attrs: attrs(el),
  }
}

var editors = document.querySelectorAll('[contenteditable="true"][role="textbox"]')
var filled = null
for (var i = 0; i < editors.length; i++) {
  if ((editors[i].innerText || '').trim().length > 0) { filled = editors[i]; break }
}

if (!filled) {
  return {
    ok: false,
    stopped: 'no comment editor on this page currently has text in it — type into one (without posting) and run again',
    editorsFound: editors.length,
  }
}

// How the text is stored. Which of these is populated decides how a tool would
// later verify that inserted text actually landed.
var storage = {
  innerText: (filled.innerText || '').slice(0, 60),
  textContent: (filled.textContent || '').slice(0, 60),
  innerHTMLPreview: (filled.innerHTML || '').slice(0, 160),
  valueProperty: typeof filled.value === 'undefined' ? '[no value property]' : String(filled.value).slice(0, 60),
}

// Walk up from the filled editor, listing every control that appeared, so the
// submit can be located by where it actually is rather than by a guess.
var levels = []
var node = filled
for (var depth = 0; depth < 8 && node && node !== document.body; depth++) {
  var controls = []
  var found = node.querySelectorAll ? node.querySelectorAll('button') : []
  for (var j = 0; j < found.length && controls.length < 12; j++) controls.push(describe(found[j]))
  levels.push({
    depth: depth,
    tag: node.tagName.toLowerCase(),
    viewName: node.getAttribute('data-view-name'),
    buttonsInSubtree: controls.length,
    buttons: controls,
  })
  // Stop as soon as a level contains something that reads like a submit — going
  // further would just add the whole page.
  var hasSubmit = controls.some(function (c) {
    return /^(post|comment|reply|submit)$/i.test(c.text) || /submit|post comment/i.test(c.label)
  })
  if (hasSubmit) break
  node = node.parentElement
}

return {
  ok: true,
  href: location.href,
  editorsOnPage: editors.length,
  filledEditorLabel: (filled.getAttribute('aria-label') || '').slice(0, 50),
  textStorage: storage,
  levels: levels,
  note: 'the shallowest level whose buttons include a submit-looking control is the container a tool should scope to',
}
