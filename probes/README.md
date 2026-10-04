# probes/

Autonomous discovery probes for reverse-engineering and automating web apps from inside a live, logged-in FlowDesk session.

Save a `.js` file here and it runs immediately — no rebuild, no app restart, no re-login. The result appears as JSON in `out/`.

---

## 1. Writing an Autonomous Probe

```js
// @target tiktok.com
// @goto https://www.tiktok.com/tiktokstudio/upload
// @file video ./out/generated_videos/alpha_paws_black_cat_phone.mp4
// @timeout 60000

// 1. Autonomous file injection without manual drag-and-drop
await probe.waitFor('input[type="file"]')
const fileResult = await probe.injectFile('input[type="file"]', probe.files.video)

// 2. Wait for Draft.js / Lexical rich text editor and type caption
await probe.waitFor('[contenteditable="true"]')
await probe.type('[contenteditable="true"]', 'Alpha Paws video #viral #fyp')

// 3. Toggle HD and comment switches
await probe.setSwitch('input[name="allow_comments"]', true)

// 4. Synthetically click publish with complete pointer event chain
await probe.click('button[data-e2e="post_video_button"]')

return { status: 'published', file: fileResult }
```

---

## 2. Directives Reference

Directives are parsed from comment headers at the top of the probe file:

- **`// @target <url-substring>`** *(Required)*
  Picks which open Electron view to execute in (e.g. `tiktok.com`, `flow.google.com`, `linkedin.com`, `flowdesk`, or `worker:<tool>`).
- **`// @file <alias> <path>`** *(Optional, multiple allowed)*
  Loads local host files from disk, encodes them as Base64, detects MIME type, and exposes them in-page at `probe.files.<alias>`. Eliminates the need to paste megabytes of Base64 strings into probe code!
- **`// @goto <url>`** *(Optional)*
  Navigates the view to the specified URL before executing the probe script if not already on that page.
- **`// @timeout <ms>`** *(Optional)*
  Overrides default 30s timeout for long-running workflows (e.g. 60000ms).

---

## 3. Autonomous In-Page Toolkit (`window.probe`)

The harness automatically injects the `probe` object into the target view's context:

### `probe.type(selectorOrEl, text, [options])`
Automates text input across both standard HTML inputs and rich contenteditable editors:
- **Inputs & Textareas**: Uses prototype property descriptor setters to bypass React synthetic state wrappers (`_valueTracker`), firing `input` and `change` events.
- **Rich Text Editors** (Draft.js, Lexical, ProseMirror, Slate): Selects content and executes `document.execCommand('insertText', false, text)`, cleanly updating internal immutable state structures without DOM corruption.
- Options: `{ clear: boolean, waitAfterMs: number }`.

### `probe.click(selectorOrEl, [options])`
Dispatches a full user-like event sequence:
- Scrolls element into view: `scrollIntoView({ block: 'center' })`.
- Focuses element.
- Fires `pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click` (plus optional `dblclick`).
- Options: `{ waitAfterMs: number, dblClick: boolean }`.

### `probe.injectFile(selectorOrEl, fileData)`
Injects binary files into `input[type="file"]`:
- Takes `{ base64, filename, mimeType }` (e.g. from `probe.files.<alias>`).
- Synthesizes `Blob` → `File` → `DataTransfer`.
- Assigns `input.files = dt.files` and triggers `change` and `input` events.

### `probe.setSwitch(selectorOrEl, checked, [options])`
Intelligently inspects checkbox state, `aria-checked`, or `data-state="checked"`. If current state does not match `checked`, triggers a synthetic click to toggle it.

### `probe.waitFor(selectorOrConditionFn, [options])`
Asynchronously polls until an element exists (or is visible) or a custom predicate function returns truthy:
- Options: `{ timeoutMs: number, intervalMs: number, visible: boolean }`.

### `probe.captureNetwork(actionFn, [options])`
Temporarily intercepts in-page `window.fetch` and `XMLHttpRequest` during execution of `actionFn`:
- Returns `{ ok: true, result, requests: [{ method, url, requestHeaders, postData, status, responseBody, responseJson }] }`.
- Automatically restores original `fetch` and `XHR` in a `finally` block to ensure zero side-effects.

### `probe.sleep(ms)`
Async delay helper (`await probe.sleep(1000)`).

### `probe.query(selector)` / `probe.queryAll(selector)`
DOM query helpers returning elements or arrays.

### `probe.info()`
Returns `{ url, title, readyState }`.

---

## 4. Running Probes

1. Start FlowDesk: `npm run dev`
2. Open target site in FlowDesk and authenticate (once).
3. Save or edit a probe file in `probes/` (Ctrl+S).
4. The runner executes the probe, logs the summary in the console, and writes the structured result to `probes/out/<name>.json`.
