// @target linkedin.com
//
// Opens the post composer, reads it, and closes it again. NOTHING IS POSTED —
// no text is typed and no submit control is clicked.
//
// li-27 found the trigger: a div with data-view-name="share-sharebox-focus"
// reading "Start a post". Everything inside the composer renders only after it
// opens, so it cannot be read without opening it — the same reason the comment
// submit control could not be seen until text existed.
//
// The composer is closed again at the end, and whether it actually closed is
// reported rather than assumed. Leaving a modal open would block the window
// the user is looking at.

function describe(el) {
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    label: (el.getAttribute('aria-label') || '').slice(0, 60),
    viewName: el.getAttribute('data-view-name'),
    placeholder: el.getAttribute('data-placeholder') || null,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    visible: !!(el.offsetParent || el.getClientRects().length),
  }
}

var trigger = document.querySelector('[data-view-name="share-sharebox-focus"]')
if (!trigger) return { ok: false, error: 'no share-sharebox-focus on this page', href: location.href }

trigger.click()

// Polled rather than a fixed delay: the composer is fetched on demand, so how
// long it takes varies with the connection.
var editor = null
var deadline = Date.now() + 8000
for (;;) {
  editor = document.querySelector('[contenteditable="true"][role="textbox"]')
  if (editor) break
  if (Date.now() > deadline) break
  await new Promise(function (r) { setTimeout(r, 250) })
}

var dialog = document.querySelector('[role="dialog"]')

var report = {
  ok: true,
  href: location.href,
  editorFound: !!editor,
  editor: editor ? describe(editor) : null,
  dialogFound: !!dialog,
}

if (dialog) {
  var buttons = []
  var found = dialog.querySelectorAll('button')
  for (var i = 0; i < found.length && buttons.length < 25; i++) buttons.push(describe(found[i]))
  report.dialogButtons = buttons

  var tagged = {}
  var t = dialog.querySelectorAll('[data-view-name]')
  for (var i = 0; i < t.length; i++) {
    var v = t[i].getAttribute('data-view-name')
    if (v) tagged[v] = (tagged[v] || 0) + 1
  }
  report.dialogViewNames = Object.keys(tagged).sort().map(function (k) { return k + ' x' + tagged[k] })

  // The visibility control decides who sees the post. Reported separately
  // because it is the setting whose default must never be guessed at.
  report.visibilityText = (function () {
    var hits = []
    var all = dialog.querySelectorAll('button, [role="button"]')
    for (var i = 0; i < all.length; i++) {
      var text = (all[i].innerText || '').replace(/\s+/g, ' ').trim()
      if (/anyone|connections|group|visib/i.test(text)) hits.push(text.slice(0, 50))
    }
    return hits
  })()
}

// Put the page back. Escape first, since that is what a person would press.
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }))
await new Promise(function (r) { setTimeout(r, 800) })

var stillOpen = !!document.querySelector('[role="dialog"]')
if (stillOpen) {
  var closers = document.querySelectorAll('[role="dialog"] button[aria-label]')
  for (var i = 0; i < closers.length; i++) {
    if (/dismiss|close/i.test(closers[i].getAttribute('aria-label') || '')) { closers[i].click(); break }
  }
  await new Promise(function (r) { setTimeout(r, 800) })
}

report.closedAfterwards = !document.querySelector('[role="dialog"]')
return report
