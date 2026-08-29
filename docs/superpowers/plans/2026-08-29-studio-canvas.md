# Studio Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An HTML canvas in FlowDesk where the agent designs social posts, app screens, and web pages as sized artboards, and exports them to PNG or PDF.

**Architecture:** A document is one self-contained `document.html` holding `.fd-artboard` elements that carry their own id and size. The agent reads and writes it through nine MCP tools split by whether they change the file, which is also the approval boundary. Electron renders the canvas in a `WebContentsView` and exports offscreen with its own `capturePage` / `printToPDF` — no new dependency.

**Tech Stack:** Electron main process (TypeScript), React 18 renderer, `@anthropic-ai/claude-agent-sdk` MCP tools, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-studio-canvas-design.md`

## Global Constraints

- **Repo root:** `E:\FlowDesk`. All paths relative to it.
- **Test:** `npx vitest run <path>` for one file, `npx vitest run` for all. Baseline is **615 tests / 40 files** and must still pass at the end of every task.
- **Typecheck:** `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`. Both clean before every commit.
- **Commit after every task.** Uncommitted work in this repo has already been destroyed once by an agent rewriting a file from an older base. A task is not done until it is committed.
- **No new npm dependency.** Node built-ins and what is installed already.
- **Electron mocking in tests:** `vi.mock('electron', () => ({ app: { getPath: () => root } }))` before a dynamic `await import()`. See `electron/savedImages.test.ts`.
- **Comment style:** explain *why*, cite confirmed evidence. Do not restate code.
- **Artboard attribute contract**, used by every module and fixed here so they agree:
  `<div class="fd-artboard" data-fd-id="a1" data-fd-name="Slide 1" data-fd-w="1080" data-fd-h="1080">`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `electron/studio/artboards.ts` (new) | Pure: parse artboards from HTML, splice one back, build a blank document. |
| `electron/studio/artboards.test.ts` (new) | Pure tests. |
| `electron/studio/presets.ts` (new) | The 31 presets as data + lookup. |
| `electron/studio/presets.test.ts` (new) | Lookup tests. |
| `electron/studio/documentStore.ts` (new) | Document directories: list, create, read, write, rename, delete. |
| `electron/studio/documentStore.test.ts` (new) | Store tests on a temp dir. |
| `electron/studio/export.ts` (new) | Offscreen render to PNG / PDF. |
| `electron/agent/studioTools.ts` (new) | The nine agent tools. |
| `electron/agent/tools.ts` (modify) | Register the studio tools. |
| `electron/main.ts` (modify) | Studio IPC handlers. |
| `electron/preload.ts` (modify) | Bindings. |
| `src/types/electron.d.ts` (modify) | Types. |
| `src/pages/StudioCanvas.tsx` (new) | Artboard list, canvas host, chat panel. |
| `src/App.tsx`, `src/components/layout/LeftNav.tsx`, `src/types/pages.ts` (modify) | New `design` page entry. |

The canvas is a **new page (`design`)**, not folded into the existing `studio` page: that page hosts third-party web tools (Google Flow) in a `WebContentsView` with a Google-account picker, which has nothing to do with authoring local documents. Overloading it would put two unrelated jobs behind one nav item.

---

## Task 1: Spike — does export reproduce exact artboard pixels?

**Files:**
- Create: `probes/studio-export-size.js` (throwaway)

**Interfaces:** none. This task's output is an answer, not code that ships.

The spec's one open question. `printToPDF` may apply print scaling rather than honouring CSS pixels, and `capturePage` depends on the window's `zoomFactor` and device scale. Building `export.ts` on a guess and discovering a 1.33× error later means redoing it and every exported file made in between.

- [ ] **Step 1: Write the probe**

Create `probes/studio-export-size.js`:

```js
// @target flowdesk
// Renders a known 1080x1080 box offscreen, exports both ways, and reports
// the real output dimensions so export.ts is built against measured numbers.
const result = await window.electronAPI.studioProbeExportSize()
return result
```

- [ ] **Step 2: Add the temporary main-process probe handler**

In `electron/main.ts`, near the other `debug:` handlers, add (dev-only, removed in Step 6):

```ts
if (!app.isPackaged) {
  ipcMain.handle('debug:studioExportSize', async () => {
    const win = new BrowserWindow({ show: false, width: 1080, height: 1080, useContentSize: true })
    await win.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="margin:0"><div style="width:1080px;height:1080px;background:#0af"></div></body>'
    ))
    const png = await win.webContents.capturePage()
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: { width: 1080 / 96, height: 1080 / 96 } })
    const out = {
      pngSize: png.getSize(),
      pngBytes: png.toPNG().length,
      pdfBytes: pdf.length,
      zoomFactor: win.webContents.getZoomFactor(),
      scaleFactor: win.webContents.getOwnerBrowserWindow()?.getContentBounds(),
    }
    win.destroy()
    return out
  })
}
```

- [ ] **Step 3: Add the preload binding**

In `electron/preload.ts`, beside the other debug hooks:

```ts
  studioProbeExportSize: () => ipcRenderer.invoke('debug:studioExportSize'),
```

And in `src/types/electron.d.ts`:

```ts
  studioProbeExportSize: () => Promise<Record<string, unknown>>
```

- [ ] **Step 4: Run it**

Start the app with `npm run dev`, then save `probes/studio-export-size.js` to trigger the probe runner. Read `probes/out/studio-export-size.json`.

- [ ] **Step 5: Record the answer**

Append a `## Export sizing (measured)` section to the spec stating the real `pngSize`, whether it equalled 1080×1080, and the `zoomFactor`. If PNG came back at a different size, state the ratio — `export.ts` will need to divide by it.

