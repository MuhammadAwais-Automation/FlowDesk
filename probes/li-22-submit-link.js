// @target linkedin.com
//
// READ-ONLY. Nothing is clicked and nothing is typed.
//
// A disabled <button type="submit">Submit</button> was found on the page, and
// two empty comment editors. That is consistent with "this is the comment
// submit control, disabled because the box is empty" — but consistent is not
// the same as true. It could equally belong to a search form or a dialog.
//
// This establishes the relationship instead of assuming it: walk up from the
// submit button and check whether a comment editor lives in the same subtree,
// and record the enclosing form or container so the pairing can be made
// reliably when there are several comment boxes on a page.

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

var submits = document.querySelectorAll('button[type="submit"]')
var findings = []

for (var i = 0; i < submits.length && findings.length < 5; i++) {
  var button = submits[i]
  var chain = []
  var editorFoundAtDepth = null
  var node = button

  for (var depth = 0; depth < 12 && node && node !== document.body; depth++) {
    var a = attrs(node)
    chain.push({
      depth: depth,
      tag: node.tagName.toLowerCase(),
      viewName: node.getAttribute('data-view-name'),
      attrs: Object.keys(a).length ? a : null,
    })
    // The question that matters: does a comment editor share this ancestor?
    if (editorFoundAtDepth === null && node.querySelector
        && node.querySelector('[contenteditable="true"][role="textbox"]')) {
      editorFoundAtDepth = depth
    }
    node = node.parentElement
  }

  findings.push({
    index: i,
    text: (button.innerText || '').trim().slice(0, 30),
    disabled: button.disabled === true,
    visible: !!(button.offsetParent || button.getClientRects().length),
    // If this is null, the button has nothing to do with commenting and the
    // whole assumption was wrong.
    commentEditorSharesAncestorAtDepth: editorFoundAtDepth,
    ancestors: chain,
  })
}

// How the pairing would actually be made: from an editor, walk up to the
// nearest form and look for the submit inside it.
var editors = document.querySelectorAll('[contenteditable="true"][role="textbox"]')
var pairing = []
for (var i = 0; i < editors.length && pairing.length < 4; i++) {
  var editor = editors[i]
  var form = editor.closest ? editor.closest('form') : null
  var submitInForm = form ? form.querySelector('button[type="submit"]') : null
  pairing.push({
    editorLabel: (editor.getAttribute('aria-label') || '').slice(0, 50),
    hasEnclosingForm: !!form,
    formAttrs: form ? attrs(form) : null,
    submitFoundInSameForm: !!submitInForm,
    submitDisabled: submitInForm ? submitInForm.disabled === true : null,
    submitText: submitInForm ? (submitInForm.innerText || '').trim().slice(0, 25) : null,
  })
}

return {
  href: location.href,
  submitButtonsOnPage: submits.length,
  findings: findings,
  // This is the pairing a tool would rely on. If hasEnclosingForm is false the
  // approach needs rethinking rather than patching.
  editorToSubmitPairing: pairing,
}
