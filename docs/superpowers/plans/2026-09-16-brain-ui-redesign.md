# Brain Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Brain page from five disconnected tabs into one three-column verification surface where clicking a thing never loses your place and a document is shown with its context.

**Architecture:** A nav rail replaces the tab strip; the middle column holds the list for the active nav item; the right column holds a detail pane that survives nav switches and dispatches over three selection kinds (document, turn, answer). Two pure modules carry the logic that can be tested without a DOM. One new IPC arm exposes `answerPack` to the renderer for the first time.

**Tech Stack:** React 18 + TypeScript, Tailwind, Vitest + @testing-library/react (jsdom), Electron IPC via `window.electronAPI`.

**Spec:** `docs/superpowers/specs/2026-09-16-brain-ui-redesign-design.md`

## Global Constraints

- `BRAIN_TABS` in `src/lib/brainUi.ts:24` must not change. `src/lib/brainUi.test.ts:6` asserts `['Today', 'Review', 'Library', 'Ask', 'Health']` exactly and must pass untouched.
- No new database table, no new write path, no pin/collection/tag feature. Presentation only.
- The scope-isolation invariant must hold and must still be asserted: a candidate, document, or event belonging to one scope never renders while another scope is selected.
- After every task: `npx vitest run --no-file-parallelism`, `npm run typecheck`, `npm run build`.
- UI copy stays in the existing Roman-Urdu/English mix already used on this page.
- Commit after every task.

**A note on this plan's fidelity:** the two pure modules are given as complete code because their exact signatures are consumed by four later tasks. The React components are given as exact file paths, prop interfaces, and named test assertions rather than full JSX, because their bodies are largely *moves* of code that already exists in `src/pages/Brain.tsx` at the line ranges cited. Where a component's body is genuinely new, its data flow is spelled out.

---

### Task 1: Pure modules — selection stack and markdown outline

**Files:**
- Create: `src/lib/brainSelection.ts`
- Create: `src/lib/brainSelection.test.ts`
- Create: `src/lib/markdownOutline.ts`
- Create: `src/lib/markdownOutline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Selection`, `SelectionStack`, `EMPTY_SELECTION`, `pushSelection`, `popSelection`, `sameSelection`, `OutlineEntry`, `markdownOutline`.

- [ ] **Step 1: Write the failing tests for the selection stack**

```ts
import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION, popSelection, pushSelection, sameSelection } from './brainSelection'

const doc = { kind: 'document', path: 'wiki/a.md' } as const
const turn = { kind: 'turn', eventId: 'event-1' } as const

describe('brainSelection', () => {
  it('starts empty', () => {
    expect(EMPTY_SELECTION).toEqual({ current: null, history: [] })
  })

  it('pushes onto an empty stack without recording history', () => {
    expect(pushSelection(EMPTY_SELECTION, doc)).toEqual({ current: doc, history: [] })
  })

  it('records the previous selection when pushing over one', () => {
    const stack = pushSelection(pushSelection(EMPTY_SELECTION, turn), doc)
    expect(stack).toEqual({ current: doc, history: [turn] })
  })

  it('does not grow the stack when the same thing is selected twice', () => {
    const once = pushSelection(EMPTY_SELECTION, doc)
    expect(pushSelection(once, { kind: 'document', path: 'wiki/a.md' })).toEqual(once)
  })

  it('pops back to the previous selection', () => {
    const stack = pushSelection(pushSelection(EMPTY_SELECTION, turn), doc)
    expect(popSelection(stack)).toEqual({ current: turn, history: [] })
  })

  it('popping an empty history clears the selection', () => {
    expect(popSelection(pushSelection(EMPTY_SELECTION, doc))).toEqual(EMPTY_SELECTION)
  })

  it('compares selections by kind and identity', () => {
    expect(sameSelection(doc, { kind: 'document', path: 'wiki/a.md' })).toBe(true)
    expect(sameSelection(doc, { kind: 'document', path: 'wiki/b.md' })).toBe(false)
    expect(sameSelection(doc, turn)).toBe(false)
    expect(sameSelection(null, null)).toBe(true)
    expect(sameSelection(null, doc)).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing tests for the outline**

```ts
import { describe, expect, it } from 'vitest'
import { markdownOutline } from './markdownOutline'

