// @target linkedin.com
//
// READ-ONLY. Nothing is clicked, nothing is typed, nothing is closed.
//
// Run this while the post composer is open on screen.
//
// The correction this exists for: the composer DOES open when clicked — that
// was seen on screen. What failed was the detection, which required an editor
// plus one of three wordings and found neither. So the composer is not where
// the earlier probes looked, and the likeliest reason is an iframe: li-30 found
// a 1364x785 iframe on the feed, and `document.querySelector` in the top
// document cannot see inside one.
//
// This therefore searches the top document AND every same-origin frame, and
// says which frame anything was found in. A cross-origin frame cannot be read
// at all, and that is reported rather than looking like an empty one.

function describe(el) {
  var r = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    label: (el.getAttribute('aria-label') || '').slice(0, 60),
    viewName: el.getAttribute('data-view-name'),
    placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || null,
    role: el.getAttribute('role'),
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    rect: Math.round(r.width) + 'x' + Math.round(r.height),
  }
}

function scan(doc, where) {
  var out = { where: where, editors: [], controls: [], wording: false, viewNames: [] }
  try {
    var text = (doc.body && doc.body.innerText || '').replace(/\s+/g, ' ')
    out.wording = /what do you want to talk about|create a post|Post to Anyone|Add a photo/i.test(text)
    out.textHead = text.slice(0, 160)

    var eds = doc.querySelectorAll('[contenteditable="true"], [contenteditable=""], textarea, [role="textbox"]')
    for (var i = 0; i < eds.length && i < 8; i++) out.editors.push(describe(eds[i]))

    var bs = doc.querySelectorAll('button, [role="button"]')
    for (var i = 0; i < bs.length && out.controls.length < 45; i++) {
      var r = bs[i].getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      out.controls.push(describe(bs[i]))
    }

    var counts = {}
    var tagged = doc.querySelectorAll('[data-view-name]')
    for (var i = 0; i < tagged.length; i++) {
      var v = tagged[i].getAttribute('data-view-name')
      if (v) counts[v] = (counts[v] || 0) + 1
    }
    out.viewNames = Object.keys(counts).sort().map(function (k) { return k + ' x' + counts[k] })
  } catch (e) {
    out.error = String((e && e.message) || e)
  }
  return out
}

var scans = [scan(document, 'top')]

var frames = document.querySelectorAll('iframe')
for (var i = 0; i < frames.length && i < 8; i++) {
  var f = frames[i]
  var rect = f.getBoundingClientRect()
  var label = 'iframe[' + i + '] ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ' src=' + String(f.getAttribute('src') || '(none)').slice(0, 60)
  try {
    var doc = f.contentDocument
    if (!doc) { scans.push({ where: label, error: 'cross-origin or not loaded — cannot be read' }); continue }
    scans.push(scan(doc, label))
  } catch (e) {
    scans.push({ where: label, error: 'blocked: ' + String(e && e.message).slice(0, 80) })
  }
}

return {
  href: location.href,
  bodyOverflowHidden: getComputedStyle(document.body).overflow === 'hidden',
  frameCount: frames.length,
  scans: scans,
}
