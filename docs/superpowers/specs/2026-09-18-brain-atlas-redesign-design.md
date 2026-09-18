# Brain as a map — Atlas-first redesign

*Design approved 2026-09-18. Supersedes
[`2026-09-16-brain-ui-redesign-design.md`](./2026-09-16-brain-ui-redesign-design.md), which
produced the five-tab three-column surface this replaces.*

## Why the previous design is being replaced two days later

The 2026-09-16 redesign fixed real defects — dead click targets, a tab switch disguised as a
document open, `answerPack` unreachable from the UI — and it fixed them correctly. What it did
not do was decide what the Brain page *is*. It kept five peer surfaces behind a text nav and
gave each one a column, which is the shape of a workspace.

The owner does not use it as a workspace. Asked directly, he described Brain as "Agent ka
dimaag — main sirf jhaankta hoon": the agent does the work, he looks in to see what it knows.
An inspection surface with five equal tabs is five places to check instead of one thing to
look at.

Two screenshots taken on 2026-09-18 show what that produces:

| Screen | What it actually shows |
|---|---|
| Today | Nine rows all reading `Agent turn`, three stat cards floating in an otherwise empty right half, and a dotted border around the list that reads as a rendering fault. |
| Atlas | Labels overlapping into an unreadable mass at the centre, 106 of 163 nodes the same green, the graph crushed against the right edge, orphan dots at the far right with nothing explaining them, and `Global · Global` printed twice in the header. |

One of those is not a UI defect and must not be "fixed" as one. `describeEvent`
(`src/lib/brainFormat.ts:20`) already renders an agent turn's prompt when it has one;
`main.ts:1913` writes the prompt **only** when `brainWritesAllowed` is true. Those nine turns ran
in temporary mode, where not keeping what was said is the promise. The row is empty because the
data is deliberately absent. The redesign says so on the row instead of letting it look broken.

## Decisions taken

Four, in the order they were settled. Everything below follows from them.

1. **Brain is an inspection console, not a daily workspace.** Fewer surfaces, larger visuals,
   clear status — not density, command palettes, or multi-pane editing.
2. **Atlas is the landing view, full screen.** Every other surface opens over it.
3. **Readability comes from map-like zoom levels**, not from clustering or from colouring by
   folder. Far out: a few hubs and region names. Close in: everything.
4. **Observatory:** a dark canvas with luminous points, inset into FlowDesk's existing warm
   housing.

## The seam between dark and cream

FlowDesk is warm and retro — `#FAF7F0` ground, `#D97706` amber, Space Grotesk and JetBrains
Mono, hard `2px 2px 0 0` shadows (`src/index.css`, `src/components/layout/LeftNav.tsx`). A dark
Atlas dropped into that clashes, unless the darkness is given a reason to be there.

It is framed as a screen. The cream housing stays — header strip, border, the same hard shadow
the nav already uses — and the Atlas canvas is inset inside it at `#0d0f14`, the way a display
sits in an instrument. The drawer and panels that float over the canvas are dark, and each
carries a thin amber edge so the housing's colour is present inside the screen rather than
stopping at its border.

