# Studio Design System

Direct manipulation on the Studio canvas — selecting, moving, resizing, and
restyling what the agent designed — without giving up HTML as the source of
truth.

> Builds on [2026-08-29-studio-canvas-design.md](2026-08-29-studio-canvas-design.md),
> which established the artboard model and the HTML-as-truth decision. This
> spec does not revisit those; it adds a second author.

## The problem

Today the user cannot touch a design. Every change — nudging a heading two
pixels, darkening one circle, fixing a typo — goes through the agent, which
rewrites HTML and takes seconds to do it. That is the right cost for "design
me a carousel" and an absurd one for "make this blue."

The canvas is view-only: zoom buttons, nothing else. There is no selection,
no drag, no property panel, no undo.

## The one decision everything rests on

**The user and the agent edit the same HTML.** No parallel scene graph, no
JSON model rendered to HTML.

The tempting alternative is a structured document model (shapes, layers,
properties as data) rendered to HTML for display — how Figma and Canva work
internally. It makes editing trivial and is the wrong choice here, because
it would demote the agent from author to code generator: it would have to
emit a constrained JSON dialect instead of the HTML it writes fluently, and
the previous spec's central bet — that an agent writing real HTML is what
makes this whole feature cheap — would be lost. Export would also stop being
"render the document" and become "render a translation of the document."

So: the DOM is the model. Direct manipulation must therefore be expressible
as HTML edits, and everything below follows from that constraint.

## The editing contract

Direct manipulation needs two things HTML does not give for free: stable
identity for an element, and a place to put a user's override that reliably
beats the agent's stylesheet.

### Identity — `data-fd-el`

Every element the user may select carries `data-fd-el="<short-id>"`, written
by the agent as part of normal authoring (its tools' descriptions will
require it) and backfilled by a one-pass migration for existing documents.

Identity cannot be positional. A CSS path like `.hero > div:nth-child(3)` is
invalidated the moment the agent inserts a sibling, which it does constantly;
selection, undo history, and any saved reference would all silently retarget
to the wrong element. An explicit id survives the agent rewriting everything
around it.

### Override — inline styles

A user edit is written as an inline style on that element.

This is not a shortcut. Inline styles beat class selectors by specificity, so
a UI edit lands predictably without the editor having to read, understand,
and outrank whatever the agent's stylesheet already says. The alternative —
editing the agent's CSS rules — means parsing arbitrary CSS, guessing which
rule "owns" a property, and rewriting it without disturbing the other
elements that rule serves. That is a losing fight against a co-author who
rewrites the stylesheet whenever it feels like it.

The visible consequence, which the UI must be honest about: an inline
override wins until the agent explicitly clears it. If the user hand-picks a
colour and then asks the agent to "make it match the theme," the agent has to
remove the inline style, not just change a token. Its tools will say so.

### What is editable, and what is not

Direct manipulation covers a **fixed, closed set** of properties:

| Group | Properties |
| --- | --- |
| Geometry | x, y, width, height, rotation |
| Fill & stroke | background-color, border-color, border-width, border-radius |
| Effects | box-shadow, opacity |
| Typography | font-family, size, weight, line-height, letter-spacing, colour, alignment |
| Content | text content, image `src` and `alt` |

Everything else — layout mode, flex/grid structure, pseudo-elements,
animations, media queries, gradients, filters, and any CSS the agent invents
— stays agent territory, reachable through chat.

This boundary is a design decision, not a limitation to apologise for. A
property panel that tried to expose arbitrary CSS would become a worse code
editor. The split is: **direct manipulation for what the hand is better at,
language for what language is better at.** Selecting an element and saying
"give this a diagonal gradient like the one above" is genuinely easier than
building a gradient editor, and the agent already does it well.

The UI must show this boundary rather than hide it. A selected element's
panel shows the properties it can edit; a "Ask the agent…" affordance in the
same panel carries the current selection into chat, so the escape hatch is
one click from the dead end.

## Architecture

### The overlay is outside the iframe

Selection outlines, resize handles, snap guides, and the marquee are React
elements drawn in the world layer **above** the iframe, never inside it.

The document must stay export-clean. Export re-renders the same HTML
offscreen (`electron/studio/render.ts`), so anything the editor injects into
the document risks appearing in a PNG. Keeping editor chrome outside also
means it renders at screen resolution regardless of canvas zoom — handles
stay crisp and a constant size at 25% or 400%, which is what makes a canvas
feel precise.

### How the two sides talk

The iframe runs a small, injected **editor bridge** whose entire job is
translating between DOM facts and the React editor:

```
iframe (document)                    React (editor)
  bridge script                        viewport + overlay
    ├── hit-test at point      ──►  selection id
    ├── element bounds         ──►  handle placement
    ├── apply style preview    ◄──  live drag feedback
    └── commit                 ──►  patch to main process
```

