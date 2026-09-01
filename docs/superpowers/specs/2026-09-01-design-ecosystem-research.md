# Design Ecosystem — Research Findings

Research conducted 2026-09-01 to answer: can FlowDesk's Studio become a
conversational, agent-driven design tool capable of the graphic-design work in
the reference set (textured carousel covers, halftone posters, subject-behind-
type compositions) — and if so, by what mechanism?

Method: `self-ask-deep-research` — 10 sub-questions across six perspectives,
two search rounds with a reflect pass between them.

---

## Constraints that shaped the answer

- Everything must be **HTML/CSS**, because that is what the agent writes well and what export renders.
- **95% accuracy first shot**, and still fully editable afterwards.
- The **agent controls everything** — placement, textures, effects, SVG — driven conversationally ("make this effect stronger", "try a different texture").
- **Local-first Electron**, no API keys.
- Must not break the existing `data-fd-el` + inline-style editing contract.

---

## Finding 1 — Paper's architecture is the same bet we already made

Paper's canvas renders real HTML/CSS; every object is HTML with no proprietary
intermediate format ([paper.design](https://paper.design/)). This is the same
architectural decision recorded in our own
[2026-08-30-studio-design-system-design.md](2026-08-30-studio-design-system-design.md).
That is corroboration, not a course correction.

Its MCP server exposes **21 tools** ([Paper MCP docs](https://paper.design/docs/mcp)):

| Read | Write |
| --- | --- |
| `get_basic_info`, `get_selection`, `get_node_info`, `get_children`, `get_tree_summary`, `get_screenshot`, `get_jsx`, `get_computed_styles`, `get_fill_image`, `get_font_family_info`, `get_guide`, `export` | `create_artboard`, `write_html`, `set_text_content`, `rename_nodes`, `duplicate_nodes`, `move_nodes`, `update_styles`, `delete_nodes`, `finish_working_on_nodes` |

Agents read and write JSX (Tailwind or inline styles), HTML, and base64 images.

### The gap this exposes

Our current agent surface is `studio_list_documents`, `studio_get_html`,
`studio_screenshot`, `studio_list_presets`, `studio_create_document`,
`studio_create_artboard`, `studio_write_html`, `studio_update_styles`,
`studio_add_image`, `studio_export`.

Mapped against Paper's, the coverage is roughly 60% — and the missing 40% is
concentrated in exactly one place: **per-element read/write**.

- Our `studio_update_styles` rewrites the document's `:root` token block. Paper's `update_styles` updates **CSS on specific nodes**.
- We have no `get_computed_styles` equivalent at all.

This matters more than any texture question, for the reason in Finding 4.

---

## Finding 2 — Paper Shaders is open source, and it contains the exact effects in the reference images

`@paper-design/shaders` / `@paper-design/shaders-react`, **Apache 2.0**, zero
runtime dependencies, installable from npm
([GitHub](https://github.com/paper-design/shaders),
[shaders.paper.design](https://shaders.paper.design/)).

30+ WebGL2 effects. The ones that map directly onto the reference set:

| Reference image | Shader |
| --- | --- |
| Red/white parrot + skull carousel (dotted print texture) | **Halftone Dots**, **Halftone CMYK** |
| Distressed paper background across the whole red/white set | **Paper texture** |
| Grain over the orange "skills" cover and the sky/grass frame | **Grain Gradient** |
| — | Image Dithering, Lens Distortion, Fluted Glass, Liquid Metal, Mesh Gradient, God Rays |

Commercial use permitted without visible attribution; redistribution requires
preserving LICENSE and NOTICE.

This is a genuinely unexpected result: the single hardest-looking part of the
problem has an off-the-shelf, permissively-licensed, dependency-free answer
built by the same team whose tool prompted the question.

---

## Finding 3 — …but our export path would silently blank it, and that reframes everything

`electron/studio/render.ts` sets `offscreen: true` (line 68) and drives the
render through `webContents.invalidate()` + the `paint` event — Electron's
offscreen rendering mode.

Electron's own documentation splits offscreen rendering into GPU-accelerated
and software modes, noting that **GPU-accelerated composition is what makes
WebGL and 3D CSS animation work**
([Electron OSR docs](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)).
Field reports of WebGL failing under offscreen rendering exist
([electron#39859](https://github.com/electron/electron/issues/39859), closed as
not planned).

So adopting shaders naively risks: correct on canvas, blank or black in the
exported PNG/PDF. Since export fidelity is the entire point of the
artboard-at-natural-size decision from Phase 1, that would be a silent,
load-bearing regression.

### The way through

WebGL canvases return black from `toDataURL()` by default, because the drawing
buffer is cleared after swap — **unless the context is created with
`preserveDrawingBuffer: true`**, which makes `toDataURL()` reliably correct
([WebGL Fundamentals — Taking a Screenshot of the Canvas](https://webglfundamentals.org/webgl/lessons/webgl-tips.html)).

That yields a **bake step**: author with live shaders on the canvas, and at
export time convert each shader canvas to a PNG data URI and swap it for an
`<img>` before the offscreen render runs. Export then contains no WebGL at all,
and the offscreen-mode question stops mattering.

### And a fallback that needs no WebGL

Both headline textures are achievable in pure CSS/SVG:

- **Grain / paper** — SVG `feTurbulence` generating fractal Perlin noise, with `feColorMatrix` controlling opacity ([Codrops — Creating Texture with feTurbulence](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/), [freeCodeCamp](https://www.freecodecamp.org/news/grainy-css-backgrounds-using-svg-filters/)).
- **Halftone** — `radial-gradient` layers plus `mix-blend-mode` and a high `filter: contrast()` to simulate the threshold CSS lacks, with a slight blur chained ahead of the contrast to keep dot edges clean ([Lean Rada — Creating a halftone effect with CSS](https://leanrada.com/notes/pure-css-halftone/), [Frontend Masters — Pure CSS Halftone in 3 Declarations](https://frontendmasters.com/blog/pure-css-halftone-effect-in-3-declarations/)).

These are compositor-level CSS, not WebGL, so they are far likelier to survive
offscreen capture — though this remains unverified (see below).

---

## Finding 4 — "make this effect stronger" is a read-modify-write loop, not a prompt trick

This was the question with the least obvious answer going in, and Paper's tool
list answers it structurally rather than cleverly.

To honour *"is effect ko thoda barhao"* the agent must:

1. `get_computed_styles(node)` — learn the effect's **current** value
2. reason about the delta
3. `update_styles(node, { ...changed })` — write back **that element's** style

Without step 1 the agent is guessing at what "stronger" means relative to; with
only document-level token writes (what we have today) it cannot do step 3 at
all. **This pair of tools is the mechanism behind conversational design
control**, and it is the highest-value gap in our current agent surface.

It also composes cleanly with the editing contract already specified: user
edits land as inline styles because they outrank the stylesheet, and per-node
`update_styles` writes to exactly the same place.

---

## Finding 5 — the subject-behind-type effect needs a cutout, and that runs locally

The "skills" cover (figure walking through the letterforms) and the MILLENIUM
parrot (type turning white where it crosses the bird) are the same technique:
type composited **between** a background and a foreground subject with an alpha
channel.

CSS can do the compositing — `mask-image`, `mask-mode`, `-webkit-background-clip: text`
([web.dev — CSS masking](https://web.dev/articles/css-masking),
[CSS-Tricks — Knockout Text](https://css-tricks.com/css-techniques-and-effects-for-knockout-text/)).
What CSS cannot do is *know where the subject is*. Something must produce the cutout.

Local, offline options exist: **U²-Net, ISNet, BiRefNet, MODNet** run through
`onnxruntime`, compositing the predicted mask as an alpha channel
([BaepatLabs/background-remover](https://github.com/BaepatLabs/background-remover/blob/main/SKILL.md)),
and browser/WASM implementations of the same models are in production use
([GotConvert](https://gotconvert.com/remove-background/)).

This closes the background-removal spike that the original design spec
deliberately left open, and it turns out to serve two features at once —
background removal *and* subject-behind-type composition are the same
capability.

---

## Finding 6 — Paper's own limits tell us where the bar actually is

Reported by reviewers: not production-ready; no responsive design (generated
code uses absolute positioning); output characterised as "a bunch of divs with
inline styles"; core primitives limited to Frame, Rectangle, Text; no plugin
marketplace or shared libraries; collaboration incomplete
([uithings — Figma vs Paper](https://uithings.com/figma-vs-paper)).

Two consequences. First, the bar for "as good as Paper" is lower than its
marketing suggests. Second — "divs with inline styles" is *precisely* what our
own canvas produces, which means that shape is not a defect to design away; it
is the current state of the art for this category.

Vector editing in Paper is comparatively young: pen tool, node add/delete/move,
curvature, fill/stroke, half-pixel snapping, AI SVG generation via `Cmd+Shift+J`.
Boolean operations, shape-to-path, cropping and vector networks are **roadmap,
not shipped** ([Paper — Vector editing](https://paper.design/docs/svg)). SVG
editing is therefore not table stakes and can safely follow the effects work.

---

## What this changes

**A false binary died.** The framing going in was "build textures in CSS *or*
generate them with AI." Both halves were wrong as a framing. The real
determinant is the **export path** — and once shader-baking is on the table,
the choice stops being exclusive: shaders for authoring, baked raster for
export, CSS/SVG as the no-WebGL fallback.

**The priority inverted.** Textures looked like the hard part and turned out to
be largely solved by an Apache-2.0 npm package. The actual blocker is that our
agent cannot read or write the style of a single element — which is the
foundation every conversational-editing request stands on.

**Two features collapsed into one.** Background removal and subject-behind-type
composition are the same ONNX capability, not two separate builds.

**One risk got promoted.** WebGL under `offscreen: true` moved from
"not considered" to the single most important thing to verify before committing
to shaders.

---

## Recommendation

Sequence by dependency, cheapest decisive experiment first.

**0 — Export-fidelity spike (before any commitment).** One artboard containing:
an SVG `feTurbulence` grain overlay, a CSS halftone block, a `mix-blend-mode`
composite, and one Paper Shaders canvas. Export it. Compare against the on-canvas
render. This single experiment settles four unknowns at once and decides whether
shaders are an authoring tool, a bake-only tool, or out.

**1 — Per-element style read/write.** `studio_get_computed_styles` and a
node-scoped `studio_update_styles`, keyed on the `data-fd-el` ids that already
exist. This is what makes conversational effect adjustment possible at all, and
it is independent of whatever the spike decides.

**2 — Effects vocabulary.** A named, parameterised set (grain, halftone, paper,
duotone, glow, vignette) the agent applies and adjusts by name, implemented
with whichever technique the spike validated. Named effects also give the agent
something to *brainstorm over* — "what else could work here" is answerable
against a catalogue, not against arbitrary CSS.

**3 — Local cutout via ONNX.** Unlocks background removal and subject-behind-type
together.

**4 — Design-intelligence constraints.** Encode the three-part system from the
reference video as rules the agent designs *within*: exactly three colours with
fixed roles (primary / background / accent); exactly two fonts with fixed roles
(display carries personality, body must have none); a layout template decided
once and reused. This is the most likely single lever on "95% accurate first
shot", because it shrinks the space the agent is choosing from.

**5 — SVG/vector editing.** Last, matching Paper's own ordering, and it is still
roadmap for them.

---

## Still unverified

Each paired with the cheapest experiment that settles it.

| Claim | Status | Cheapest experiment |
| --- | --- | --- |
| CSS `filter`, `mix-blend-mode`, and SVG filters survive our `offscreen: true` export | **Inference.** Compositor-level CSS is likelier to survive than WebGL, but nothing sourced confirms it for Electron OSR specifically. | Recommendation 0 — the same one artboard settles it |
| WebGL renders at all under our current offscreen config | **Contested.** Electron docs say GPU-accelerated OSR supports WebGL; field reports say otherwise. Version- and platform-dependent. | Recommendation 0 |
| `preserveDrawingBuffer: true` + `toDataURL()` bake works inside our iframe/sandbox setup | **Sourced for browsers generally, unverified here.** Our iframe is `sandbox="allow-same-origin allow-scripts"`. | Add a shader canvas to the spike artboard and call `toDataURL()` from the bridge |
| Pure-CSS halftone is good enough to match the reference images | **Unverified.** The technique is real; whether it reaches that visual quality at artboard resolution is a judgement call. | Build one slide from the red/white set with CSS halftone, compare side by side |
| ONNX cutout quality on these subjects, and its bundle size | **Unverified.** Models are real and run locally; nothing measured for our case. | Run one reference photo through ISNet and BiRefNet, measure output quality and package size |
| Fonts — how the display faces in the references are licensed and bundled offline | **Not researched.** Deferred as a smaller, separable question. | Its own short research pass before the typography work |
| Whether an effects vocabulary stays UI-editable after the agent writes it | **Inference from our own contract.** Inline styles outrank the stylesheet, so it should hold. | Falls out of Recommendation 1 naturally |

**The first three share one experiment.** That experiment is the correct first
task of the build, not a preliminary — it converts the largest uncertainty in
this document into a decision for the cost of a single artboard.
