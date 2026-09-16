# Brain page redesign — a verification surface, not five worlds

*Design approved 2026-09-16. Supersedes nothing; the Brain page has never had a design document.*

## The problem, as the owner stated it

> "Backend bahut advanced hai, bahut achhe ban gaye hain. Lekin Today, Review, Library, Ask,
> Health — ye properly work nahi karte, UI bahut bura hai."

Three concrete complaints, each of which was traced to a specific line of code rather than
treated as a matter of taste:

| Complaint | Cause |
|---|---|
| "Aaj par click karke aaj ki conversation nahi dekh sakte" | `Brain.tsx:380` — the event row is a `<div>`. There is no click handler at all. |
| "Recently updated click karo to Library mein pahunch jaate ho" | `Brain.tsx:395` — `onOpen` literally calls `setTab('Library')`. |
| "Library mein sab ek jagah nahi dikhta" | Opening a document replaces the list. Sections, links, and the turns that read it are never shown together. |

A fourth, structural: `src/pages/Brain.tsx` is 545 lines, one component, ~25 `useState` hooks,
and every tab's data loads whether or not that tab is visible.

## What the backend already has that the UI never shows

This is the heart of the redesign. Almost nothing here needs building — it needs *surfacing*.

- **`sessionId` is already in the `agent.turn` event metadata** (`main.ts:1834`), and
  `agentSessionTurns(id)` is already exposed to the renderer (`preload.ts:249`). Showing the
  conversation behind a timeline row needs **zero** backend work.
- **`answerPack` is not reachable from the UI.** `preload.ts` exposes fourteen
  `brainKnowledge*` methods; `answerPack` is not among them. `askBrain()` (`Brain.tsx:259`)
  calls `knowledge.search` — the old keyword path. The retrieval ladder built in S1 and
  improved with vectors in S5 is available to the agent and to nobody else.
- **Turn cost is recorded and never displayed.** S2 captured `usage`, `total_cost_usd`,
  `num_turns`, `duration_ms` onto the event.
- **Outbound actions are recorded and never displayed.** S3 writes `tool.action` events.
- **`RetroMarkdown` already exists** (`src/components/chat/RetroMarkdown.tsx`). The Brain
  reader renders raw text in a `<pre>` capped at `max-h-96`.

## Scope

**In:** presentation. One new IPC arm (`answerPack`). Splitting the page into components.

**Out:** any new table, any new write path, any "collect"/pin/tag feature. The owner chose a
*verification* surface — "dekhna ke AI kya jaanta hai" — over a working surface, so the design
adds no way to author knowledge from this page. Knowledge is authored in the vault and by the
agent; this page is where you check it.

## Architecture

### The shell

