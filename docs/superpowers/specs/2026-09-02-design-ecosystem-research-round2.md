# Design ecosystem — research round 2

Date: 2026-09-02
Follows: `2026-09-01-design-ecosystem-architecture.md`

This round exists to close the **Still unverified** table in the architecture
document. Three search passes, with a reflect step between each. Two findings
changed the architecture rather than merely confirming it, and both are in
*What this changes*.

---

## Questions asked

**Feasibility**
1. Does `@paper-design/shaders-react` run inside a sandboxed iframe, and can its output be baked?
2. Can ONNX cutout run in Electron with GPU acceleration, and at what size and speed?

**Mechanism**
3. What is the actual tool vocabulary for element-level style read/write?
4. How would the system learn a subject's *parts* (beak, head) from a cutout?

**Prior art**
5. Has anyone shipped an agent-driven HTML design tool with element-level tools?
6. Does a unified open-source effects library (grain/halftone/duotone/riso) exist?

**Constraints**
7. Which OFL faces match the references, and are the cutout model licences safe to bundle commercially?
8. What is the WebGL context limit, and does it bite a multi-artboard canvas?

**Maintenance**
9. Quantized model quality drift — how much edge quality does compression cost?

**The unlisted alternative**
10. Is there a texture path other than SVG filters and WebGL (CSS Houdini Paint API)?
11. Is there a way to escape the WebGL context limit rather than budget around it?
12. Does any research exist on generating genuinely responsive layout, rather than absolute positioning?

---

## What the research found

### 1–2 · Runtime and models

**The Electron renderer is a web environment, not a Node one.** This single
fact inverts the obvious choice. `onnxruntime-node` has "very limited EP
support (cpu-only on Windows/macOS + cuda on Linux)"; `onnxruntime-web`
carries WebGPU bindings and runs in the renderer. On Windows — the target
platform — the "faster backend" instinct is exactly wrong.

The speed difference is not marginal:

| Model | GPU | CPU |
| --- | --- | --- |
| ISNet | ~351 ms | ~1 s |
| BiRefNet | ~821 ms (351 ms on larger GPUs) | ~9–20 s |

**Sizes, with quantisation:** ISNet fp32 ~168–179 MB → fp16 ~80–84 MB →
quint8 ~30–44 MB. BiRefNet ~930–973 MB.

**Licensing is clear.** BiRefNet's weights are MIT — commercial use permitted
with no special agreement. It is already the model behind several commercial
products.

### 3 · The element-level tool vocabulary

Paper's MCP server exposes 24 tools. The full list, from their own docs:

> `paper_connection_status`, `get_basic_info`, `get_selection`, `get_node_info`,
> `get_children`, `get_tree_summary`, `get_screenshot`, `get_jsx`,
> `get_computed_styles`, `get_fill_image`, `get_font_family_info`, `get_guide`,
> `find_placement`, `export`, `create_artboard`, `write_html`,
> `set_text_content`, `rename_nodes`, `duplicate_nodes`, `move_nodes`,
> `update_styles`, `delete_nodes`, `finish_working_on_nodes`

Three of these were not in our architecture document and each earns its place:

- **`get_guide`** — "retrieves guided workflows for topics". This is the
  design-intelligence layer **as a tool the agent calls**, not as prompt text.
  It is the same conclusion the layout.md research reached, already shipped by
  someone else. Strong corroboration for Layer 4.
- **`find_placement`** — the agent asks *where* something should go before
  writing it. Placement is a query, not a guess.
- **`finish_working_on_nodes`** — clears a working indicator. A UX affordance
  we would have discovered late: the canvas shows which artboards the agent
  currently holds.

Also notable: `get_computed_styles` and `update_styles` are both **batch** over
node lists, and `get_jsx` returns either Tailwind or inline styles. `move_nodes`
"repositions/reparents nodes while preserving IDs" — the id-stability property
our `data-fd-el` scheme already has.

### 4 · Part-level semantics

Florence-2 is a lightweight vision-language model doing open-vocabulary
detection, segmentation, captioning and OCR from one checkpoint, returning
`[x1, y1, x2, y2]` boxes with labels, and pairs with SAM-2 for open-vocabulary
segmentation. It runs under transformers.js.

**Part-level detection ("beak" rather than "bird") was not confirmed by any
source.** That is the honest state: the mechanism exists, the granularity is
untested.

### 6 · No unified effects library exists

The search returned individual implementations — SVG halftone filters, duotone
via gradient-map filters, risograph gradients, and one npm package
(`grainy-image`) covering grain alone with four techniques. **No single package
combines them.**

This directly confirms the standing instruction: if no library exists, build
our own. It does — or rather, it doesn't, and now that is a sourced fact rather
than an assumption.

### 7 · Fonts