This is the one place the design is vulnerable to taste. If the instrument reading does not land
when built, the fallback is direction B from the same exploration (warm paper, `#f6f1e7`), which
needs only `atlasTheme.ts` to change.

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ ◉ FlowDesk Brain        [Global — Global ▾]  ● Ready    │  cream housing, 52px
├─────────────────────────────────────────────────────────┤
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓         ┌──────────────────────────┐          ┌──────┐▓│
│▓         │ ⌕  search or ask         │          │      │▓│
│▓         └──────────────────────────┘          │detail│▓│
│▓                                               │ 420  │▓│
│▓              ● ── ● ── ●                      │      │▓│
│▓            ╱   ╲    ╲                         │      │▓│
│▓          ●      ●────●                        └──────┘▓│
│▓                                                       ▓│
│▓  163 docs · 755 links · 2 review · 153 loose ends     ▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└─────────────────────────────────────────────────────────┘
```

| Element | Position | Behaviour |
|---|---|---|
| Header | On the cream housing, 52px | Title, scope picker, status pill. The duplicated `Global · Global` is removed; the picker already names the scope. |
| Command bar | Floating on the canvas, top centre, 520px | `/` or `Ctrl/Cmd-K` focuses it. |
| Detail drawer | Right, 420px, over the canvas | Opens on node click. Closes on `Esc` or its own control. |
| Status strip | Bottom left, floating pills | Each pill opens its panel. The review pill turns amber when the count is above zero. |
| Timeline / Review / Health | Left, 380px, over the canvas | Panels, never page swaps. `Esc` closes. |

The 176px internal nav column is removed entirely, and with it the concept of a tab inside
Brain. `BRAIN_TABS` and `NavButton` go with it.

## Zoom levels

The layout runs **once**, when the graph is built. Zoom changes only what sigma's reducers
return. Nothing is re-laid-out on a camera move, which is the property that keeps it smooth and
the reason this is the chosen approach rather than clustering.

| Band | Camera ratio | Nodes rendered | Labels |
|---|---|---|---|
| Far | `> 1.6` | `degree >= 8` (~18 of 163 in the current store) | Region names only |
| Mid | `0.6 – 1.6` | `degree >= 2` | Nodes with `degree >= 6` |
| Near | `< 0.6` | all | all in view |

Labels cannot collide, because each band renders only as many as fit. Sigma's own
`labelDensity` / `labelGridCellSize` / `labelRenderedSizeThreshold` handle the within-band case;
the band itself decides what is eligible.

Region names are derived in the renderer from a path's first two segments
(`wiki/ai-tooling/...` → `ai-tooling`), placed at the centroid of their members, and drawn as an
HTML overlay positioned through `sigma.graphToViewport()`. At the far band there are at most a
dozen, so the overlay is cheap. They are not drawn at mid or near, where node labels carry the
same information more precisely.

The thresholds above are starting values chosen against the current store's degree distribution
(median 2, maximum 103). They are constants in one place and expected to be tuned once against
the real graph.

## Inverting the palette

The current palette gives every document type a saturated colour. 106 of 163 documents are
`skill`, so the map is two thirds one green and colour carries almost no information.

The fix is to let the majority become ground rather than figure:

| Type | Count | Now | After |
|---|---|---|---|
| `skill` | 106 | saturated green | desaturated slate — the floor the map sits on |
| `project` | 15 | violet | violet, full strength |
| `client` | 3 | rose | rose, the strongest accent |
| `me` | 5 | amber | amber |
| `research`, `note`, `person`, `decision`, `source` | 34 | mixed | their own, clearly separated |

The 35% that carries meaning becomes visible, and the 106 skills read as texture.

## Search and ask, in one input

| Action | Result |
|---|---|
| Typing | Client-side filter over the loaded graph. Matches highlighted, the rest dimmed, camera zoom-to-fit on the matches, and up to five results listed beneath the bar. No IPC call. |
| Clicking a result | Selects the node and opens the drawer. |
| `Enter` | Calls `brainKnowledgeAnswerPack`. The answer renders in the drawer; its cited passages' documents are highlighted on the map. |
| `Escape` | Clears the query and the highlight. |

Library and Ask cease to exist as surfaces. Both were queries over the same documents, and the
map is a better result list than a column of rows.

## Detail drawer

Opens on node selection with the document's body as markdown, its backlinks and outgoing links
as a list, and its own two-hop neighbourhood as a small graph. Clicking a neighbour moves the
camera to that node and re-fills the drawer; it never navigates away. Reuses
`brainKnowledgeRead` and `brainKnowledgeNeighbors` unchanged.

## Panels

**Timeline.** Today and the past week as a stream. An agent turn shows its prompt when one was
stored, and `Agent turn · temporary mode — prompt not stored` when one was not, so an honest
absence does not read as a broken row. Each turn lists the documents it read as chips; clicking
a chip highlights that document on the map.

**Review.** Memory candidates, knowledge candidates, and unresolved links. Unresolved links gain
one new action — **create this document** — which writes a stub through
`brainKnowledgeProposeCandidate` with `explicit-user` origin and turns a loose end into an edge.

**Health.** Vault import, manifest preview, compaction, the memories migration, vector index,
entity backfill, and backup. Same operations as today's `HealthPanel`, restyled as one console.

## Overlays

Toggled from the status strip, at most one at a time.

| Overlay | Shows | Source |
|---|---|---|
| New | A ring on nodes created or changed since the last visit | `updatedAt` against a timestamp in `electron-store`, written on unmount |
| Agent trail | Documents the agent read in the last 7 days | `brainListEvents` → `metadata.documentsRead` |
| Orphans | Nodes with no links (8 in the current store) | `degree === 0` |
| Loose ends | The 153 unresolved targets as ghost nodes with severed edges | `brainKnowledgeListUnresolvedLinks` |

## Data

No new backend work. Every call this design needs already exists and is already exposed to the
renderer:

| Need | Call | Status |
|---|---|---|
| Graph | `brainKnowledgeGraph` | Added 2026-09-18 |
| Search | `brainKnowledgeSearch` | exists |
| Ask | `brainKnowledgeAnswerPack` | exists |
| Document, neighbours | `brainKnowledgeRead`, `brainKnowledgeNeighbors` | exists |
| Timeline, agent trail | `brainListEvents` over a 7-day range | exists; only the range widens |
| Review | `brainListCandidates`, `brainKnowledgeListCandidates`, `brainKnowledgeListUnresolvedLinks` | exists |
| Create a stub | `brainKnowledgeProposeCandidate` | exists |
| Last visit | `storeGet` / `storeSet` | exists, already used by `ScopePicker` |

Regions, orphans, and the search filter are derived in the renderer from the graph that is
already loaded.

## Files

```
src/pages/Brain.tsx                       rewritten — shell only, no tabs
src/components/brain/atlas/
  AtlasCanvas.tsx                         sigma, zoom bands, overlays
  AreaLabels.tsx                          HTML region-name overlay
  CommandBar.tsx                          search and ask
  DetailDrawer.tsx                        frame only; reuses detail/* children
  StatusStrip.tsx                         pills and overlay toggles
  panels/Timeline.tsx
  panels/Review.tsx
  panels/Health.tsx                       today's HealthPanel, restyled
src/lib/atlasGraph.ts                     + zoom bands, regions, inverted palette
src/lib/atlasTheme.ts                     Observatory tokens
src/lib/atlasSearch.ts                    query -> matches, zoom-to-fit target
src/lib/atlasOverlays.ts                  overlay membership from graph + events
```

Removed: `src/components/brain/lists/` (all four), `Card.tsx`, `DocumentRow.tsx`,
`HealthPanel.tsx` (moved), `NavButton`, and `BRAIN_TABS` from `src/lib/brainUi.ts`.
`ScopePicker`, `brainSelection.ts` and `brainFormat.ts` survive unchanged, as do the detail
bodies — `DocumentDetail`, `AnswerDetail`, `TurnDetail`, `NeighborhoodGraph`. Only
`detail/DetailPane.tsx` is replaced: `DetailDrawer` renders the same children in a floating
dark frame instead of a bordered column, and keeps the existing back/close selection stack.

`src/pages/Brain.tsx` is 424 lines with roughly 25 `useState` hooks today. The rewrite splits its
state by owner: the shell holds scope, selection and which panel is open; each panel owns its own
data and loads it when it opens rather than on every scope refresh.

## Testing

The decisive choice is that everything which decides *what* is drawn is a pure function, and
sigma only paints the result. Nothing that can be wrong needs a WebGL context to test.

| Behaviour | Where | How |
|---|---|---|
| Which nodes and labels a zoom band yields | `src/lib/atlasGraph.test.ts` | `(ratio, nodes) → visible`, pure |
| Region names and centroids | `src/lib/atlasGraph.test.ts` | pure, from paths |
| Palette completeness; `skill` least saturated | `src/lib/atlasTheme.test.ts` | pure |
| Search filter and the zoom-to-fit target | `src/lib/atlasSearch.test.ts` | pure |
| Overlay membership (new, trail, orphan, loose end) | `src/lib/atlasOverlays.test.ts` | events + graph in, path set out |
| Shell: panels open and close, `Esc`, drawer, selection | `src/pages/Brain.test.tsx` | jsdom; Atlas stays lazily imported so no WebGL is needed |
| Scope isolation | `src/pages/brainScopeIsolation.test.tsx` | unchanged, must still pass |

Sigma's rendering itself is not tested. The existing `Brain.test.tsx` assertions about selection
surviving a nav change and state clearing on a scope switch must pass against the new shell —
they describe behaviour the redesign keeps, and are the regression guard for the rewrite.

## Out of scope

- No changes to the Brain backend, the retrieval ladder, or the job system.
- No changes to the Intelligence page, which stays a separate surface.
- No 3D, no minimap, no timeline scrubber animating the store's growth. Each was considered and
  dropped: none answers a question an inspection surface asks.
- No light theme for Atlas. If Observatory fails in use, `atlasTheme.ts` is replaced wholesale
  rather than made switchable.