- [ ] **Step 6: Remove the probe**

Delete `probes/studio-export-size.js`, the `debug:studioExportSize` handler, the preload binding, and the type. It was a measurement, not a feature.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: measure Electron export sizing for Studio artboards"
```

---

## Task 2: Artboard parsing and splicing (pure)

**Files:**
- Create: `electron/studio/artboards.ts`
- Test: `electron/studio/artboards.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Artboard { id: string; name: string; width: number; height: number; html: string }`
  - `function parseArtboards(documentHtml: string): Artboard[]`
  - `function replaceArtboardHtml(documentHtml: string, id: string, innerHtml: string): string`
  - `function appendArtboard(documentHtml: string, artboard: Omit<Artboard, 'html'> & { html?: string }): string`
  - `function blankDocument(title: string): string`

- [ ] **Step 1: Write the failing test**

Create `electron/studio/artboards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseArtboards, replaceArtboardHtml, appendArtboard, blankDocument } from './artboards'

const DOC = `<!doctype html>
<html><head><style>:root{--bg:#fff}</style></head>
<body>
<div class="fd-artboard" data-fd-id="a1" data-fd-name="Cover" data-fd-w="1080" data-fd-h="1080"><h1>One</h1></div>
<div class="fd-artboard" data-fd-id="a2" data-fd-name="Body" data-fd-w="1080" data-fd-h="1350"><p>Two</p></div>
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
    // Naive regex matching stops at the first </div> and would truncate
    // every real design, which is nested by definition.
    const nested = `<div class="fd-artboard" data-fd-id="x" data-fd-name="N" data-fd-w="100" data-fd-h="100"><div><span>deep</span></div></div>`
    const boards = parseArtboards(nested)
    expect(boards).toHaveLength(1)
    expect(boards[0].html).toBe('<div><span>deep</span></div>')
  })
})

describe('replaceArtboardHtml', () => {
  it('replaces only the named artboard and leaves the rest byte-identical', () => {
    const next = replaceArtboardHtml(DOC, 'a1', '<h1>Changed</h1>')
    expect(next).toContain('<h1>Changed</h1>')
    expect(next).not.toContain('<h1>One</h1>')
    // The untouched artboard and the document's own head must survive intact.
    expect(next).toContain('<p>Two</p>')
    expect(next).toContain('--bg:#fff')
  })

  it('throws with the real ids when the id does not exist', () => {
    expect(() => replaceArtboardHtml(DOC, 'nope', '<p/>')).toThrow(/a1.*a2|a2.*a1/s)
  })
})

describe('appendArtboard', () => {
  it('adds an artboard before the closing body tag', () => {
    const next = appendArtboard(DOC, { id: 'a3', name: 'New', width: 390, height: 844 })
    const boards = parseArtboards(next)
    expect(boards.map(b => b.id)).toEqual(['a1', 'a2', 'a3'])
    expect(boards[2]).toMatchObject({ width: 390, height: 844 })
  })

  it('refuses a duplicate id rather than creating an ambiguous document', () => {
    expect(() => appendArtboard(DOC, { id: 'a1', name: 'Dup', width: 10, height: 10 })).toThrow(/a1/)
  })
})

describe('blankDocument', () => {
  it('produces a parseable document with no artboards', () => {
    const doc = blankDocument('My Post')
    expect(doc).toContain('My Post')
    expect(parseArtboards(doc)).toEqual([])
  })

  it('round-trips: appending then parsing returns what was appended', () => {
    const doc = appendArtboard(blankDocument('T'), { id: 'z1', name: 'Z', width: 1280, height: 720 })
    expect(parseArtboards(doc)[0]).toMatchObject({ id: 'z1', name: 'Z', width: 1280, height: 720 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run electron/studio/artboards.test.ts`
Expected: FAIL — cannot resolve `./artboards`.

- [ ] **Step 3: Write the implementation**

Create `electron/studio/artboards.ts`:

```ts
/**
 * Reading and editing artboards inside a document's HTML.
 *
 * The HTML file is the source of truth, so these functions must never
 * reformat or normalise anything they were not asked to change: an edit to
 * one artboard has to leave every other byte alone, or the user's own hand
 * edits and the agent's edits would fight each other.
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

function attribute(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return match ? match[1] : ''
}

/** Index just past the `<div ...>` whose content ends at the returned index. */
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
  /** Offsets of the inner HTML, for splicing without touching anything else. */
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
  const existing = parseArtboards(documentHtml)
  if (existing.some(board => board.id === artboard.id)) {
    throw new Error(`Artboard id "${artboard.id}" is already used in this document.`)
  }
  const element =
    `\n<div class="fd-artboard" data-fd-id="${artboard.id}" data-fd-name="${artboard.name}"` +
    ` data-fd-w="${artboard.width}" data-fd-h="${artboard.height}">${artboard.html ?? ''}</div>\n`
  const closing = documentHtml.lastIndexOf('</body>')
  if (closing === -1) return documentHtml + element
  return documentHtml.slice(0, closing) + element + documentHtml.slice(closing)
}

export function blankDocument(title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run electron/studio/artboards.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/artboards.ts electron/studio/artboards.test.ts
git commit -m "feat: parse and splice Studio artboards inside document HTML"
```

---

## Task 3: Presets as data

**Files:**
- Create: `electron/studio/presets.ts`
- Test: `electron/studio/presets.test.ts`

**Interfaces:**
- Produces:
  - `interface StudioPreset { id: string; name: string; vibe: string; bestFor: string; avoidFor: string; fontsLink: string; cssTokens: string }`
  - `const STUDIO_PRESETS: StudioPreset[]`
  - `function findPreset(name: string): StudioPreset | null`

