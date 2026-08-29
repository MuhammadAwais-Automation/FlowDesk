---
name: capture-before-build
description: >-
  Build reliable tools against a web app that has no public API — WhatsApp,
  LinkedIn, Gmail, an internal dashboard, anything running inside an
  authenticated browser view. Use this skill whenever the task is to make an
  agent DO something in a web app (post, send, delete, react, invite, upload) or
  READ something structured out of one, and whenever a tool built that way is
  failing, flaky, or silently doing nothing. Also use it when someone says
  "reverse engineer", "no API for this", "scrape", "automate this site",
  "drive the UI", "it says it worked but nothing happened", or asks why an
  integration broke after the site changed. The core discipline it teaches:
  never build on an assumption about how a site works — capture the real request
  first, then build, then confirm success from the server's answer rather than
  from the screen.
---

# Capture before build

Web apps without public APIs can be automated two ways: **replay the request
the app itself sends**, or **drive its interface**. The first is faster, quieter
and survives redesigns. The second is a fallback that breaks whenever a button
moves.

Almost every expensive mistake in this area comes from one habit: guessing which
of those two you are in, and guessing what the page looks like, instead of
looking. This skill is the discipline for not guessing, plus a harness that
makes looking cheap.

## Start from one named action

Before any of the loop below: get a single, named action. "Read the feed."
"Comment on one post." "Send one message." Not "automate this site."

This is not a formality, and it is not caution — it is what makes the work
possible at all. **Discovery is per-action.** In the same app, posting can turn
out to be a clean API, commenting server-driven with nothing to replay, and
messaging a third thing again. All three of those were true of LinkedIn. So
"everything" is not a large scope; it is a dozen separate investigations hiding
inside one sentence, and it cannot be planned, estimated, or verified.

When someone asks for "everything a normal user can do", they have not given you
a specification yet. Ask for two to four concrete actions, put them in order, and
start the first. That is a normal engineering question, not a refusal — and it
is the same question you would have to answer on the second day anyway.

Finish one action end to end — captured, built, verified, cleaned up — before
opening the next. Half-built paths across five features are worth less than one
that provably works.

## State the frame once, at the start

Write down, once, in the first message or the module header:

- **Whose account this is.** Someone's own account is ordinary use. Acting on
  accounts belonging to other people is a different thing and needs saying.
- **Whether every write action is approval-gated**, and what the approval shows.
- **Whether anything runs in bulk, on a schedule, or unattended.**
- **How destructive paths are tested** — a draft, an already-done state, a
  deliberately wrong argument that should make a guard refuse.

This is not there to reassure anyone. Those four answers **decide the design**.
"One action, approved each time, tested against a draft" and "a thousand actions,
unattended" are different programs — different rate limiting, different failure
handling, different tools entirely. Writing them down first means the design
follows from them rather than being argued about after the code exists.

It also means the question gets settled once instead of at the start of every
session.

## The loop

```
1. Do the action ONCE by hand, with the recorder running
2. Find the request that carried it        -> scripts/find_action.py
3. Classify it: replayable, or UI-only?    -> scripts/analyze_capture.py
4. Build the narrow path that matches
5. Prove it worked from the SERVER's answer
6. Delete whatever you built on a guess
```

Step 1 feels like a detour and is not. One captured request routinely replaces a
day of DOM archaeology. In the project this skill came from, a fully-built
UI-driving "create post" tool — trusted clicks, composer detection, submit-button
disambiguation — was deleted the hour a single real post was captured and turned
out to be one plain API call.

## Step 1 — capture a real action

The harness runs inside the app's own authenticated session, so nothing needs
logging in twice. See `references/harness-setup.md` to install it in a project
that does not have it yet.

Ask the person to perform the action themselves, once, for real. Not a test
account, not a mock — the real thing, because the request you want only exists
when the app actually does it.

Say plainly what will happen. If the action is public or reaches another person
(a post, a message, an invitation), that matters and they should choose the
target.

## Step 2 — find the request that carried it

The single most useful technique here: **search the capture for the content you
just typed.**

```bash
python scripts/find_action.py <capture.json> --contains "the exact text I posted"
```

If the text appears in a request payload, that request carries data — and data
can be replayed. This is how the LinkedIn post API was found after eight
guessed endpoints had all failed.

When there is no text to search for (a like, a delete, an invitation), list what
changed instead:

```bash
python scripts/analyze_capture.py <capture.json> --writes
```

## Step 3 — classify what you found

