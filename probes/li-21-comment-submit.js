// @target linkedin.com
//
// READ-ONLY. Nothing is clicked and nothing is typed.
//
// The first pass found the comment button and the comment box but no submit
// control — because it only looked at buttons whose name mentioned "comment",
// and LinkedIn's submit button is not named that way. It also only appears once
// the box has text in it.
//
// This looks at EVERY button inside and around a comment box, so the submit
// control is found whatever it calls itself. Also records whether each is
// disabled, since that is how LinkedIn signals "the box is still empty" — and
// that flag is the thing that will reveal whether inserted text actually
// registered with React or only appeared on screen.

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
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    label: (el.getAttribute('aria-label') || '').slice(0, 50),
    viewName: el.getAttribute('data-view-name'),
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    visible: !!(el.offsetParent || el.getClientRects().length),
    attrs: attrs(el),
  }
}

var boxes = document.querySelectorAll('[data-view-name="comment-box"]')
var reports = []

for (var i = 0; i < boxes.length && reports.length < 4; i++) {
  var box = boxes[i]
  var editor = box.querySelector('[contenteditable="true"][role="textbox"]')

  // Buttons inside the box itself.
  var inside = []
  var bs = box.querySelectorAll('button')
  for (var j = 0; j < bs.length; j++) inside.push(describe(bs[j]))

  // And in the two levels above it, since a submit control often sits in a
  // footer that is a sibling of the editor rather than a child of it.
  var around = []
  var scope = box.parentElement && box.parentElement.parentElement
  if (scope) {
    var outer = scope.querySelectorAll('button')
    for (var j = 0; j < outer.length && around.length < 14; j++) {
      var already = false
      for (var k = 0; k < bs.length; k++) if (bs[k] === outer[j]) already = true
      if (!already) around.push(describe(outer[j]))
    }
  }

  reports.push({
    boxIndex: i,
    editorPresent: !!editor,
    editorHasText: editor ? (editor.innerText || '').trim().length > 0 : null,
    editorTextPreview: editor ? (editor.innerText || '').trim().slice(0, 60) : null,
    buttonsInsideBox: inside,
    buttonsAroundBox: around,
  })
}

// Anything that looks like a submit control anywhere on the page, as a
// cross-check in case the box-scoped search misses it entirely.
var submitish = []
var all = document.querySelectorAll('button')
for (var i = 0; i < all.length && submitish.length < 10; i++) {
  var b = all[i]
  var t = (b.innerText || '').trim()
  var l = b.getAttribute('aria-label') || ''
  var v = b.getAttribute('data-view-name') || ''
  if (!/^(post|submit|reply|send)$/i.test(t) && !/submit|post comment|send/i.test(l) && !/submit/i.test(v)) continue
  submitish.push(describe(b))
}

return {
  href: location.href,
  commentBoxesFound: boxes.length,
  reports: reports,
  submitLookingButtonsAnywhere: submitish,
  note: 'a disabled submit control means React still believes the box is empty — that flag is how inserted text gets verified later',
}
