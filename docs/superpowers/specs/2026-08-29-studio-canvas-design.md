# Studio Canvas Design

> **Revision note.** A review of the first draft found ten real defects, all
> confirmed against the draft itself. This version fixes them. The ones that
> changed the design rather than just the code are called out inline as
> **[revised]** so a reader of the first version can see what moved and why.

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
   scaled to fit, with a zoom control.
2. A chat panel sits beside the canvas and drives the same agent session as
   the Agent page, so work already discussed there can become a design
   without re-explaining it. Approval prompts appear in that panel.
3. Asking the agent for a design creates or edits artboards, and the canvas
   reflects it without a manual refresh.
4. Any artboard exports to PNG. A document whose artboards are all the same
   size exports to a multi-page PDF.
5. Exports land in `Downloads/FlowDesk Studio`, named after the document or
   artboard rather than its id.
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
- **No image generation inside Studio**, and therefore **no populated assets
  directory** in this slice. See *Assets* below for why the directory exists
  anyway and what it will take to make it work.
- **No publishing.** Export writes a file; posting to LinkedIn or Facebook
  comes later.
- **No collaboration, cloud sync, or versioning beyond the file itself.**

## Architecture

### Document storage

```
<userData>/studio-documents/
  <documentId>/          documentId is a UUID, validated on every path
    document.html        the whole document, self-contained
    meta.json            title, artboard registry, timestamps
    assets/              reserved; see Assets
```

`document.html` is the source of truth. `meta.json` carries what the UI needs
without parsing HTML — title, and each artboard's id, name, and size — and is
rebuilt from the HTML if it is ever missing.

**Writes are atomic. [revised]** A write goes to a temporary file in the same
directory and is then renamed over the target, and writes to one document are
serialized behind a per-document promise chain. A plain `writeFile` truncates
before it writes, so an export or a canvas reload landing in that window would
see half a document — and the first draft claimed mid-write safety it did not
actually implement.

### Artboards inside the HTML

Each artboard carries its identity and size as attributes **and as inline
custom properties**:

```html
<div class="fd-artboard"
     data-fd-id="a1" data-fd-name="Slide 1"
     data-fd-w="1080" data-fd-h="1080"
     style="--fd-w:1080px;--fd-h:1080px">
  ...
</div>
```

**[revised]** The inline `style` is not redundant. The stylesheet sizes an
artboard with `width: var(--fd-w)`, and a `data-fd-w` attribute does not
become a CSS variable — the first draft set the attribute only, so every
artboard would have rendered at the fallback 1080×1080 regardless of its
declared size, silently breaking thumbnails, app screens, and web pages.

The attributes remain because they are what the parser reads and what a
person editing the file by hand will look for; the inline properties are what
the browser lays out from. `appendArtboard` writes both, and escapes the name
so a quote in a title cannot break the document.

### Rendering the canvas

**An `<iframe srcdoc>`, not a `WebContentsView`. [revised]** The first draft's
prose said `WebContentsView` while its own implementation used an iframe. The
iframe is the right choice and the prose was wrong: a native view floats above
the React tree and has to be positioned by hand against a DOM rectangle, which
every other page in this app works around. A document is local, trusted HTML,
so an iframe with `sandbox="allow-same-origin"` is enough, and it scales,
scrolls, and layers like any other element.

Scaling is done by a small script injected into the frame: it measures the
frame's own width, computes `min(1, available / artboardWidth)` per artboard,
and applies it as a CSS transform with a matching layout height so scaled
artboards do not leave gaps. A zoom control multiplies that factor.

### Export

Two distinct operations, because they are not the same kind of thing:

| Operation | Returns | Touches disk | Approval |
| --- | --- | --- | --- |
| `renderArtboardPng` | a PNG buffer | no | no |
| `exportArtboardPng` | a written path | yes | yes |
| `exportDocumentPdf` | a written path | yes | yes |

**[revised]** The first draft had `studio_screenshot` — declared read-only —
call the exporter, so every look at an artboard wrote a file into the user's
Downloads folder. Splitting the render from the write is what makes the
read/write boundary true rather than merely stated.

Rendering happens in an offscreen `BrowserWindow` sized to the artboard, so
exported pixels match the artboard's declared size rather than whatever zoom
the visible canvas is at. That window runs page JavaScript inside a
**sandbox** (`sandbox: true`, `contextIsolation: true`, `nodeIntegration:
false`). Disabling JavaScript outright was the original intent and is not
possible: the measured spike found that `javascript: false` also breaks
`executeJavaScript`, so the readiness check below could not run and a late
web font would export as the fallback face. A sandboxed, context-isolated,
Node-less window is the ordinary browser-tab model and cannot reach the
system.

The window's content size is set **after** the page loads. The spike found a
window constructed at 1080x1080 reporting a content size of 1080x852, which
clipped the capture — constructor dimensions alone are not enough.

Before capturing, rendering waits on `document.fonts.ready` and on every
image having decoded, rather than a fixed sleep — a preset's Google Font
arriving late would otherwise export the fallback face.

**PDF requires one size per document. [revised]** `printToPDF` takes a single
page size for the whole document, so a document mixing a 1280×720 thumbnail
with a 390×844 screen cannot become one correct PDF. Rather than silently
cropping or letterboxing, `exportDocumentPdf` refuses and names the sizes it
found. PNG export stays per-artboard and is unaffected, so a mixed document is
still perfectly usable — the restriction is on PDF alone. Supporting mixed
page sizes needs a verified `@page` / `preferCSSPageSize` spike or a PDF
merging dependency, and neither belongs in this slice.

### Security

The agent supplies document and artboard ids, and one of the operations is a
recursive delete, so ids are not trusted input:

