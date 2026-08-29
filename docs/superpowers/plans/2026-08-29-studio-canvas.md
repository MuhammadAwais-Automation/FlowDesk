# Studio Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An HTML canvas in FlowDesk where the agent designs social posts, app screens, and web pages as sized artboards, and exports them to PNG or PDF.

**Architecture:** A document is one self-contained `document.html` holding `.fd-artboard` elements that carry their own id, size attributes, and inline size custom properties. The agent reads and writes it through nine MCP tools split by whether they change the file, which is also the approval boundary. The canvas is an `<iframe srcdoc>` scaled to fit; export renders offscreen with JavaScript disabled using Electron's own `capturePage` / `printToPDF`. No new dependency.

**Tech Stack:** Electron main process (TypeScript), React 18 renderer, `@anthropic-ai/claude-agent-sdk` MCP tools, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-studio-canvas-design.md`

> **Revision note.** A review of the first draft found ten real defects — all confirmed against the draft. This version fixes them and follows the review's recommended order: the security contract and a spike that actually answers its question come before anything is built on top. Points that changed the approach are marked **[revised]**.

## Global Constraints

- **Repo root:** `E:\FlowDesk`. All paths relative to it.
- **Test:** `npx vitest run <path>` for one file, `npx vitest run` for all. Baseline **615 tests / 40 files**; must still pass at the end of every task.
- **Typecheck:** `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`. Both clean before every commit.
- **Commit after every task.** Uncommitted work in this repo has already been destroyed once by an agent rewriting a file from an older base. A task is not done until it is committed.
- **Never rewrite `electron/main.ts` from scratch or restore it from git** — it holds 60+ IPC handlers. Edit it in place.
- **No new npm dependency.**
- **Electron mocking in tests:** `vi.mock('electron', () => ({ app: { getPath: () => root } }))` before a dynamic `await import()`. See `electron/savedImages.test.ts`.
- **Every filesystem path built from an agent- or renderer-supplied id must go through `studioPath()` (Task 1).** Never `join(documentsRoot(), id)` directly.
- **Every document write must go through `writeDocumentHtml` (Task 5).** Never `writeFile` a `document.html` directly — writes are atomic and serialized.
- **Offscreen render windows run page JavaScript inside a sandbox**, with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. Task 2's spike disproved the first draft's plan of disabling JavaScript outright: with `javascript: false`, `executeJavaScript` itself fails, so the font/image readiness check could not run and exports would silently use fallback faces. A sandboxed, context-isolated, Node-less window is the ordinary browser-tab security model and cannot reach the system.
- **Artboard element contract**, fixed here so every module agrees:
  ```html
  <div class="fd-artboard" data-fd-id="a1" data-fd-name="Slide 1"
       data-fd-w="1080" data-fd-h="1080"
       style="--fd-w:1080px;--fd-h:1080px"></div>
  ```
  Attributes are what the parser reads; the inline custom properties are what the browser lays out from. Both are required — a `data-` attribute does not become a CSS variable.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `electron/studio/paths.ts` (new) | Id validation + containment-checked paths. |
| `electron/studio/artboards.ts` (new) | Pure: parse, splice, append, escape, blank document. |
| `electron/studio/presets.ts` (new) | The 31 presets as data + lookup. |
| `electron/studio/documentStore.ts` (new) | Atomic, serialized document reads and writes. |
| `electron/studio/render.ts` (new) | Offscreen render to PNG / PDF **buffers**. |
| `electron/studio/export.ts` (new) | Write a rendered buffer to Downloads. |
| `electron/agent/studioTools.ts` (new) | The nine agent tools. |
| `electron/agent/tools.ts` (modify) | Register them. |
| `electron/main.ts` (modify) | Studio IPC handlers. |
| `electron/preload.ts`, `src/types/electron.d.ts` (modify) | Bindings and types. |
| `src/hooks/useAgentApprovals.ts` (new) | Approval queue shared by Agent and Studio. |
| `src/pages/StudioCanvas.tsx` (new) | Documents, canvas, zoom. |
| `src/components/studio/StudioChat.tsx` (new) | Chat panel with approvals. |
| `src/App.tsx`, `src/components/layout/LeftNav.tsx`, `src/types/pages.ts` (modify) | New `design` page. |

The canvas is a **new page (`design`)**, not folded into the existing `studio` page: that page hosts third-party web tools (Google Flow) in a `WebContentsView` with a Google-account picker, which has nothing to do with authoring local documents.

---

## Task 1: Path safety

**Files:**
- Create: `electron/studio/paths.ts`
- Test: `electron/studio/paths.test.ts`

**Interfaces:**
- Produces: `documentsRoot()`, `isValidDocumentId(id: unknown): id is string`, `studioPath(id: string, ...segments: string[]): string`

**[revised]** The first draft built paths straight from an agent-supplied id, and one of the operations is a recursive delete. This module exists first because everything else depends on it.

- [ ] **Step 1: Write the failing test**

Create `electron/studio/paths.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const root = join('/tmp', 'fd-studio-paths')
vi.mock('electron', () => ({ app: { getPath: () => root } }))

const { isValidDocumentId, studioPath, documentsRoot } = await import('./paths')

const VALID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('isValidDocumentId', () => {
  it('accepts a UUID, which is the only shape createDocument produces', () => {
    expect(isValidDocumentId(VALID)).toBe(true)
  })

  it('rejects traversal, absolute paths, and separators', () => {
    // deleteDocument does a recursive remove, so an id that escapes the
    // documents directory is not a bug, it is data loss.
    for (const bad of ['..', '../..', '../../etc', '/etc/passwd', 'C:\\Windows', 'a/b', 'a\\b']) {
      expect(isValidDocumentId(bad), bad).toBe(false)
    }
  })

  it('rejects non-strings and empty input', () => {
    for (const bad of [undefined, null, 42, {}, [], '']) {
      expect(isValidDocumentId(bad)).toBe(false)
    }
  })

  it('rejects a UUID with anything appended', () => {
    expect(isValidDocumentId(`${VALID}/../..`)).toBe(false)
    expect(isValidDocumentId(`${VALID}.bak`)).toBe(false)
  })
})

