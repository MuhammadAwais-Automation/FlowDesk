# Studio Canvas Design

## Purpose

Let the agent design anything FlowDesk needs to publish — a LinkedIn
carousel, a single social post, a YouTube thumbnail, an app screen, a web
page — as real HTML on a canvas the user can see, and export it as PNG or
PDF.

## The one idea this rests on

An **artboard** is a fixed-size box of HTML. Everything the user asked for is
a set of artboards that differ only in size and count:

| What it is | Artboards |
| --- | --- |
| LinkedIn carousel | 8 × `1080×1080` |
| LinkedIn post | 1 × `1080×1350` |
| YouTube thumbnail | 1 × `1280×720` |
| App flow | 5 × `390×844` |
| Web page | 1 × `1440×3000` |

Treating "social posts" and "app/web design" as one feature rather than two
follows from this: they are the same engine with different numbers. Building
them separately would produce two canvases, two exporters, and two sets of
agent tools that drift apart.

## Why HTML rather than a drawing format

The agent is the primary author here, and it writes HTML far better than it
would drive a shape API. HTML also needs no conversion step to become the
thing that ships, and Electron already contains a browser that renders and
exports it, so the canvas, the preview, and the export are one mechanism
rather than three.

This is not an untested bet. paper.design is a funded product built on
exactly this premise — an HTML/CSS canvas with agents reading and writing it
over MCP — used in production by designers at Vercel, Tailwind, and Zed. The
tool surface below deliberately mirrors the read/write split they arrived at.

## User-visible behaviour

1. Studio lists documents; opening one shows its artboards on a canvas,
   scaled to fit.
2. A chat panel sits beside the canvas and drives the same agent session as
   the Agent page, so work already discussed there can become a design
   without re-explaining it.
3. Asking the agent for a design creates or edits artboards, and the canvas
   reflects it without a manual refresh.
4. Any artboard, or a whole document, exports to PNG; a multi-artboard
   document also exports to a single multi-page PDF.
5. Exports land in `Downloads/FlowDesk Studio` under a readable name.
6. A document survives restart, and its HTML is a plain file the user can
   open in any editor.

## Non-goals

- **No visual editing.** No dragging, no layer reordering, no properties
  panel. Editing happens by asking the agent. The visual editor is a later
  slice and needs this canvas's structure settled first.
- **No responsive or interactive web output.** A web page here is one tall
  static artboard. No breakpoints, no hover or click states, no prototyping.
  Saying otherwise would promise a working site and deliver a picture of one.
- **No font library.** Presets load Google Fonts by URL, as they already do.
- **No image generation inside Studio.** Existing Flow/ChatGPT tools produce
  images; wiring them into a document is the next slice.
- **No publishing.** Export writes a file; posting to LinkedIn or Facebook
  comes later.
- **No collaboration, cloud sync, or versioning beyond the file itself.**

## Architecture

### Document storage

```
<userData>/studio-documents/
  <documentId>/
    document.html     the whole document, self-contained
    meta.json         title, artboard registry, timestamps
    assets/           images referenced by the HTML
```

`document.html` is the source of truth and is written whole on each change
rather than appended to, because unlike a transcript it has no natural
append point — an edit can touch anything. `meta.json` carries what the UI
needs without parsing HTML: title, and each artboard's id, name, and size.

### Artboards inside the HTML

Each artboard is one element carrying its identity and size as data
attributes:

```html
<div class="fd-artboard" data-fd-id="a1" data-fd-w="1080" data-fd-h="1080">
  ...
</div>
```

Attributes rather than a separate index because a single file that fully
describes itself can be opened, edited by hand, and re-imported without
`meta.json` having to be correct. `meta.json` is a cache; the HTML wins.

### Rendering

A `WebContentsView` loads `document.html`, following the pattern the rest of
FlowDesk already uses for hosting web content. A small injected script scales
the artboards to fit the viewport, the same approach the carousel reference
CSS takes.

### Export

Electron's own `printToPDF` and `capturePage` do the work; no Playwright, no
headless browser, no new dependency. Export renders in an offscreen window
sized to the artboard so the exported pixels match the artboard's declared
size exactly rather than whatever the visible canvas happens to be scaled to.

### Themes

The 31 presets in `crausel system for refrence/carousel-presets.md` are
design data — fonts, CSS custom properties, layout rules, and the signature
elements of each style. They are imported into `electron/studio/presets.ts`
as structured data the agent reads when generating.

They are imported rather than referenced in place, because that directory is
a cloned reference repository, not a dependency: the app must not break if it
is deleted, and the presets need a shape the agent can query by name.

