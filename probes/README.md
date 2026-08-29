# probes/

Discovery probes for reverse-engineering a web app from inside a live,
logged-in FlowDesk session.

Save a `.js` file here and it runs immediately — no rebuild, no app restart,
no re-login. The result appears as JSON in `out/`.

## Writing a probe

```js
// @target linkedin.com
const r = await fetch('/voyager/api/me', {
  headers: { 'csrf-token': document.cookie.match(/JSESSIONID="?([^";]+)"?/)[1] },
})
return { status: r.status, body: await r.json() }
```

- **`// @target <url-substring>`** on the first line is required. It picks
  which open view to run in. A probe without it cannot be aimed and fails
  with that message rather than running somewhere unintended.
- The rest is the body of an `async function`, so `await` works and `return`
  is how a result comes back.
- Anything returned is flattened to primitives before it crosses back —
  functions become `"[function name]"`, Blobs become `"[Blob 1234b]"`.
  This is not tidiness: one un-cloneable value fails the entire call with
  "An object could not be cloned", and during the WhatsApp work that
  silently destroyed a diagnostic's own report.

## Running

1. `npm run dev`
2. Open the target site in FlowDesk's Social page and sign in — **once**.
3. Save a probe file here (Ctrl+S is enough — no edit needed). The result is
   written to `probes/out/<name>.json` and summarised in the terminal.

The app stays open the whole time. Saving a probe re-runs it.

## Network capture uses CDP, not page hooks

The network recorder is **not** a probe and **not** an injected script. It
attaches via the Chrome DevTools Protocol in `electron/discovery/cdpRecorder.ts`
and writes a rolling capture to `probes/out/_network-<host>.json` on its own —
no probe save, no user action.

Page-level `fetch`/`XHR` hooks were tried first and have a blind spot that
decided the matter: those hooks live on the main thread's global object, and a
Web Worker has its own. A LinkedIn session that browsed messaging, opened a
thread and *sent a message* produced 201 captured calls with no messaging
request among them — a sent message has to hit the network, so it hit one the
hooks could not see. CDP sits under the renderer and sees every request
whichever thread issued it, plus document navigations and server-sent events.

Cost: one debugger client per WebContents, so opening DevTools on a recorded
view will conflict. Hosts are listed in `CDP_RECORDER_HOSTS` and removed once
that site is no longer being studied.

## Injected scripts belong in CAPTURE_RULES, not in probe files

Anything that must be *listening before you act* — a network recorder, an
event hook — installs automatically on page load via `CAPTURE_RULES` in
`electron/sessions.ts`, not by saving a probe.

Two failures made that necessary, both real:

- A recorder you have to remember to switch on is off when it matters. The
  first LinkedIn attempt had a full browsing session recorded by nothing,
  because installing it was a separate step that got skipped — and the only
  symptom was an empty capture afterwards.
- Injected hooks die on navigation. A reload, or the site's own login
  redirect, wipes them; a manually installed recorder then goes quiet
  mid-session without saying so. `CAPTURE_RULES` re-injects on every
  dom-ready.

Probe files are for *asking questions about what was captured* — the part
that changes constantly while you learn the shape of a site.

## Why this exists

Probes used to live inside the app's source, so changing one question meant
rebuild → relaunch → re-login → wait for sync → copy terminal output by
hand. Two to three minutes per question, on work that needs dozens.

None of that was necessary. A probe is a string of JavaScript evaluated in a
page that is already open — `whatsapp_diagnose` already proved that by
running the same probes with no restart at all.

## What this is not

This is a **development** tool. It is gated behind `!app.isPackaged` and is
never exposed to the in-app agent, deliberately: it evaluates arbitrary
JavaScript inside an authenticated session, and the agent reads message and
post content written by strangers. A tool of this shape cannot be gated by
an approval dialog — there is nothing to show that a user could reasonably
judge. Narrow tools ("send this text to this chat") can be gated precisely
because their parameters say what they will do.
