# The mistakes, and the rules they produced

Every entry here is a real failure from building agent tools against WhatsApp
and LinkedIn. They are written up because each one cost real time, and because
they repeat — three of them happened more than once in the same project, to
someone who already knew better.

Read this once before starting. Skim it again when something is failing in a way
that makes no sense; the symptom sections are written to be recognisable.

---

## 0. Taking "everything" as the scope

**What happened.** A session opened with "let us start on Facebook — everything a
normal user can do". Work stalled immediately, and the argument that followed was
about permissions when the actual problem was that no specification existed.

**Why it is a real problem, not a formality.** Discovery is per-action. In one
app, posting turned out to be a clean API, commenting was server-driven with
nothing to replay, reactions had no API at all, and inviting someone was
replayable from one surface and not from another. Those are four different
investigations. "Everything" bundles a dozen of them into one sentence that
cannot be planned, estimated, or verified — and every one of them would have to
be separated on the second day anyway.

**Rule.** Get two to four named actions and order them. Finish the first end to
end — captured, built, verified, cleaned up — before opening the next. Asking for
this is an engineering question, not a refusal, and it is worth saying so plainly
rather than letting it be mistaken for one.

**The other half.** State the frame once, at the start: whose account, whether
every write is approval-gated, whether anything runs unattended, and how
destructive paths get tested. Those four answers decide the design — rate
limiting, failure handling, which tools even exist. Written down first, the
design follows from them. Left unwritten, the same conversation happens at the
start of every session and the code gets built on whichever assumption went
unexamined.

---

## 1. Building on an anchor from a different page

**What happened.** A "like this post" tool looked for
`button[data-view-name="reaction-button"]`. That attribute was read off the feed
page. The tool ran on the post's own permalink page, where it does not exist.
Every run reported "the page did not render" — for a page that had returned 200
with 180KB, twice.

The same assumption then went into the comment tool, and failed the same way.

**Why it was hard to see.** The error said "did not render". Nobody doubts a
timeout message. The network capture flatly contradicted it.

**Symptom.** A tool times out waiting for something, but the page loads fine when
you look at it. Steps list is empty — it never got past the first check.

**Rule.** An anchor is evidence about the page you read it on. Verify it on the
page the tool will actually use, before building on it.

---

## 2. `element.click()` does nothing, silently

**What happened.** A "create post" tool clicked the share box. Nothing opened. A
full pointer sequence with real coordinates — `pointerdown`, `mousedown`,
`pointerup`, `mouseup`, `click` — also did nothing. Enter on the `role="button"`
did nothing.

The control was a `div` with `role="button"`. Page JavaScript cannot activate it;
only a trusted event from the browser can.

**Rule.** If a control does not respond to a page-script click, do not escalate
by synthesising more events. Use `Input.dispatchMouseEvent` over CDP, which
produces input at the browser level. And check whether an API exists first —
in this case one did, and the entire clicking path was deleted.

---

## 3. A check that cannot fail

**What happened.** A probe clicked Connect and then "verified nothing was sent"
by comparing `numPendingInvitations` before and after.

That field counts invitations **received**. It could never move when the user
sends one. The check passed, proved nothing, and was reported as evidence.

**Symptom.** A safety check that always passes.

**Rule.** Before trusting a check, ask: *what value would this show if the thing
I fear had actually happened?* If the answer is "the same value", it is not a
check. Find the signal that genuinely differs — here, the button's own state,
which switches from "Invite X to connect" to "Pending".

---

## 4. A field that lies about its contents

**What happened, twice.**

A comment reader exposed `authorHeadline`. The value was actually the connection
degree — "1st", "2nd". Anything consuming it got confident nonsense.

An analytics reader pulled numbers with a number-before-label pattern. The page
mixes two styles:

```
99 Impressions                      number BEFORE the label
Reactions 5 Comments 5 Reposts 0    number AFTER the label
```

Every engagement metric silently took its neighbour's figure. It reported
`reposts: 5` when the true value was `0`.

**Rule.** A wrong value is worse than a missing one, because nothing downstream
can tell. When a field cannot be filled correctly, report null and say why.
Name fields after what they actually contain.

---

## 5. Unknown reported as zero

**What happened.** LinkedIn exposes no endpoint for the remaining weekly
invitation allowance — four candidates returned 404, and `invitationsSummary`
returns `null` for its sent counts.

Reporting that as `0` would read as "none sent, safe to send more" — a lie in
exactly the direction that gets an account restricted.

**Rule.** Unknown is not zero. Return null, label it unknown, and say in the
tool's own output that the real limit cannot be read.

---

## 6. Success claimed from the screen

**What happened.** A message-send tool reported "sent" because the promise
resolved. Messages never left. Later, a like tool reported success because a
button label flipped — which is an optimistic UI update, not the server agreeing.

**Rule.** Success is what the server returned. Require the identifier from the
response (`shareUrn`, `invitationUrn`, `entityUrn`). A 200 without one is a
failure. When the only signal is on screen, read it **after** a settle delay so a
rejection has time to revert it, and re-query the element rather than reusing a
reference — a detached node keeps its old attributes.

---

## 7. Two controls with the same name

**What happened.** A post page shows a button reading "Comment" in the action
bar (which opens the box) and another reading "Comment" that submits it.
Matching on the visible text clicked the opener and posted nothing, while
reporting that it had.

A profile page carries **five** Connect controls — three for the profile, two or
more for people in the "People also viewed" rail, identical in shape.

**Rule.** Never take "the first match". Find what actually separates them — the
submit button had an empty `aria-label` where the opener's said "Comment"; the
Connect controls are separated only by the name inside the label. If the
separator does not resolve to exactly one target, refuse rather than guess. An
action that does not happen is recoverable; one aimed at the wrong person is not.

