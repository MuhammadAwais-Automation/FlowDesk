// @target linkedin.com
//
// READ-ONLY. Reports whether the composer is open and what it contains.

function describe(el) {
  var r = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    label: (el.getAttribute('aria-label') || '').slice(0, 60),
    viewName: el.getAttribute('data-view-name'),
    placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || null,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    rect: Math.round(r.width) + 'x' + Math.round(r.height),
  }
}

var text = (document.body.innerText || '').replace(/\s+/g, ' ')
var editors = []
var eds = document.querySelectorAll('[contenteditable="true"], textarea')
for (var i = 0; i < eds.length && i < 6; i++) editors.push(describe(eds[i]))

var buttons = []
var bs = document.querySelectorAll('button, [role="button"]')
for (var i = 0; i < bs.length && buttons.length < 40; i++) {
  var b = bs[i]
  var hay = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase()
  if (/post|anyone|connection|visib|schedule|dismiss|close|add a photo/.test(hay)) buttons.push(describe(b))
}

var viewNames = {}
var tagged = document.querySelectorAll('[data-view-name]')
for (var i = 0; i < tagged.length; i++) {
  var v = tagged[i].getAttribute('data-view-name')
  if (v && /share|post|editor|composer|creation|visib/i.test(v)) viewNames[v] = (viewNames[v] || 0) + 1
}

return {
  href: location.href,
  composerWording: /what do you want to talk about|create a post|Post to Anyone/i.test(text),
  editorCount: eds.length,
  editors: editors,
  relevantButtons: buttons,
  composerViewNames: Object.keys(viewNames).sort().map(function (k) { return k + ' x' + viewNames[k] }),
  bodyTextHead: text.slice(0, 200),
}