Condensed display grotesques under OFL: **Anton** (explicitly OFL-1.1, rated
for maximum-impact display), **Oswald**, **Bebas Neue**, **Fjalla One**,
**Barlow Condensed** (9 weights), **Archivo Narrow**, **Pathway Gothic One**,
**BenchNine**.

Swashes are reachable from CSS through two routes: `font-variant-alternates:
swash(<name>)` mapping to the OpenType `swsh` tag, or `font-feature-settings:
"swsh"`; `@font-feature-values` gives the alternates human-readable names, and
a numeric index selects among multiple swashes for one glyph. **Which OFL serif
actually carries `swsh` alternates remains unfound** — every source explained
the mechanism, none named a free face that has them.

### 8 · The WebGL context limit — a real constraint

Chromium limits active WebGL contexts to **16**, or a cumulative
`16 × 1024 × 1024` pixel budget, whichever binds first. Chrome and Safari cap
at 16; Firefox allows ~200; mobile browsers 8. The limit exists because
graphics drivers tend to crash rather than report out-of-memory.

A carousel is 8 artboards. Two shader layers each and the app is at the ceiling
— and past it, canvases silently cycle through context loss and restore.

### 9 · Quantisation cost

quint8 shows "slight precision loss visible on fine edges (hair, fur)" and
"slight edge softness versus FP16". fp16 is "slightly cleaner edges".

### 10 · Houdini Paint API — investigated and rejected

Chromium-only in production, which our Electron target could tolerate. The
disqualifier is different: **`PaintRenderingContext2D` deliberately excludes
`fillText`, `drawImage` and `createPattern`** — the operations needing external
resources — because worklets are sandboxed against exactly that. A texture
engine that cannot draw an image cannot composite a texture *over a photograph*,
which is the entire use case. Branch closed.

### 11 · The unlisted alternative that worked

**One WebGL context, many canvases, via `OffscreenCanvas`.**

`OffscreenCanvas` "supports using a single `WebGLRenderingContext` to
efficiently render into multiple regions on the web page". The render loop
calls `transferToImageBitmap()` to tear off the finished frame; each display
canvas is a cheap `getContext('bitmaprenderer')` surface receiving it via
`transferFromImageBitmap()`. **A single OffscreenCanvas may transfer frames
into an arbitrary number of `ImageBitmapRenderingContext` objects**, and on
Chrome the transfer is a GPU-texture handoff rather than a copy.

So the 16-context ceiling is not a budget to ration — it is avoidable
entirely. One context for the whole application, regardless of artboard count.

### 12 · Responsive output

Still not solved, but no longer directionless. Two research lines are relevant:
**LayoutPrompter** — "versatile, data-efficient, and training-free… capable of
generating high-quality, constraint-compliant layouts" — and **LaySPA**, which
adds spatial reasoning to layout agents with "hybrid reward signals that capture
geometric constraints, structural fidelity, and visual quality". On the
engineering side, container queries move responsiveness "from page-first to
component-first", which fits artboards far better than viewport breakpoints do.

No source described an algorithm for inferring constraints from an
already-absolute design. Figma's own answer is manual: wrap in auto-layout, then
mark the exceptions as absolute.

---

## What this changes

**Two architectural revisions.**

1. **Cutout runs in a hidden renderer window with `onnxruntime-web` + WebGPU** —
   not in the main process with `onnxruntime-node`. The doc previously implied
   the native path. On Windows that path is CPU-only and makes BiRefNet
   (9–20 s) unusable interactively. We already run hidden renderer windows for
   the browser workers, so the machinery exists.

2. **The shader layer is one shared context, not one per artboard.** This must
   be designed in from the first shader, because retrofitting a renderer from
   per-canvas contexts to a shared `OffscreenCanvas` is a rewrite. It also
   makes bake-on-export nearly free: `transferToImageBitmap()` already produces
   exactly the frame the exporter needs, so the live path and the export path
   stop being two implementations.

**One branch closed:** Houdini Paint API cannot composite images. SVG filters
plus shared-context WebGL is the whole texture story.

**Three confirmations that were previously assumptions:** no unified effects
library exists (build our own is correct, not merely preferred); BiRefNet is
MIT and safe to bundle; and design intelligence belongs behind a tool call —
Paper shipped `get_guide` doing exactly that.

**One item got cheaper.** Bundling looked like an 80–180 MB decision. With
quint8 at ~30–44 MB it is a *tiering* decision: ship the small model, download
the good one.

---

## Recommendation

**Cutout tiering** — bundle `isnet_fp16` (~80 MB) as the default, expose
`isnet_quint8` (~30–44 MB) as the fast preview path, and fetch BiRefNet
on demand for final artwork. Run all of them in a hidden renderer window under
`onnxruntime-web` with WebGPU, falling back to WASM. The tiers map cleanly onto
what the user is doing: drag an image in → quint8 preview; commit → fp16;
export a hero asset → BiRefNet.