describe('markdownOutline', () => {
  it('returns one entry per heading, with its level', () => {
    expect(markdownOutline(['# Top', 'body', '## Sub', 'more', '### Deep'].join('\n'))).toEqual([
      { level: 1, text: 'Top', line: 0 },
      { level: 2, text: 'Sub', line: 2 },
      { level: 3, text: 'Deep', line: 4 },
    ])
  })

  it('returns nothing for a body with no headings', () => {
    expect(markdownOutline('just a paragraph\nand another')).toEqual([])
  })

  it('ignores headings deeper than three levels', () => {
    expect(markdownOutline('#### Too deep')).toEqual([])
  })

  it('requires a space after the hashes', () => {
    expect(markdownOutline('#nothashtag')).toEqual([])
  })

  // Documented limitation: this parser is not fence-aware, unlike the database
  // sectioner in electron/brain/knowledge/sectioning.ts. A '#' comment inside a
  // fenced block appears in the outline. Asserted so it is a known cost rather
  // than a surprise; see the spec's "assumes rather than knows" section.
  it('does not skip fenced code blocks', () => {
    expect(markdownOutline(['```bash', '# not a heading', '```'].join('\n'))).toEqual([
      { level: 1, text: 'not a heading', line: 1 },
    ])
  })
})
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run src/lib/brainSelection.test.ts src/lib/markdownOutline.test.ts`
Expected: FAIL — cannot resolve `./brainSelection` and `./markdownOutline`.

- [ ] **Step 4: Implement `src/lib/brainSelection.ts`**

```ts
/**
 * What the Brain page's detail pane is currently showing.
 *
 * Three kinds, because three kinds of thing can be selected, and they navigate
 * into each other: a turn names the documents it read, a document names the
 * turns that read it, an answer names the documents it quoted. The history is
 * what stops that navigation from being one-way -- without it, clicking a
 * document chip inside a turn loses the turn.
 */
export type Selection =
  | { kind: 'document'; path: string }
  | { kind: 'turn'; eventId: string }
  | { kind: 'answer'; question: string }

export interface SelectionStack {
  current: Selection | null
  history: Selection[]
}

export const EMPTY_SELECTION: SelectionStack = { current: null, history: [] }

/** True when both name the same thing, treating two nulls as equal. */
export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'document') return a.path === (b as { path: string }).path
  if (a.kind === 'turn') return a.eventId === (b as { eventId: string }).eventId
  return a.question === (b as { question: string }).question
}

/**
 * Selects `next`, remembering what was showing.
 *
 * Re-selecting what is already open is a no-op rather than a history entry, so
 * clicking the same row twice does not require two presses of back.
 */
export function pushSelection(stack: SelectionStack, next: Selection): SelectionStack {
  if (sameSelection(stack.current, next)) return stack
  return {
    current: next,
    history: stack.current === null ? stack.history : [...stack.history, stack.current],
  }
}

/** Goes back one step; an empty history clears the pane. */
export function popSelection(stack: SelectionStack): SelectionStack {
  const previous = stack.history[stack.history.length - 1]
  if (previous === undefined) return EMPTY_SELECTION
  return { current: previous, history: stack.history.slice(0, -1) }
}
```

- [ ] **Step 5: Implement `src/lib/markdownOutline.ts`**

```ts
export interface OutlineEntry {
  level: number
  text: string
  /** Zero-based line index, so a click can scroll to the right place. */
  line: number
}