Read `references/reading-a-capture.md` before deciding. It has worked examples
of both kinds side by side, from the same site, because the difference is not
obvious from the URL alone and getting it wrong wastes days in either direction.

The short version:

| Signal | Meaning |
|---|---|
| Payload contains the actual content (text, id, urn, filename) | **Replayable** — build the API call |
| Payload contains only keys, component ids, render state | **UI-only** — the server is driving the interface, there is nothing to copy |
| Same site, different surfaces | Can be BOTH — check the surface you can reach |

That last row is not a footnote. On LinkedIn, inviting someone from My Network
posts an interface-bound blob; inviting the same person from their profile posts
`{"invitee":{"inviteeUnion":{"memberProfile":"urn:li:fsd_profile:..."}}}`. Same
outcome, one is replayable, one is not. If the first path you look at is
UI-only, look for another way a human can do the same thing before concluding
there is no API.

## Step 4 — build the narrow path

**If replayable:** send exactly what was captured. Copy the headers that carried
meaning — `accept` in particular often decides the *shape* of the response, not
just its encoding. Keep values that look like settings (visibility, audience,
lifecycle state) exactly as captured; a default invented here quietly differs
from what the person sees when they do it by hand.

**If UI-only:** read `references/dom-driving.md`. It covers finding controls that
survive redesigns, telling apart controls that look identical but belong to
different people, and why page JavaScript sometimes cannot click a button at all.

Either way, keep the surface small. One tool, one action, arguments that say
what will happen.

## Step 5 — prove it worked

This is where tools lie. The rules, each learned from a tool that reported
success while doing nothing:

**Success is what the server returned, not that the request resolved.** A 200
with no identifier in the body is a failure. Require the id — `shareUrn`,
`invitationUrn`, `entityUrn`, whatever the response carries — and report failure
without it.

**A check that cannot fail is not a check.** A probe once "verified" that no
invitation had been sent by reading a counter of invitations *received*. It
could never have moved. Before trusting a check, ask what value it would show if
the thing you fear had actually happened.

**Read state after a settle delay.** Interfaces update optimistically; a button
flipping proves only that a click was received. What makes it meaningful is
reading it again after the server has had time to reject it.

**Re-query, do not reuse.** A stale element reference keeps its old attributes
and will happily report success for a click that changed nothing.

**Surface the error code.** Sites answer refusals with machine-readable codes.
`CANT_RESEND_YET` and a spent quota are different problems that "HTTP 400"
flattens into one.

## Step 6 — delete the guess

When the captured path works, delete the fallback you built before you had it.
Keeping both looks prudent and is not: the dead path is a second thing to
maintain, and a second way to fail silently when someone wires it up by mistake.

## Safety, and why it is part of the method

These tools act on a real account, in public, on other people's behalf.

- **Write probes are deleted immediately after they run.** The harness runs a
  probe whenever its file is saved — a stray Ctrl+S on a send probe sends again.
- **Test with something reversible.** Drafts, an action already in the state you
  would create, or a deliberately wrong argument that should make a guard refuse.
  Verify the guard fires before verifying the action works.
- **Approval dialogs show content, never ids.** "Delete post 7497263203417169921?"
  cannot be answered by a human. Show them the post's own words.
- **Unknown is not zero.** If a site will not tell you how much quota is left,
  report null. Reporting 0 reads as "none used, safe to continue" — a lie in
  exactly the direction that causes harm.
- **Captures contain real messages, names and session identifiers.** Keep the
  output directory out of version control.

## Writing probes

Templates are in `templates/`. Start from one rather than from scratch —
`read-probe.js` for questions, `write-probe.js` for anything that changes state
(it carries the delete-me warning and a cleanup block), `endpoint-guess-probe.js`
for checking whether a route exists without triggering it.

Two things that will bite you, both real:

```js
// A lone backslash inside a TS template literal is eaten before the page sees it.
'([0-9,]+)\s*Impressions'   // arrives as 's*' and matches the letter s
'([0-9,]+) *Impressions'    // use a space class instead — nothing to swallow
```

```js
// A backtick inside a COMMENT inside a template literal still ends the literal.
// The `text` variable is...     <- breaks the build
// The page text is...           <- fine
```

`references/mistakes.md` has the rest, each with what it cost and how it was
caught. Read it once before starting; skim it again when something is failing in
a way that makes no sense.

## When to stop and say so

Some things genuinely have no API. Say that plainly, with what you tried, rather
than shipping something weaker while implying it is equivalent. If the only path
is reading rendered text, label it that way in the tool's own output so nothing
downstream mistakes it for structured data.