describe('studioPath', () => {
  it('builds a path inside the documents root', () => {
    expect(studioPath(VALID, 'document.html')).toBe(join(documentsRoot(), VALID, 'document.html'))
  })

  it('throws on an invalid id rather than returning a path', () => {
    expect(() => studioPath('..', 'document.html')).toThrow(/document id/i)
  })

  it('throws when a later segment escapes, not only the id', () => {
    expect(() => studioPath(VALID, '..', '..', 'secrets')).toThrow(/outside/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

`npx vitest run electron/studio/paths.test.ts` → FAIL, cannot resolve `./paths`.

- [ ] **Step 3: Write the implementation**

Create `electron/studio/paths.ts`:

```ts
import { join, resolve, sep } from 'path'
import { app } from 'electron'

/**
 * Every filesystem path Studio builds from an id it was handed.
 *
 * Document ids reach the main process from the agent and from the renderer,
 * and one of the operations they drive is a recursive delete. Validating the
 * id shape and then re-checking the resolved path keeps a crafted id from
 * reading, overwriting, or deleting anything outside the documents
 * directory. The same discipline already exists for image filenames in
 * electron/savedImages.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function documentsRoot(): string {
  return join(app.getPath('userData'), 'studio-documents')
}

export function isValidDocumentId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id)
}

export function studioPath(id: string, ...segments: string[]): string {
  if (!isValidDocumentId(id)) {
    throw new Error(`Not a valid Studio document id: ${String(id).slice(0, 80)}`)
  }
  const base = resolve(documentsRoot(), id)
  const target = resolve(base, ...segments)
  // Shape validation alone still allows a crafted later segment, and
  // resolve() is the only thing that knows what the path really became.
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('Refusing a Studio path outside its own document directory.')
  }
  return target
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run electron/studio/paths.test.ts
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/paths.ts electron/studio/paths.test.ts
git commit -m "feat: validate Studio document ids and contain their paths"
```

Expected: 7 tests pass.

---

## Task 2: Spike — what size do Electron's exports actually produce?

**Files:** create `probes/studio-export-size.js` (throwaway)

**Interfaces:** none. The output is an answer written into the spec.

**[revised]** The first draft's probe returned only `pdfBytes`, which cannot answer a question about dimensions. This one reads the PDF's **MediaBox** — the page size recorded inside the file — across square, landscape, and portrait.

- [ ] **Step 1: Add the temporary probe handler**

In `electron/main.ts`, beside the other `debug:` handlers:

```ts
if (!app.isPackaged) {
  ipcMain.handle('debug:studioExportSize', async () => {
    const cases = [
      { name: 'square', w: 1080, h: 1080 },
      { name: 'landscape', w: 1280, h: 720 },
      { name: 'portrait', w: 390, h: 844 },
    ]
    const results: unknown[] = []
    for (const c of cases) {
      const win = new BrowserWindow({
        show: false, width: c.w, height: c.h, useContentSize: true,
        webPreferences: { offscreen: true, javascript: false },
      })
      await win.loadURL('data:text/html,' + encodeURIComponent(
        `<body style="margin:0"><div style="width:${c.w}px;height:${c.h}px;background:#0af"></div></body>`))
      const png = await win.webContents.capturePage()
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: { width: c.w / 96, height: c.h / 96 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      // A PDF records its page size in /MediaBox [x0 y0 x1 y1], in points
      // (72 per inch). Byte length says nothing about dimensions.
      const mediaBox = (pdf.toString('latin1').match(/\/MediaBox\s*\[([^\]]+)\]/) ?? [])[1] ?? 'not found'
      results.push({
        case: c.name,
        asked: `${c.w}x${c.h}`,
        pngSize: png.getSize(),
        pdfMediaBoxPoints: mediaBox,
        pdfMediaBoxAsPixels: mediaBox === 'not found' ? null
          : mediaBox.trim().split(/\s+/).map(n => Math.round(Number(n) * 96 / 72)).join(' '),
        zoomFactor: win.webContents.getZoomFactor(),
      })
      win.destroy()
    }
    return results
  })
}
```

Add the preload binding `studioProbeExportSize: () => ipcRenderer.invoke('debug:studioExportSize'),` and the type `studioProbeExportSize: () => Promise<unknown>`.

- [ ] **Step 2: Write and run the probe**

Create `probes/studio-export-size.js`:

```js
// @target flowdesk
return await window.electronAPI.studioProbeExportSize()
```

Start `npm run dev`, save the probe file, read `probes/out/studio-export-size.json`.

- [ ] **Step 3: Record the answer in the spec**

Append a `## Export sizing (measured)` section to `docs/superpowers/specs/2026-08-29-studio-canvas-design.md` giving, per case: asked size, `pngSize`, `pdfMediaBoxAsPixels`, `zoomFactor`.

State plainly whether PNG matched and whether the MediaBox matched. If either is off by a constant factor, record it — Task 6 divides by it.

- [ ] **Step 4: Remove the probe**

Delete `probes/studio-export-size.js`, the handler, the preload binding, and the type. It was a measurement, not a feature.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: measure Electron PNG and PDF export sizing for artboards"
```

---

## Task 3: Artboard parsing, splicing, and appending (pure)

**Files:** create `electron/studio/artboards.ts`, `electron/studio/artboards.test.ts`

**Interfaces:**
- Produces:
  - `interface Artboard { id: string; name: string; width: number; height: number; html: string }`
  - `parseArtboards(documentHtml: string): Artboard[]`
  - `replaceArtboardHtml(documentHtml: string, id: string, innerHtml: string): string`
  - `appendArtboard(documentHtml: string, artboard: Omit<Artboard, 'html'> & { html?: string }): string`
  - `blankDocument(title: string): string`

- [ ] **Step 1: Write the failing test**

Create `electron/studio/artboards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseArtboards, replaceArtboardHtml, appendArtboard, blankDocument } from './artboards'

const DOC = `<!doctype html>
<html><head><style>:root{--bg:#fff}</style></head>
<body>
<div class="fd-artboard" data-fd-id="a1" data-fd-name="Cover" data-fd-w="1080" data-fd-h="1080" style="--fd-w:1080px;--fd-h:1080px"><h1>One</h1></div>
<div class="fd-artboard" data-fd-id="a2" data-fd-name="Body" data-fd-w="1080" data-fd-h="1350" style="--fd-w:1080px;--fd-h:1350px"><p>Two</p></div>
</body></html>`

describe('parseArtboards', () => {
  it('reads every artboard with its id, name, size, and inner html', () => {
    const boards = parseArtboards(DOC)
    expect(boards).toHaveLength(2)
    expect(boards[0]).toMatchObject({ id: 'a1', name: 'Cover', width: 1080, height: 1080 })
    expect(boards[0].html).toContain('<h1>One</h1>')
    expect(boards[1]).toMatchObject({ id: 'a2', width: 1080, height: 1350 })
  })

  it('returns an empty list for a document with no artboards, not an error', () => {
    expect(parseArtboards('<html><body></body></html>')).toEqual([])
  })

  it('keeps nested divs with the artboard that contains them', () => {
    // Stopping at the first </div> would truncate every real design, which
    // is nested by definition.
    const nested = `<div class="fd-artboard" data-fd-id="x" data-fd-name="N" data-fd-w="100" data-fd-h="100"><div><span>deep</span></div></div>`
    expect(parseArtboards(nested)[0].html).toBe('<div><span>deep</span></div>')
  })

  it('throws on an artboard that is never closed rather than returning half a result', () => {
    expect(() => parseArtboards('<div class="fd-artboard" data-fd-id="x"><p>')).toThrow(/closed/i)
  })
})

describe('replaceArtboardHtml', () => {
  it('replaces only the named artboard and leaves the rest byte-identical', () => {
    const next = replaceArtboardHtml(DOC, 'a1', '<h1>Changed</h1>')
    expect(next).toContain('<h1>Changed</h1>')
    expect(next).not.toContain('<h1>One</h1>')
    expect(next).toContain('<p>Two</p>')
    expect(next).toContain('--bg:#fff')
  })

  it('throws with the real ids when the id does not exist', () => {
    expect(() => replaceArtboardHtml(DOC, 'nope', '<p/>')).toThrow(/a1/)
  })
})

describe('appendArtboard', () => {
  it('writes the size as inline custom properties, not only attributes', () => {
    // The stylesheet lays out from var(--fd-w); a data- attribute is not a
    // CSS variable, so attributes alone render every artboard at the
    // fallback size regardless of what it declares.
    const next = appendArtboard(DOC, { id: 'a3', name: 'New', width: 390, height: 844 })
    expect(next).toContain('--fd-w:390px')
    expect(next).toContain('--fd-h:844px')
  })

  it('adds the artboard before the closing body tag, in order', () => {
    const next = appendArtboard(DOC, { id: 'a3', name: 'New', width: 390, height: 844 })
    expect(parseArtboards(next).map(b => b.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('escapes the name so a quote cannot break the document', () => {
    const next = appendArtboard(DOC, { id: 'a4', name: 'He said "hi" & <b>', width: 10, height: 10 })
    expect(next).not.toContain('data-fd-name="He said "hi"')
    expect(parseArtboards(next)).toHaveLength(3)
    expect(parseArtboards(next)[2].name).toContain('&quot;')
  })

  it('refuses a duplicate id rather than creating an ambiguous document', () => {
    expect(() => appendArtboard(DOC, { id: 'a1', name: 'Dup', width: 10, height: 10 })).toThrow(/a1/)
  })
})

describe('blankDocument', () => {
  it('produces a parseable document with no artboards', () => {
    expect(parseArtboards(blankDocument('My Post'))).toEqual([])
  })

  it('escapes the title', () => {
    expect(blankDocument('A "quoted" & <tagged> title')).not.toContain('<tagged>')
  })

  it('round-trips: appending then parsing returns what was appended', () => {
    const doc = appendArtboard(blankDocument('T'), { id: 'z1', name: 'Z', width: 1280, height: 720 })
    expect(parseArtboards(doc)[0]).toMatchObject({ id: 'z1', name: 'Z', width: 1280, height: 720 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

`npx vitest run electron/studio/artboards.test.ts` → FAIL.

- [ ] **Step 3: Write the implementation**

Create `electron/studio/artboards.ts`:

```ts
/**
 * Reading and editing artboards inside a document's HTML.
 *
 * The HTML file is the source of truth, so these functions never reformat
 * anything they were not asked to change: an edit to one artboard leaves
 * every other byte alone, or the user's hand edits and the agent's edits
 * would fight each other.
 *
 * Depth tracking rather than a regex for the closing tag: a real design is
 * nested, and matching the first </div> would silently truncate every
 * artboard to its first child.
 */

export interface Artboard {
  id: string
  name: string
  width: number
  height: number
  /** Inner HTML only — the wrapper element belongs to the document. */
  html: string
}

const OPEN_TAG = /<div\s+class="fd-artboard"([^>]*)>/g

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attribute(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return match ? match[1] : ''
}

/** Index of the `</div>` closing the element opened just before `afterOpen`. */
function findClose(html: string, afterOpen: number): number {
  let depth = 1
  let i = afterOpen
  while (i < html.length) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)
    if (nextClose === -1) return -1
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
      continue
    }
    depth--
    if (depth === 0) return nextClose
    i = nextClose + 6
  }
  return -1
}

interface Located extends Artboard {
  start: number
  end: number
}

function locate(documentHtml: string): Located[] {
  const found: Located[] = []
  OPEN_TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = OPEN_TAG.exec(documentHtml)) !== null) {
    const attrs = match[1]
    const start = match.index + match[0].length
    const end = findClose(documentHtml, start)
    if (end === -1) throw new Error('Malformed document: an fd-artboard element is never closed.')
    found.push({
      id: attribute(attrs, 'data-fd-id'),
      name: attribute(attrs, 'data-fd-name'),
      width: Number(attribute(attrs, 'data-fd-w')) || 0,
      height: Number(attribute(attrs, 'data-fd-h')) || 0,
      html: documentHtml.slice(start, end),
      start,
      end,
    })
    OPEN_TAG.lastIndex = end
  }
  return found
}

export function parseArtboards(documentHtml: string): Artboard[] {
  return locate(documentHtml).map(({ start: _s, end: _e, ...board }) => board)
}

export function replaceArtboardHtml(documentHtml: string, id: string, innerHtml: string): string {
  const boards = locate(documentHtml)
  const target = boards.find(board => board.id === id)
  if (!target) {
    throw new Error(`No artboard "${id}" in this document. Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
  }
  return documentHtml.slice(0, target.start) + innerHtml + documentHtml.slice(target.end)
}

export function appendArtboard(
  documentHtml: string,
  artboard: Omit<Artboard, 'html'> & { html?: string },
): string {
  if (parseArtboards(documentHtml).some(board => board.id === artboard.id)) {
    throw new Error(`Artboard id "${artboard.id}" is already used in this document.`)
  }
  const { id, name, width, height } = artboard
  // The inline custom properties are what the browser lays out from; the
  // data- attributes are what the parser reads. Both, always.
  const element =
    `\n<div class="fd-artboard" data-fd-id="${escapeAttribute(id)}" data-fd-name="${escapeAttribute(name)}"` +
    ` data-fd-w="${width}" data-fd-h="${height}"` +
    ` style="--fd-w:${width}px;--fd-h:${height}px">${artboard.html ?? ''}</div>\n`
  const closing = documentHtml.lastIndexOf('</body>')
  if (closing === -1) return documentHtml + element
  return documentHtml.slice(0, closing) + element + documentHtml.slice(closing)
}

export function blankDocument(title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeAttribute(title)}</title>
<style>
  :root { --bg: #ffffff; --text: #111111; }
  body { margin: 0; background: #e9e6df; font-family: system-ui, sans-serif; }
  .fd-artboard {
    width: var(--fd-w, 1080px);
    height: var(--fd-h, 1080px);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    position: relative;
    margin: 24px auto;
    box-shadow: 0 2px 18px rgba(0,0,0,0.12);
  }
</style>
</head>
<body>
</body>
</html>`
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run electron/studio/artboards.test.ts
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/artboards.ts electron/studio/artboards.test.ts
git commit -m "feat: parse, splice, and append Studio artboards with real sizes"
```

Expected: 12 tests pass.

---

## Task 4: Presets as data

**Files:** create `electron/studio/presets.ts`, `electron/studio/presets.test.ts`

**Interfaces:** `interface StudioPreset { id, name, vibe, bestFor, avoidFor, fontsLink, cssTokens }`, `STUDIO_PRESETS`, `findPreset(name)`

- [ ] **Step 1: Generate the data**

Save as `scripts/import-presets.mjs`, run `node scripts/import-presets.mjs`, then delete it:

```js
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const md = readFileSync('crausel system for refrence/carousel-presets.md', 'utf8')
const blocks = md.split(/^## /m).slice(1).filter(b => /^\d+\./.test(b))

const pick = (b, label) => {
  const m = b.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]*)`))
  return m ? m[1].trim() : ''
}

const presets = blocks.map(b => {
  const name = b.split('\n')[0].replace(/^\d+\.\s*/, '').trim()
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    name,
    vibe: pick(b, 'Vibe'),
    bestFor: pick(b, 'Best for'),
    avoidFor: pick(b, 'Avoid for'),
    fontsLink: (b.match(/<link[^>]*>/) ?? [''])[0],
    cssTokens: (b.match(/:root \{[\s\S]*?\n\}/) ?? [''])[0],
  }
})

const header = `/**
 * Design presets, imported from the linkedin-carousel reference repo.
 *
 * Data, not code: each preset is the font pairing and CSS custom properties
 * that define a look. Imported rather than read from the reference directory
 * at runtime so deleting that clone cannot break the app, and so the agent
 * can look one up by name instead of parsing markdown.
 */

export interface StudioPreset {
  id: string
  name: string
  vibe: string
  bestFor: string
  avoidFor: string
  /** Google Fonts <link> tag the preset expects. */
  fontsLink: string
  /** A :root { ... } block of CSS custom properties. */
  cssTokens: string
}

export const STUDIO_PRESETS: StudioPreset[] = `

const footer = `

/** Case-insensitive lookup by id or name. Null rather than a throw: the caller reports the near misses. */
export function findPreset(name: string): StudioPreset | null {
  const needle = String(name ?? '').trim().toLowerCase()
  if (!needle) return null
  return STUDIO_PRESETS.find(p => p.id === needle || p.name.toLowerCase() === needle) ?? null
}
`

mkdirSync('electron/studio', { recursive: true })
writeFileSync('electron/studio/presets.ts', header + JSON.stringify(presets, null, 2) + footer, 'utf8')
console.log('wrote', presets.length, 'presets')
```

Expected: `wrote 31 presets`. A different count means the reference file changed — inspect it rather than continuing with partial data.

- [ ] **Step 2: Write the test**

Create `electron/studio/presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { STUDIO_PRESETS, findPreset } from './presets'

describe('STUDIO_PRESETS', () => {
  it('holds all 31 presets from the reference repo', () => {
    expect(STUDIO_PRESETS).toHaveLength(31)
  })

  it('gives every preset the fields the agent chooses on', () => {
    for (const preset of STUDIO_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9-]+$/)
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.vibe.length).toBeGreaterThan(0)
    }
  })

  it('carries real CSS tokens, since a preset with none is just a name', () => {
    expect(STUDIO_PRESETS.filter(p => p.cssTokens.includes(':root')).length).toBeGreaterThanOrEqual(25)
  })
})

describe('findPreset', () => {
  it('finds by name regardless of case, and by id', () => {
    const first = STUDIO_PRESETS[0]
    expect(findPreset(first.name)?.id).toBe(first.id)
    expect(findPreset(first.name.toUpperCase())?.id).toBe(first.id)
    expect(findPreset(first.id)?.name).toBe(first.name)
  })

  it('returns null for an unknown or empty name rather than guessing', () => {
    expect(findPreset('not a preset')).toBeNull()
    expect(findPreset('')).toBeNull()
  })
})
```

- [ ] **Step 3: Run, typecheck, commit**

```bash
npx vitest run electron/studio/presets.test.ts
npx tsc --noEmit -p tsconfig.node.json
rm scripts/import-presets.mjs
git add electron/studio/presets.ts electron/studio/presets.test.ts
git commit -m "feat: import the 31 carousel design presets as Studio data"
```

Expected: 5 tests pass.

---

## Task 5: Document store — atomic and serialized

**Files:** create `electron/studio/documentStore.ts`, `electron/studio/documentStore.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 3.
- Produces: `StudioDocumentMeta`, `listDocuments`, `createDocument`, `readDocumentHtml`, `writeDocumentHtml`, `renameDocument`, `deleteDocument`, `assetsDir`, `studioDocumentChanged`

**[revised]** Writes are atomic (temp file then rename) and serialized per document. A plain `writeFile` truncates first, so an export or canvas reload landing in that window would read half a document — which the first draft's spec promised safety from and its code did not provide.

- [ ] **Step 1: Write the failing test**

Create `electron/studio/documentStore.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

const store = await import('./documentStore')
const { appendArtboard } = await import('./artboards')

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'fd-studio-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('createDocument and listDocuments', () => {
  it('creates a document that then appears in the list', async () => {
    const created = await store.createDocument('My Carousel')
    const all = await store.listDocuments()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: created.id, title: 'My Carousel' })
    expect(created.artboards).toEqual([])
  })

  it('returns an empty list before anything is created', async () => {
    expect(await store.listDocuments()).toEqual([])
  })
})

describe('writeDocumentHtml', () => {
  it('derives the artboard registry from the HTML that was written', async () => {
    const doc = await store.createDocument('T')
    const html = appendArtboard(
      appendArtboard((await store.readDocumentHtml(doc.id))!, { id: 'a1', name: 'One', width: 1080, height: 1080 }),
      { id: 'a2', name: 'Two', width: 390, height: 844 },
    )
    const meta = await store.writeDocumentHtml(doc.id, html)
    expect(meta.artboards.map(a => a.id)).toEqual(['a1', 'a2'])
    expect(meta.artboards[1]).toMatchObject({ width: 390, height: 844 })
  })

  it('leaves the assets directory untouched', async () => {
    const doc = await store.createDocument()
    await mkdir(store.assetsDir(doc.id), { recursive: true })
    await writeFile(join(store.assetsDir(doc.id), 'keep.png'), 'x')
    await store.writeDocumentHtml(doc.id, '<html><body></body></html>')
    expect(await readFile(join(store.assetsDir(doc.id), 'keep.png'), 'utf8')).toBe('x')
  })

  it('leaves no temporary file behind after a write', async () => {
    // An atomic write renames its temp file into place; a leftover .tmp
    // means the rename never happened and a reader could find it.
    const doc = await store.createDocument()
    await store.writeDocumentHtml(doc.id, '<html><body>done</body></html>')
    const entries = await readdir(join(root, 'studio-documents', doc.id))
    expect(entries.filter(e => e.includes('.tmp'))).toEqual([])
  })

  it('serializes concurrent writes so the file is never a blend of two', async () => {
    const doc = await store.createDocument()
    await Promise.all([
      store.writeDocumentHtml(doc.id, '<html><body>A</body></html>'),
      store.writeDocumentHtml(doc.id, '<html><body>B</body></html>'),
      store.writeDocumentHtml(doc.id, '<html><body>C</body></html>'),
    ])
    expect(['<html><body>A</body></html>', '<html><body>B</body></html>', '<html><body>C</body></html>'])
      .toContain(await store.readDocumentHtml(doc.id))
  })
})

describe('id safety', () => {
  it('refuses to read, write, or delete with a traversing id', async () => {
    expect(await store.readDocumentHtml('../..')).toBeNull()
    await expect(store.writeDocumentHtml('../..', '<html></html>')).rejects.toThrow()
    await expect(store.deleteDocument('../..')).rejects.toThrow()
  })
})

describe('resilience', () => {
  it('rebuilds meta from the HTML when meta.json is missing', async () => {
    const doc = await store.createDocument('Recoverable')
    const html = appendArtboard((await store.readDocumentHtml(doc.id))!, { id: 'z', name: 'Z', width: 100, height: 200 })
    await store.writeDocumentHtml(doc.id, html)
    await rm(join(root, 'studio-documents', doc.id, 'meta.json'))
    const all = await store.listDocuments()
    expect(all).toHaveLength(1)
    expect(all[0].artboards.map(a => a.id)).toEqual(['z'])
  })

  it('returns null for an unknown document rather than throwing', async () => {
    expect(await store.readDocumentHtml('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBeNull()
  })
})

describe('rename and delete', () => {
  it('renames without losing the HTML', async () => {
    const doc = await store.createDocument('Old')
    await store.renameDocument(doc.id, 'New')
    expect((await store.listDocuments())[0].title).toBe('New')
    expect(await store.readDocumentHtml(doc.id)).toContain('fd-artboard')
  })

  it('deletes exactly one document', async () => {
    const a = await store.createDocument('A')
    const b = await store.createDocument('B')
    await store.deleteDocument(a.id)
    expect((await store.listDocuments()).map(d => d.id)).toEqual([b.id])
  })
})

describe('studioDocumentChanged', () => {
  it('fires after a write so the canvas can follow the agent', async () => {
    const doc = await store.createDocument()
    const seen: string[] = []
    store.studioDocumentChanged.on('changed', (id: string) => seen.push(id))
    await store.writeDocumentHtml(doc.id, '<html><body></body></html>')
    expect(seen).toEqual([doc.id])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

`npx vitest run electron/studio/documentStore.test.ts` → FAIL.

- [ ] **Step 3: Write the implementation**

Create `electron/studio/documentStore.ts`:

```ts
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { join } from 'path'
import { documentsRoot, isValidDocumentId, studioPath } from './paths'
import { blankDocument, parseArtboards } from './artboards'

/**
 * Filesystem home for Studio documents.
 *
 * `document.html` is the source of truth and `meta.json` is a cache of what
 * it says, which is why every write re-derives the registry from the HTML
 * and why a missing meta.json is rebuilt rather than treated as a lost
 * document. The user can edit the HTML by hand and the app still agrees.
 *
 * Writes are atomic and serialized per document: a plain writeFile truncates
 * before writing, so an export or a canvas reload landing in that window
 * would read a half-written file.
 */

export interface StudioArtboardMeta {
  id: string
  name: string
  width: number
  height: number
}

export interface StudioDocumentMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  artboards: StudioArtboardMeta[]
}

/** Fires after any write, so the Studio page can follow the agent's edits. */
export const studioDocumentChanged = new EventEmitter()

const htmlPath = (id: string) => studioPath(id, 'document.html')
const metaPath = (id: string) => studioPath(id, 'meta.json')

export function assetsDir(id: string): string {
  return studioPath(id, 'assets')
}

/** One promise chain per document, so two writes cannot interleave. */
const writeChains = new Map<string, Promise<unknown>>()

function serialize<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(id) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(run)
  writeChains.set(id, next.catch(() => {}))
  return next
}

async function writeAtomic(target: string, contents: string): Promise<void> {
  const temporary = `${target}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(temporary, contents, 'utf8')
  await rename(temporary, target)
}

export async function readDocumentHtml(id: string): Promise<string | null> {
  if (!isValidDocumentId(id)) return null
  try {
    return await readFile(htmlPath(id), 'utf8')
  } catch {
    return null
  }
}

function registryFrom(html: string): StudioArtboardMeta[] {
  return parseArtboards(html).map(({ id, name, width, height }) => ({ id, name, width, height }))
}

async function readMeta(id: string): Promise<StudioDocumentMeta | null> {
  if (!isValidDocumentId(id)) return null
  try {
    return JSON.parse(await readFile(metaPath(id), 'utf8')) as StudioDocumentMeta
  } catch {
    // Rebuild from the HTML rather than dropping the document: meta.json is
    // only a cache, and losing it must not lose the user's work.
    const html = await readDocumentHtml(id)
    if (html === null) return null
    const now = new Date().toISOString()
    const rebuilt: StudioDocumentMeta = { id, title: id, createdAt: now, updatedAt: now, artboards: registryFrom(html) }
    await writeAtomic(metaPath(id), JSON.stringify(rebuilt, null, 2)).catch(() => {})
    return rebuilt
  }
}

export async function listDocuments(): Promise<StudioDocumentMeta[]> {
  let entries: string[]
  try {
    entries = await readdir(documentsRoot())
  } catch {
    return []
  }
  const metas: StudioDocumentMeta[] = []
  for (const entry of entries) {
    const meta = await readMeta(entry)
    if (meta) metas.push(meta)
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createDocument(title = 'Untitled'): Promise<StudioDocumentMeta> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await mkdir(assetsDir(id), { recursive: true })
  await writeAtomic(htmlPath(id), blankDocument(title))
  const meta: StudioDocumentMeta = { id, title, createdAt: now, updatedAt: now, artboards: [] }
  await writeAtomic(metaPath(id), JSON.stringify(meta, null, 2))
  return meta
}

export function writeDocumentHtml(id: string, html: string): Promise<StudioDocumentMeta> {
  if (!isValidDocumentId(id)) {
    return Promise.reject(new Error(`Not a valid Studio document id: ${String(id).slice(0, 80)}`))
  }
  return serialize(id, async () => {
    const existing = await readMeta(id)
    if (!existing) throw new Error(`No Studio document "${id}".`)
    await writeAtomic(htmlPath(id), html)
    const meta: StudioDocumentMeta = {
      ...existing,
      updatedAt: new Date().toISOString(),
      artboards: registryFrom(html),
    }
    await writeAtomic(metaPath(id), JSON.stringify(meta, null, 2))
    studioDocumentChanged.emit('changed', id)
    return meta
  })
}

export function renameDocument(id: string, title: string): Promise<void> {
  if (!isValidDocumentId(id)) return Promise.reject(new Error('Not a valid Studio document id.'))
  return serialize(id, async () => {
    const existing = await readMeta(id)
    if (!existing) return
    await writeAtomic(metaPath(id), JSON.stringify({ ...existing, title, updatedAt: new Date().toISOString() }, null, 2))
    studioDocumentChanged.emit('changed', id)
  })
}

export async function deleteDocument(id: string): Promise<void> {
  if (!isValidDocumentId(id)) throw new Error(`Not a valid Studio document id: ${String(id).slice(0, 80)}`)
  await rm(join(documentsRoot(), id), { recursive: true, force: true })
  writeChains.delete(id)
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run electron/studio/documentStore.test.ts
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/documentStore.ts electron/studio/documentStore.test.ts
git commit -m "feat: add an atomic, serialized, id-validated Studio document store"
```

Expected: 12 tests pass.

---

## Task 6: Offscreen rendering to buffers

**Files:** create `electron/studio/render.ts`

**Interfaces:**
- Produces: `renderArtboardPng(documentId, artboardId): Promise<Buffer>`, `renderDocumentPdf(documentId): Promise<Buffer>`

**[revised]** This module writes nothing. Splitting rendering from writing is what makes `studio_screenshot` genuinely read-only — the first draft had it call the exporter, so every look wrote a file into Downloads.

Read Task 2's `## Export sizing (measured)` section first. It already recorded two findings this
code depends on: the content size must be set **after** `loadURL` or captures are clipped, and
`javascript: false` breaks `executeJavaScript`, so the readiness check needs page JavaScript
enabled in a sandbox. Both are applied below.

The spike found no constant scale factor to correct for: PNG matched every requested size once
the content size was set, and the PDF MediaBox matched square and landscape exactly (portrait
is 390.72x844.16 before rounding). Do not add a correction factor that the measurement did not
call for.

- [ ] **Step 1: Write the implementation**

Create `electron/studio/render.ts`:

```ts
import { BrowserWindow } from 'electron'
import { readDocumentHtml } from './documentStore'
import { parseArtboards, type Artboard } from './artboards'

/**
 * Renders artboards offscreen at their declared size, returning bytes.
 *
 * Nothing here touches the filesystem: a screenshot the agent takes to check
 * its own work must not litter the user's Downloads folder, and keeping the
 * write in a separate module is what keeps that boundary honest.
 *
 * The visible canvas is scaled to fit its panel, so capturing it would
 * export whatever zoom the user happened to be at. A dedicated offscreen
 * window sized to the artboard makes exported pixels match the design's own
 * numbers.
 *
 * JavaScript is disabled: this HTML was written by a model, and a static
 * design has no reason to execute anything.
 */

/** Waits for fonts and images — a preset's Google Font arriving late would otherwise export the fallback face. */
const READY_SCRIPT = `
  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...Array.from(document.images).map(img => img.complete ? Promise.resolve() : img.decode().catch(() => {})),
  ]).then(() => true)
`

async function withOffscreen<T>(
  html: string,
  width: number,
  height: number,
  run: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      // Task 2's spike: with javascript:false, executeJavaScript itself
      // fails, so the readiness check below cannot run and a late Google
      // Font exports as the fallback face. Sandboxed + context-isolated +
      // no Node is the ordinary browser-tab model; the page cannot reach
      // the system.
      javascript: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // Task 2's spike: a window CONSTRUCTED at 1080x1080 reported a content
    // size of 1080x852, and capturePage was clipped to it. Setting the
    // content size after the load is what makes the captured pixels match
    // the artboard's declared size.
    win.setContentSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
    await win.webContents.executeJavaScript(READY_SCRIPT).catch(() => {})
    return await run(win)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function headOf(documentHtml: string): string {
  const end = documentHtml.indexOf('</head>')
  return end === -1 ? '<html><head>' : documentHtml.slice(0, end)
}

/** One artboard alone on a page, at its own size, with the document's own styles. */
function isolate(documentHtml: string, board: Artboard): string {
  return `${headOf(documentHtml)}
<style>
  body { margin: 0; background: transparent; }
  .fd-artboard { margin: 0 !important; box-shadow: none !important; }
</style>
</head><body>
<div class="fd-artboard" data-fd-id="${board.id}" data-fd-w="${board.width}" data-fd-h="${board.height}"
     style="--fd-w:${board.width}px;--fd-h:${board.height}px">${board.html}</div>
</body></html>`
}

async function loadBoards(documentId: string) {
  const documentHtml = await readDocumentHtml(documentId)
  if (documentHtml === null) throw new Error(`No Studio document "${documentId}".`)
  return { documentHtml, boards: parseArtboards(documentHtml) }
}

export async function renderArtboardPng(documentId: string, artboardId: string): Promise<Buffer> {
  const { documentHtml, boards } = await loadBoards(documentId)
  const board = boards.find(b => b.id === artboardId)
  if (!board) {
    throw new Error(`No artboard "${artboardId}". Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
  }
  const image = await withOffscreen(isolate(documentHtml, board), board.width, board.height,
    // An explicit rect, measured exact in the spike, rather than trusting
    // whatever the window currently believes its content size to be.
    win => win.webContents.capturePage({ x: 0, y: 0, width: board.width, height: board.height }))
  return image.toPNG()
}

export async function renderDocumentPdf(documentId: string): Promise<Buffer> {
  const { documentHtml, boards } = await loadBoards(documentId)
  if (boards.length === 0) throw new Error('That document has no artboards to export.')

  // printToPDF takes ONE page size for the whole document, so mixed sizes
  // cannot become one correct PDF. Refusing beats silently cropping or
  // letterboxing; PNG export stays per-artboard and is unaffected.
  const sizes = [...new Set(boards.map(b => `${b.width}x${b.height}`))]
  if (sizes.length > 1) {
    throw new Error(
      `PDF export needs every artboard to be the same size; this document has ${sizes.join(' and ')}. ` +
      `Export the artboards as PNGs instead, or split them into separate documents.`,
    )
  }

  const { width, height } = boards[0]
  return await withOffscreen(documentHtml, width, height * boards.length,
    win => win.webContents.printToPDF({
      printBackground: true,
      // Page size is in inches; CSS pixels are 96 to the inch.
      pageSize: { width: width / 96, height: height / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }))
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/render.ts
git commit -m "feat: render Studio artboards offscreen to PNG and PDF buffers"
```

No unit test: every line is Electron window behaviour a unit test would have to mock into meaninglessness. Task 13 verifies it against real output.

---

## Task 7: Writing exports to disk

**Files:** create `electron/studio/export.ts`

**Interfaces:** `exportArtboardPng(documentId, artboardId): Promise<string>`, `exportDocumentPdf(documentId): Promise<string>`

- [ ] **Step 1: Write the implementation**

Create `electron/studio/export.ts`:

```ts
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { renderArtboardPng, renderDocumentPdf } from './render'
import { readDocumentHtml, listDocuments } from './documentStore'
import { parseArtboards } from './artboards'
import { safeImageFileName } from '../savedImages'

/**
 * The only place a rendered artboard becomes a file.
 *
 * Kept apart from render.ts so the agent's screenshot tool can look at an
 * artboard without writing anything, which is what its read-only label has
 * to mean.
 */

async function exportDir(): Promise<string> {
  const dir = join(app.getPath('downloads'), 'FlowDesk Studio')
  await mkdir(dir, { recursive: true })
  return dir
}

export async function exportArtboardPng(documentId: string, artboardId: string): Promise<string> {
  const bytes = await renderArtboardPng(documentId, artboardId)
  const html = await readDocumentHtml(documentId)
  const board = html ? parseArtboards(html).find(b => b.id === artboardId) : null
  // The artboard's own name, not its generated id: the user opens this file
  // in Downloads and has to recognise it.
  const filePath = join(await exportDir(), safeImageFileName(board?.name || artboardId, 'png', artboardId))
  await writeFile(filePath, bytes)
  return filePath
}

export async function exportDocumentPdf(documentId: string): Promise<string> {
  const bytes = await renderDocumentPdf(documentId)
  const title = (await listDocuments()).find(d => d.id === documentId)?.title ?? documentId
  const filePath = join(await exportDir(), safeImageFileName(title, 'pdf', documentId))
  await writeFile(filePath, bytes)
  return filePath
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/export.ts
git commit -m "feat: write Studio exports to Downloads under readable names"
```

---

## Task 8: The nine agent tools

**Files:** create `electron/agent/studioTools.ts`, `electron/agent/studioTools.test.ts`; modify `electron/agent/tools.ts`

Read `electron/agent/flowTools.ts` first — it already does approval-gated tools and MCP image blocks.

- [ ] **Step 1: Write the tools**

Create `electron/agent/studioTools.ts`:

```ts
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'crypto'
import type { RequestApproval } from './approval'
import { listDocuments, createDocument, readDocumentHtml, writeDocumentHtml } from '../studio/documentStore'
import { parseArtboards, replaceArtboardHtml, appendArtboard } from '../studio/artboards'
import { STUDIO_PRESETS, findPreset } from '../studio/presets'
import { renderArtboardPng } from '../studio/render'
import { exportArtboardPng, exportDocumentPdf } from '../studio/export'

/**
 * Studio's agent surface.
 *
 * Split into read and write, which is also the approval boundary: reads only
 * look and run freely, writes change a real file and are gated. The split
 * mirrors the one paper.design arrived at for the same job.
 */

const MAX_TOOL_TEXT = 12_000

function ok(value: unknown) {
  const out = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text' as const, text: out.length > MAX_TOOL_TEXT ? out.slice(0, MAX_TOOL_TEXT) + '\n\n[truncated]' : out }] }
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

async function guard<T>(run: () => Promise<T>) {
  try {
    return ok(await run())
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

export const STUDIO_TOOL_NAMES = [
  'mcp__workers__studio_list_documents',
  'mcp__workers__studio_get_html',
  'mcp__workers__studio_screenshot',
  'mcp__workers__studio_list_presets',
  'mcp__workers__studio_create_document',
  'mcp__workers__studio_create_artboard',
  'mcp__workers__studio_write_html',
  'mcp__workers__studio_update_styles',
  'mcp__workers__studio_export',
]

export function createStudioTools(requestApproval: RequestApproval) {
  const readOnly = { annotations: { readOnlyHint: true } }

  return [
    tool(
      'studio_list_documents',
      'List every Studio document with its artboards (id, name, width, height). Start here to find what already exists before creating anything.',
      {},
      () => guard(async () => await listDocuments()),
      readOnly,
    ),

    tool(
      'studio_get_html',
      "Read a Studio document's HTML, or one artboard's inner HTML. Read before writing so an edit preserves what is already there.",
      {
        documentId: z.string(),
        artboardId: z.string().optional().describe('Omit for the whole document; give an id for just that artboard.'),
      },
      ({ documentId, artboardId }) => guard(async () => {
        const html = await readDocumentHtml(documentId)
        if (html === null) throw new Error(`No Studio document "${documentId}".`)
        if (!artboardId) return html
        const boards = parseArtboards(html)
        const board = boards.find(b => b.id === artboardId)
        if (!board) throw new Error(`No artboard "${artboardId}". Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
        return board.html
      }),
      readOnly,
    ),

    tool(
      'studio_screenshot',
      'See an artboard as it actually renders. Use this after writing HTML and before telling the user it is done — it is the only way to tell a correct layout from a broken one. Writes nothing to disk.',
      { documentId: z.string(), artboardId: z.string() },
      async ({ documentId, artboardId }) => {
        try {
          const bytes = await renderArtboardPng(documentId, artboardId)
          return {
            content: [
              { type: 'text' as const, text: `${artboardId} rendered (${bytes.length} bytes)` },
              { type: 'image' as const, data: bytes.toString('base64'), mimeType: 'image/png' },
            ],
          }
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
      },
      readOnly,
    ),

    tool(
      'studio_list_presets',
      'List the 31 design presets with their vibe and what each is best and worst for. Choose one before generating a design rather than inventing a palette.',
      {},
      () => guard(async () => STUDIO_PRESETS.map(({ id, name, vibe, bestFor, avoidFor }) => ({ id, name, vibe, bestFor, avoidFor }))),
      readOnly,
    ),

    tool(
      'studio_create_document',
      "Create a new Studio document, optionally seeded with a preset's fonts and CSS tokens.",
      {
        title: z.string().describe('What this document is, e.g. "Q3 launch carousel".'),
        preset: z.string().optional().describe('A preset id or name from studio_list_presets.'),
      },
      async ({ title, preset }) => {
        // Validate the preset BEFORE creating anything, or an unknown name
        // leaves an empty document behind.
        const chosen = preset ? findPreset(preset) : null
        if (preset && !chosen) {
          return fail(`No preset "${preset}". Available: ${STUDIO_PRESETS.map(p => p.name).join(', ')}`)
        }
        if (!await requestApproval({
          tool: 'studio_create_document',
          title: `Create Studio document "${title}"`,
          ...(chosen ? { detail: `Preset: ${chosen.name}` } : {}),
        })) {
          return fail('The user declined creating that document.')
        }
        return guard(async () => {
          const meta = await createDocument(title)
          if (!chosen) return meta
          const html = (await readDocumentHtml(meta.id))!
            .replace('</head>', `${chosen.fontsLink}\n<style>${chosen.cssTokens}</style>\n</head>`)
          return await writeDocumentHtml(meta.id, html)
        })
      },
    ),

    tool(
      'studio_create_artboard',
      'Add an artboard of a given pixel size. A carousel is several 1080x1080 artboards; a LinkedIn post one 1080x1350; a YouTube thumbnail 1280x720; an app screen 390x844; a web page one tall artboard such as 1440x3000. Keep every artboard in a document the same size if you want a PDF of it.',
      {
        documentId: z.string(),
        name: z.string().describe('Human label, e.g. "Slide 3".'),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      },
      async ({ documentId, name, width, height }) => {
        if (!await requestApproval({ tool: 'studio_create_artboard', title: `Add ${width}x${height} artboard "${name}"` })) {
          return fail('The user declined adding that artboard.')
        }
        return guard(async () => {
          const html = await readDocumentHtml(documentId)
          if (html === null) throw new Error(`No Studio document "${documentId}".`)
          const id = `ab-${randomUUID().slice(0, 8)}`
          return await writeDocumentHtml(documentId, appendArtboard(html, { id, name, width, height }))
        })
      },
    ),

    tool(
      'studio_write_html',
      "Replace one artboard's inner HTML. Everything outside that artboard is untouched, so this is safe to call repeatedly while iterating on one slide.",
      {
        documentId: z.string(),
        artboardId: z.string(),
        html: z.string().describe('Inner HTML for the artboard. Do not include the artboard wrapper element itself.'),
      },
      async ({ documentId, artboardId, html }) => {
        if (!await requestApproval({ tool: 'studio_write_html', title: `Write ${html.length} characters into artboard ${artboardId}` })) {
          return fail('The user declined that edit.')
        }
        return guard(async () => {
          const documentHtml = await readDocumentHtml(documentId)
          if (documentHtml === null) throw new Error(`No Studio document "${documentId}".`)
          return await writeDocumentHtml(documentId, replaceArtboardHtml(documentHtml, artboardId, html))
        })
      },
    ),

    tool(
      'studio_update_styles',
      'Replace the document-level :root CSS custom properties, changing the whole look at once without rewriting any artboard.',
      {
        documentId: z.string(),
        cssTokens: z.string().describe('A complete `:root { ... }` block.'),
      },
      async ({ documentId, cssTokens }) => {
        if (!await requestApproval({ tool: 'studio_update_styles', title: "Change the document's style tokens", detail: cssTokens.slice(0, 400) })) {
          return fail('The user declined that style change.')
        }
        return guard(async () => {
          const html = await readDocumentHtml(documentId)
          if (html === null) throw new Error(`No Studio document "${documentId}".`)
          const next = /:root\s*\{[\s\S]*?\}/.test(html)
            ? html.replace(/:root\s*\{[\s\S]*?\}/, cssTokens)
            : html.replace('</head>', `<style>${cssTokens}</style>\n</head>`)
          return await writeDocumentHtml(documentId, next)
        })
      },
    ),

    tool(
      'studio_export',
      'Export to Downloads/FlowDesk Studio. Give an artboardId for a PNG of that artboard, or omit it for a PDF of the whole document. PDF needs every artboard to be the same size.',
      { documentId: z.string(), artboardId: z.string().optional() },
      async ({ documentId, artboardId }) => {
        if (!await requestApproval({ tool: 'studio_export', title: artboardId ? `Export artboard ${artboardId} as PNG` : 'Export the document as PDF' })) {
          return fail('The user declined that export.')
        }
        return guard(async () =>
          artboardId
            ? `Saved to ${await exportArtboardPng(documentId, artboardId)}`
            : `Saved to ${await exportDocumentPdf(documentId)}`)
      },
    ),
  ]
}
```

- [ ] **Step 2: Register them**

In `electron/agent/tools.ts`: import `createStudioTools, STUDIO_TOOL_NAMES`, add `...STUDIO_TOOL_NAMES,` to `BASE_AGENT_TOOL_NAMES`, add `const studioTools = createStudioTools(requestApproval)` beside the other tool-set constructions, and `...studioTools,` to the `tools:` array.

- [ ] **Step 3: Write the test**

Create `electron/agent/studioTools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const diskWriteSpy = vi.fn()

vi.mock('../studio/documentStore', () => ({
  listDocuments: vi.fn(async () => []),
  createDocument: vi.fn(async () => ({ id: 'd1', title: 'T', createdAt: '', updatedAt: '', artboards: [] })),
  readDocumentHtml: vi.fn(async () => '<html><head></head><body></body></html>'),
  writeDocumentHtml: vi.fn(async () => ({ id: 'd1', title: 'T', createdAt: '', updatedAt: '', artboards: [] })),
}))
vi.mock('../studio/render', () => ({ renderArtboardPng: vi.fn(async () => Buffer.from('png')) }))
vi.mock('../studio/export', () => ({
  exportArtboardPng: vi.fn(async () => { diskWriteSpy(); return '/tmp/x.png' }),
  exportDocumentPdf: vi.fn(async () => { diskWriteSpy(); return '/tmp/x.pdf' }),
}))

const { createStudioTools, STUDIO_TOOL_NAMES } = await import('./studioTools')

const READ_TOOLS = ['studio_list_documents', 'studio_get_html', 'studio_screenshot', 'studio_list_presets']
const WRITE_TOOLS = ['studio_create_document', 'studio_create_artboard', 'studio_write_html', 'studio_update_styles', 'studio_export']

function get(tools: ReturnType<typeof createStudioTools>, name: string) {
  const found = tools.find(t => t.name === name)
  if (!found) throw new Error(`tool ${name} missing`)
  return found
}

describe('studio tools', () => {
  it('exposes exactly the nine tools the spec lists', () => {
    expect(STUDIO_TOOL_NAMES).toHaveLength(9)
    expect(createStudioTools(async () => true)).toHaveLength(9)
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) {
      expect(STUDIO_TOOL_NAMES).toContain(`mcp__workers__${name}`)
    }
  })

  it('never asks approval for a read tool', async () => {
    const approve = vi.fn(async () => true)
    const tools = createStudioTools(approve)
    await get(tools, 'studio_list_documents').handler({}, {} as never)
    await get(tools, 'studio_list_presets').handler({}, {} as never)
    await get(tools, 'studio_get_html').handler({ documentId: 'd1' }, {} as never)
    expect(approve).not.toHaveBeenCalled()
  })

  it('screenshots without writing a file, so looking does not litter Downloads', async () => {
    diskWriteSpy.mockClear()
    const result = await get(createStudioTools(async () => true), 'studio_screenshot')
      .handler({ documentId: 'd1', artboardId: 'a1' }, {} as never)
    expect(diskWriteSpy).not.toHaveBeenCalled()
    expect(result.content.some((c: { type: string }) => c.type === 'image')).toBe(true)
  })

  it('asks approval before every write tool, and refuses when denied', async () => {
    for (const name of WRITE_TOOLS) {
      const approve = vi.fn(async () => false)
      const result = await get(createStudioTools(approve), name).handler(
        { documentId: 'd1', artboardId: 'a1', title: 'X', name: 'N', width: 10, height: 10, html: '<p/>', cssTokens: ':root{}' },
        {} as never,
      )
      expect(approve, name).toHaveBeenCalled()
      expect(result.isError, name).toBe(true)
    }
  })

  it('rejects an unknown preset before creating anything, so no orphan document is left', async () => {
    const approve = vi.fn(async () => true)
    const result = await get(createStudioTools(approve), 'studio_create_document')
      .handler({ title: 'X', preset: 'no such preset' }, {} as never)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Crisp Navy')
    // Refused before the approval prompt, so nothing was created either.
    expect(approve).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run electron/agent/studioTools.test.ts
npx tsc --noEmit -p tsconfig.node.json
npx vitest run
git add electron/agent/studioTools.ts electron/agent/studioTools.test.ts electron/agent/tools.ts
git commit -m "feat: add the nine Studio agent tools"
```

If `tool()` does not return objects with `.name` / `.handler`, inspect what it does return and adjust the test's accessor — do not weaken what it asserts.

---

## Task 9: IPC, preload, and renderer types

**Files:** modify `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`

- [ ] **Step 1: Add the handlers**

In `electron/main.ts`, in its own section. Every handler takes `unknown` and validates: a renderer type annotation is not a runtime guarantee.

```ts
// ─────────────────────────────────────────────────────────────────
// IPC: Studio canvas — documents the agent authors and the user exports.
// Ids arrive from the renderer, so each is validated before it can reach
// the filesystem (electron/studio/paths.ts).
// ─────────────────────────────────────────────────────────────────

function asStudioDocumentId(value: unknown): string {
  if (!studioIsValidDocumentId(value)) throw new Error('Not a valid Studio document id.')
  return value
}

ipcMain.handle('studio:listDocuments', () => studioStore.listDocuments())
ipcMain.handle('studio:createDocument', (_e, title: unknown) =>
  studioStore.createDocument(typeof title === 'string' && title.trim() ? title.trim() : undefined))
ipcMain.handle('studio:readHtml', (_e, id: unknown) => studioStore.readDocumentHtml(asStudioDocumentId(id)))
ipcMain.handle('studio:renameDocument', (_e, id: unknown, title: unknown) =>
  studioStore.renameDocument(asStudioDocumentId(id), String(title ?? '').slice(0, 200)))
ipcMain.handle('studio:deleteDocument', (_e, id: unknown) => studioStore.deleteDocument(asStudioDocumentId(id)))
ipcMain.handle('studio:exportPng', (_e, documentId: unknown, artboardId: unknown) =>
  exportArtboardPng(asStudioDocumentId(documentId), String(artboardId ?? '')))
ipcMain.handle('studio:exportPdf', (_e, documentId: unknown) => exportDocumentPdf(asStudioDocumentId(documentId)))

studioStore.studioDocumentChanged.on('changed', (documentId: string) => {
  mainWindow?.webContents.send('studio:documentChanged', documentId)
})
```

With the imports:

```ts
import * as studioStore from './studio/documentStore'
import { isValidDocumentId as studioIsValidDocumentId } from './studio/paths'
import { exportArtboardPng, exportDocumentPdf } from './studio/export'
```

- [ ] **Step 2: Preload bindings**

```ts
  studioListDocuments: () => ipcRenderer.invoke('studio:listDocuments'),
  studioCreateDocument: (title?: string) => ipcRenderer.invoke('studio:createDocument', title),
  studioReadHtml: (id: string) => ipcRenderer.invoke('studio:readHtml', id),
  studioRenameDocument: (id: string, title: string) => ipcRenderer.invoke('studio:renameDocument', id, title),
  studioDeleteDocument: (id: string) => ipcRenderer.invoke('studio:deleteDocument', id),
  studioExportPng: (documentId: string, artboardId: string) => ipcRenderer.invoke('studio:exportPng', documentId, artboardId),
  studioExportPdf: (documentId: string) => ipcRenderer.invoke('studio:exportPdf', documentId),
  onStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => ipcRenderer.on('studio:documentChanged', cb),
  offStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => ipcRenderer.removeListener('studio:documentChanged', cb),
```

- [ ] **Step 3: Renderer types**

In `src/types/electron.d.ts`:

```ts
export interface StudioArtboardMeta { id: string; name: string; width: number; height: number }
export interface StudioDocumentMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  artboards: StudioArtboardMeta[]
}
```

```ts
  studioListDocuments: () => Promise<StudioDocumentMeta[]>
  studioCreateDocument: (title?: string) => Promise<StudioDocumentMeta>
  studioReadHtml: (id: string) => Promise<string | null>
  studioRenameDocument: (id: string, title: string) => Promise<void>
  studioDeleteDocument: (id: string) => Promise<void>
  studioExportPng: (documentId: string, artboardId: string) => Promise<string>
  studioExportPdf: (documentId: string) => Promise<string>
  onStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => void
  offStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => void
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
git add electron/main.ts electron/preload.ts src/types/electron.d.ts
git commit -m "feat: wire Studio document IPC with validated ids"
```

---

## Task 10: Shared approval handling

**Files:** create `src/hooks/useAgentApprovals.ts`; modify `src/pages/Agent.tsx`

**[revised]** Every write tool asks for approval. The first draft's Studio panel handled only `text`, `done`, and `error`, so the first design request from Studio would have blocked forever on a prompt nobody could answer. Extracting the queue means the two surfaces cannot drift apart again.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useAgentApprovals.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { AgentRunEvent } from '@/types/electron'

export interface ApprovalRequest {
  requestId: string
  tool: string
  title: string
  detail?: string
}

/**
 * The approval queue, shared by every surface that can start an agent turn.
 *
 * The agent is blocked on the answer, so any surface able to send a message
 * must also be able to answer a prompt — a panel that ignores
 * approval_request leaves the run hanging with no way to finish it.
 */
export function useAgentApprovals(sessionId: string | null) {
  const api = window.electronAPI
  const [pending, setPending] = useState<ApprovalRequest[]>([])

  useEffect(() => {
    function onEvent(_e: unknown, run: AgentRunEvent) {
      if (sessionId && run.sessionId !== sessionId) return
      if (run.event.type === 'approval_request') {
        const { requestId, tool, title, detail } = run.event
        setPending(prev => prev.some(p => p.requestId === requestId)
          ? prev
          : [...prev, { requestId, tool, title, ...(detail ? { detail } : {}) }])
      }
      // A finished or failed run cannot still be waiting on an answer.
      if (run.event.type === 'done' || run.event.type === 'error') setPending([])
    }
    api.onAgentEvent(onEvent)
    return () => api.offAgentEvent(onEvent)
  }, [api, sessionId])

  const respond = useCallback((requestId: string, approved: boolean) => {
    setPending(prev => prev.filter(p => p.requestId !== requestId))
    void api.agentApprovalResponse(requestId, approved)
  }, [api])

  return { pending, respond }
}
```

- [ ] **Step 2: Use it in Agent.tsx**

Replace Agent.tsx's own `pendingApprovals` state and its `approval_request` branch with `const { pending, respond } = useAgentApprovals(activeSessionId)`, passing `pending` / `respond` to the dialog it already renders. Leave the dialog component itself alone.

- [ ] **Step 3: Typecheck, test, commit**

```bash
npx tsc --noEmit -p tsconfig.web.json
npx vitest run
git add src/hooks/useAgentApprovals.ts src/pages/Agent.tsx
git commit -m "refactor: extract the agent approval queue into a shared hook"
```

Verify by hand before committing: on the Agent page, trigger a write tool and confirm the prompt still appears and still gates the action.

---

## Task 11: The Studio canvas page

**Files:** create `src/pages/StudioCanvas.tsx`; modify `src/types/pages.ts`, `src/App.tsx`, `src/components/layout/LeftNav.tsx`

Match the retro styling used across the app — read `src/components/agent/SessionList.tsx` first.

- [ ] **Step 1: Add the page id**

In `src/types/pages.ts`, add `'design'` to the `Page` union.

- [ ] **Step 2: Write the page**

Create `src/pages/StudioCanvas.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, FileText, Image as ImageIcon, ZoomIn, ZoomOut } from 'lucide-react'
import StudioChat from '@/components/studio/StudioChat'
import type { StudioDocumentMeta } from '@/types/electron'

/**
 * The canvas renders the document in an iframe rather than a native
 * WebContentsView: the document is local, trusted, self-contained HTML, and
 * an iframe scales and layers with the React UI instead of floating above
 * it, which every other page in this app works around with manual bounds
 * maths.
 */

/**
 * Injected into the frame to fit artboards to the panel.
 *
 * An artboard is authored at its real pixel size — up to 1440 wide, or 3000
 * tall for a page — so without this the frame simply scrolls a full-size
 * document and the user never sees a whole design at once.
 */
const FIT_SCRIPT = (zoom: number) => `
  (function () {
    var pad = 48;
    var avail = document.documentElement.clientWidth - pad;
    document.querySelectorAll('.fd-artboard').forEach(function (el) {
      var w = Number(el.getAttribute('data-fd-w')) || el.offsetWidth;
      var h = Number(el.getAttribute('data-fd-h')) || el.offsetHeight;
      var scale = Math.min(1, avail / w) * ${zoom};
      el.style.transform = 'scale(' + scale + ')';
      el.style.transformOrigin = 'top center';
      // Reserve the scaled height too, or the next artboard overlaps this one.
      el.style.marginBottom = (h * scale - h + 24) + 'px';
    });
  })();
`

interface Props { isActive: boolean }

export default function StudioCanvas({ isActive }: Props) {
  const api = window.electronAPI
  const [documents, setDocuments] = useState<StudioDocumentMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [html, setHtml] = useState('')
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(false)

  const active = documents.find(d => d.id === activeId) ?? null

  const refresh = useCallback(async () => {
    const list = await api.studioListDocuments()
    setDocuments(list)
    setActiveId(prev => prev && list.some(d => d.id === prev) ? prev : list[0]?.id ?? null)
  }, [api])

  useEffect(() => { if (isActive) void refresh() }, [isActive, refresh])

  useEffect(() => {
    if (!activeId) { setHtml(''); return }
    void api.studioReadHtml(activeId).then(value => setHtml(value ?? ''))
  }, [activeId, api, documents])

  // The agent edits documents through its own tools, so the canvas follows
  // those writes rather than only the user's own actions.
  useEffect(() => {
    const onChanged = () => { void refresh() }
    api.onStudioDocumentChanged(onChanged)
    return () => api.offStudioDocumentChanged(onChanged)
  }, [api, refresh])

  async function handleExport(kind: 'png' | 'pdf', artboardId?: string) {
    if (!activeId) return
    setBusy(true)
    try {
      const path = kind === 'png' && artboardId
        ? await api.studioExportPng(activeId, artboardId)
        : await api.studioExportPdf(activeId)
      alert(`Saved to:\n${path}`)
    } catch (error) {
      alert(`Export failed:\n${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const framedHtml = html ? html.replace('</body>', `<script>${FIT_SCRIPT(zoom)}</script></body>`) : ''

  return (
    <div className="flex h-full bg-[#FAF7F0]">
      <div className="w-[240px] shrink-0 flex flex-col border-r-2 border-[#281E14]">
        <div className="flex items-center justify-between h-14 px-3 border-b-2 border-[#281E14] bg-[#EBE5D5]">
          <span className="font-retro-mono text-[11px] font-bold uppercase tracking-wider text-[#281E14]">Documents</span>
          <button
            onClick={async () => { const c = await api.studioCreateDocument(); await refresh(); setActiveId(c.id) }}
            className="retro-btn flex items-center gap-1 px-2 py-1 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] font-retro-mono text-[11px] font-bold"
          >
            <Plus size={11} /> New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {documents.length === 0 ? (
            <p className="font-retro-mono text-[11px] text-stone-500 p-3 text-center">
              No documents yet. Ask the agent to design something.
            </p>
          ) : documents.map(doc => (
            <div
              key={doc.id}
              onClick={() => setActiveId(doc.id)}
              className={`group p-2.5 rounded-xl cursor-pointer transition-all ${
                doc.id === activeId ? 'border-2 border-[#D97706] bg-[#FEF3C7]' : 'border border-[#E2DBD0] bg-white hover:border-[#D97706]/40'
              }`}
            >
              <div className="flex items-center gap-1">
                <p className="flex-1 min-w-0 truncate font-retro-sans text-[11px] font-bold text-stone-900">{doc.title}</p>
                <button
                  onClick={async e => {
                    e.stopPropagation()
                    if (!confirm('Delete this document? Its HTML is not recoverable.')) return
                    await api.studioDeleteDocument(doc.id)
                    await refresh()
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  <Trash2 size={11} className="text-stone-400 hover:text-[#DC2626]" />
                </button>
              </div>
              <p className="font-retro-mono text-[10px] text-stone-500 mt-0.5">
                {doc.artboards.length} artboard{doc.artboards.length === 1 ? '' : 's'}
              </p>
              {doc.id === activeId && doc.artboards.map(board => (
                <button
                  key={board.id}
                  onClick={e => { e.stopPropagation(); void handleExport('png', board.id) }}
                  disabled={busy}
                  className="mt-1 w-full text-left px-2 py-1 rounded bg-white/70 border border-[#E2DBD0] font-retro-mono text-[10px] text-stone-700 hover:border-[#D97706] flex items-center gap-1 disabled:opacity-40"
                  title="Export this artboard as PNG"
                >
                  <ImageIcon size={9} />
                  <span className="truncate">{board.name || board.id}</span>
                  <span className="ml-auto text-stone-400">{board.width}×{board.height}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 h-14 px-4 border-b-2 border-[#281E14] bg-[#EBE5D5] shrink-0">
          <span className="font-retro-sans text-sm font-bold text-[#281E14] truncate flex-1">
            {active?.title ?? 'No document'}
          </span>
          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} title="Zoom out"><ZoomOut size={14} /></button>
          <span className="font-retro-mono text-[11px] text-stone-600 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} title="Zoom in"><ZoomIn size={14} /></button>
          <button
            onClick={() => void handleExport('pdf')}
            disabled={!active || active.artboards.length === 0 || busy}
            className="retro-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border-2 border-[#281E14] font-retro-mono text-[11px] font-bold text-[#281E14] disabled:opacity-40"
          >
            <FileText size={12} /> Export PDF
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-[#e9e6df]">
          {framedHtml ? (
            <iframe
              title="Studio canvas"
              srcDoc={framedHtml}
              sandbox="allow-same-origin allow-scripts"
              className="w-full h-full border-0"
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="font-retro-mono text-xs text-stone-500">
                Select or create a document, then ask the agent to design it.
              </p>
            </div>
          )}
        </div>
      </div>

      <StudioChat isActive={isActive} />
    </div>
  )
}
```

`allow-scripts` is present only because the fit script runs inside the frame; on a `srcdoc` frame holding local, self-authored content this is acceptable, and nothing remote is ever loaded into it.

- [ ] **Step 3: Register the page**

`src/App.tsx`: `case 'design': return <StudioCanvas isActive={currentPage === 'design'} />`
`src/components/layout/LeftNav.tsx`: `{ icon: LayoutTemplate, page: 'design', label: 'Design' },` (import `LayoutTemplate` from `lucide-react`)

- [ ] **Step 4: Typecheck, test, commit**

```bash
npx tsc --noEmit -p tsconfig.web.json
npx vitest run
git add src/pages/StudioCanvas.tsx src/App.tsx src/components/layout/LeftNav.tsx src/types/pages.ts
git commit -m "feat: add the Studio canvas page with fit-to-panel scaling"
```

---

## Task 12: The chat panel

**Files:** create `src/components/studio/StudioChat.tsx`; modify `src/pages/Agent.tsx`

Deliberately a **minimal** panel — recent turns, an input, and approvals — not a second copy of Agent.tsx's UI. Extracting that page into a shared component is a refactor worth doing when a third surface needs it.

- [ ] **Step 1: Write the panel**

Create `src/components/studio/StudioChat.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Send, Check, X } from 'lucide-react'
import { useAgentApprovals } from '@/hooks/useAgentApprovals'
import type { AgentRunEvent, AgentSessionMeta, AgentSessionTurn } from '@/types/electron'

/**
 * Studio's chat attaches to an existing agent session rather than starting
 * one. A second conversation the user cannot find on the Agent page would
 * split their history and break the one thing this panel exists for: turning
 * what was already discussed into a design without re-explaining it.
 */
const LAST_SESSION_KEY = 'agentActiveSessionId'

interface Props { isActive: boolean }

export default function StudioChat({ isActive }: Props) {
  const api = window.electronAPI
  const [session, setSession] = useState<AgentSessionMeta | null>(null)
  const [turns, setTurns] = useState<AgentSessionTurn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [liveText, setLiveText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { pending, respond } = useAgentApprovals(session?.id ?? null)

  async function load() {
    const sessions = await api.agentSessionList()
    // The session the user last had open, not sessions[0] — that is the most
    // recently UPDATED one, which jumps to whichever session an agent last
    // wrote to.
    const remembered = localStorage.getItem(LAST_SESSION_KEY)
    const chosen = sessions.find(s => s.id === remembered) ?? sessions[0] ?? null
    setSession(chosen)
    setTurns(chosen ? await api.agentSessionTurns(chosen.id) : [])
  }

  useEffect(() => { if (isActive) void load() }, [isActive])

  useEffect(() => {
    function onEvent(_e: unknown, run: AgentRunEvent) {
      if (!session || run.sessionId !== session.id) return
      if (run.event.type === 'text') setLiveText(prev => prev + run.event.text)
      if (run.event.type === 'done' || run.event.type === 'error') {
        setLiveText('')
        setSending(false)
        void load()
      }
    }
    api.onAgentEvent(onEvent)
    return () => api.offAgentEvent(onEvent)
  }, [api, session])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns.length, liveText, pending.length])

  async function handleSend() {
    const text = draft.trim()
    if (!text || !session || sending) return
    setDraft('')
    setSending(true)
    setLiveText('')
    await api.agentSendMessage({ prompt: text, sessionId: session.id, runId: crypto.randomUUID() })
  }

  if (!session) {
    return (
      <div className="w-[320px] shrink-0 border-l-2 border-[#281E14] bg-[#FAF7F0] flex items-center justify-center p-6">
        <p className="font-retro-mono text-[11px] text-stone-500 text-center">
          No agent session yet. Start one on the Agent page, then come back — Studio uses that same conversation.
        </p>
      </div>
    )
  }

  return (
    <div className="w-[320px] shrink-0 border-l-2 border-[#281E14] bg-[#FAF7F0] flex flex-col">
      <div className="h-14 shrink-0 px-3 flex items-center border-b-2 border-[#281E14] bg-[#EBE5D5]">
        <span className="font-retro-mono text-[11px] font-bold uppercase tracking-wider text-[#281E14] truncate">
          {session.title}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {turns.slice(-8).map(turn => (
          <div
            key={turn.id}
            className={`rounded-xl px-3 py-2 font-retro-sans text-[11px] leading-relaxed ${
              turn.role === 'user'
                ? 'bg-[#FEF3C7] border border-[#D97706]/40 text-[#92400E]'
                : 'bg-white border border-[#E2DBD0] text-stone-800'
            }`}
          >
            {turn.content.slice(0, 600)}
          </div>
        ))}

        {liveText && (
          <div className="rounded-xl px-3 py-2 bg-white border border-[#E2DBD0] font-retro-sans text-[11px] text-stone-800">
            {liveText.slice(-600)}
          </div>
        )}

        {/* The agent is blocked until one of these is answered. */}
        {pending.map(request => (
          <div key={request.requestId} className="rounded-xl border-2 border-[#D97706] bg-[#FEF3C7] p-3 space-y-2">
            <p className="font-retro-sans text-[11px] font-bold text-[#92400E]">{request.title}</p>
            {request.detail && (
              <p className="font-retro-mono text-[10px] text-stone-600 break-words max-h-24 overflow-y-auto">{request.detail}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => respond(request.requestId, true)}
                className="retro-btn flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-[#059669] text-white border border-[#047857] font-retro-mono text-[11px] font-bold"
              >
                <Check size={11} /> Allow
              </button>
              <button
                onClick={() => respond(request.requestId, false)}
                className="retro-btn flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-white text-stone-700 border border-[#D6CFC0] font-retro-mono text-[11px] font-bold"
              >
                <X size={11} /> Deny
              </button>
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t-2 border-[#281E14] bg-[#EBE5D5]">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
            placeholder="Ask the agent to design something…"
            rows={2}
            className="flex-1 min-w-0 resize-none rounded-lg border-2 border-[#281E14] bg-white px-2 py-1.5 font-retro-sans text-[11px] outline-none"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!draft.trim() || sending}
            className="retro-btn shrink-0 self-end px-3 py-2 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border-2 border-[#B45309] disabled:opacity-40"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Have Agent.tsx remember the active session**

In `src/pages/Agent.tsx`, wherever `setActiveSessionId` is called, also `localStorage.setItem('agentActiveSessionId', id)`. This is what makes the panel attach to the session the user was actually in.

- [ ] **Step 3: Typecheck, test, commit**

```bash
npx tsc --noEmit -p tsconfig.web.json
npx vitest run
git add src/components/studio/StudioChat.tsx src/pages/Agent.tsx
git commit -m "feat: add a Studio chat panel that shares the agent session and its approvals"
```

---

## Task 13: Manual verification

**Files:** none. This exercises the agent, offscreen windows, and the filesystem together, which no unit test reaches.

- [ ] **Step 1: Start the app**

`npm run dev`, open the new **Design** page.

- [ ] **Step 2: A carousel, driven from Studio's own panel**

In Studio's chat: *"Make a 3-slide LinkedIn carousel about why uncommitted work is dangerous. Pick a preset that fits, then show me each slide."*

Expected: approval prompts appear **in the Studio panel** and gate each write; three 1080×1080 artboards appear; the agent calls `studio_screenshot` and describes what it actually rendered.

- [ ] **Step 3: Sizes are real**

In a **new** document, ask for a 1280×720 thumbnail and a 390×844 app screen.

Expected: genuinely different shapes — one wide, one tall — not both square. This is the check for the size-variable defect.

- [ ] **Step 4: The canvas follows the agent, and fits**

Watch the canvas while the agent works; try the zoom control.

Expected: artboards appear without a manual refresh; a 1440-wide artboard is visible whole rather than needing horizontal scrolling.

- [ ] **Step 5: PNG export**

Click an artboard to export.

Expected: a file in `Downloads/FlowDesk Studio`, named after the artboard, opening at exactly its declared pixel size.

- [ ] **Step 6: PDF, both cases**

Export the 3-slide carousel. Then try the mixed-size document from Step 3.

Expected: the carousel gives one PDF, 3 pages, correct size, named after the document. The mixed document **refuses with a message naming both sizes** — that is correct behaviour, not a failure.

- [ ] **Step 7: Screenshots leave no litter**

Count the files in `Downloads/FlowDesk Studio`, ask the agent to screenshot an artboard a few times, count again.

Expected: unchanged.

- [ ] **Step 8: Id safety**

In the Design page's devtools console: `await window.electronAPI.studioDeleteDocument('../..')`

Expected: rejects with an invalid-id error, and `studio-documents` is untouched.

- [ ] **Step 9: The panel shares the Agent page's session**

Say something on the Agent page, then open Design.

Expected: the panel shows that same exchange, and a message sent from the panel appears on the Agent page too.

- [ ] **Step 10: Restart and Codex parity**

Close and reopen the app — every document still listed. Then switch the lead agent to Codex and ask it to add a slide.

Expected: identical behaviour; the tools come from `createAgentToolSet`, which both providers share.

- [ ] **Step 11: Commit any fixes**

Fix, re-run `npx vitest run` and both typechecks, commit.

---

## Deliberately not in this plan

Visual editing, a font library, image generation inside a document (and therefore a working `assets/` directory), publishing to LinkedIn or Facebook, responsive or interactive web output, and mixed-page-size PDFs are all named non-goals in the spec. Each is its own slice on top of this canvas.