const HEADING = /^(#{1,3}) +(.+?)\s*$/

/**
 * Headings from a markdown body, for the reader's outline.
 *
 * Reads the text the renderer already holds rather than the knowledge_sections
 * table, which holds the same headings but would cost an IPC arm to fetch. The
 * cost of that choice: this is not fence-aware, so a '#' comment inside a code
 * block shows up as a heading. The database sectioner is fence-aware; if the
 * difference ever matters in practice, expose that table instead of teaching
 * this one to count backticks.
 */
export function markdownOutline(body: string): OutlineEntry[] {
  return body.split('\n').flatMap((line, index) => {
    const match = HEADING.exec(line)
    return match ? [{ level: match[1].length, text: match[2], line: index }] : []
  })
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/brainSelection.test.ts src/lib/markdownOutline.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Full verification and commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add src/lib/brainSelection.ts src/lib/brainSelection.test.ts src/lib/markdownOutline.ts src/lib/markdownOutline.test.ts
git commit -m "feat: selection stack and markdown outline for the Brain reader"
```

---

### Task 2: Expose `answerPack` to the renderer

The retrieval ladder built in S1 and improved with vectors in S5 is reachable by the agent and by nothing else. This is the only backend change in the whole redesign.

**Files:**
- Modify: `src/types/brainKnowledge.ts` — add `AnswerPackSection`, `AnswerPack`
- Modify: `electron/brain/knowledge/evidence.ts:120-137` — import those two types instead of declaring them, re-export for existing importers
- Modify: `electron/main.ts` — one `ipcMain.handle` beside the other `brain:knowledge*` handlers
- Modify: `electron/preload.ts:23-38` — one line
- Modify: `src/types/electron.d.ts` — one method signature

**Interfaces:**
- Consumes: the existing `knowledge.answerPack` protocol arm (`electron/brain/protocol.ts`) and service case (`electron/brain/service.ts`), both already built in S1.
- Produces: `api.brainKnowledgeAnswerPack({ scopeId, question, tokenBudget? }) => Promise<AnswerPack>`, and the `AnswerPack` type importable from `@/types/brainKnowledge`.

- [ ] **Step 1: Move the types to `src/types/brainKnowledge.ts`**

```ts
/** One verbatim passage the ladder chose, with where it came from. */
export interface AnswerPackSection {
  path: string
  title: string
  headingPath: string
  text: string
  score: number
}

/**
 * What the retrieval ladder returns for one question: assembled evidence plus
 * enough provenance to see how it was found. `strategy` and `pointerFollowed`
 * are what make the answer checkable rather than merely plausible.
 */
export interface AnswerPack {
  question: string
  /** The text to hand the model. Never empty. */
  evidence: string
  sections: AnswerPackSection[]
  pointerFollowed: { from: string; to: string } | null
  strategy: 'strong-signal' | 'ranked' | 'fuzzy' | 'none'
  estimatedTokens: number
  candidatesConsidered: number
}
```

- [ ] **Step 2: Have `evidence.ts` import and re-export them**

Replace the two local `export interface AnswerPackSection` / `export interface AnswerPack` declarations at `electron/brain/knowledge/evidence.ts:120-137` with:

```ts
import type { AnswerPack, AnswerPackSection } from '../../../src/types/brainKnowledge'

export type { AnswerPack, AnswerPackSection }
```

Match the existing relative-import style already used in that directory for `src/types` imports; check a sibling file (`electron/brain/knowledge/documents.ts`) for the exact prefix before writing it.

- [ ] **Step 3: Add the IPC handler in `electron/main.ts`**

Beside the other knowledge handlers (search for `brain:knowledgeNeighbors` to find the block):

```ts
ipcMain.handle('brain:knowledgeAnswerPack', (_e, input: unknown) => brainRequest('knowledge.answerPack', input))
```

- [ ] **Step 4: Add the preload line in `electron/preload.ts`**

```ts
brainKnowledgeAnswerPack: (input: unknown) => ipcRenderer.invoke('brain:knowledgeAnswerPack', input),
```

- [ ] **Step 5: Add the type in `src/types/electron.d.ts`**

Add `AnswerPack` to the existing `import type { … } from './brainKnowledge'` list, then:

```ts
brainKnowledgeAnswerPack: (input: { scopeId: string; question: string; tokenBudget?: number }) => Promise<AnswerPack>
```

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add src/types/brainKnowledge.ts electron/brain/knowledge/evidence.ts electron/main.ts electron/preload.ts src/types/electron.d.ts
git commit -m "feat: expose the retrieval ladder to the renderer"
```

Expected: all existing tests still pass — nothing calls the new arm yet.

---

### Task 3: The shell — nav rail and three columns

The largest task, and the one that breaks the existing page test. Everything moves; nothing changes behaviour except that clicking no longer switches nav.

**Files:**
- Modify: `src/pages/Brain.tsx` — becomes the shell only
- Create: `src/components/brain/lists/TodayList.tsx`
- Create: `src/components/brain/lists/LibraryList.tsx`
- Create: `src/components/brain/lists/ReviewList.tsx`
- Create: `src/components/brain/lists/AskList.tsx`
- Create: `src/components/brain/DocumentRow.tsx` — the existing `DocumentHit` (`Brain.tsx:102`), moved
- Create: `src/pages/Brain.test.tsx` — the new behaviour tests
- Modify: `src/pages/brainScopeIsolation.test.tsx` — rewrite assertions for the new DOM

**Interfaces:**
- Consumes: `Selection`, `SelectionStack`, `EMPTY_SELECTION`, `pushSelection`, `popSelection` from Task 1.
- Produces:
  - `DocumentRow({ path, type, title, snippet, selected, onSelect })`
  - `TodayList({ events, dailyNotePath, selection, onSelect, onOpenDailyNote })`
  - `LibraryList({ documents, hits, query, setQuery, typeFilter, setTypeFilter, busy, onSearch, selection, onSelect })`
  - `ReviewList({ candidates, knowledgeCandidates, unresolvedLinks, onReview, onReviewKnowledge, onSelect })`
  - `AskList({ query, setQuery, busy, onAsk, pack, selection, onSelect })`
  - Each list renders **only** its list. No detail rendering inside a list.

- [ ] **Step 1: Write the failing behaviour tests**

Create `src/pages/Brain.test.tsx` with the same `window.electronAPI` mock harness as `brainScopeIsolation.test.tsx:52-99` (copy it; it is the established pattern in this repo), plus `brainKnowledgeAnswerPack: vi.fn()` and `agentSessionTurns: vi.fn()`. Assertions:

```ts
it('keeps the active nav item when a library row is selected', async () => {
  // brainKnowledgeList returns one document; click its row in the Library list.
  // Expect: the Library nav button still carries aria-current="page", and the
  // document's title appears in the detail region.
})

it('keeps the selection when the nav item changes', async () => {
  // Select a document in Library, then click the 'Today' nav button.
  // Expect: the Today list is showing AND the document title is still in the
  // detail region. This is the "sab ek jagah" guarantee.
})

it('shows the counters in the detail pane when nothing is selected', async () => {
  // Expect: document count, review count, unresolved-link count all present
  // before anything has been clicked.
})
```

Use `getByRole('button', { name: … })` for nav items and a `region` landmark with an accessible name for the detail pane, so the assertions do not depend on class names.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/Brain.test.tsx`
Expected: FAIL — nav items are not buttons with `aria-current`, and there is no detail region.

- [ ] **Step 3: Extract `DocumentRow`**

Move `DocumentHit` from `Brain.tsx:102-111` into `src/components/brain/DocumentRow.tsx`, renamed, with two added props: `selected: boolean` and `onSelect: () => void` replacing `onOpen`. Selected rows get an amber left border; this is how the middle column shows what the right column is displaying.

- [ ] **Step 4: Extract the four lists**

Move each tab's list markup out of `Brain.tsx` unchanged except that every `onOpen` that called `readDocument(...)` followed by `setTab(...)` becomes `onSelect(...)` calling the shell's `select({ kind: 'document', path })`. **The `setTab` calls at `Brain.tsx:374` and `Brain.tsx:395` are deleted, not moved** — they are the bug.

Source ranges to move:
- Today list body: `Brain.tsx:376-397` (the Aaj card's event rows and the Recently-updated rows). The three counter cards at `Brain.tsx:360-364` move to the empty-detail state, not to the list.
- Review: `Brain.tsx:400-425`
- Library: `Brain.tsx:428-441` (search box + results; the `selectedDocument` cards at `:433-442` do **not** move here — they belong to Task 4's detail pane)
- Ask: `Brain.tsx:445-452` (input + hits; same exclusion for the document cards)

- [ ] **Step 5: Rebuild `src/pages/Brain.tsx` as the shell**

`BrainScopeView` keeps its data-loading hooks and handlers, and renders:

```
<header>            unchanged: title, ScopePicker, status pill
<div class=flex>
  <nav>             BRAIN_TABS.filter(t => t !== 'Health') as buttons, then a
                    divider, then Health. Active button gets aria-current="page".
  <section>         the list for the active nav item (Health: nothing)
  <aside>            <DetailPane … />  (Health: nothing; HealthPanel takes the
                    full width in Task 7 — until then Health keeps its current
                    body inline)
</div>
```

State added to `BrainScopeView`: `const [stack, setStack] = useState(EMPTY_SELECTION)`, with `select = (next: Selection) => setStack(s => pushSelection(s, next))` and `back = () => setStack(popSelection)`.

Data loading: keep the single `refresh` for now. Splitting loads per nav item is a separate concern and is **not** part of this task — doing both at once would make a regression impossible to localise.

- [ ] **Step 6: Create a minimal `DetailPane`**

`src/components/brain/detail/DetailPane.tsx`, taking `{ stack, onBack, counters }`. For this task it renders the empty state (the three counters) and, for `kind: 'document'`, the existing read result exactly as `Brain.tsx:433-442` does today — raw `<pre>` and the neighbourhood graph. Tasks 4–6 replace the bodies. This keeps the app working at the end of every task.

- [ ] **Step 7: Rewrite `brainScopeIsolation.test.tsx` assertions**

The invariant does not change; the DOM does. Update:
- `fireEvent.click(screen.getByRole('button', { name: /^Review/ }))` still works — nav items remain buttons with those names.
- `screen.getByText('Private knowledge candidate A').closest('section')` must become `closest('[data-candidate]')` or equivalent, since cards are no longer `section` elements inside the list.
- Add one new assertion to the scope-switch test: after switching scope, the detail pane is cleared. A document from scope A must not stay open while scope B is selected — this is a **new** way the isolation invariant could break, created by making the pane survive nav changes.

- [ ] **Step 8: Verify and commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add -A src/pages src/components/brain
git commit -m "feat: three columns instead of five tabs on the Brain page"
```

---

### Task 4: DocumentDetail — a document with its context

**Files:**
- Create: `src/components/brain/detail/DocumentDetail.tsx`
- Modify: `src/components/brain/detail/DetailPane.tsx` — dispatch `kind: 'document'` to it
- Modify: `src/pages/Brain.test.tsx` — add assertions

**Interfaces:**
- Consumes: `markdownOutline` (Task 1); `api.brainKnowledgeRead`, `api.brainKnowledgeNeighbors` (existing); `RetroMarkdown` from `@/components/chat/RetroMarkdown` (prop: `content`); `layoutNeighborhood` via the existing `NeighborhoodGraph`.
- Produces: `DocumentDetail({ scopeId, path, events, onSelect })` where `onSelect` takes a `Selection`.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders the document body as markdown, not as raw text', async () => {
  // brainKnowledgeRead returns text '# Heading\n\nBody text.'
  // Expect: a heading element with 'Heading', and no <pre> in the detail region.
})