Live drag feedback is applied to the DOM directly for smoothness and is
**not** persisted; only the commit at pointer-up produces a patch. Writing on
every mousemove would mean hundreds of file writes and an unusable undo
history.

### Writes are patches, not string surgery

An edit becomes a structured patch — `{ elementId, styles?, text?, attrs? }` —
applied by a dedicated module (`electron/studio/htmlPatch.ts`) that finds the
element by `data-fd-el` and rewrites only that element's `style` attribute or
text content.

Applying edits by regex over the document is how this feature would rot: the
first attribute containing a `>` or a nested quote produces silently corrupt
HTML, and the corruption surfaces later as an unexplained rendering bug. The
patch module is pure, has no Electron dependency, and is unit-tested against
real agent-authored HTML — including elements with nested quotes, existing
inline styles, self-closing tags, and duplicate ids.

Existing writes already serialise per document
(`electron/studio/documentStore.ts`); patches use that same path, so a user
drag and an agent rewrite cannot interleave into a corrupt file.

### History

Undo/redo is a stack of applied patches with their inverses, captured at
commit. It lives in the renderer, is per-document, and does not survive
restart.

Agent edits enter the same stack. A user who nudges a box, asks the agent to
restyle the section, and hits Ctrl+Z expects the agent's change to come back
off — one timeline, or the feature is a trap.

## Phases

Each phase ends with something usable. Ordering is by dependency, not by
value: selection cannot be built before navigation is comfortable, transform
cannot be built before selection, and undo cannot be built before patches.

**Phase 1 — Navigation** *(design already approved)*
Space+drag and middle-drag pan, Ctrl/Cmd+wheel zoom anchored at the cursor,
wheel/shift-wheel pan, Fit and 100%. Viewport maths extracted to
`src/lib/canvasViewport.ts` and unit-tested.

**Phase 2 — Selection**
`data-fd-el` convention, agent tools updated to emit it, migration for
existing documents. Editor bridge with hit-testing and bounds reporting.
Click to select, Esc to clear, selection outline in the overlay. A read-only
inspector showing what the selected element is.

**Phase 3 — Patches and history**
`htmlPatch.ts` with its test suite. The commit path end to end. Undo/redo
stack. Nothing new is visible to the user, but every later phase is a small
change instead of a large one — this is the phase that makes the rest cheap.

**Phase 4 — Transform**
Drag to move, eight resize handles, arrow-key nudge, shift to constrain.
Snapping to artboard edges, centres, and sibling edges, with guides drawn in
the overlay.

**Phase 5 — Text**
Double-click to edit in place via `contenteditable`, committed as a text
patch. Typography controls in the property panel.

**Phase 6 — Property panel**
The rest of the editable set: fill, stroke, radius, shadow, opacity. Colour
picker seeded from the document's `:root` tokens, so hand-picked colours
default to the theme rather than drifting from it. The "Ask the agent…"
escape hatch.

**Phase 7 — Insert**
Rectangle, ellipse, text, and image, inserted as plain HTML at a chosen
point. Deliberately after the property panel: an inserted box is useless
until it can be styled.

**Phase 8 — Images**
Insert from disk, from the generated-image library, or from a provider.
Crop and fit. Replace-in-place on an existing `<img>`.

**Phase 9 — Layers**
A tree of the artboard's elements, mirroring document order. Reorder,
rename, hide, lock. Z-order changes are structural (element moves in the
DOM), so this needs a move-node patch beyond Phase 3's style patches.

**Phase 10 — Alignment**
Align and distribute across a multi-selection, which also requires
multi-select in the overlay and marquee selection.

## Open questions, to settle by spike rather than argument

**Background removal.** The user wants it, and the honest answer is that we
do not yet know the right mechanism. Three candidates: a WASM/ONNX model
running locally in the renderer (fits local-first, unknown bundle size and
quality), an existing browser provider such as Gemini's image editing (no new
dependency, slow and quota-bound), or a system tool. This needs a spike
measuring output quality on real assets and bundle cost **before** it is
committed to a phase. It is deliberately absent from the phases above.

**Existing document migration.** Whether `data-fd-el` backfill can be a pure
function over stored HTML, or needs a rendered DOM to disambiguate. Cheap to
find out; determines whether Phase 2 carries a migration risk.

## Testing

The parts that are pure get real unit tests, because they are the parts where
a subtle error is invisible until it corrupts something: `canvasViewport.ts`
(zoom-at-cursor, clamping, fit), `htmlPatch.ts` (apply, invert, malformed
input, adversarial attribute contents), and the `data-fd-el` migration.

The parts that are inherently interactive — drag feel, snap thresholds,
handle hit areas — are verified by using them, and are written so that the
maths underneath is in the tested pure modules rather than in event handlers.

## Explicitly out of scope

Components and symbols, collaborative editing, version history beyond
in-session undo, vector path editing, blend modes, and effects requiring
compositing beyond CSS. Each is a product in its own right; none is needed
to make the canvas feel like a design tool.