**Shader architecture** — a single `OffscreenCanvas` WebGL context owned by the
app, artboards holding `bitmaprenderer` canvases. Validate Paper Shaders
against this shape before adopting it; if the library insists on owning its own
canvas and context per component — which its documented convenience is that it
"owns the WebGL context lifecycle" — then use `@paper-design/shaders` (the
framework-agnostic core) rather than the React wrapper, or lift its shader
source directly. Apache 2.0 permits both.

**Tool vocabulary** — adopt Paper's shape, since it is a shipped existence
proof, and specifically include the three we had missed: `find_placement`,
`get_guide`, and a working-indicator clear. Keep read and write batch over node
lists from the start; retrofitting batch onto single-node tools doubles the
surface.

**Fonts** — Anton for maximum-impact display, Oswald or Barlow Condensed where
weight range matters. The swash serif stays open and needs glyph-level
inspection rather than more searching.

**Responsive** — do not attempt inference from absolute positions. Generate
container-query components directly when the target is app/web, and keep
absolute artboards for print-like output. These are two output modes, not one
mode with a conversion step.

---

## Still unverified

| Claim | Cheapest experiment |
| --- | --- |
| Paper Shaders renders inside *our* sandboxed iframe, and can be driven from a shared context | Drop one Grain Gradient into a test artboard; if the React wrapper fights the shared context, try the core package. One afternoon, and it also settles the shared-context design |
| Florence-2 can name subject **parts** ("beak"), not just objects | One reference photo, one open-vocabulary prompt list, count hits |
| WebGPU is actually available in our Electron renderer at our current version | `navigator.gpu` in a hidden window — minutes |
| quint8's edge softness is acceptable for *preview* specifically | Same photo through all three tiers, compare at 100% |
| Which OFL serif carries `swsh` alternates | Inspect candidate fonts' glyph tables directly; searching has already failed twice |
| Whether constrained effects raise first-shot accuracy for us | Ten runs, same brief, with and without the vocabulary |

**The first three share one experiment**: a single hidden-renderer spike that
checks `navigator.gpu`, runs one ONNX session, and initialises one WebGL
context. That spike is the right first task of the build, ahead of the
per-element style work, because both revisions above depend on its outcome.

---

## Sources

- [Paper MCP docs](https://paper.design/docs/mcp) · [Paper MCP review](https://www.banani.co/blog/paper-design-mcp-review)
- [ONNX Runtime WebGPU background removal](https://img.ly/blog/browser-background-removal-using-onnx-runtime-webgpu/) · [onnxruntime-node WebGPU request](https://github.com/microsoft/onnxruntime/issues/26216) · [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)
- [BiRefNet licence](https://github.com/fal-ai/realtime-birefnet) · [background removal model comparison](https://invideo.io/blog/ai-background-removal-models/)
- [ISNet variants and quantisation](https://zeropng.com/blog/how-ai-background-removal-works) · [ORT Web pitfalls](https://dev.to/allplix/client-side-background-removal-with-onnx-runtime-web-a-few-things-that-tripped-me-up-350g)
- [Chromium WebGL context limit](https://issues.chromium.org/issues/40543269) · [original limit CL](https://codereview.chromium.org/14217005)
- [OffscreenCanvas — WHATWG](https://wiki.whatwg.org/wiki/OffscreenCanvas) · [transferFromImageBitmap — MDN](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmapRenderingContext/transferFromImageBitmap)
- [CSS Painting API — MDN](https://developer.mozilla.org/docs/Web/API/CSS_Painting_API) · [Houdini Paint worklet limits](https://empire-ui.com/blog/css-houdini-paint-worklet)
- [font-variant-alternates — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variant-alternates) · [OpenType features in CSS](https://helpx.adobe.com/fonts/using/open-type-syntax.html)
- [Anton and free condensed faces](https://fontalternatives.com/blog/best-free-condensed-fonts-2026/) · [Typewolf Google Fonts](https://www.typewolf.com/google-fonts)
- [Florence-2](https://huggingface.co/docs/transformers/model_doc/florence2) · [Florence-2 + SAM-2](https://github.com/MjdMahasneh/florance2-sam2)
- [LayoutPrompter](https://arxiv.org/pdf/2311.06495) · [LaySPA](https://arxiv.org/html/2509.16891) · [container queries](https://kickstage.com/blog/component-first-responsive-design-container-queries-tailwind-v4)
- [grainy-image](https://github.com/yashrajbharti/Grainy-image) · [duotone SVG filters](https://css-tricks.com/using-svg-to-create-a-duotone-image-effect/)