The source is `crausel system for refrence/carousel-presets.md`, a cloned reference repo holding 31 presets. It is imported rather than read at runtime because the app must not break if that directory is deleted, and because the agent needs to query presets by name rather than parse markdown.

- [ ] **Step 1: Generate the preset data**

Run this one-off conversion (it reads the reference and writes the module):

```bash
node -e "
const fs=require('fs');
const md=fs.readFileSync('crausel system for refrence/carousel-presets.md','utf8');
const blocks=md.split(/^## /m).slice(1).filter(b=>/^\d+\./.test(b));
const esc=s=>s.replace(/\\\\/g,'\\\\\\\\').replace(/\`/g,'\\\\\`').replace(/\\\$\{/g,'\\\\\${');
const pick=(b,label)=>{const m=b.match(new RegExp('\\\\*\\\\*'+label+':\\\\*\\\\*\\\\s*([^\\\\n]*)'));return m?m[1].trim():''};
const presets=blocks.map(b=>{
  const name=b.split('\n')[0].replace(/^\d+\.\s*/,'').trim();
  const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-\$/g,'');
  const link=(b.match(/<link[^>]*>/)||[''])[0];
  const css=(b.match(/:root \{[\s\S]*?\n\}/)||[''])[0];
  return {id,name,vibe:pick(b,'Vibe'),bestFor:pick(b,'Best for'),avoidFor:pick(b,'Avoid for'),fontsLink:link,cssTokens:css};
});
const out='/**\n * Design presets, imported from the linkedin-carousel reference repo.\n *\n * Data, not code: each preset is the font pairing and CSS custom properties\n * that define a look. Imported rather than read from the reference directory\n * at runtime so deleting that clone cannot break the app, and so the agent\n * can look one up by name instead of parsing markdown.\n */\n\nexport interface StudioPreset {\n  id: string\n  name: string\n  vibe: string\n  bestFor: string\n  avoidFor: string\n  /** Google Fonts <link> tag the preset expects. */\n  fontsLink: string\n  /** A :root { ... } block of CSS custom properties. */\n  cssTokens: string\n}\n\nexport const STUDIO_PRESETS: StudioPreset[] = '+JSON.stringify(presets,null,2)+'\n\n/** Case-insensitive lookup by id or name. Null rather than a throw: the caller reports the near misses. */\nexport function findPreset(name: string): StudioPreset | null {\n  const needle = String(name ?? \\'\\').trim().toLowerCase()\n  if (!needle) return null\n  return STUDIO_PRESETS.find(p => p.id === needle || p.name.toLowerCase() === needle) ?? null\n}\n';
fs.mkdirSync('electron/studio',{recursive:true});
fs.writeFileSync('electron/studio/presets.ts',out,'utf8');
console.log('wrote',presets.length,'presets');
"
```

Expected output: `wrote 31 presets`. If it reports a different count, stop and inspect the reference file rather than continuing with partial data.

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
    const withTokens = STUDIO_PRESETS.filter(p => p.cssTokens.includes(':root'))
    expect(withTokens.length).toBeGreaterThanOrEqual(25)
  })
})

describe('findPreset', () => {
  it('finds by name regardless of case', () => {
    expect(findPreset('Crisp Navy & White')?.id).toBe(STUDIO_PRESETS[0].id)
    expect(findPreset('crisp navy & white')?.id).toBe(STUDIO_PRESETS[0].id)
  })

  it('finds by id', () => {
    const first = STUDIO_PRESETS[0]
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
git add electron/studio/presets.ts electron/studio/presets.test.ts
git commit -m "feat: import the 31 carousel design presets as Studio data"
```

Expected: 6 tests pass. If the count assertion fails, fix the generator in Step 1 rather than relaxing the test — a missing preset is missing data, not a wrong expectation.

---

## Task 4: Document store

**Files:**
- Create: `electron/studio/documentStore.ts`
- Test: `electron/studio/documentStore.test.ts`

**Interfaces:**
- Consumes: `parseArtboards`, `blankDocument` (Task 2).
- Produces:
  - `interface StudioDocumentMeta { id: string; title: string; createdAt: string; updatedAt: string; artboards: { id: string; name: string; width: number; height: number }[] }`
  - `function documentsRoot(): string`
  - `function listDocuments(): Promise<StudioDocumentMeta[]>`
  - `function createDocument(title?: string): Promise<StudioDocumentMeta>`
  - `function readDocumentHtml(id: string): Promise<string | null>`
  - `function writeDocumentHtml(id: string, html: string): Promise<StudioDocumentMeta>`
  - `function renameDocument(id: string, title: string): Promise<void>`
  - `function deleteDocument(id: string): Promise<void>`
  - `function assetsDir(id: string): string`

- [ ] **Step 1: Write the failing test**

Create `electron/studio/documentStore.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises'
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
  })

  it('starts with no artboards', async () => {
    const created = await store.createDocument()
    expect(created.artboards).toEqual([])
  })

  it('returns an empty list before anything is created', async () => {
    expect(await store.listDocuments()).toEqual([])
  })
})

