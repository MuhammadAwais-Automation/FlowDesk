// @target linkedin.com
//
// READ-ONLY. Nothing is clicked.
//
// li-29 showed the [role="dialog"] elements on this page are all pre-existing
// 0x0 shells — video caption dialogs and ad menus — so li-28 matched one of
// those and learned nothing about the composer. It also showed body overflow
// is hidden, which means a modal really is open, and that NO contenteditable
// exists anywhere on the page.
//
// Both facts together say the composer's text input is not a contenteditable
// with role=textbox, which is what every other LinkedIn editor in this codebase
// has been. So rather than looking for a shape, this finds the overlay by
// GEOMETRY: whatever is large, fixed or absolute, and stacked above the page.
// An element covering the viewport is a modal regardless of what it calls
// itself.

function summarise(el) {
  var style = getComputedStyle(el)
  var rect = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    viewName: el.getAttribute('data-view-name'),
    role: el.getAttribute('role'),
    label: (el.getAttribute('aria-label') || '').slice(0, 60),
    className: String(el.className || '').slice(0, 80),
    position: style.position,
    zIndex: style.zIndex,
    rect: Math.round(rect.width) + 'x' + Math.round(rect.height),
    buttons: el.querySelectorAll('button').length,
    inputs: el.querySelectorAll('input, textarea, [contenteditable]').length,
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  }
}

var overlays = []
var all = document.body.querySelectorAll('*')
for (var i = 0; i < all.length; i++) {
  var el = all[i]
  var style = getComputedStyle(el)
  if (style.position !== 'fixed' && style.position !== 'absolute') continue
  var rect = el.getBoundingClientRect()
  // Large enough to be a modal rather than a tooltip or a badge.
  if (rect.width < 320 || rect.height < 240) continue
  overlays.push(summarise(el))
  if (overlays.length >= 12) break
}

// Every text input of any kind, since the composer's is evidently not a
// contenteditable.
var inputs = []
var fields = document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable]')
for (var i = 0; i < fields.length && inputs.length < 15; i++) {
  var f = fields[i]
  var r = f.getBoundingClientRect()
  inputs.push({
    tag: f.tagName.toLowerCase(),
    type: f.getAttribute('type'),
    role: f.getAttribute('role'),
    label: (f.getAttribute('aria-label') || '').slice(0, 60),
    placeholder: f.getAttribute('placeholder') || f.getAttribute('data-placeholder') || null,
    viewName: f.getAttribute('data-view-name'),
    rect: Math.round(r.width) + 'x' + Math.round(r.height),
    visible: !!(f.offsetParent || f.getClientRects().length),
  })
}

// Whether the composer is on screen at all, judged by its own words rather
// than by structure.
var bodyText = (document.body.innerText || '').replace(/\s+/g, ' ')

return {
  href: location.href,
  bodyOverflowHidden: getComputedStyle(document.body).overflow === 'hidden',
  overlayCount: overlays.length,
  overlays: overlays,
  inputs: inputs,
  // Distinctive composer wording. Present means it rendered; absent means the
  // click never opened it and the scroll lock is from something else.
  mentionsCreatePost: /create a post|Post to Anyone|Add a photo|What do you want to talk about/i.test(bodyText),
  bodyTextHead: bodyText.slice(0, 200),
}