Three columns, replacing the tab strip. Chosen over a slide-over panel and over
"keep the tabs, add a detail pane" because it is the only one of the three that fixes both the
jump *and* the "sab ek jagah nahi dikhta" complaint. Master-detail is also the documented
pattern for drill-down where the user switches items frequently and must not lose the list
([Windows Developer Blog](https://blogs.windows.com/windowsdeveloper/2017/05/01/master-master-detail-pattern/)).

```
┌────────────┬──────────────────┬───────────────────────────┐
│ scope      │                  │                           │
├────────────┤                  │                           │
│ Aaj        │   list for the   │   detail for whatever     │
│ Review (3) │   active nav     │   is selected             │
│ Library    │   item           │                           │
│ Ask        │                  │   (survives nav switch)   │
│ ───────    │                  │                           │
│ Health     │                  │                           │
└────────────┴──────────────────┴───────────────────────────┘
```

- `BRAIN_TABS` (`src/lib/brainUi.ts:24`) is **not modified**. The same five names render as a
  rail instead of a strip, with `Health` filtered below a divider. `brainUi.test.ts:6` asserts
  that array exactly and must keep passing untouched.
- `Health` is the one exception to the layout: it takes the full width with no list or detail,
  because it is maintenance (import, compact, vector index), not something you read.
- Selecting an item in the list changes **only** the detail pane. It never changes the nav.
- The detail pane is **not** cleared when the nav changes.
- Empty detail shows the three counters that are today's Today-tab cards (documents, review
  inbox, unresolved links). Those cards are removed from the Aaj list.

### The detail pane

Polymorphic over three selection kinds, because three kinds of thing can be selected.

**`document`** — from the Library list, a neighbour circle, a cited passage, or a
`documentsRead` chip.

- Body rendered with `RetroMarkdown`, not `<pre>`, with no height cap; the pane scrolls.
- An outline of headings, parsed **client-side from the text `knowledge.read` already returns**.
  `knowledge_sections` exists in the database and is deliberately *not* exposed: adding an IPC
  arm to fetch what is already in hand would be waste. The cost of this choice is honest —
  the database sectioner is fence-aware and a client-side parse is not, so a `#` inside a
  fenced code block will appear in the outline. If that becomes a real irritation, expose the
  table then.
- `NeighborhoodGraph` (built in S4) moves here, so links are visible while the document is open.
- "Read in these turns" — derived by filtering `events` for `metadata.documentsRead`
  containing this path. Each is a chip that switches the detail to that turn.

**`turn`** — from the Aaj list.

- The conversation: `agentSessionTurns(sessionId)`, matched to this turn by
  `event.targetId === turn.id`, showing that assistant turn and the user turn before it.
- Cost: tokens, `total_cost_usd`, duration, from the event metadata.
- `documentsRead` as chips → switch detail to that document.
- What it did in the world: the `tool.action` events sharing this turn's `targetId`
  (`main.ts:1819` records them against the same `assistantTurn.id`), so the association is
  exact rather than by time window.
- **Temporary mode**: such a turn has no `prompt` in its metadata by design. Render an explicit
  "Temporary mode — baat mehfooz nahi ki gayi, sirf kharcha" notice rather than an empty box.

**`answer`** — from Ask.

- The `AnswerPack`: each `sections[]` entry verbatim under its `path#headingPath`.
- A provenance line: `strategy`, `pointerFollowed`, `candidatesConsidered`, `estimatedTokens`.
  This is the point of the pane — an AI memory UI's job is to show where an answer came from,
  not only to answer ([ACM UIST, Memory Sandbox](https://dl.acm.org/doi/10.1145/3586182.3615796)).
- Each section clicks through to its document.

**Back stack.** The three kinds navigate into each other (turn → document → neighbour → turn),
so the pane keeps a stack of selections with a back control. Without it, clicking a
`documentsRead` chip loses the turn you were reading.

## Components

```
src/pages/Brain.tsx                     shell: scope, rail, three columns, selection
src/components/brain/lists/TodayList.tsx
src/components/brain/lists/LibraryList.tsx
src/components/brain/lists/AskList.tsx
src/components/brain/lists/ReviewList.tsx
src/components/brain/detail/DetailPane.tsx      dispatch + back stack
src/components/brain/detail/DocumentDetail.tsx
src/components/brain/detail/TurnDetail.tsx
src/components/brain/detail/AnswerDetail.tsx
src/components/brain/HealthPanel.tsx            full width
src/lib/brainSelection.ts                       selection + back stack (pure)
src/lib/markdownOutline.ts                      heading parse (pure)
```

Data loading follows the active nav item rather than loading everything on mount.

## Backend change

Exactly one, in three files:

- `electron/main.ts` — `ipcMain.handle('brain:knowledgeAnswerPack', …)` → `knowledge.answerPack`
- `electron/preload.ts` — `brainKnowledgeAnswerPack`
- `src/types/electron.d.ts` — its type, returning `AnswerPack`

The protocol arm and service case already exist (`protocol.ts`, `service.ts`). `AnswerPack` and
`AnswerPackSection` move to `src/types/brainKnowledge.ts` so the renderer can name them, and
`evidence.ts` imports them from there — the same direction every other knowledge type already
travels.

## Testing

Pure units, no DOM:

- `brainSelection.ts` — push, back, empty, and that selecting the same thing twice does not grow
  the stack.
- `markdownOutline.ts` — headings at each level, no headings, and the known fenced-code
  limitation asserted as current behaviour so it is documented rather than discovered.

Component tests, each one aimed at a complaint the owner actually made:

- Clicking a Library row does **not** change the active nav item.
- Selection survives a nav switch.
- Clicking an `agent.turn` row renders that turn's conversation.
- A Temporary-mode turn renders the notice, not an empty conversation.
- Ask renders the answer pack's provenance line.

**Known breakage, stated up front:** `src/pages/brainScopeIsolation.test.tsx` asserts against
the current DOM (`section` elements, card structure) and will need rewriting. The invariant it
protects — a candidate from one scope never appears under another — does not change, and must
still be asserted after the rewrite.

## Build order

Each step leaves the app in a working state.

| # | Step | Risk |
|---|---|---|
| 1 | `brainSelection.ts`, `markdownOutline.ts` | none; pure |
| 2 | `answerPack` IPC arm + type move | small; protocol already exists |
| 3 | Shell: rail + three columns, existing list bodies moved in unchanged | scope-isolation test breaks here |
| 4 | `DocumentDetail` — markdown, outline, neighbours, read-in-turns | `<pre>` removed |
| 5 | `TurnDetail` — conversation, cost, chips, Temporary notice | new data path |
| 6 | `AnswerDetail` — evidence + provenance | answerPack reaches the UI for the first time |
| 7 | `HealthPanel` extracted, full width | move only |

After every step: `npx vitest run --no-file-parallelism`, `npm run typecheck`, `npm run build`.

## What this design assumes rather than knows

- That a client-side heading parse is good enough for the outline. Not measured; chosen because
  the alternative spends an IPC arm on data already in hand.
- That the owner wants the conversation *inline* in the detail pane rather than a jump to the
  Agent page. The Agent page owns the live session; this is a read-only look at a past turn.
- That three columns fit. At narrow widths the detail pane will need to overlay the list, which
  is Option B's behaviour appearing as a fallback rather than as the primary design.