---

## 8. Structure that only exists on some pages

**What happened.** A reply tool found the target comment by walking up to an
ancestor tagged `data-view-name~/comment/`. Permalink pages carry no
`data-view-name` at all, so the walk terminated on the button itself, whose text
is just "Reply". No snippet could ever match.

**Rule.** Prefer structure that is true regardless of tagging. The fix: the
comment's container is the smallest ancestor containing exactly one "Reply to"
button. Growing past that swallows the neighbouring comment — which is the
mix-up that posts a reply under the wrong person.

---

## 9. The template literal ate the backslash — three times

**What happened.** A regex written inside a TypeScript template literal:

```ts
const SCRIPT = `... text.match(/activity:(\d+)/) ...`
```

`\d` is not a valid escape in a template literal, so it collapses to `d`. The
page received `/activity:(d+)/`, matched nothing, and every activity id came
back null.

It happened again with `\s+` — the page got `s+` and the pattern stripped every
letter "s" from the text. The symptom was unmistakable once seen: a diagnostic
reading `"Awai Mu htaq"` instead of `"Awais Mushtaq"`.

**Rule.** Inside a template literal, either double the backslash (`\\d`) or
avoid escapes entirely. Where the text is already whitespace-normalised, a space
class works and cannot be swallowed:

```ts
'([0-9,]+) *Impressions'    // no backslash, nothing to eat
```

Pin it with a test that asserts the built string contains what you meant.

---

## 10. A backtick inside a comment inside a template literal

```ts
const SCRIPT = `
  // The `text` variable is already normalised     <- ends the literal here
  ...
`
```

The build error points somewhere unrelated. **Rule.** No backticks in comments
inside template literals. Reword.

---

## 11. Apostrophes in single-quoted strings — four times

```ts
'Publish a post on the user's feed'    // breaks
```

It keeps happening in tool descriptions, which are long prose in single quotes.
**Rule.** Reword to avoid the apostrophe rather than escaping it. "the feed
belonging to the user" reads fine and cannot break.

---

## 12. encodeURIComponent does not escape parentheses

Rest.li URLs contain parenthesised urns, and the server expects them escaped
inside values. `encodeURIComponent` deliberately leaves parens alone, so the
request 400s.

```js
function enc(v) {
  return encodeURIComponent(String(v)).replace(/\(/g, '%28').replace(/\)/g, '%29')
}
```

---

## 13. A stray save re-sends

The probe harness runs a probe whenever its file is saved. A send probe left on
disk sends again on the next Ctrl+S — no edit required.

**Rule.** Delete write probes the moment they have run. The templates carry this
warning at the top for a reason.

---

## 14. Testing a destructive path on something real

**What happened.** Verifying "delete a post" needs a post to delete.

**What worked.** Create one first — `intendedShareLifeCycleState: "DRAFT"` made
a post nobody could see, which proved create and delete end to end without
publishing anything. Where a draft was not possible (delete needs an activity id,
which drafts lack), a real post was published, verified, and deleted within
seconds, and that was stated plainly rather than done quietly.

**Rule.** Look for a reversible state to test against — a draft, an already-done
action, or a deliberately wrong argument that should make a guard refuse. Verify
the guard fires before verifying the action works.

---

## 15. Keeping the guessed path "just in case"

Both the create-post and send-invitation tools were fully built on UI-driving
before the API was captured. Both times the fallback was deleted rather than
kept.

**Rule.** When the captured path works, delete the guess. Two paths is two things
to maintain and a second way to fail silently when someone wires up the wrong
one.
---

## 16. A hardcoded truncation length tuned for one site, wrong for the next

**What happened.** The recorder capped a captured request body at 2000
characters. That was generous for LinkedIn's compact JSON payloads. On the next
site, the form-encoded body led with tens of thousands of characters of
obfuscated routing state before the fields that actually mattered — a CSRF
token, a query id, the real arguments — ever appeared. Every early capture
showed those fields as simply absent, not malformed.

**Why it was easy to miss.** Nothing errored. The capture "worked" — it wrote a
file, the file had a `postData` field, the field just did not contain the part
anyone needed. A cap sized for one payload shape is invisible until a
differently-shaped payload runs into it.

**Rule.** Do not carry a hardcoded body-capture length between sites without
checking it against the new one. If a capture shows a request body ending
mid-parameter, or expected fields (a token, a doc/query id) are simply not
there, check the truncation limit before concluding the site does not send them.

---

## 17. A response that streams instead of arriving as one document

**What happened.** A captured request's own variables included a flag asking
for incremental delivery. Replaying it verbatim got a 200 — but a plain
`JSON.parse(responseText)` threw, because the body was newline-delimited JSON:
an initial partial payload followed by patch objects that fill in specific
fields at specific paths, including the one field (the actual post text) that
mattered most.

Swallowing that parse error would have looked exactly like the earlier
"succeeded with empty data" bugs — a 200, no visible error, nothing useful in
the result.

**Rule.** If a captured request's own arguments mention an incremental,
streaming, or deferred-delivery option, check whether the response is one JSON
document or many before writing a parser. Two fixes, in order of preference:

1. If the field is a request parameter (not a fixed part of the API), try
   sending it `false`. It often makes the server return one complete document,
   which is far simpler to consume for a plain read.
2. If it cannot be disabled, split the body on newlines and parse each line;
   the first line usually carries the primary shape, later lines are `{path,
   data}` patches to merge onto it.

Either way, verify against the field paths that actually carry content — not
just that parsing no longer throws.