- A document id must match the UUID shape before it is used to build any
  path. The resolved path is then checked to still sit inside
  `studio-documents`, so neither `../` nor an absolute path can escape.
- IPC handlers receive `unknown` and validate rather than trusting a declared
  TypeScript type, which the renderer cannot enforce at runtime.
- Offscreen render windows run with `nodeIntegration` off, `contextIsolation`
  on, and `sandbox` on. Page JavaScript is enabled because the spike showed
  `javascript: false` also disables `executeJavaScript` and therefore the
  font-readiness check; the sandbox is what contains the page.

**[revised]** The first draft built paths straight from the supplied id. The
same validation already exists in `electron/savedImages.ts` for image
filenames, with tests; not carrying it here was an inconsistency in this
codebase's own established practice rather than a novel risk.

### Assets

`assets/` is created with each document and stays empty in this slice, since
nothing here inserts an image yet.

It is worth stating what it will take, because the current rendering makes it
impossible: both the canvas (`srcdoc`) and the exporter (`data:` URL) render
without a document origin, so a relative `assets/photo.png` has nothing to
resolve against. The image slice will load documents from a registered custom
protocol scoped to the documents directory — the same approach
`flowdesk-image://` already uses — rather than injecting a `<base href>`,
because a protocol also bounds what a document can reach.

### Themes

The 31 presets in `crausel system for refrence/carousel-presets.md` are
design data — fonts, CSS custom properties, layout rules, and the signature
elements of each style. They are imported into `electron/studio/presets.ts`
as structured data the agent reads when generating.

They are imported rather than referenced in place, because that directory is
a cloned reference repository, not a dependency: the app must not break if it
is deleted, and the presets need a shape the agent can query by name.

A preset name is validated **before** a document is created, so an unknown
name does not leave an empty document behind.

### Agent tools

Split by whether they change anything, which is also the approval boundary:

**Read — no approval, they only look**

| Tool | Returns |
| --- | --- |
| `studio_list_documents` | documents with their artboards |
| `studio_get_html` | a document's HTML, or one artboard's |
| `studio_screenshot` | a rendered PNG as an image block, written nowhere |
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
session and sends through the same `agent:sendMessage` path, so a turn started
in Studio lands in the same transcript and the same provider session.

**It must render approval prompts. [revised]** Every write tool asks for
approval, and the first draft's panel handled only `text`, `done`, and
`error` — so the very first design request from Studio would have blocked
forever on a prompt nobody could answer. Approval queueing and the dialog are
extracted from `Agent.tsx` into a shared hook and component used by both
surfaces, so they cannot drift apart again.

The panel attaches to the session the user last had active, which is
persisted rather than inferred: `sessions[0]` is the most recently *updated*
session, which is not the same thing and would jump to whichever session an
agent last wrote to.

Studio never creates a session of its own; if none exists it asks the user to
start one on the Agent page rather than quietly opening a second conversation
the user cannot find.

### Studio page layout

```
┌──────────────────────────────────────────────────────┐
│ document name │ zoom │ Export ▾                       │
├──────────┬───────────────────────────┬───────────────┤
│ Documents│                           │ Agent chat    │
│ + art-   │      CANVAS               │ + approvals   │
│ boards   │      (scaled to fit)      │               │
│ [+]      │                           │               │
└──────────┴───────────────────────────┴───────────────┘
```

The right panel is where later slices add Layers, Properties, Assets, and
Fonts as tabs; the left list grows to hold pages.

## Modules

| File | Responsibility |
| --- | --- |
| `electron/studio/paths.ts` | id validation and containment-checked paths |
| `electron/studio/artboards.ts` | pure: parse, splice, append, escape |
| `electron/studio/presets.ts` | the 31 presets as data, plus lookup |
| `electron/studio/documentStore.ts` | atomic, serialized document reads and writes |
| `electron/studio/render.ts` | offscreen render to PNG buffer or PDF buffer |
| `electron/studio/export.ts` | write a rendered buffer to Downloads |
| `electron/agent/studioTools.ts` | the nine agent tools |
| `src/hooks/useAgentApprovals.ts` | approval queue shared by Agent and Studio |
| `src/components/agent/ApprovalDialog.tsx` | the prompt both surfaces render |
| `src/pages/StudioCanvas.tsx` | documents, canvas, zoom |
| `src/components/studio/StudioChat.tsx` | the chat panel |

`paths.ts` and `render.ts` are separate from `documentStore.ts` and
`export.ts` respectively because each pair is one testable rule plus one
side-effecting caller, and mixing them is what let the read/write boundary
break in the first draft.

## Error handling

- **A document whose HTML no longer parses** — report it and offer the raw
  HTML; never rewrite a file we cannot understand.
- **An id the agent invents** — refuse with the list of real ids.
- **An id that is not a UUID** — refuse before touching the filesystem.
- **A PDF export of a mixed-size document** — refuse, naming the sizes found.
- **A preset name that does not exist** — refuse before creating anything.

## Testing

Pure, no Electron: artboard parse/splice/append round-trips, name escaping,
size properties written, id validation accepting UUIDs and rejecting
traversal, preset lookup.

Store, on a temp directory: atomic write leaves no partial file, concurrent
writes to one document serialize, meta rebuilds from HTML, delete removes
exactly one directory and refuses a non-UUID id.

Tools: every write tool requests approval, no read tool does, `studio_screenshot`
writes nothing to disk, unknown ids and presets are refused with real options.

## Open questions

Whether `printToPDF` reproduces an artboard's declared pixel size exactly is
still unverified, and the measurement must include the PDF's own MediaBox
rather than only its byte length — the first draft's spike measured bytes,
which would not have answered the question it existed for. The spike runs
before the exporter is built and covers square, landscape, and portrait
artboards.
