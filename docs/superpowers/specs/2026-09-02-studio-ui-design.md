# Studio UI — design spec

Date: 2026-09-02
Reference: the supplied Paper screenshot (layout only)
Related: `2026-09-01-design-ecosystem-architecture.md`, `2026-09-02-reference-system.md`

---

## The one insight this rests on

The right-hand properties panel is not chrome. **It is the visual half of the
same read-modify-write loop the agent uses.** When a user drags the radius
slider and when the agent runs `studio_update_styles` on the same node, those
are the same operation reaching the same model by two doors.

That has a consequence worth stating before any layout: **the panel and the
agent tools must share one model, or they will disagree.** A panel that reads
the DOM directly while the tools read stored HTML will drift within minutes —
the user sees 12px, the agent sees 16px, and neither is wrong from where it is
standing.

So the build order is inverted from how it looks: the shared node model comes
first, and the panel is its first consumer. The agent tools become its second.
This is why the UI work and the "per-element style read/write" step in the
architecture doc are **one piece of work**, not two.

---

## What the screenshot actually gives us

Read structurally, in order of how much it changes:

1. **Documents are tabs across the top.** Several open at once, each closable.
   Today we have a single active document chosen from a list, so this is a real
   model change, not a restyle.
2. **The left panel is two stacked trees** — a page/artboard list, and a layer
   hierarchy below it. The layer tree is the piece that makes precise selection
   possible; clicking blindly on a canvas cannot reach an element behind
   another one.
3. **A vertical tool rail** sits between the left panel and the canvas: select,
   pan, frame, rectangle, pen.
4. **The right panel is sectioned and collapsible** — Layout (X, Y, angle, W,
   H), Flex (direction, a 3×3 alignment picker, gap, padding, clip), Radius,
   Blending (opacity, blend mode), Fill (solid / gradient / image).
5. **The agent floats over the canvas** in its own window with a title bar, not
   docked to an edge.
6. Zoom sits top-right, above the panel.

---

## Theme translation — the density problem

Ours is not their palette and the difference is not decorative.

| | Paper | FlowDesk |
| --- | --- | --- |
| Ground | light | `--bg: #12100E`, warm near-black |
| Accent | blue-grey system | `--accent: #E5A853`, amber |
| Radius | 4–6px throughout | `--radius-sm: 8px` … `--radius-2xl: 24px` |
| Type | ~11–12px, dense | DM Sans, app-wide sizes are larger |

The collision is radius. A properties panel is a grid of 24px-tall inputs; our
`--radius-md: 12px` on a 24px input makes it a pill, and forty pills in a
column reads as bloated toy UI rather than an instrument.

**Decision: a panel-scoped density scale.** A `.studio-panel` scope redefines a
small set of tokens — control radius 5px, control height 26px, label 11px,
input 12px — without touching the app-wide tokens any other page depends on.
The rest of Studio (tabs, agent window, canvas chrome) keeps the app's normal
generosity. Density is applied where instruments live, not everywhere.

**Decision: amber is a state colour, not a surface colour.** `--accent` marks
exactly three things — the active tool, the active tab, and the focused input
ring. If it also fills buttons and headers, a panel of thirty controls becomes
uniformly amber and the active state stops being findable, which is the only
job the accent has.

**Decision: the canvas void is its own value.** Artboards are usually white or
light. If the void behind them is `--surface`, white artboards glare; if it is
`--bg`, artboards and app chrome blur into each other. The void gets one
dedicated token sitting between them.

---

## Where the agent goes

The screenshot floats it. That is right for the working moment and wrong for
the other two, so the answer is three states rather than one:

- **Pill** — collapsed into the top bar, showing only run status and the
  current step. The idle state. Costs no canvas.
- **Floating** — a draggable window over the canvas, remembered position and
  size. The working state, and the default when a run starts.
- **Docked bottom** — full width beneath the canvas. The reviewing state, for
  reading a long run without a window sitting on top of the artwork.

A floating window is the right *default* and the wrong *only option*: it
covers the very poster being discussed. Docking to the **bottom** rather than
the right matters — the right edge is the properties panel, and the properties
panel is exactly what you need open while the agent works.

---

## What we deliberately do not take

The screenshot is a multiplayer cloud tool. We are local-first and single-user.

- **No collaborator avatars, no "Copy link".** That corner becomes zoom, fit,
  and export — the controls a single user actually reaches for.
- **No pen tool yet.** Vector editing is step 7 in the architecture doc's build
  order and still roadmap for Paper themselves. The rail is built to hold it;
  shipping a dead button that does nothing is worse than an absent one.
- **"Pages" becomes "Artboards".** Their pages are separate canvases; our
  artboards already live together in one document and that is the model the
  export path, the bridge, and the reference carousels all assume. Renaming
  their concept onto ours would be a lie in the UI.
- **No gradient or image fill in v1.** Solid only. The segmented control ships
  with the other two disabled and labelled, because the shape of the control is
  part of the layout and hiding it would mean rebuilding the section later.

---

## Layout skeleton

```
┌──────────────────────────────────────────────────────────────────────┐
│  tabs: [Poster ×] [Carousel ×] [+]            agent pill · zoom 71%   │ 40px
├────────────┬──┬──────────────────────────────────┬───────────────────┤
│ ARTBOARDS  │  │                                  │  Layout        ⌄  │
│  · Cover   │T │        canvas void               │   X ▢   Y ▢   ∠▢  │
│  · Slide 2 │O │                                  │   W ▢   H ▢       │
│  · Slide 3 │O │     ┌──────────┐                 ├───────────────────┤
│            │L │     │ artboard │                 │  Radius        ⌄  │
│ LAYERS     │  │     │          │  ┌───────────┐  ├───────────────────┤
│  ▾ section │R │     └──────────┘  │  agent    │  │  Blending      ⌄  │
│    · h1    │A │                   │  window   │  ├───────────────────┤
│    · img   │I │                   └───────────┘  │  Fill          ⌄  │
│  ▸ footer  │L │                                  │                   │
└────────────┴──┴──────────────────────────────────┴───────────────────┘
   240px      44px            flexible                    260px
```

Both side panels collapse. The canvas is the only element that grows.

---

## Success criteria

1. Selecting a layer in the tree, on the canvas, or by the agent produces the
   same selection state — one model, three doors.
2. Editing a value in the panel and editing it through `studio_update_styles`
   produce byte-identical document HTML.
3. The panel reflects an agent-made change without a manual refresh.
4. Nothing in the panel reads the iframe DOM as its source of truth.
