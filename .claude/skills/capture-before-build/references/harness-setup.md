# Installing the harness in a project that does not have it

The harness is two files, both in `harness/` next to this document. They are
plain TypeScript with no dependencies beyond Electron and Node, and nothing in
them names any particular site — copy them in, wire three blocks, done.

If the project already has `discovery/probeRunner.ts`, it is installed. Skip to
"Using it".

## What the two pieces do

**`probeRunner.ts`** — watches a directory. Save a `.js` file there and it runs
inside a live, logged-in view; the result appears as JSON in `out/`. No rebuild,
no restart, no logging in again. This is what makes looking cheap enough that
you stop guessing.

**`cdpRecorder.ts`** — records network traffic through the Chrome DevTools
Protocol rather than by hooking `fetch` in the page. That distinction matters
and is not a preference:

- A page hook only sees requests the page's own JavaScript makes. Requests from
  an iframe, a worker, or the browser itself are invisible to it.
- CDP sees everything, including streaming responses that never finish — which
  is where push channels live, and a body-fetch API cannot read them at all.

An earlier version of this harness used a page hook, and a capture was misread
for hours because a request attributed to "the page" had in fact come from an
iframe the hook could not see.

## Install

### 1. Copy the files

```
harness/probeRunner.ts   ->  <project>/electron/discovery/probeRunner.ts
harness/cdpRecorder.ts   ->  <project>/electron/discovery/cdpRecorder.ts
```

Create `<project>/probes/` and `<project>/probes/out/`.

### 2. Start the probe runner (main process, after app ready)

```ts
import { join } from 'node:path'
import { app } from 'electron'
import { startProbeRunner } from './discovery/probeRunner'

// Development only, and never in a packaged build. This evaluates arbitrary
// JavaScript inside whatever authenticated session is open — exactly the
// capability that must not ship to users or reach an in-app agent.
if (!app.isPackaged) {
  void startProbeRunner({
    dir: join(app.getAppPath(), 'probes'),
    // Resolve a probe's `@target` substring to a live page in your app.
    resolveView: target => findViewByUrl(target)?.webContents ?? null,
    onResult: (name, result) => {
      const head = result.ok ? 'ok' : `FAILED: ${result.error}`
      console.log(`[probe] ${name} (${result.target}) ${result.durationMs}ms — ${head}`)
      console.log(`[probe] -> probes/out/${name}.json`)
    },
  }).catch(error => console.log('[probe] runner did not start:', error))
}
```

`resolveView` is the only project-specific part: given a URL substring, return
the `webContents` of a matching open view, or null. If the app has one browser
view, return it unconditionally.

### 3. Start the recorder when a target site loads

```ts
import { startCdpRecorder } from './discovery/cdpRecorder'

const RECORDER_HOSTS = ['linkedin.com', 'web.whatsapp.com']   // sites you are reversing

view.webContents.on('dom-ready', () => {
  const url = view.webContents.getURL()
  // Captures contain real message text and contact names, so this never runs
  // in a packaged build.
  const host = app.isPackaged ? undefined : RECORDER_HOSTS.find(h => url.includes(h))
  if (!host) return

  startCdpRecorder({
    webContents: view.webContents,
    urlMatch: host,
    outFile: join(app.getAppPath(), 'probes', 'out', `_network-${host.replace(/\W+/g, '-')}.json`),
    onAttach: info => console.log(`[cdp] ${host}: ${info}`),
  })
})
```

### 4. Keep captures out of version control

```gitignore
probes/out/
```

Captures contain real message text, contact names and session identifiers. This
is not optional.

## Using it

1. `npm run dev`
2. Open the target site in the app and sign in — **once**. The session persists.
3. Save a probe file into `probes/`. Ctrl+S is enough; no edit needed.
4. Read `probes/out/<name>.json`.

The app stays open the whole time. Saving a probe re-runs it.

## Two properties worth knowing

**Everything crossing back is flattened to primitives.** `executeJavaScript`
structured-clones its result, and one un-cloneable value — a function, a Blob, a
DOM node — fails the *whole* call with "An object could not be cloned". A
diagnostic once destroyed its own report that way. The runner serialises
defensively so exploratory probes returning unknown objects do not have to think
about it.

**A probe without `@target` fails rather than running somewhere unintended.**

## The security boundary

**The harness must never be reachable by an in-app agent.** It evaluates
arbitrary JavaScript inside an authenticated session, and an agent that reads
message and post content is reading text written by strangers. There is nothing
meaningful to show in an approval dialog for "run this JavaScript" — a user
cannot judge it. Narrow tools ("send this message to this chat") can be gated
precisely because their arguments say what will happen.

Both files are gated behind `!app.isPackaged`. Keep it that way, and do not
expose either through IPC or as an agent tool.

## Adapting to a non-Electron host

`probeRunner.ts` needs exactly one thing from its host: something that can
evaluate a string in a page and return the result. The interface is:

```ts
resolveView: (targetMatch: string) => { executeJavaScript(src: string): Promise<unknown> } | null
```

Playwright's `page.evaluate`, a browser extension's `chrome.scripting.executeScript`,
or a CDP client all satisfy it. `cdpRecorder.ts` is more Electron-specific
(`webContents.debugger`) but the CDP domains it uses — `Network.enable`,
`Network.getResponseBody`, `Network.streamResourceContent`, `Target.setAutoAttach` —
are standard, so porting is mechanical.