it('lists the document headings as an outline', async () => {
  // Same document, plus '## Sub'. Expect both 'Heading' and 'Sub' as outline buttons.
})

it('names the turns that read this document', async () => {
  // brainListEvents returns an agent.turn whose metadata.documentsRead includes
  // the open document's path. Expect a chip naming that turn; clicking it puts
  // the pane on that turn.
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pages/Brain.test.tsx`
Expected: FAIL — `<pre>` still present, no outline.

- [ ] **Step 3: Implement `DocumentDetail`**

Body, in order:
1. Header: `title`, then `type · path · updated {updatedAt}`.
2. Outline: `markdownOutline(document.text)`, rendered as buttons indented by level. Clicking scrolls its heading into view via a ref map keyed by line index.
3. Body: `<RetroMarkdown content={document.text} />` — no height cap; the pane scrolls.
4. Connected documents: the existing `NeighborhoodGraph` (move it out of `Brain.tsx:65-89` into `src/components/brain/detail/NeighborhoodGraph.tsx`), with `onOpen={path => onSelect({ kind: 'document', path })}`.
5. Read-in-turns: `events.filter(e => e.action === 'agent.turn' && Array.isArray(e.metadata.documentsRead) && (e.metadata.documentsRead as string[]).includes(path))`, each a chip calling `onSelect({ kind: 'turn', eventId: e.id })`.

Fetching stays where it already is — `readDocument` in `BrainScopeView` (`Brain.tsx:222-234`) already loads document and neighbours together and guards against a stale scope. Drive it from the selection with a `useEffect` on `stack.current`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/Brain.test.tsx`

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add -A src/components/brain src/pages
git commit -m "feat: show a document with its outline, links and readers"
```

---

### Task 5: TurnDetail — the conversation behind a timeline row

The complaint this closes: *"Aaj ke andar click karke aaj ki conversation nahi dekh sakte."*

**Files:**
- Create: `src/components/brain/detail/TurnDetail.tsx`
- Modify: `src/components/brain/detail/DetailPane.tsx` — dispatch `kind: 'turn'`
- Modify: `src/pages/Brain.test.tsx`

**Interfaces:**
- Consumes: `api.agentSessionTurns(sessionId)` (already in `preload.ts:249`), returning `AgentTurn[]` where `AgentTurn` is `{ id, role, content, toolCalls, createdAt }` from `electron/agentSessionStore.ts:31`.
- Produces: `TurnDetail({ event, events, onSelect })`.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows the conversation behind an agent turn', async () => {
  // brainListEvents returns an agent.turn with metadata.sessionId 's1' and
  // targetId 'turn-2'. agentSessionTurns('s1') returns
  // [{ id:'turn-1', role:'user', content:'mere clients kaun hain' },
  //  { id:'turn-2', role:'assistant', content:'Yasir aur Bilal.' }].
  // Click the row. Expect both the question and the answer in the detail region.
})

it('says so plainly when a turn was temporary rather than showing an empty box', async () => {
  // An agent.turn whose metadata has sessionId and usage but no prompt.
  // Expect the Temporary-mode notice; expect no empty conversation block.
})

it('shows what the turn cost', async () => {
  // metadata: { total_cost_usd: 0.0123, duration_ms: 4200 }.
  // Expect both rendered.
})
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement `TurnDetail`**

1. Header: time from `eventTime(event.createdAt)` (move that helper from `Brain.tsx:33` into the component file or a shared `src/lib/brainFormat.ts` — pick one and use it everywhere).
2. Conversation: if `typeof event.metadata.sessionId === 'string'`, call `api.agentSessionTurns(sessionId)`; find the index of the turn whose `id === event.targetId`; render that turn and the immediately preceding `role === 'user'` turn. If the session is gone or the id does not match, show "Is turn ki baat ab mehfooz nahi" rather than nothing.
3. Temporary mode: if `event.metadata.prompt === undefined`, render the notice from the spec instead of the conversation block, and skip the fetch entirely.
4. Cost: `total_cost_usd`, `duration_ms`, and any `usage` token fields present, each rendered only when present.
5. Documents read: chips → `onSelect({ kind: 'document', path })`.
6. Actions: `events.filter(e => e.action === 'tool.action' && e.targetId === event.targetId)`, each showing its `label` and a failure marker when `metadata.failed === true`.

- [ ] **Step 4: Make the Today rows selectable**

In `TodayList`, the event row becomes a `<button>` calling `onSelect({ kind: 'turn', eventId: event.id })` — for `agent.turn` rows. Rows for `knowledge.imported` and the like stay plain text: there is nothing behind them to open, and a button that does nothing is worse than a div.

- [ ] **Step 5: Run tests, verify, commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add -A src/components/brain src/pages
git commit -m "feat: open the conversation behind a timeline row"
```

---

### Task 6: AnswerDetail — Ask uses the ladder

**Files:**
- Create: `src/components/brain/detail/AnswerDetail.tsx`
- Modify: `src/components/brain/lists/AskList.tsx`
- Modify: `src/pages/Brain.tsx` — `askBrain` switches from `brainKnowledgeSearch` to `brainKnowledgeAnswerPack`
- Modify: `src/pages/Brain.test.tsx`

**Interfaces:**
- Consumes: `api.brainKnowledgeAnswerPack` (Task 2); `AnswerPack` from `@/types/brainKnowledge`.
- Produces: `AnswerDetail({ pack, onSelect })`.

- [ ] **Step 1: Write the failing test**

```ts
it('answers from the retrieval ladder and shows how it found the answer', async () => {
  // brainKnowledgeAnswerPack resolves to a pack with one section
  // { path: 'wiki/clients/yasir.md', headingPath: 'Rates', text: 'PKR 40,000 monthly.' },
  // strategy 'ranked', candidatesConsidered 5, estimatedTokens 120.
  // Type a question, press Enter.
  // Expect: the passage text, the 'wiki/clients/yasir.md#Rates' provenance label,
  // and 'ranked' visible. Expect brainKnowledgeSearch NOT to have been called.
})
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Rewrite `askBrain`**

Replace the `brainKnowledgeSearch` call at `Brain.tsx:259` with `brainKnowledgeAnswerPack({ scopeId, question })`, store the pack, and `select({ kind: 'answer', question })`. Keep the existing request-sequence guard (`askRequest.current`) exactly as it is — it is what prevents a slow answer from overwriting a newer one.

- [ ] **Step 4: Implement `AnswerDetail`**

1. Each `pack.sections` entry: a block headed `{path}#{headingPath}` as a button calling `onSelect({ kind: 'document', path })`, with `text` rendered verbatim.
2. When `pack.sections` is empty: the `pack.evidence` line as-is — it already says "No local knowledge matched this question."
3. Provenance footer: `strategy`, `candidatesConsidered`, `estimatedTokens`, and `pointerFollowed` rendered as `{from} → {to}` when non-null.

- [ ] **Step 5: Run tests, verify, commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add -A src/components/brain src/pages
git commit -m "feat: Ask answers from the ladder instead of keyword search"
```

---

### Task 7: HealthPanel

**Files:**
- Create: `src/components/brain/HealthPanel.tsx`
- Modify: `src/pages/Brain.tsx`

**Interfaces:**
- Consumes: every Health handler already on `BrainScopeView` — `chooseVaultFolder`, `importVault`, `loadManifest`, `runCompaction`, `runMigration`, `buildVectors`, plus `api.brainExportBackup` / `api.brainImportBackup`.
- Produces: `HealthPanel({ … })` taking those handlers and their report state as props.

- [ ] **Step 1: Move the markup**

Move `Brain.tsx:462-541` verbatim into `HealthPanel.tsx`, converting the closed-over values into props. No copy changes, no behaviour changes — this is a move, and reviewing it should be a diff of indentation and prop threading only.

- [ ] **Step 2: Render it full width**

When the active nav item is `Health`, the shell renders `<HealthPanel …/>` in place of the list and detail columns.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add -A src/components/brain src/pages
git commit -m "refactor: Health becomes its own full-width panel"
```

---

## Self-review notes

- **Spec coverage.** Shell → Task 3. Detail pane's three kinds → Tasks 3 (skeleton), 4, 5, 6. Back stack → Task 1 + 3. Outline → Task 1 + 4. `answerPack` arm → Task 2. Component split → Tasks 3–7. Testing section → tests appear in Tasks 1, 3, 4, 5, 6. Known breakage of `brainScopeIsolation.test.tsx` → Task 3 Step 7.
- **One thing the spec left implicit and this plan makes explicit:** switching scope must clear the detail pane. Making the pane survive *nav* changes creates a new way for the scope-isolation invariant to break, so Task 3 Step 7 adds an assertion for it.
- **Deliberately not in this plan:** per-nav-item data loading. The spec mentions it; doing it inside Task 3 would mean a layout change and a data-flow change land together, and any regression would be impossible to localise. It is a follow-up, worth its own task once the layout is stable.
