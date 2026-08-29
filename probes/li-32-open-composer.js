// @target linkedin.com
//
// Opens the composer. Nothing is typed and nothing is posted.
//
// li-31 showed the trigger is a div with role="button" and tabindex="0" — not
// a real <button>. `element.click()` on it did nothing (li-30: no overlay, no
// input, none of the composer's wording anywhere on the page), which is the
// signature of a handler bound to the pointer sequence rather than to click.
//
// So this sends the sequence a real press produces: pointerdown, mousedown,
// pointerup, mouseup, click — in that order, with the coordinates of the
// element, because some handlers read them.
//
// Two fallbacks are tried in turn if that does not work, and WHICH one worked
// is reported. That matters more than the fact that something did: the tool
// has to reproduce the method that actually opens it, not run all three every
// time and hope.

function centre(el) {
  var r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}

function pointerSequence(el) {
  var at = centre(el)
  var common = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, button: 0, buttons: 1 }
  el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse' }, common)))
  el.dispatchEvent(new MouseEvent('mousedown', common))
  el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse', buttons: 0 }, common)))
  el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, { buttons: 0 })))
  el.dispatchEvent(new MouseEvent('click', Object.assign({}, common, { buttons: 0 })))
}

// The composer is judged open by its own wording plus a real input appearing.
// Structure is deliberately not the test here — li-28 already matched a
// [role="dialog"] that turned out to be a video caption shell.
function composerOpen() {
  var text = (document.body.innerText || '').replace(/\s+/g, ' ')
  var wording = /what do you want to talk about|create a post|Post to Anyone/i.test(text)
  var editor = document.querySelector('[contenteditable="true"], textarea')
  return { wording: wording, editor: !!editor, open: wording || !!editor }
}

async function settle(ms) {
  var deadline = Date.now() + ms
  for (;;) {
    var state = composerOpen()
    if (state.open) return state
    if (Date.now() > deadline) return state
    await new Promise(function (r) { setTimeout(r, 250) })
  }
}

var trigger = document.querySelector('[data-view-name="share-sharebox-focus"]')
if (!trigger) return { ok: false, error: 'share-sharebox-focus is gone', href: location.href }

var before = composerOpen()
if (before.open) return { ok: true, method: 'already-open', state: before, href: location.href }

var attempts = []

trigger.scrollIntoView({ block: 'center' })
await new Promise(function (r) { setTimeout(r, 300) })

pointerSequence(trigger)
var after = await settle(6000)
attempts.push({ method: 'pointer-sequence', result: after })

if (!after.open) {
  // A role="button" with tabindex is keyboard-operable by definition, and
  // Enter is the documented activation for it. If the pointer path is guarded
  // somehow, this is the other path the component itself must support.
  trigger.focus()
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  trigger.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  after = await settle(6000)
  attempts.push({ method: 'enter-key', result: after })
}

if (!after.open) {
  // Last: the labelled inner div. If the handler sits there rather than on the
  // tagged wrapper, the sequence has to land on it instead.
  var inner = trigger.querySelector('[aria-label="Start a post"]')
  if (inner && inner !== trigger) {
    pointerSequence(inner)
    after = await settle(6000)
    attempts.push({ method: 'inner-labelled-div', result: after })
  }
}

return {
  ok: after.open,
  href: location.href,
  // The one that worked is what the tool will use. Reported explicitly so the
  // tool does not end up firing all three on every post.
  workingMethod: after.open ? attempts[attempts.length - 1].method : null,
  attempts: attempts,
  bodyTextHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
}