The reference `viewport-base-square.css` is generalised from its fixed
1080×1080 stage to a size-driven one, since artboards here are not all
square.

### Agent tools

Split by whether they change anything, which is also the approval boundary:

**Read — no approval, they only look**

| Tool | Returns |
| --- | --- |
| `studio_list_documents` | documents with their artboards |
| `studio_get_html` | a document's HTML, or one artboard's |
| `studio_screenshot` | a PNG of an artboard, as an image block |
| `studio_list_presets` | preset names with their vibe and best-for notes |

**Write — approval required, they change a real file**

| Tool | Does |
| --- | --- |
| `studio_create_document` | new document, optionally from a preset |
| `studio_create_artboard` | add an artboard of a given size |
| `studio_write_html` | replace an artboard's inner HTML |
| `studio_update_styles` | change document-level CSS custom properties |
| `studio_export` | write PNG or PDF to Downloads |

`studio_screenshot` is in the first slice, not deferred: without it the agent
writes HTML it has never seen rendered, and cannot tell a correct layout from
a broken one. It returns the same MCP image content block `view_saved_image`
already uses.

Tools go through `createAgentToolSet`, so Claude and Codex both get them with
no per-provider work — the same mechanism that already gives both the
existing worker and Flow tools.

### The chat panel

Studio does not own a conversation. Its panel attaches to an existing agent
session by id — the one the Agent page last had active — and sends through
the same `agent:sendMessage` path, so a turn started in Studio lands in the
same transcript and the same provider session.

This is the whole reason "make a post about what we just discussed" works
without repeating the discussion, and it is why the sessions work had to come
first. Studio never creates a session of its own; if none exists it asks the
user to start one on the Agent page rather than quietly opening a second
conversation the user cannot find.

### Studio page layout

```
┌──────────────────────────────────────────────────────┐
│ document name │ + Artboard │ Export ▾                 │
├──────────┬───────────────────────────┬───────────────┤
│ Artboard │                           │ Agent chat    │
│ list     │      CANVAS               │ (same session │
│          │      (scaled to fit)      │  as Agent)    │
│ [+]      │                           │               │
└──────────┴───────────────────────────┴───────────────┘
```

The right panel is where later slices add Layers, Properties, Assets, and
Fonts as tabs; the left list grows to hold pages. Laying it out this way now
costs nothing and avoids a rebuild when those arrive.

## Modules

| File | Responsibility |
| --- | --- |
| `electron/studio/documentStore.ts` | document directories: list, create, read, write, delete |
| `electron/studio/artboards.ts` | pure: parse artboards out of HTML, splice one back in |
| `electron/studio/presets.ts` | the 31 presets as data, plus lookup by name |
| `electron/studio/export.ts` | offscreen render to PNG / PDF |
| `electron/agent/studioTools.ts` | the nine agent tools |
| `src/pages/StudioCanvas.tsx` | the page: artboard list, canvas host, chat panel |

`artboards.ts` is pure and separate because HTML splicing is the part most
likely to be subtly wrong, and it is the only part testable without Electron.

## Error handling

- **A document whose HTML no longer parses into artboards** — report it and
  offer the raw HTML; never rewrite a file we cannot understand.
- **An artboard id the agent invents** — refuse with the list of real ids
  rather than creating one silently.
- **An export while the document is mid-write** — export reads the file, so a
  failed read is reported, not retried into a half-written file.
- **A preset name that does not exist** — refuse with the closest matches.

## Testing

Pure (`artboards.ts`, `presets.ts`), no Electron:

- Artboards parse out of a document with their id, size, and inner HTML.
- Splicing one artboard back leaves every other artboard byte-identical.
- A document with no artboards parses to an empty list, not an error.
- Malformed HTML reports a parse failure rather than returning half a result.
- Preset lookup is case-insensitive and refuses an unknown name.

Store, against a temp directory:

- Creating a document writes `document.html` and `meta.json`.
- Writing a document leaves `assets/` untouched.
- Deleting removes exactly one document directory.
- Reading a document whose `meta.json` is missing rebuilds it from the HTML,
  since the HTML is the source of truth.

Tools:

- Every write tool requests approval before touching a file.
- No read tool requests approval.
- `studio_write_html` against an unknown artboard id returns the real ids.

## Open questions

Whether `printToPDF` reproduces the artboard's declared pixel size exactly,
or applies a print scaling factor, is not yet verified and must not be
assumed — the cheapest experiment is to export one 1080×1080 artboard and
measure the output before the export module is built, since the answer
decides whether export needs an explicit scale correction.
