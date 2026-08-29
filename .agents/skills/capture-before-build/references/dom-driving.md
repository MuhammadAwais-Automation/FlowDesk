# When driving the interface is the only path

Read this only after `reading-a-capture.md` has settled that there is no
replayable request — including from a different surface of the same app. Every
rule here exists because a DOM-driven tool broke in that specific way.

## Find controls by meaning, not by build artefacts

Class names are regenerated on every deploy. Framework attributes come and go
per page. What survives is what the control is *for*, which is usually in its
accessible label.

```js
// Fragile — this attribute exists on the feed and nowhere else
document.querySelector('button[data-view-name="reaction-button"]')

// Durable — describes purpose, and the page must keep it for screen readers
labelOf(el).match(/^(un)?react /i)
```

Anchor priority:

1. `aria-label` semantics (`"Invite Jane Doe to connect"`)
2. Visible text, when unambiguous
3. Structural position relative to something already identified
4. Framework attributes — only if you verified them on *this* page
5. Class names — never

## Verify the anchor on the page you will actually use

A permalink page, a feed, a profile and a modal are different component trees on
the same site. In the project this came from, `/feed/` was richly tagged with
`data-view-name`; the post permalink carried **eight tagged elements in total**
and none of the ones the tools needed.

Write a read-only probe that dumps what is actually there before you write the
tool. `templates/read-probe.js` is shaped for this.

## Identical controls belonging to different things

This is the failure that hurts, because it acts on the wrong person or the wrong
post and cannot be undone.

- A post page has one "Comment" button that opens the box and another that
  submits it. Same text. The submit has an **empty** `aria-label`; the opener's
  says "Comment".
- A profile page has five "Connect" controls — three for the profile, two for
  people in a sidebar rail. Only the name inside the label separates them.
- Every comment on a post has its own reply box and its own reaction button.

**Never take the first match.** Establish what separates them, and if the
separator does not resolve to exactly one target, refuse:

```js
if (candidates.length === 0) return { ok: false, error: 'nothing matched — nothing was done' }
if (candidates.length > 1) {
  // Refusing on ambiguity IS the safety property. An action that does not
  // happen is recoverable; one aimed at the wrong person is not.
  return { ok: false, ambiguous: true, matchCount: candidates.length,
           error: 'matched ' + candidates.length + ' targets — narrow it so exactly one matches' }
}
```

Duplicates of the *same* target are fine and expected (a header copy, a sticky
copy). The check is that every match names the intended thing — not that there
is exactly one element.

## Finding the container something belongs to

Walking up for a tagged ancestor fails on pages that do not tag. Walk up by
*structure* instead — the container is the smallest ancestor that still contains
exactly one of the thing that identifies it:

```js
// The comment a Reply button belongs to: grow until a second Reply button
// appears, then stop. One step further swallows the neighbouring comment.
var container = button
for (var n = button.parentElement, hops = 0; n && n !== document.body && hops < 12; n = n.parentElement, hops++) {
  var replyButtons = 0
  var inside = n.querySelectorAll('button[aria-label]')
  for (var k = 0; k < inside.length; k++) {
    if (/^Reply to /i.test(inside[k].getAttribute('aria-label') || '')) replyButtons++
  }
  if (replyButtons !== 1) break
  container = n
}
```

## Typing into a contenteditable

A rich editor is a `contenteditable` div, not a textarea. It has no `value`.
Assigning `textContent` puts the words on screen while the framework still
believes the box is empty — so the submit control stays inert and nothing is
ever sent.

Insert text so that the events a real keystroke produces actually fire:

- From the main process: `Input.insertText` over CDP.
- From inside a probe (no CDP available): `document.execCommand('insertText', ...)`.

Then **read the box back and compare against what was approved** before
submitting. Two things this catches: a stale draft already in the box, and a
partial insertion.

One caveat found live: some editors pre-fill content of their own. A reply box
inserts an @mention of the person being replied to, so the box legitimately reads
`"Jane Doe <your reply>"`. Allow exactly that one shape and nothing else:

```js
if (typed !== expected && typed !== (mention + ' ' + expected)) return refuse()
```

## Controls that page JavaScript cannot activate

Some controls only respond to trusted input. Symptom: `element.click()` returns
without error and nothing happens; a full synthetic pointer sequence also does
nothing.

Do not escalate by synthesising more events. Either send real input from the
main process:

```ts
await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
```

...or go back and look harder for an API, which is what actually resolved both
cases where this came up.

Coordinates must be read **after** scrolling, in the same evaluation. A rect read
before a scroll describes where the element used to be, and a click at stale
coordinates lands on whatever is there now.

## Dialogs are not always `role="dialog"`

A send-invitation tool clicked Connect, then looked for `[role="dialog"]` to find
the "Send without a note" confirmation. On that build the confirmation is not
tagged that way, so it was never found and the invitation never went — while the
page had a `[role="dialog"]` element that was a hidden video-caption shell.

Identify a modal by what it contains and by geometry (a large element that
appeared after the click), not by its role attribute.

## Restore what you moved

If the tool navigated a tab the user was looking at, put it back — in a `finally`
block, so it happens on failure too. An action that silently relocates someone's
browser is its own bug.

## What to report

Push a step onto a list as each stage completes:

```
steps: ['post rendered', 'comment box focused', 'text inserted', 'submitted']
```

When something fails mid-sequence, which step it reached is the difference
between a diagnosable failure and a mystery. Several bugs in this project were
solvable in minutes purely because `steps: []` proved the first check never
passed.