describe('writeDocumentHtml', () => {
  it('derives the artboard registry from the HTML that was written', async () => {
    // meta.json is a cache of what the HTML says, so writing HTML with two
    // artboards must produce a meta listing exactly those two.
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
})

describe('resilience', () => {
  it('rebuilds meta from the HTML when meta.json is missing', async () => {
    // The HTML is the source of truth; a lost cache must not lose a document.
    const doc = await store.createDocument('Recoverable')
    const html = appendArtboard((await store.readDocumentHtml(doc.id))!, { id: 'z', name: 'Z', width: 100, height: 200 })
    await store.writeDocumentHtml(doc.id, html)
    await rm(join(root, 'studio-documents', doc.id, 'meta.json'))
    const all = await store.listDocuments()
    expect(all).toHaveLength(1)
    expect(all[0].artboards.map(a => a.id)).toEqual(['z'])
  })

  it('returns null for an unknown document rather than throwing', async () => {
    expect(await store.readDocumentHtml('nope')).toBeNull()
  })
})

describe('rename and delete', () => {
  it('renames without losing the HTML', async () => {
    const doc = await store.createDocument('Old')
    await store.renameDocument(doc.id, 'New')
    const all = await store.listDocuments()
    expect(all[0].title).toBe('New')
    expect(await store.readDocumentHtml(doc.id)).toContain('fd-artboard')
  })

  it('deletes exactly one document', async () => {
    const a = await store.createDocument('A')
    const b = await store.createDocument('B')
    await store.deleteDocument(a.id)
    const all = await store.listDocuments()
    expect(all.map(d => d.id)).toEqual([b.id])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/studio/documentStore.test.ts`
Expected: FAIL — cannot resolve `./documentStore`.

- [ ] **Step 3: Write the implementation**

Create `electron/studio/documentStore.ts`:

```ts
import { mkdir, readdir, readFile, writeFile, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { app } from 'electron'
import { blankDocument, parseArtboards } from './artboards'

/**
 * Filesystem home for Studio documents.
 *
 * `document.html` is the source of truth and `meta.json` is a cache of what
 * it says, which is why every write re-derives the registry from the HTML
 * and why a missing meta.json is rebuilt rather than treated as a lost
 * document. The user can edit the HTML by hand and the app still agrees
 * with them.
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

export function documentsRoot(): string {
  return join(app.getPath('userData'), 'studio-documents')
}

const dir = (id: string) => join(documentsRoot(), id)
const htmlPath = (id: string) => join(dir(id), 'document.html')
const metaPath = (id: string) => join(dir(id), 'meta.json')

export function assetsDir(id: string): string {
  return join(dir(id), 'assets')
}

export async function readDocumentHtml(id: string): Promise<string | null> {
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
  try {
    return JSON.parse(await readFile(metaPath(id), 'utf8')) as StudioDocumentMeta
  } catch {
    // Rebuild from the HTML rather than dropping the document: meta.json is
    // only a cache, and losing it must not lose the user's work.
    const html = await readDocumentHtml(id)
    if (html === null) return null
    const now = new Date().toISOString()
    const rebuilt: StudioDocumentMeta = {
      id, title: id, createdAt: now, updatedAt: now, artboards: registryFrom(html),
    }
    await writeFile(metaPath(id), JSON.stringify(rebuilt, null, 2), 'utf8').catch(() => {})
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
  await writeFile(htmlPath(id), blankDocument(title), 'utf8')
  const meta: StudioDocumentMeta = { id, title, createdAt: now, updatedAt: now, artboards: [] }
  await writeFile(metaPath(id), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

export async function writeDocumentHtml(id: string, html: string): Promise<StudioDocumentMeta> {
  const existing = await readMeta(id)
  if (!existing) throw new Error(`No Studio document "${id}".`)
  await writeFile(htmlPath(id), html, 'utf8')
  const meta: StudioDocumentMeta = {
    ...existing,
    updatedAt: new Date().toISOString(),
    artboards: registryFrom(html),
  }
  await writeFile(metaPath(id), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

export async function renameDocument(id: string, title: string): Promise<void> {
  const existing = await readMeta(id)
  if (!existing) return
  const meta = { ...existing, title, updatedAt: new Date().toISOString() }
  await writeFile(metaPath(id), JSON.stringify(meta, null, 2), 'utf8')
}

export async function deleteDocument(id: string): Promise<void> {
  await rm(dir(id), { recursive: true, force: true })
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run electron/studio/documentStore.test.ts
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/documentStore.ts electron/studio/documentStore.test.ts
git commit -m "feat: add Studio document store with HTML as source of truth"
```

Expected: 9 tests pass.

---

## Task 5: Export to PNG and PDF

**Files:**
- Create: `electron/studio/export.ts`

**Interfaces:**
- Consumes: `readDocumentHtml`, `parseArtboards`, and Task 1's measured sizing answer.
- Produces:
  - `function exportArtboardPng(documentId: string, artboardId: string): Promise<string>` → written file path
  - `function exportDocumentPdf(documentId: string): Promise<string>` → written file path

Read Task 1's `## Export sizing (measured)` section in the spec before writing this. If PNG came back larger than the artboard, divide by the recorded ratio when sizing the offscreen window.

- [ ] **Step 1: Write the implementation**

Create `electron/studio/export.ts`:

```ts
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import { readDocumentHtml } from './documentStore'
import { parseArtboards } from './artboards'
import { safeImageFileName } from '../savedImages'

/**
 * Renders artboards offscreen at their declared size.
 *
 * The visible canvas is scaled to fit its panel, so capturing it would
 * export whatever zoom the window happened to be at. A dedicated offscreen
 * window sized to the artboard makes the exported pixels match the design's
 * own numbers regardless of what the user is looking at.
 */

const EXPORT_DIR_NAME = 'FlowDesk Studio'

async function exportDir(): Promise<string> {
  const dir = join(app.getPath('downloads'), EXPORT_DIR_NAME)
  await mkdir(dir, { recursive: true })
  return dir
}

/** One artboard alone on a page, at exactly its own size. */
function isolate(documentHtml: string, artboardId: string): string {
  const boards = parseArtboards(documentHtml)
  const board = boards.find(b => b.id === artboardId)
  if (!board) throw new Error(`No artboard "${artboardId}". Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
  const head = documentHtml.slice(0, documentHtml.indexOf('</head>'))
  return `${head}
<style>
  body { margin: 0; background: transparent; }
  .fd-artboard { margin: 0 !important; box-shadow: none !important; width: ${board.width}px; height: ${board.height}px; }
</style>
</head><body>
<div class="fd-artboard" data-fd-id="${board.id}" data-fd-w="${board.width}" data-fd-h="${board.height}">${board.html}</div>
</body></html>`
}

async function withOffscreen<T>(html: string, width: number, height: number, run: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // Google Fonts in the presets load over the network; painting before
    // they arrive exports the fallback face instead of the design's own.
    await new Promise(resolve => setTimeout(resolve, 600))
    return await run(win)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function exportArtboardPng(documentId: string, artboardId: string): Promise<string> {
  const documentHtml = await readDocumentHtml(documentId)
  if (documentHtml === null) throw new Error(`No Studio document "${documentId}".`)
  const board = parseArtboards(documentHtml).find(b => b.id === artboardId)
  if (!board) throw new Error(`No artboard "${artboardId}" in that document.`)

  const image = await withOffscreen(isolate(documentHtml, artboardId), board.width, board.height,
    win => win.webContents.capturePage())

  const dir = await exportDir()
  const filePath = join(dir, safeImageFileName(board.name || artboardId, 'png', artboardId))
  await writeFile(filePath, image.toPNG())
  return filePath
}

export async function exportDocumentPdf(documentId: string, title = documentId): Promise<string> {
  const documentHtml = await readDocumentHtml(documentId)
  if (documentHtml === null) throw new Error(`No Studio document "${documentId}".`)
  const boards = parseArtboards(documentHtml)
  if (boards.length === 0) throw new Error('That document has no artboards to export.')

  // Page size is in inches; CSS pixels are 96 to the inch. One page per
  // artboard is what a carousel PDF has to be, so the first artboard's size
  // sets the page and the rest follow it.
  const first = boards[0]
  const pdf = await withOffscreen(documentHtml, first.width, first.height * boards.length,
    win => win.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: first.width / 96, height: first.height / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }))

  const dir = await exportDir()
  // The document's title, not its UUID: the user opens this file in
  // Downloads and has to recognise it.
  const filePath = join(dir, safeImageFileName(title, 'pdf', documentId))
  await writeFile(filePath, pdf)
  return filePath
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.node.json
git add electron/studio/export.ts
git commit -m "feat: export Studio artboards to PNG and documents to PDF"
```

No unit test here: every line is Electron window behaviour, which a unit test would have to mock into meaninglessness. Task 9 verifies it against real output.

---

## Task 6: The nine agent tools

**Files:**
- Create: `electron/agent/studioTools.ts`
- Modify: `electron/agent/tools.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5, and `RequestApproval` from `./approval`.
- Produces: `createStudioTools(requestApproval: RequestApproval)`, `STUDIO_TOOL_NAMES: string[]`

Follow `electron/agent/flowTools.ts` for shape: it already does approval-gated tools and MCP image blocks. Read it first.

- [ ] **Step 1: Write the tools**

Create `electron/agent/studioTools.ts`:

```ts
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'crypto'
import type { RequestApproval } from './approval'
import {
  listDocuments, createDocument, readDocumentHtml, writeDocumentHtml,
} from '../studio/documentStore'
import { parseArtboards, replaceArtboardHtml, appendArtboard } from '../studio/artboards'
import { STUDIO_PRESETS, findPreset } from '../studio/presets'
import { exportArtboardPng, exportDocumentPdf } from '../studio/export'

/**
 * Studio's agent surface.
 *
 * Split into read and write, which is also the approval boundary: reads only
 * look and are safe to run freely, writes change a real file on disk and are
 * gated. The split mirrors the one paper.design arrived at for the same job.
 */

const MAX_TOOL_TEXT = 12_000

function text(value: unknown): string {
  const out = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return out.length > MAX_TOOL_TEXT ? out.slice(0, MAX_TOOL_TEXT) + '\n\n[truncated]' : out
}

function ok(value: unknown) {
  return { content: [{ type: 'text' as const, text: text(value) }] }
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
      'Read a Studio document\'s HTML, or one artboard\'s inner HTML. Read before writing so an edit preserves what is already there.',
      {
        documentId: z.string().describe('The document to read.'),
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
      'See an artboard as it actually renders. Use this after writing HTML and before telling the user it is done — it is the only way to tell a correct layout from a broken one.',
      {
        documentId: z.string(),
        artboardId: z.string(),
      },
      async ({ documentId, artboardId }) => {
        try {
          const filePath = await exportArtboardPng(documentId, artboardId)
          const { readFile } = await import('fs/promises')
          const bytes = await readFile(filePath)
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
      () => guard(async () => STUDIO_PRESETS.map(p => ({ id: p.id, name: p.name, vibe: p.vibe, bestFor: p.bestFor, avoidFor: p.avoidFor }))),
      readOnly,
    ),

    tool(
      'studio_create_document',
      'Create a new Studio document, optionally seeded with a preset\'s fonts and CSS tokens.',
      {
        title: z.string().describe('What this document is, e.g. "Q3 launch carousel".'),
        preset: z.string().optional().describe('A preset id or name from studio_list_presets.'),
      },
      async ({ title, preset }) => {
        if (!await requestApproval({ tool: 'studio_create_document', title: `Create Studio document "${title}"`, ...(preset ? { detail: `Preset: ${preset}` } : {}) })) {
          return fail('The user declined creating that document.')
        }
        return guard(async () => {
          const meta = await createDocument(title)
          if (!preset) return meta
          const found = findPreset(preset)
          if (!found) {
            const names = STUDIO_PRESETS.map(p => p.name).join(', ')
            throw new Error(`No preset "${preset}". Available: ${names}`)
          }
          const html = (await readDocumentHtml(meta.id))!
            .replace('</head>', `${found.fontsLink}\n<style>${found.cssTokens}</style>\n</head>`)
          return await writeDocumentHtml(meta.id, html)
        })
      },
    ),

    tool(
      'studio_create_artboard',
      'Add an artboard of a given pixel size. A carousel is several 1080x1080 artboards; a LinkedIn post is one 1080x1350; a YouTube thumbnail 1280x720; an app screen 390x844; a web page one tall artboard such as 1440x3000.',
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
      'Replace one artboard\'s inner HTML. Everything outside that artboard is untouched, so this is safe to call repeatedly while iterating on one slide.',
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
        if (!await requestApproval({ tool: 'studio_update_styles', title: 'Change the document\'s style tokens', detail: cssTokens.slice(0, 400) })) {
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
      'Export to Downloads/FlowDesk Studio. Give an artboardId for a PNG of that artboard, or omit it for a PDF of the whole document (one page per artboard).',
      {
        documentId: z.string(),
        artboardId: z.string().optional(),
      },
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

In `electron/agent/tools.ts`:

```ts
import { createStudioTools, STUDIO_TOOL_NAMES } from './studioTools'
```

Add `...STUDIO_TOOL_NAMES,` to `BASE_AGENT_TOOL_NAMES`, add `const studioTools = createStudioTools(requestApproval)` beside the other tool-set constructions, and add `...studioTools,` to the `tools:` array in `createSdkMcpServer`.

- [ ] **Step 3: Write the tool test**

Create `electron/agent/studioTools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../studio/documentStore', () => ({
  listDocuments: vi.fn(async () => []),
  createDocument: vi.fn(async () => ({ id: 'd1', title: 'T', createdAt: '', updatedAt: '', artboards: [] })),
  readDocumentHtml: vi.fn(async () => '<html><head></head><body></body></html>'),
  writeDocumentHtml: vi.fn(async () => ({ id: 'd1', title: 'T', createdAt: '', updatedAt: '', artboards: [] })),
}))
vi.mock('../studio/export', () => ({ exportArtboardPng: vi.fn(), exportDocumentPdf: vi.fn() }))

const { createStudioTools, STUDIO_TOOL_NAMES } = await import('./studioTools')

const READ_TOOLS = ['studio_list_documents', 'studio_get_html', 'studio_screenshot', 'studio_list_presets']

describe('studio tools', () => {
  it('exposes exactly the nine tools the spec lists', () => {
    expect(STUDIO_TOOL_NAMES).toHaveLength(9)
    expect(createStudioTools(async () => true)).toHaveLength(9)
  })

  it('never asks approval for a read tool', async () => {
    const approve = vi.fn(async () => true)
    const tools = createStudioTools(approve)
    for (const name of READ_TOOLS) {
      const found = tools.find(t => t.name === name)
      expect(found, `${name} missing`).toBeDefined()
    }
    const list = tools.find(t => t.name === 'studio_list_documents')!
    await list.handler({}, {} as never)
    expect(approve).not.toHaveBeenCalled()
  })

  it('asks approval before creating a document, and refuses when denied', async () => {
    const approve = vi.fn(async () => false)
    const create = createStudioTools(approve).find(t => t.name === 'studio_create_document')!
    const result = await create.handler({ title: 'X' }, {} as never)
    expect(approve).toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('reports the real preset names when given one that does not exist', async () => {
    const create = createStudioTools(async () => true).find(t => t.name === 'studio_create_document')!
    const result = await create.handler({ title: 'X', preset: 'no such preset' }, {} as never)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Crisp Navy')
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

If a tool's `.handler` or `.name` is not reachable the way the test assumes, inspect what `tool()` returns and adjust the test to the real shape — do not weaken what it asserts.

---

## Task 7: IPC, preload, and renderer types

**Files:**
- Modify: `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`

**Interfaces:**
- Produces channels: `studio:listDocuments`, `studio:createDocument`, `studio:readHtml`, `studio:renameDocument`, `studio:deleteDocument`, `studio:exportPng`, `studio:exportPdf`, and a `studio:documentChanged` push.

- [ ] **Step 1: Add the handlers**

In `electron/main.ts`, beside the other feature blocks:

```ts
// ─────────────────────────────────────────────────────────────────
// IPC: Studio canvas — documents the agent authors and the user exports.
// ─────────────────────────────────────────────────────────────────

ipcMain.handle('studio:listDocuments', () => studioStore.listDocuments())
ipcMain.handle('studio:createDocument', (_e, title?: string) =>
  studioStore.createDocument(typeof title === 'string' && title.trim() ? title.trim() : undefined))
ipcMain.handle('studio:readHtml', (_e, id: string) => studioStore.readDocumentHtml(id))
ipcMain.handle('studio:renameDocument', (_e, id: string, title: string) => studioStore.renameDocument(id, title))
ipcMain.handle('studio:deleteDocument', (_e, id: string) => studioStore.deleteDocument(id))
ipcMain.handle('studio:exportPng', (_e, documentId: string, artboardId: string) => exportArtboardPng(documentId, artboardId))
ipcMain.handle('studio:exportPdf', (_e, documentId: string) => exportDocumentPdf(documentId))
```

With the imports:

```ts
import * as studioStore from './studio/documentStore'
import { exportArtboardPng, exportDocumentPdf } from './studio/export'
```

- [ ] **Step 2: Tell the renderer when the agent changes a document**

The canvas must refresh when a tool writes, without the user reloading. In `electron/studio/documentStore.ts`, add an emitter at the end:

```ts
import { EventEmitter } from 'events'

/**
 * Fires after any write, so the Studio page can reload the canvas when the
 * agent edits a document rather than the user having to refresh to discover
 * that their request was carried out.
 */
export const studioDocumentChanged = new EventEmitter()
```

And emit inside `writeDocumentHtml`, just before returning:

```ts
  studioDocumentChanged.emit('changed', id)
```

Then in `main.ts`, after the handlers:

```ts
studioDocumentChanged.on('changed', (documentId: string) => {
  mainWindow?.webContents.send('studio:documentChanged', documentId)
})
```

- [ ] **Step 3: Preload bindings**

In `electron/preload.ts`:

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

- [ ] **Step 4: Renderer types**

In `src/types/electron.d.ts`, add the interfaces and methods:

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

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json
git add electron/main.ts electron/preload.ts electron/studio/documentStore.ts src/types/electron.d.ts
git commit -m "feat: wire Studio document IPC and change notifications"
```

---

## Task 8: The Studio canvas page

**Files:**
- Create: `src/pages/StudioCanvas.tsx`
- Modify: `src/types/pages.ts`, `src/App.tsx`, `src/components/layout/LeftNav.tsx`

**Interfaces:**
- Consumes: the `studio*` renderer API from Task 7.

Match the retro styling used across the app — read `src/components/agent/SessionList.tsx` first for the idiom (`font-retro-mono`, `#D97706` accent, `retro-btn`, `#281E14` borders).

- [ ] **Step 1: Add the page id**

In `src/types/pages.ts`, add `'design'` to the `Page` union.

- [ ] **Step 2: Write the page**

Create `src/pages/StudioCanvas.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Download, FileText, Image as ImageIcon } from 'lucide-react'
import type { StudioDocumentMeta } from '@/types/electron'

/**
 * The canvas renders the document in a plain iframe rather than a native
 * WebContentsView: the document is local, trusted, self-contained HTML, and
 * an iframe scales and layers with the React UI instead of floating above it
 * the way a native view does — which is the problem every other page in this
 * app has to work around with manual bounds maths.
 */
interface Props { isActive: boolean }

export default function StudioCanvas({ isActive }: Props) {
  const api = window.electronAPI
  const [documents, setDocuments] = useState<StudioDocumentMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [html, setHtml] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)

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

  // The agent edits documents through its own tools, so the canvas has to
  // follow those writes rather than only the user's own actions.
  useEffect(() => {
    const onChanged = () => { void refresh() }
    api.onStudioDocumentChanged(onChanged)
    return () => api.offStudioDocumentChanged(onChanged)
  }, [api, refresh])

  async function handleCreate() {
    const created = await api.studioCreateDocument()
    await refresh()
    setActiveId(created.id)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document? Its HTML and exports are not recoverable.')) return
    await api.studioDeleteDocument(id)
    await refresh()
  }

  async function handleExport(kind: 'png' | 'pdf', artboardId?: string) {
    if (!activeId) return
    setBusy(kind)
    try {
      const path = kind === 'png' && artboardId
        ? await api.studioExportPng(activeId, artboardId)
        : await api.studioExportPdf(activeId)
      alert(`Saved to:\n${path}`)
    } catch (error) {
      alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full bg-[#FAF7F0]">
      {/* Documents + artboards */}
      <div className="w-[240px] shrink-0 flex flex-col border-r-2 border-[#281E14] bg-[#FAF7F0]">
        <div className="flex items-center justify-between h-14 px-3 border-b-2 border-[#281E14] bg-[#EBE5D5]">
          <span className="font-retro-mono text-[11px] font-bold uppercase tracking-wider text-[#281E14]">Documents</span>
          <button
            onClick={handleCreate}
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
                doc.id === activeId
                  ? 'border-2 border-[#D97706] bg-[#FEF3C7]'
                  : 'border border-[#E2DBD0] bg-white hover:border-[#D97706]/40'
              }`}
            >
              <div className="flex items-center gap-1">
                <p className="flex-1 min-w-0 truncate font-retro-sans text-[11px] font-bold text-stone-900">{doc.title}</p>
                <button
                  onClick={e => { e.stopPropagation(); void handleDelete(doc.id) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  <Trash2 size={11} className="text-stone-400 hover:text-[#DC2626]" />
                </button>
              </div>
              <p className="font-retro-mono text-[10px] text-stone-500 mt-0.5">
                {doc.artboards.length} artboard{doc.artboards.length === 1 ? '' : 's'}
              </p>
              {doc.id === activeId && doc.artboards.length > 0 && (
                <div className="mt-2 space-y-1">
                  {doc.artboards.map(board => (
                    <button
                      key={board.id}
                      onClick={e => { e.stopPropagation(); void handleExport('png', board.id) }}
                      className="w-full text-left px-2 py-1 rounded bg-white/70 border border-[#E2DBD0] font-retro-mono text-[10px] text-stone-700 hover:border-[#D97706] flex items-center gap-1"
                      title="Export this artboard as PNG"
                    >
                      <ImageIcon size={9} />
                      <span className="truncate">{board.name || board.id}</span>
                      <span className="ml-auto text-stone-400">{board.width}×{board.height}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between h-14 px-4 border-b-2 border-[#281E14] bg-[#EBE5D5] shrink-0">
          <span className="font-retro-sans text-sm font-bold text-[#281E14] truncate">
            {active?.title ?? 'No document'}
          </span>
          <button
            onClick={() => void handleExport('pdf')}
            disabled={!active || active.artboards.length === 0 || busy !== null}
            className="retro-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border-2 border-[#281E14] font-retro-mono text-[11px] font-bold text-[#281E14] disabled:opacity-40"
          >
            {busy === 'pdf' ? <Download size={12} className="animate-pulse" /> : <FileText size={12} />}
            Export PDF
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-[#e9e6df] overflow-auto">
          {html ? (
            <iframe
              title="Studio canvas"
              srcDoc={html}
              sandbox="allow-same-origin"
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
    </div>
  )
}
```

- [ ] **Step 3: Register the page**

In `src/App.tsx`, import it and add to the switch:

```tsx
      case 'design': return <StudioCanvas isActive={currentPage === 'design'} />
```

In `src/components/layout/LeftNav.tsx`, add beside the Studio entry:

```tsx
  { icon: LayoutTemplate,  page: 'design',    label: 'Design'     },
```

importing `LayoutTemplate` from `lucide-react`.

- [ ] **Step 4: Typecheck, test, commit**

```bash
npx tsc --noEmit -p tsconfig.web.json
npx vitest run
git add src/pages/StudioCanvas.tsx src/App.tsx src/components/layout/LeftNav.tsx src/types/pages.ts
git commit -m "feat: add the Studio canvas page"
```

---

## Task 9: The chat panel

**Files:**
- Create: `src/components/studio/StudioChat.tsx`
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `agentSessionList`, `agentSessionTurns`, `agentSendMessage`, `onAgentEvent` / `offAgentEvent` — all already present.
- Produces: default export `StudioChat` with props `{ isActive: boolean }`.

The spec's point is that Studio does not own a conversation: it attaches to the agent session the Agent page last had active, so "make a post about what we just discussed" needs no repetition.

This is deliberately a **minimal** panel — the last few turns plus an input — not a second copy of Agent.tsx's UI. Extracting that 736-line page into a shared component is a refactor worth doing when a third surface needs it, not on the first.

- [ ] **Step 1: Write the panel**

Create `src/components/studio/StudioChat.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import type { AgentRunEvent, AgentSessionMeta, AgentSessionTurn } from '@/types/electron'

/**
 * Studio's chat attaches to an existing agent session rather than starting
 * one. A second conversation the user cannot find on the Agent page would
 * split their history in half and break the one thing this panel exists for:
 * turning what was already discussed into a design without re-explaining it.
 */
interface Props { isActive: boolean }

export default function StudioChat({ isActive }: Props) {
  const api = window.electronAPI
  const [session, setSession] = useState<AgentSessionMeta | null>(null)
  const [turns, setTurns] = useState<AgentSessionTurn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [liveText, setLiveText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  async function load() {
    const sessions = await api.agentSessionList()
    const first = sessions[0] ?? null
    setSession(first)
    setTurns(first ? await api.agentSessionTurns(first.id) : [])
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns.length, liveText])

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

- [ ] **Step 2: Mount it**

In `src/pages/StudioCanvas.tsx`, import it and place it as the last child of the outer flex row, after the canvas column:

```tsx
      <StudioChat isActive={isActive} />
```

- [ ] **Step 3: Typecheck, test, commit**

```bash
npx tsc --noEmit -p tsconfig.web.json
npx vitest run
git add src/components/studio/StudioChat.tsx src/pages/StudioCanvas.tsx
git commit -m "feat: attach a Studio chat panel to the active agent session"
```

---


## Task 10: Manual verification

**Files:** none.

No automated test covers this: it exercises the agent, two Electron windows, and the filesystem together.

- [ ] **Step 1: Start the app**

`npm run dev`, then open the new **Design** page.

- [ ] **Step 2: Agent creates a carousel**

Ask from **Studio's own chat panel** (this is the point of it), or from the
Agent page - either way it is the same session: *"Make a 3-slide LinkedIn carousel about why uncommitted work is dangerous. Pick a preset that fits, then show me each slide."*

Expected: approval prompts for the document, artboards, and each write; the Design page shows three 1080×1080 artboards; the agent uses `studio_screenshot` and describes what it actually rendered.

- [ ] **Step 3: The canvas follows the agent**

Watch the Design page while the agent works. Expected: artboards appear without a manual refresh.

- [ ] **Step 4: Other formats**

Ask for a 1280×720 YouTube thumbnail and a 390×844 app screen in one document.

Expected: both appear at their own sizes on the same canvas.

- [ ] **Step 5: Export**

Click an artboard to export PNG, then Export PDF.

Expected: files in `Downloads/FlowDesk Studio`; the PNG opens at exactly the artboard's pixel size; the PDF has one page per artboard.

- [ ] **Step 6: Restart**

Close and reopen the app.

Expected: every document still listed, canvas renders the same.

- [ ] **Step 7: The chat panel shares the Agent page's session**

Say something on the Agent page, then open Design.

Expected: the panel shows that same exchange, and a message sent from the
panel appears on the Agent page too.

- [ ] **Step 8: Codex parity**

Switch the lead agent to Codex in Settings and ask it to add one more slide.

Expected: identical behaviour — the tools come from `createAgentToolSet`, which both providers share.

- [ ] **Step 9: Commit any fixes**

Fix, re-run `npx vitest run` and both typechecks, commit.

---

## Deliberately not in this plan

Visual editing, a font library, image generation inside a document, publishing to LinkedIn or Facebook, and responsive or interactive web output are all named non-goals in the spec. Each is its own slice on top of this canvas, and each needs this artboard structure settled before it can be designed.
