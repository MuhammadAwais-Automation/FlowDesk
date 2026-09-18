# Brain Atlas-first redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Brain page from five peer tabs into one full-screen graph with panels floating over it.

**Architecture:** Every decision about *what* is drawn lives in a pure function under `src/lib/`; sigma only paints the result. The graph is laid out once when it loads, and a camera move changes only what sigma's reducers return — never the layout. The shell owns scope, selection and which panel is open; each panel loads its own data when it opens.

**Tech Stack:** React 18, TypeScript, Tailwind, sigma 3.0.3, graphology 0.26.0, graphology-layout-forceatlas2 0.10.1, vitest 4.1.8 (jsdom for components).

**Spec:** [`docs/superpowers/specs/2026-09-18-brain-atlas-redesign-design.md`](../specs/2026-09-18-brain-atlas-redesign-design.md)

## Global Constraints

- **No backend changes.** Every IPC call this plan needs already exists on `window.electronAPI`. Do not edit anything under `electron/`.
- **Run tests with** `npx vitest run <path>`. Typecheck with `npm run typecheck`. Both must pass before every commit.
- **No WebGL in tests.** Sigma is never constructed in a test. Anything that decides what is drawn is a pure function in `src/lib/` and is tested there.
- **Atlas stays lazily imported** from `Brain.tsx` (`lazy(() => import(...))`). jsdom has no WebGL2 context; an eager import fails every `Brain.test.tsx` case.
- **Fonts:** `font-retro-sans` (Space Grotesk) for UI text, `font-retro-mono` (JetBrains Mono) for paths, counts and ids. Defined in `src/index.css`.
- **Housing colours (cream, existing):** ground `#FAF7F0`, border `#D6CFC0`, panel `#EBE5D5`, amber `#D97706`, amber-dark `#B45309`.
- **Screen colours (dark, new):** canvas `#0d0f14`, raised `#141824`, border `#1e2330`, text `#cbd5e1`, muted `#8b98b5`, dim `#4a5568`.
- **Copy is Roman Urdu / Hinglish** for user-facing strings, matching the existing surface (`"Koi document nahi mila."`). Technical terms stay English.
- **Sentence case** for all labels. No emoji. Icons come from `lucide-react`, already a dependency.

---

### Task 1: Zoom bands

The far/mid/near rule that makes labels stop colliding. Pure, no sigma.

**Files:**
- Modify: `src/lib/atlasGraph.ts`
- Test: `src/lib/atlasGraph.test.ts`

**Interfaces:**
- Consumes: `KnowledgeGraphNode` from `src/types/brainKnowledge.ts`.
- Produces: `type ZoomBand = 'far' | 'mid' | 'near'`; `bandForRatio(ratio: number): ZoomBand`; `BAND_RULES: Record<ZoomBand, { minDegree: number; labelMinDegree: number | null; regionLabels: boolean }>`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/atlasGraph.test.ts`:

```ts
describe('zoom bands', () => {
  // Thresholds are tuned against the real store: 163 documents, median degree
  // 2, maximum 103. Far shows the ~18 documents with 8 or more links.
  it('maps the camera ratio to a band', () => {
    expect(bandForRatio(3)).toBe('far')
    expect(bandForRatio(1.61)).toBe('far')
    expect(bandForRatio(1.6)).toBe('mid')
    expect(bandForRatio(0.6)).toBe('mid')
    expect(bandForRatio(0.59)).toBe('near')
    expect(bandForRatio(0.1)).toBe('near')
  })

  it('shows fewer nodes the further out you are', () => {
    expect(BAND_RULES.far.minDegree).toBeGreaterThan(BAND_RULES.mid.minDegree)
    expect(BAND_RULES.mid.minDegree).toBeGreaterThan(BAND_RULES.near.minDegree)
    expect(BAND_RULES.near.minDegree).toBe(0)
  })

  // Far draws region names instead of node names, so node labels are off.
  it('draws region names only at the furthest band', () => {
    expect(BAND_RULES.far.regionLabels).toBe(true)
    expect(BAND_RULES.far.labelMinDegree).toBeNull()
    expect(BAND_RULES.mid.regionLabels).toBe(false)
    expect(BAND_RULES.near.regionLabels).toBe(false)
  })

  it('labels everything that is drawn at the nearest band', () => {
    expect(BAND_RULES.near.labelMinDegree).toBe(0)
    expect(BAND_RULES.mid.labelMinDegree).toBe(6)
  })

  it('treats a ratio that is not a number as the middle band', () => {
    expect(bandForRatio(Number.NaN)).toBe('mid')
  })
})
```

Add `bandForRatio, BAND_RULES` to the existing import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/atlasGraph.test.ts`
Expected: FAIL — `bandForRatio is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/atlasGraph.ts`:

```ts
export type ZoomBand = 'far' | 'mid' | 'near'

/**
 * What each band draws.
 *
 * `minDegree` gates which nodes exist on screen; `labelMinDegree` gates which
 * of those get a name, and `null` means none. Labels stop colliding because
 * each band renders only as many as fit, the way a map shows countries before
 * cities before streets.
 *
 * Tuned against the real store — 163 documents, median degree 2, maximum 103 —
 * so `far` resolves to roughly eighteen hubs.
 */
export const BAND_RULES: Record<ZoomBand, { minDegree: number; labelMinDegree: number | null; regionLabels: boolean }> = {
  far: { minDegree: 8, labelMinDegree: null, regionLabels: true },
  mid: { minDegree: 2, labelMinDegree: 6, regionLabels: false },
  near: { minDegree: 0, labelMinDegree: 0, regionLabels: false },
}

/**
 * Sigma's camera ratio grows as you zoom out, so the thresholds read backwards
 * from how it feels: a big ratio is far away.
 *
 * A ratio that is not a number falls to `mid` rather than throwing — a camera
 * mid-animation has produced one, and the middle band is the safe answer.
 */
export function bandForRatio(ratio: number): ZoomBand {
  if (!Number.isFinite(ratio)) return 'mid'
  if (ratio > 1.6) return 'far'
  if (ratio >= 0.6) return 'mid'
  return 'near'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/atlasGraph.test.ts`
Expected: PASS — 17 tests (12 existing plus 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/atlasGraph.ts src/lib/atlasGraph.test.ts
git commit -m "feat: zoom bands decide how much of the Atlas is drawn"
```

---

### Task 2: Regions

Region names float over their part of the map at the far band. Derived from paths, no backend.

**Files:**
- Modify: `src/lib/atlasGraph.ts`
- Test: `src/lib/atlasGraph.test.ts`

**Interfaces:**
- Consumes: `bandForRatio`, `BAND_RULES` from Task 1; `Graph` from graphology.
- Produces: `regionOf(path: string): string`; `interface AtlasRegion { name: string; x: number; y: number; count: number }`; `regionCentroids(graph: Graph): AtlasRegion[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/atlasGraph.test.ts`:

```ts
describe('regionOf', () => {
  // The real store's paths: wiki/ai-tooling/agents/..., wiki/me/profile.md,
  // toolkits/nextjs/index.md, daily/2026-09-18.md, AGENTS.md.
  it('names the region from the first two segments, skipping a wiki root', () => {
    expect(regionOf('wiki/ai-tooling/agents/ai-workflow.md')).toBe('ai-tooling')
    expect(regionOf('wiki/me/profile.md')).toBe('me')
    expect(regionOf('toolkits/nextjs/index.md')).toBe('toolkits/nextjs')
    expect(regionOf('daily/2026-09-18.md')).toBe('daily')
  })

  it('calls a document at the root loose', () => {
    expect(regionOf('AGENTS.md')).toBe('loose')
    expect(regionOf('index.md')).toBe('loose')
  })

  it('does not fall over on an empty path', () => {
    expect(regionOf('')).toBe('loose')
  })
})

describe('regionCentroids', () => {
  it('places each region at the middle of its members, largest first', () => {
    const graph = buildAtlasGraph({
      nodes: [
        node('wiki/me/a.md', 1), node('wiki/me/b.md', 1),
        node('toolkits/nextjs/x.md', 1), node('toolkits/nextjs/y.md', 1), node('toolkits/nextjs/z.md', 1),
      ],
      edges: [],
      unresolvedCount: 0,
    }, { minDegree: 0, types: [] })
    graph.setNodeAttribute('wiki/me/a.md', 'x', 0)
    graph.setNodeAttribute('wiki/me/a.md', 'y', 0)
    graph.setNodeAttribute('wiki/me/b.md', 'x', 10)
    graph.setNodeAttribute('wiki/me/b.md', 'y', 20)
    for (const path of ['toolkits/nextjs/x.md', 'toolkits/nextjs/y.md', 'toolkits/nextjs/z.md']) {
      graph.setNodeAttribute(path, 'x', 100)
      graph.setNodeAttribute(path, 'y', 100)
    }

    const regions = regionCentroids(graph)

    expect(regions.map(region => region.name)).toEqual(['toolkits/nextjs', 'me'])
    expect(regions[1]).toMatchObject({ name: 'me', x: 5, y: 10, count: 2 })
  })

  it('ignores a region with only one document, which a node label covers better', () => {
    const graph = buildAtlasGraph({
      nodes: [node('wiki/me/only.md', 1)], edges: [], unresolvedCount: 0,
    }, { minDegree: 0, types: [] })

    expect(regionCentroids(graph)).toEqual([])
  })

  it('returns nothing for an empty graph', () => {
    const graph = buildAtlasGraph({ nodes: [], edges: [], unresolvedCount: 0 }, { minDegree: 0, types: [] })
    expect(regionCentroids(graph)).toEqual([])
  })
})
```

Add `regionOf, regionCentroids` to the imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/atlasGraph.test.ts`
Expected: FAIL — `regionOf is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/atlasGraph.ts`:

```ts
export interface AtlasRegion {
  name: string
  x: number
  y: number
  count: number
}

/**
 * The part of the map a document belongs to.
 *
 * Two segments, because one is too coarse — the real store keeps 106 of its
 * 163 documents under `wiki/`, so a one-segment region would be the whole map.
 * `wiki` is dropped as a root for the same reason: it is where everything
 * lives, so it distinguishes nothing.
 */
export function regionOf(path: string): string {
  const segments = path.replaceAll('\\', '/').split('/').filter(Boolean)
  const meaningful = segments[0] === 'wiki' ? segments.slice(1) : segments
  // Only the last segment left is the filename, so there is no directory to
  // name: the document sits at the root of the vault.
  if (meaningful.length <= 1) return 'loose'
  return meaningful.slice(0, meaningful.length > 2 ? 2 : 1).join('/')
}

/**
 * Where to write each region's name, and how big it is.
 *
 * Drawn only at the far band, where node labels are off, so this is what tells
 * you which part of the map you are looking at. A region holding one document
 * is skipped: its own label says more than the region's name would.
 *
 * Largest first, so a caller that has to drop some keeps the ones that matter.
 */
export function regionCentroids(graph: Graph): AtlasRegion[] {
  const members = new Map<string, { x: number; y: number; count: number }>()
  graph.forEachNode((path, attributes) => {
    const name = regionOf(path)
    const current = members.get(name) ?? { x: 0, y: 0, count: 0 }
    members.set(name, {
      x: current.x + Number(attributes.x ?? 0),
      y: current.y + Number(attributes.y ?? 0),
      count: current.count + 1,
    })
  })

  return [...members]
    .filter(([, total]) => total.count > 1)
    .map(([name, total]) => ({ name, x: total.x / total.count, y: total.y / total.count, count: total.count }))
    .sort((left, right) => right.count - left.count)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/atlasGraph.test.ts`
Expected: PASS — 24 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/atlasGraph.ts src/lib/atlasGraph.test.ts
git commit -m "feat: name the Atlas regions from document paths"
```

---

### Task 3: Observatory theme and the inverted palette

Move colour out of `atlasGraph.ts` into its own module, and make `skill` the map's floor instead of its subject.

**Files:**
- Create: `src/lib/atlasTheme.ts`
- Create: `src/lib/atlasTheme.test.ts`
- Modify: `src/lib/atlasGraph.ts` (import `TYPE_COLOR` from the new module; delete its own copy and `DIMMED_NODE`, `DIMMED_EDGE`, `EDGE_COLOR`)
- Modify: `src/components/brain/Atlas.tsx` (import the tokens from `atlasTheme`)
- Test: `src/lib/atlasTheme.test.ts`

**Interfaces:**
- Consumes: `KNOWLEDGE_DOC_TYPES`, `KnowledgeDocType` from `src/types/brainKnowledge.ts`.
- Produces: `OBSERVATORY: { canvas, raised, border, text, muted, dim, edge, edgeDim, nodeDim, accent }`; `TYPE_COLOR: Record<KnowledgeDocType, string>`; `GROUND_TYPE: KnowledgeDocType`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/atlasTheme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GROUND_TYPE, OBSERVATORY, TYPE_COLOR } from './atlasTheme'
import { KNOWLEDGE_DOC_TYPES } from '@/types/brainKnowledge'

function saturation(hex: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(...channels)
  const min = Math.min(...channels)
  if (max === min) return 0
  const lightness = (max + min) / 2
  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}

describe('TYPE_COLOR', () => {
  it('covers every document type with a distinct colour', () => {
    for (const type of KNOWLEDGE_DOC_TYPES) expect(TYPE_COLOR[type]).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(Object.values(TYPE_COLOR)).size).toBe(KNOWLEDGE_DOC_TYPES.length)
  })

  // 106 of the real store's 163 documents are skills. When the majority is the
  // loudest colour, the map is one green and colour says nothing. The majority
  // has to be the ground the rest is read against.
  it('keeps the ground type quieter than every type it carries', () => {
    expect(GROUND_TYPE).toBe('skill')
    const ground = saturation(TYPE_COLOR[GROUND_TYPE])
    for (const type of KNOWLEDGE_DOC_TYPES) {
      if (type === GROUND_TYPE || type === 'note') continue
      expect(saturation(TYPE_COLOR[type])).toBeGreaterThan(ground)
    }
  })

  it('gives client the strongest accent, since there are three of them', () => {
    const others = KNOWLEDGE_DOC_TYPES
      .filter(type => type !== 'client')
      .map(type => saturation(TYPE_COLOR[type]))
    expect(saturation(TYPE_COLOR.client)).toBeGreaterThanOrEqual(Math.max(...others))
  })
})

describe('OBSERVATORY', () => {
  it('is a dark surface with readable text on it', () => {
    for (const value of Object.values(OBSERVATORY)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    const luminance = (hex: string) => [1, 3, 5]
      .map(offset => parseInt(hex.slice(offset, offset + 2), 16))
      .reduce((total, channel) => total + channel, 0) / 3
    expect(luminance(OBSERVATORY.canvas)).toBeLessThan(40)
    expect(luminance(OBSERVATORY.text)).toBeGreaterThan(160)
    expect(luminance(OBSERVATORY.nodeDim)).toBeLessThan(luminance(OBSERVATORY.text))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/atlasTheme.test.ts`
Expected: FAIL — cannot resolve `./atlasTheme`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/atlasTheme.ts`:

```ts
import type { KnowledgeDocType } from '@/types/brainKnowledge'

/**
 * The Atlas canvas is a screen inset into FlowDesk's cream housing.
 *
 * Dark because a node-link graph reads best on it — luminous points against
 * near-black separate at a glance where ink on paper does not. The housing's
 * amber reappears as `accent` inside the screen, so the two surfaces belong to
 * one object instead of meeting at a seam.
 */
export const OBSERVATORY = {
  canvas: '#0d0f14',
  raised: '#141824',
  border: '#1e2330',
  text: '#cbd5e1',
  muted: '#8b98b5',
  dim: '#4a5568',
  edge: '#2a3142',
  edgeDim: '#171b26',
  nodeDim: '#262d3d',
  accent: '#d97706',
} as const

/**
 * The type that holds the majority, and therefore the one that must stay quiet.
 *
 * 106 of the real store's 163 documents are skills. A palette that gives the
 * majority its loudest colour produces a map that is two thirds one hue, where
 * colour distinguishes nothing.
 */
export const GROUND_TYPE: KnowledgeDocType = 'skill'

/**
 * One colour per document type, ordered by how much attention it deserves.
 *
 * `skill` and `note` are the floor — desaturated slate, read as texture. The
 * rarer a type is, the stronger its accent, because a rare thing on a map is
 * the thing you are looking for.
 */
export const TYPE_COLOR: Record<KnowledgeDocType, string> = {
  skill: '#5b6b84',
  note: '#6b7a91',
  source: '#3f9e8c',
  research: '#6366f1',
  person: '#0ea5e9',
  decision: '#f97316',
  me: '#f0b429',
  project: '#8b5cf6',
  client: '#f43f5e',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/atlasTheme.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Point the existing modules at the new one**

In `src/lib/atlasGraph.ts`, delete the `TYPE_COLOR`, `DIMMED_NODE`, `DIMMED_EDGE` and `EDGE_COLOR` declarations and their doc comments, and add at the top:

```ts
import { OBSERVATORY, TYPE_COLOR } from './atlasTheme'
```

Inside `buildAtlasGraph`, replace `color: TYPE_COLOR[node.type] ?? TYPE_COLOR.note` with `color: TYPE_COLOR[node.type] ?? OBSERVATORY.nodeDim` and `graph.addEdge(edge.from, edge.to, { size: 0.6, color: EDGE_COLOR })` with `graph.addEdge(edge.from, edge.to, { size: 0.6, color: OBSERVATORY.edge })`.

In `src/lib/atlasGraph.test.ts`, change the `TYPE_COLOR` import to come from `./atlasTheme` and delete the `describe('TYPE_COLOR', ...)` block — Task 3's own test file now owns it.

In `src/components/brain/Atlas.tsx`, replace the `DIMMED_EDGE, DIMMED_NODE, TYPE_COLOR` import from `atlasGraph` with `import { OBSERVATORY, TYPE_COLOR } from '@/lib/atlasTheme'`, and substitute `DIMMED_NODE` → `OBSERVATORY.nodeDim` and `DIMMED_EDGE` → `OBSERVATORY.edgeDim` throughout.

- [ ] **Step 6: Run the whole renderer suite and typecheck**

Run: `npx vitest run src && npm run typecheck`
Expected: PASS — no failures, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/atlasTheme.ts src/lib/atlasTheme.test.ts src/lib/atlasGraph.ts src/lib/atlasGraph.test.ts src/components/brain/Atlas.tsx
git commit -m "feat: invert the Atlas palette so 106 skills become the ground"
```

---

### Task 4: Search

Client-side match over the loaded graph, plus the rectangle the camera should fit.

**Files:**
- Create: `src/lib/atlasSearch.ts`
- Create: `src/lib/atlasSearch.test.ts`
- Test: `src/lib/atlasSearch.test.ts`

**Interfaces:**
- Consumes: `KnowledgeGraph`, `KnowledgeGraphNode` from `src/types/brainKnowledge.ts`.
- Produces: `interface AtlasSearchResult { matches: Set<string>; top: KnowledgeGraphNode[] }`; `searchAtlas(graph: KnowledgeGraph, query: string, limit?: number): AtlasSearchResult`; `interface FitBox { x: number; y: number; width: number; height: number }`; `fitBox(positions: Array<{ x: number; y: number }>, padding?: number): FitBox | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/atlasSearch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fitBox, searchAtlas } from './atlasSearch'
import type { KnowledgeDocType, KnowledgeGraph } from '@/types/brainKnowledge'

const node = (path: string, title: string, degree = 1, type: KnowledgeDocType = 'note') => ({
  path, title, type, degree, updatedAt: '2026-09-18T00:00:00.000Z',
})

const STORE: KnowledgeGraph = {
  nodes: [
    node('wiki/clients/yasir-bhai.md', 'Yasir Bhai', 7, 'client'),
    node('wiki/projects/zapzone.md', 'Zap Zone Marketplace App', 25, 'project'),
    node('wiki/projects/zapzone-proposal.md', 'Zap Zone Proposal Plan', 14, 'project'),
    node('wiki/me/positioning.md', 'Positioning', 14, 'me'),
  ],
  edges: [],
  unresolvedCount: 0,
}

describe('searchAtlas', () => {
  it('matches on the title, ignoring case', () => {
    expect([...searchAtlas(STORE, 'yasir').matches]).toEqual(['wiki/clients/yasir-bhai.md'])
    expect([...searchAtlas(STORE, 'YASIR').matches]).toEqual(['wiki/clients/yasir-bhai.md'])
  })

  it('matches on the path too, so a folder finds its documents', () => {
    expect([...searchAtlas(STORE, 'projects/').matches].sort()).toEqual([
      'wiki/projects/zapzone-proposal.md', 'wiki/projects/zapzone.md',
    ])
  })

  // The list under the bar is short, so the best-connected match goes first.
  it('lists the most connected matches first, capped', () => {
    const result = searchAtlas(STORE, 'zap', 1)
    expect(result.top.map(item => item.title)).toEqual(['Zap Zone Marketplace App'])
    expect(result.matches.size).toBe(2)
  })

  // An empty query means "no filter", which is different from "nothing matched" —
  // the map must not dim itself while the box is empty.
  it('matches nothing and highlights nothing for an empty query', () => {
    const result = searchAtlas(STORE, '   ')
    expect(result.matches.size).toBe(0)
    expect(result.top).toEqual([])
  })

  it('reports no matches for a query nothing satisfies', () => {
    expect(searchAtlas(STORE, 'zzzz').matches.size).toBe(0)
  })
})

describe('fitBox', () => {
  it('covers every position with padding around it', () => {
    expect(fitBox([{ x: 0, y: 0 }, { x: 10, y: 20 }], 5))
      .toEqual({ x: -5, y: -5, width: 20, height: 30 })
  })

  // One match still needs a box, or the camera has nothing to fit and jumps.
  it('gives a single position a box of its own', () => {
    expect(fitBox([{ x: 4, y: 4 }], 3)).toEqual({ x: 1, y: 1, width: 6, height: 6 })
  })

  it('has nothing to fit when there are no positions', () => {
    expect(fitBox([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/atlasSearch.test.ts`
Expected: FAIL — cannot resolve `./atlasSearch`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/atlasSearch.ts`:

```ts
import type { KnowledgeGraph, KnowledgeGraphNode } from '@/types/brainKnowledge'

export interface AtlasSearchResult {
  /** Every match, for dimming the rest of the map. */
  matches: Set<string>
  /** The few worth listing under the bar. */
  top: KnowledgeGraphNode[]
}

export interface FitBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Finds documents by title or path, over the graph already in memory.
 *
 * No IPC: the whole store is a few hundred nodes and is already loaded for
 * drawing, so a keystroke filters it in place rather than waiting on a round
 * trip. `brainKnowledgeSearch` still exists for full-text over bodies; this is
 * the map's own filter, and it has to keep up with typing.
 *
 * An empty query returns no matches rather than all of them, because the caller
 * reads a non-empty `matches` set as "dim everything else".
 */
export function searchAtlas(graph: KnowledgeGraph, query: string, limit = 5): AtlasSearchResult {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { matches: new Set(), top: [] }

  const found = graph.nodes.filter(node => (
    node.title.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)
  ))
  return {
    matches: new Set(found.map(node => node.path)),
    top: [...found].sort((left, right) => right.degree - left.degree).slice(0, limit),
  }
}

/**
 * The rectangle the camera should fit, in graph coordinates.
 *
 * Padded, so matched nodes do not sit against the edge of the viewport, and
 * never zero-sized — a single match would otherwise ask the camera to fit a
 * point, which reads as a jump to maximum zoom.
 */
export function fitBox(positions: Array<{ x: number; y: number }>, padding = 30): FitBox | null {
  if (positions.length === 0) return null
  const xs = positions.map(position => position.x)
  const ys = positions.map(position => position.y)
  const x = Math.min(...xs) - padding
  const y = Math.min(...ys) - padding
  return {
    x,
    y,
    width: Math.max(...xs) + padding - x,
    height: Math.max(...ys) + padding - y,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/atlasSearch.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/atlasSearch.ts src/lib/atlasSearch.test.ts
git commit -m "feat: filter the Atlas by title or path as you type"
```

---

### Task 5: Overlays

Which paths each overlay highlights. Four pure functions over data the renderer already holds.

**Files:**
- Create: `src/lib/atlasOverlays.ts`
- Create: `src/lib/atlasOverlays.test.ts`
- Test: `src/lib/atlasOverlays.test.ts`

**Interfaces:**
- Consumes: `KnowledgeGraph`, `BrainEvent`, `UnresolvedLink` from `src/types/brainKnowledge.ts`; `documentsRead` from `src/lib/brainFormat.ts`.
- Produces: `type AtlasOverlay = 'new' | 'trail' | 'orphans' | 'loose'`; `changedSince(graph, sinceIso: string | null): Set<string>`; `readInEvents(events: BrainEvent[]): Set<string>`; `orphanPaths(graph): Set<string>`; `looseEndCount(links: UnresolvedLink[]): number`; `overlayPaths(overlay, input): Set<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/atlasOverlays.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { changedSince, looseEndCount, orphanPaths, overlayPaths, readInEvents } from './atlasOverlays'
import type { BrainEvent, KnowledgeDocType, KnowledgeGraph } from '@/types/brainKnowledge'

const node = (path: string, degree: number, updatedAt: string, type: KnowledgeDocType = 'note') => ({
  path, title: path, type, degree, updatedAt,
})

const STORE: KnowledgeGraph = {
  nodes: [
    node('old.md', 3, '2026-09-01T00:00:00.000Z'),
    node('fresh.md', 2, '2026-09-18T09:00:00.000Z'),
    node('alone.md', 0, '2026-09-02T00:00:00.000Z'),
  ],
  edges: [],
  unresolvedCount: 12,
}

const turn = (documentsRead: unknown): BrainEvent => ({
  id: 'e1', scopeId: 's', action: 'agent.turn', targetId: 't',
  metadata: { documentsRead }, createdAt: '2026-09-18T10:00:00.000Z',
})

describe('changedSince', () => {
  it('finds documents touched after the given moment', () => {
    expect([...changedSince(STORE, '2026-09-10T00:00:00.000Z')]).toEqual(['fresh.md'])
  })

  // A first visit has no previous one. Ringing all 163 documents says nothing,
  // so nothing is ringed.
  it('highlights nothing when there is no previous visit', () => {
    expect(changedSince(STORE, null).size).toBe(0)
  })

  it('ignores an unparseable timestamp rather than highlighting everything', () => {
    expect(changedSince(STORE, 'not a date').size).toBe(0)
  })
})

describe('readInEvents', () => {
  it('collects the documents the agent read, without repeats', () => {
    const events = [turn(['a.md', 'b.md']), turn(['b.md', 'c.md'])]
    expect([...readInEvents(events)].sort()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  // A turn in temporary mode stores no documentsRead at all.
  it('skips a turn that recorded nothing', () => {
    expect(readInEvents([turn(undefined), turn('nope'), turn([1, null])]).size).toBe(0)
  })

  it('is empty for no events', () => {
    expect(readInEvents([]).size).toBe(0)
  })
})

describe('orphanPaths', () => {
  it('finds the documents nothing links to or from', () => {
    expect([...orphanPaths(STORE)]).toEqual(['alone.md'])
  })
})

describe('looseEndCount', () => {
  it('counts the unresolved targets', () => {
    expect(looseEndCount([
      { documentPath: 'a.md', documentTitle: 'A', targetPath: 'x' },
      { documentPath: 'b.md', documentTitle: 'B', targetPath: 'x' },
    ])).toBe(2)
    expect(looseEndCount([])).toBe(0)
  })
})

describe('overlayPaths', () => {
  const input = { graph: STORE, since: '2026-09-10T00:00:00.000Z', events: [turn(['old.md'])] }

  it('routes each overlay to its own rule', () => {
    expect([...overlayPaths('new', input)]).toEqual(['fresh.md'])
    expect([...overlayPaths('trail', input)]).toEqual(['old.md'])
    expect([...overlayPaths('orphans', input)]).toEqual(['alone.md'])
  })

  // Loose ends are drawn as their own ghost nodes, not as highlights on
  // existing ones, so this overlay highlights no real document.
  it('highlights no document for loose ends', () => {
    expect(overlayPaths('loose', input).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/atlasOverlays.test.ts`
Expected: FAIL — cannot resolve `./atlasOverlays`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/atlasOverlays.ts`:

```ts
import { documentsRead } from './brainFormat'
import type { BrainEvent, KnowledgeGraph, UnresolvedLink } from '@/types/brainKnowledge'

export type AtlasOverlay = 'new' | 'trail' | 'orphans' | 'loose'

export interface OverlayInput {
  graph: KnowledgeGraph
  /** When this scope was last looked at, or null on a first visit. */
  since: string | null
  events: BrainEvent[]
}

/**
 * Documents created or changed since the given moment.
 *
 * An unusable `since` — absent, or not a date — highlights nothing rather than
 * everything. On a first visit every document is new, and a map with all 163
 * nodes ringed carries no more information than one with none.
 */
export function changedSince(graph: KnowledgeGraph, sinceIso: string | null): Set<string> {
  const since = sinceIso === null ? Number.NaN : Date.parse(sinceIso)
  if (!Number.isFinite(since)) return new Set()
  return new Set(graph.nodes.filter(node => Date.parse(node.updatedAt) > since).map(node => node.path))
}

/**
 * Documents the agent actually opened, across these events.
 *
 * The one overlay that shows which part of the store is doing work, rather than
 * which part exists. A turn run in temporary mode records no `documentsRead`,
 * so it contributes nothing — which is correct, not a gap.
 */
export function readInEvents(events: BrainEvent[]): Set<string> {
  const paths = new Set<string>()
  for (const event of events) for (const path of documentsRead(event)) paths.add(path)
  return paths
}

/** Documents with no link in or out — the parts of the store nothing reaches. */
export function orphanPaths(graph: KnowledgeGraph): Set<string> {
  return new Set(graph.nodes.filter(node => node.degree === 0).map(node => node.path))
}

export function looseEndCount(links: UnresolvedLink[]): number {
  return links.length
}

/**
 * The documents an overlay highlights.
 *
 * `loose` highlights none: an unresolved link has no document behind it by
 * definition, so it is drawn as its own ghost node instead of as a ring on a
 * real one.
 */
export function overlayPaths(overlay: AtlasOverlay, input: OverlayInput): Set<string> {
  if (overlay === 'new') return changedSince(input.graph, input.since)
  if (overlay === 'trail') return readInEvents(input.events)
  if (overlay === 'orphans') return orphanPaths(input.graph)
  return new Set()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/atlasOverlays.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/atlasOverlays.ts src/lib/atlasOverlays.test.ts
git commit -m "feat: decide which documents each Atlas overlay highlights"
```

---

### Task 6: AtlasCanvas — bands, regions, overlays on screen

Replace `Atlas.tsx` with the canvas the shell embeds. No chrome of its own: the command bar, strip and drawer are separate tasks.

**Files:**
- Create: `src/components/brain/atlas/AtlasCanvas.tsx`
- Create: `src/components/brain/atlas/AreaLabels.tsx`
- Delete: `src/components/brain/Atlas.tsx`
- Modify: `src/pages/Brain.tsx:41` (the `lazy()` import path)

**Interfaces:**
- Consumes: `buildAtlasGraph`, `bandForRatio`, `BAND_RULES`, `regionCentroids`, `neighborhoodPaths`, `AtlasRegion` (Tasks 1–2); `OBSERVATORY`, `TYPE_COLOR` (Task 3); `fitBox` (Task 4).
- Produces: `AtlasCanvas` with props `{ graph: KnowledgeGraph | null; selectedPath: string | null; matches: Set<string> | null; highlighted: Set<string> | null; fitTo: Set<string> | null; onSelect: (path: string) => void }`; `AreaLabels` with props `{ regions: AtlasRegion[]; project: (x: number, y: number) => { x: number; y: number } }`.

- [ ] **Step 1: Write AreaLabels and its failing test**

Create `src/components/brain/atlas/AreaLabels.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AreaLabels } from './AreaLabels'

describe('AreaLabels', () => {
  const project = (x: number, y: number) => ({ x: x * 2, y: y * 2 })

  it('places each region name where the projection puts it', () => {
    render(<AreaLabels regions={[{ name: 'ai-tooling', x: 10, y: 20, count: 106 }]} project={project} />)
    const label = screen.getByText('ai-tooling')
    expect(label.style.left).toBe('20px')
    expect(label.style.top).toBe('40px')
  })

  // The far band draws at most a dozen; more than that is a second hairball
  // made of text.
  it('draws at most twelve, largest first', () => {
    const regions = Array.from({ length: 20 }, (_, index) => ({
      name: `region-${index}`, x: 0, y: 0, count: 100 - index,
    }))
    render(<AreaLabels regions={regions} project={project} />)
    expect(screen.getAllByRole('presentation')).toHaveLength(12)
    expect(screen.queryByText('region-12')).toBeNull()
  })

  it('renders nothing when there are no regions', () => {
    const { container } = render(<AreaLabels regions={[]} project={project} />)
    expect(container.textContent).toBe('')
  })
})
```

Run: `npx vitest run src/components/brain/atlas/AreaLabels.test.tsx`
Expected: FAIL — cannot resolve `./AreaLabels`.

- [ ] **Step 2: Write AreaLabels**

Create `src/components/brain/atlas/AreaLabels.tsx`:

```tsx
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { AtlasRegion } from '@/lib/atlasGraph'

/** More than a dozen region names is a hairball made of text. */
const MAX_LABELS = 12

/**
 * Region names floating over their part of the map.
 *
 * An HTML layer rather than sigma nodes, because these are annotations on the
 * graph and not members of it: they must not be clickable, must not take part
 * in the layout, and must not be dimmed by a hover. Drawn only at the far band,
 * where node labels are off and this is all that says where you are.
 */
export function AreaLabels({ regions, project }: {
  regions: AtlasRegion[]
  project: (x: number, y: number) => { x: number; y: number }
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {regions.slice(0, MAX_LABELS).map(region => {
        const at = project(region.x, region.y)
        return (
          <span
            key={region.name}
            role="presentation"
            className="font-retro-mono absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] uppercase tracking-[0.18em]"
            style={{ left: `${at.x}px`, top: `${at.y}px`, color: OBSERVATORY.muted }}
          >
            {region.name}
          </span>
        )
      })}
    </div>
  )
}
```

Run: `npx vitest run src/components/brain/atlas/AreaLabels.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 3: Write AtlasCanvas**

Create `src/components/brain/atlas/AtlasCanvas.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import Sigma from 'sigma'
import { AreaLabels } from './AreaLabels'
import { BAND_RULES, bandForRatio, buildAtlasGraph, regionCentroids, type AtlasRegion, type ZoomBand } from '@/lib/atlasGraph'
import { fitBox } from '@/lib/atlasSearch'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { KnowledgeGraph } from '@/types/brainKnowledge'

/**
 * The map itself. No chrome — the command bar, status strip and drawer float
 * over it as siblings, so this component's only job is drawing and picking.
 *
 * The layout runs once, inside `buildAtlasGraph`. Everything after that —
 * zoom, hover, search, overlays — changes only what the reducers return, and
 * a repaint is `refresh()`. Re-laying out on a camera move is what makes a
 * graph feel heavy, and nothing here does it.
 */
export function AtlasCanvas({ graph, selectedPath, matches, highlighted, fitTo, onSelect }: {
  graph: KnowledgeGraph | null
  selectedPath: string | null
  /** Search hits. Non-empty means everything else is dimmed. */
  matches: Set<string> | null
  /** An overlay's paths, ringed rather than dimming their neighbours. */
  highlighted: Set<string> | null
  /** Paths the camera should frame, once, when this changes. */
  fitTo: Set<string> | null
  onSelect: (path: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const [band, setBand] = useState<ZoomBand>('mid')
  const [regions, setRegions] = useState<AtlasRegion[]>([])
  const [, setProjectionTick] = useState(0)
  const paint = useRef({ band: 'mid' as ZoomBand, hovered: null as string | null, matches, highlighted, selectedPath })

  const built = useMemo(() => (graph ? buildAtlasGraph(graph, { minDegree: 0, types: [] }) : null), [graph])
  paint.current = { ...paint.current, matches, highlighted, selectedPath }

  useEffect(() => {
    if (!container.current || !built) return
    const instance = new Sigma(built, container.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: OBSERVATORY.edge,
      labelFont: 'JetBrains Mono, ui-monospace, monospace',
      labelSize: 11,
      labelWeight: '400',
      labelColor: { color: OBSERVATORY.text },
      labelDensity: 1.2,
      labelGridCellSize: 70,
      labelRenderedSizeThreshold: 0,
      nodeReducer: (path, data) => {
        const state = paint.current
        const rules = BAND_RULES[state.band]
        const degree = Number(data.degree ?? 0)
        if (degree < rules.minDegree && path !== state.selectedPath) return { ...data, hidden: true }

        const named = rules.labelMinDegree !== null && degree >= rules.labelMinDegree
        const dimmed = (state.matches !== null && state.matches.size > 0 && !state.matches.has(path))
          || (state.hovered !== null && state.hovered !== path && !built.areNeighbors(state.hovered, path))
        if (path === state.selectedPath) return { ...data, highlighted: true, zIndex: 3 }
        if (dimmed) return { ...data, color: OBSERVATORY.nodeDim, label: '', zIndex: 0 }
        // Sigma's default node program draws a disc with no border, so an
        // overlay marks a node by growing it and taking the accent colour
        // rather than by ringing it. `borderColor` is silently ignored.
        if (state.highlighted?.has(path)) {
          return { ...data, color: OBSERVATORY.accent, size: Number(data.size ?? 4) * 1.6, zIndex: 2 }
        }
        return { ...data, label: named ? data.label : '', zIndex: 1 }
      },
      edgeReducer: (edge, data) => {
        const state = paint.current
        const [from, to] = built.extremities(edge)
        const rules = BAND_RULES[state.band]
        if (Number(built.getNodeAttribute(from, 'degree') ?? 0) < rules.minDegree) return { ...data, hidden: true }
        if (Number(built.getNodeAttribute(to, 'degree') ?? 0) < rules.minDegree) return { ...data, hidden: true }
        const quiet = (state.matches !== null && state.matches.size > 0 && !state.matches.has(from) && !state.matches.has(to))
          || (state.hovered !== null && state.hovered !== from && state.hovered !== to)
        return quiet ? { ...data, color: OBSERVATORY.edgeDim } : data
      },
    })

    instance.on('clickNode', ({ node }) => onSelect(node))
    instance.on('enterNode', ({ node }) => { paint.current.hovered = node; instance.refresh() })
    instance.on('leaveNode', () => { paint.current.hovered = null; instance.refresh() })

    const camera = instance.getCamera()
    const onCamera = () => {
      const next = bandForRatio(camera.ratio)
      if (next !== paint.current.band) {
        paint.current.band = next
        setBand(next)
        instance.refresh()
      }
      // Region labels are positioned in screen space, so they move with every
      // pan as well as every zoom.
      setProjectionTick(tick => tick + 1)
    }
    camera.on('updated', onCamera)

    setRegions(regionCentroids(built))
    sigmaRef.current = instance
    return () => {
      camera.removeListener('updated', onCamera)
      instance.kill()
      sigmaRef.current = null
    }
  }, [built, onSelect])

  useEffect(() => { sigmaRef.current?.refresh() }, [matches, highlighted, selectedPath])

  // Framing is a one-shot: the camera is the user's after this, and re-fitting
  // on every repaint would fight their panning.
  useEffect(() => {
    const instance = sigmaRef.current
    if (!instance || !built || !fitTo || fitTo.size === 0) return
    const box = fitBox([...fitTo]
      .filter(path => built.hasNode(path))
      .map(path => ({ x: Number(built.getNodeAttribute(path, 'x')), y: Number(built.getNodeAttribute(path, 'y')) })))
    if (!box) return
    // The camera takes normalised graph coordinates, which is what
    // `normalizationFunction` produces from the raw layout — going through
    // `graphToViewport` and back would return the same numbers and move
    // nothing. The ratio is the larger side of the box over the graph's own
    // extent, clamped so a single match does not slam to maximum zoom.
    void instance.getCamera().animate({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      ratio: Math.min(1.2, Math.max(0.25, Math.max(box.width, box.height) / 400)),
    }, { duration: 350 })
  }, [fitTo, built])

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center font-retro-mono text-xs" style={{ background: OBSERVATORY.canvas, color: OBSERVATORY.dim }}>
        Atlas load ho raha hai…
      </div>
    )
  }

  return (
    <div className="relative h-full w-full" style={{ background: OBSERVATORY.canvas }}>
      <div ref={container} className="absolute inset-0" />
      {BAND_RULES[band].regionLabels && sigmaRef.current && (
        <AreaLabels regions={regions} project={(x, y) => sigmaRef.current!.graphToViewport({ x, y })} />
      )}
      {graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>
          Is scope mein koi document nahi.
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Repoint the lazy import and delete the old component**

In `src/pages/Brain.tsx`, change the `lazy()` call to:

```ts
const Atlas = lazy(() => import('@/components/brain/atlas/AtlasCanvas').then(module => ({ default: module.AtlasCanvas })))
```

and give the JSX the new props — for this task, pass `matches={null} highlighted={null} fitTo={null}` alongside the existing `graph`, `selectedPath` and `onSelect`. Then:

```bash
git rm src/components/brain/Atlas.tsx
```

- [ ] **Step 5: Verify the suite and the build**

Run: `npm run typecheck && npx vitest run src && npm run build`
Expected: PASS. The build must still emit a separate `Atlas*.js` chunk — proof the renderer is still lazily loaded.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/brain/atlas src/pages/Brain.tsx
git commit -m "feat: draw the Atlas in zoom bands with region names"
```

---

### Task 7: CommandBar — search and ask in one input

**Files:**
- Create: `src/components/brain/atlas/CommandBar.tsx`
- Create: `src/components/brain/atlas/CommandBar.test.tsx`

**Interfaces:**
- Consumes: `searchAtlas` (Task 4); `OBSERVATORY`, `TYPE_COLOR` (Task 3).
- Produces: `CommandBar` with props `{ graph: KnowledgeGraph | null; query: string; onQueryChange: (query: string) => void; onOpen: (path: string) => void; onAsk: (question: string) => void; asking: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/brain/atlas/CommandBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandBar } from './CommandBar'
import type { KnowledgeGraph } from '@/types/brainKnowledge'

const GRAPH: KnowledgeGraph = {
  nodes: [
    { path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai', type: 'client', degree: 7, updatedAt: '2026-09-18T00:00:00.000Z' },
    { path: 'wiki/projects/zapzone.md', title: 'Zap Zone Marketplace App', type: 'project', degree: 25, updatedAt: '2026-09-18T00:00:00.000Z' },
  ],
  edges: [],
  unresolvedCount: 0,
}

function setup(overrides: Partial<Parameters<typeof CommandBar>[0]> = {}) {
  const props = {
    graph: GRAPH, query: '', onQueryChange: vi.fn(), onOpen: vi.fn(), onAsk: vi.fn(), asking: false,
    ...overrides,
  }
  render(<CommandBar {...props} />)
  return props
}

describe('CommandBar', () => {
  it('reports every keystroke so the map can follow along', async () => {
    const props = setup()
    await userEvent.type(screen.getByRole('searchbox'), 'y')
    expect(props.onQueryChange).toHaveBeenCalledWith('y')
  })

  it('lists matches for the current query and opens the one you pick', async () => {
    const props = setup({ query: 'zap' })
    await userEvent.click(screen.getByRole('button', { name: /Zap Zone Marketplace App/ }))
    expect(props.onOpen).toHaveBeenCalledWith('wiki/projects/zapzone.md')
  })

  it('asks the Brain on Enter rather than just filtering', async () => {
    const props = setup({ query: 'yasir bhai ka scope kya tha' })
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}')
    expect(props.onAsk).toHaveBeenCalledWith('yasir bhai ka scope kya tha')
  })

  it('does not ask an empty question', async () => {
    const props = setup({ query: '   ' })
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}')
    expect(props.onAsk).not.toHaveBeenCalled()
  })

  it('clears the query on Escape', async () => {
    const props = setup({ query: 'zap' })
    await userEvent.type(screen.getByRole('searchbox'), '{Escape}')
    expect(props.onQueryChange).toHaveBeenCalledWith('')
  })

  // The map is the real result list; this is a shortcut, not a browser.
  it('lists no more than five matches', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      path: `p${index}.md`, title: `Zap ${index}`, type: 'note' as const, degree: index, updatedAt: '2026-09-18T00:00:00.000Z',
    }))
    setup({ graph: { nodes: many, edges: [], unresolvedCount: 0 }, query: 'zap' })
    expect(screen.getAllByRole('button', { name: /^Zap / })).toHaveLength(5)
  })

  it('says so while an answer is on its way', () => {
    setup({ query: 'anything', asking: true })
    expect(screen.getByText('Poochh raha hai…')).toBeTruthy()
  })
})
```

Run: `npx vitest run src/components/brain/atlas/CommandBar.test.tsx`
Expected: FAIL — cannot resolve `./CommandBar`.

- [ ] **Step 2: Write CommandBar**

Create `src/components/brain/atlas/CommandBar.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { searchAtlas } from '@/lib/atlasSearch'
import { OBSERVATORY, TYPE_COLOR } from '@/lib/atlasTheme'
import type { KnowledgeGraph } from '@/types/brainKnowledge'

/**
 * One input for both questions the owner asks of the store.
 *
 * Typing filters the map, which is instant because the graph is already in
 * memory. Enter asks the Brain, which costs a round trip and a model call.
 * They were two surfaces — Library and Ask — over the same documents, and the
 * map is a better result list than a column of rows.
 */
export function CommandBar({ graph, query, onQueryChange, onOpen, onAsk, asking }: {
  graph: KnowledgeGraph | null
  query: string
  onQueryChange: (query: string) => void
  onOpen: (path: string) => void
  onAsk: (question: string) => void
  asking: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => (graph ? searchAtlas(graph, query).top : []), [graph, query])

  // `/` and Ctrl/Cmd-K reach the bar from anywhere on the map, which is the
  // only way to start typing when the canvas has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
      if ((event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="w-[520px] max-w-[calc(100vw-120px)]">
      <div
        className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5"
        style={{ background: OBSERVATORY.raised, borderColor: OBSERVATORY.border }}
      >
        <Search size={15} style={{ color: OBSERVATORY.dim }} />
        <input
          ref={input}
          type="search"
          role="searchbox"
          aria-label="Search or ask"
          value={query}
          placeholder="Dhoondein, ya poochein…"
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && query.trim()) onAsk(query.trim())
            if (event.key === 'Escape') onQueryChange('')
          }}
          className="font-retro-sans flex-1 bg-transparent text-sm outline-none placeholder:opacity-60"
          style={{ color: OBSERVATORY.text }}
        />
        {asking
          ? <span className="font-retro-mono text-[11px]" style={{ color: OBSERVATORY.accent }}>Poochh raha hai…</span>
          : <span className="font-retro-mono flex items-center gap-1 text-[11px]" style={{ color: OBSERVATORY.dim }}>
              <CornerDownLeft size={11} /> ask
            </span>}
      </div>

      {results.length > 0 && (
        <div
          className="mt-1.5 overflow-hidden rounded-xl border"
          style={{ background: OBSERVATORY.raised, borderColor: OBSERVATORY.border }}
        >
          {results.map(result => (
            <button
              key={result.path}
              onClick={() => onOpen(result.path)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/5"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[result.type] }} />
              <span className="font-retro-sans min-w-0 flex-1 truncate text-sm" style={{ color: OBSERVATORY.text }}>{result.title}</span>
              <span className="font-retro-mono shrink-0 text-[11px]" style={{ color: OBSERVATORY.dim }}>{result.degree}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

Run: `npx vitest run src/components/brain/atlas/CommandBar.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 3: Commit**

```bash
git add src/components/brain/atlas/CommandBar.tsx src/components/brain/atlas/CommandBar.test.tsx
git commit -m "feat: one Atlas input that filters as you type and asks on Enter"
```

---

### Task 8: StatusStrip — counts, panels, overlay toggles

**Files:**
- Create: `src/components/brain/atlas/StatusStrip.tsx`
- Create: `src/components/brain/atlas/StatusStrip.test.tsx`

**Interfaces:**
- Consumes: `AtlasOverlay` (Task 5); `OBSERVATORY` (Task 3).
- Produces: `type AtlasPanel = 'timeline' | 'review' | 'health'`; `StatusStrip` with props `{ documents: number; links: number; review: number; looseEnds: number; panel: AtlasPanel | null; onPanel: (panel: AtlasPanel | null) => void; overlay: AtlasOverlay | null; onOverlay: (overlay: AtlasOverlay | null) => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/brain/atlas/StatusStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatusStrip } from './StatusStrip'

function setup(overrides: Partial<Parameters<typeof StatusStrip>[0]> = {}) {
  const props = {
    documents: 163, links: 755, review: 2, looseEnds: 153,
    panel: null, onPanel: vi.fn(), overlay: null, onOverlay: vi.fn(),
    ...overrides,
  }
  render(<StatusStrip {...props} />)
  return props
}

describe('StatusStrip', () => {
  it('shows what the store holds', () => {
    setup()
    expect(screen.getByRole('button', { name: /163 documents/ })).toBeTruthy()
    expect(screen.getByText('755 links')).toBeTruthy()
  })

  it('opens a panel, and closes it when its own pill is pressed again', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: /2 review/ }))
    expect(props.onPanel).toHaveBeenCalledWith('review')

    props.onPanel.mockClear()
    render(<StatusStrip {...props} panel="review" />)
    await userEvent.click(screen.getAllByRole('button', { name: /2 review/ })[1])
    expect(props.onPanel).toHaveBeenCalledWith(null)
  })

  it('marks the open panel for assistive tech', () => {
    setup({ panel: 'timeline' })
    expect(screen.getByRole('button', { name: /163 documents/ }).getAttribute('aria-pressed')).toBe('true')
  })

  // Two overlays at once means two meanings for one ring.
  it('turns one overlay on and swaps it for another', async () => {
    const props = setup({ overlay: 'new' })
    await userEvent.click(screen.getByRole('button', { name: 'Orphans' }))
    expect(props.onOverlay).toHaveBeenCalledWith('orphans')
  })

  it('turns the active overlay off when its own control is pressed', async () => {
    const props = setup({ overlay: 'orphans' })
    await userEvent.click(screen.getByRole('button', { name: 'Orphans' }))
    expect(props.onOverlay).toHaveBeenCalledWith(null)
  })

  // Zero pending work should read as quiet, not as an alert with a zero in it.
  it('does not accent the review pill when nothing is pending', () => {
    setup({ review: 0 })
    expect(screen.getByRole('button', { name: /0 review/ }).className).not.toContain('text-amber')
  })
})
```

Run: `npx vitest run src/components/brain/atlas/StatusStrip.test.tsx`
Expected: FAIL — cannot resolve `./StatusStrip`.

- [ ] **Step 2: Write StatusStrip**

Create `src/components/brain/atlas/StatusStrip.tsx`:

```tsx
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { AtlasOverlay } from '@/lib/atlasOverlays'

export type AtlasPanel = 'timeline' | 'review' | 'health'

const OVERLAYS: Array<{ id: AtlasOverlay; label: string }> = [
  { id: 'new', label: 'Naya' },
  { id: 'trail', label: 'Agent trail' },
  { id: 'orphans', label: 'Orphans' },
  { id: 'loose', label: 'Loose ends' },
]

/**
 * The store's vital signs, and the way into everything that is not the map.
 *
 * Each count is also its own door: documents opens the timeline, review opens
 * the review queue, loose ends turns on their overlay. A number you cannot act
 * on is a number that did not need a pill.
 */
export function StatusStrip({ documents, links, review, looseEnds, panel, onPanel, overlay, onOverlay }: {
  documents: number
  links: number
  review: number
  looseEnds: number
  panel: AtlasPanel | null
  onPanel: (panel: AtlasPanel | null) => void
  overlay: AtlasOverlay | null
  onOverlay: (overlay: AtlasOverlay | null) => void
}) {
  const pill = 'font-retro-mono rounded-lg border px-2.5 py-1.5 text-[11px] transition'
  const surface = { background: OBSERVATORY.raised, borderColor: OBSERVATORY.border }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onPanel(panel === 'timeline' ? null : 'timeline')}
        aria-pressed={panel === 'timeline'}
        className={pill}
        style={{ ...surface, color: panel === 'timeline' ? OBSERVATORY.accent : OBSERVATORY.muted }}
      >
        {documents} documents
      </button>

      <span className={pill} style={{ ...surface, color: OBSERVATORY.dim }}>{links} links</span>

      <button
        onClick={() => onPanel(panel === 'review' ? null : 'review')}
        aria-pressed={panel === 'review'}
        className={`${pill} ${review > 0 ? 'text-amber-500' : ''}`}
        style={{ ...surface, ...(review > 0 ? {} : { color: OBSERVATORY.muted }) }}
      >
        {review} review
      </button>

      <button
        onClick={() => onOverlay(overlay === 'loose' ? null : 'loose')}
        aria-pressed={overlay === 'loose'}
        className={pill}
        style={{ ...surface, color: overlay === 'loose' ? OBSERVATORY.accent : OBSERVATORY.muted }}
      >
        {looseEnds} loose ends
      </button>

      <span className="mx-1 h-4 w-px" style={{ background: OBSERVATORY.border }} />

      {OVERLAYS.filter(item => item.id !== 'loose').map(item => (
        <button
          key={item.id}
          onClick={() => onOverlay(overlay === item.id ? null : item.id)}
          aria-pressed={overlay === item.id}
          className={pill}
          style={{ ...surface, color: overlay === item.id ? OBSERVATORY.accent : OBSERVATORY.dim }}
        >
          {item.label}
        </button>
      ))}

      <button
        onClick={() => onPanel(panel === 'health' ? null : 'health')}
        aria-pressed={panel === 'health'}
        className={pill}
        style={{ ...surface, color: panel === 'health' ? OBSERVATORY.accent : OBSERVATORY.dim }}
      >
        Health
      </button>
    </div>
  )
}
```

Run: `npx vitest run src/components/brain/atlas/StatusStrip.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 3: Commit**

```bash
git add src/components/brain/atlas/StatusStrip.tsx src/components/brain/atlas/StatusStrip.test.tsx
git commit -m "feat: an Atlas status strip whose counts are also its doors"
```

---

### Task 9: DetailDrawer — the detail pane, reframed

Replace `detail/DetailPane.tsx`'s frame. The bodies it renders are unchanged.

**Files:**
- Create: `src/components/brain/atlas/DetailDrawer.tsx`
- Create: `src/components/brain/atlas/DetailDrawer.test.tsx`
- Delete: `src/components/brain/detail/DetailPane.tsx`
- Modify: `src/pages/Brain.tsx` (import `DetailDrawer` instead of `DetailPane`)

**Interfaces:**
- Consumes: `DocumentDetail`, `AnswerDetail`, `TurnDetail` from `src/components/brain/detail/` with their existing props; `SelectionStack`, `Selection` from `src/lib/brainSelection.ts`; `OBSERVATORY` (Task 3).
- Produces: `DetailDrawer` with props `{ stack: SelectionStack; onBack: () => void; onClear: () => void; document: DocumentReadResult | null; neighborhood: DocumentNeighborhood | null; events: BrainEvent[]; pack: AnswerPack | null; onSelect: (next: Selection) => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/brain/atlas/DetailDrawer.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DetailDrawer } from './DetailDrawer'
import { EMPTY_SELECTION } from '@/lib/brainSelection'

function setup(overrides: Partial<Parameters<typeof DetailDrawer>[0]> = {}) {
  const props = {
    stack: EMPTY_SELECTION, onBack: vi.fn(), onClear: vi.fn(),
    document: null, neighborhood: null, events: [], pack: null, onSelect: vi.fn(),
    ...overrides,
  }
  const view = render(<DetailDrawer {...props} />)
  return { ...props, view }
}

describe('DetailDrawer', () => {
  // Nothing selected means no drawer at all — the map gets the whole screen.
  it('renders nothing when nothing is selected', () => {
    const { view } = setup()
    expect(view.container.firstChild).toBeNull()
  })

  it('shows a document that is still loading without stranding the title', () => {
    setup({ stack: { current: { kind: 'document', path: 'wiki/me/profile.md' }, history: [] } })
    expect(screen.getByText('wiki/me/profile.md')).toBeTruthy()
    expect(screen.getByText('Khul raha hai…')).toBeTruthy()
  })

  it('offers back only once there is somewhere to go back to', () => {
    setup({ stack: { current: { kind: 'document', path: 'a.md' }, history: [] } })
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()

    setup({ stack: { current: { kind: 'document', path: 'b.md' }, history: [{ kind: 'document', path: 'a.md' }] } })
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })

  it('closes on Escape as well as its own control', async () => {
    const props = setup({ stack: { current: { kind: 'document', path: 'a.md' }, history: [] } })
    await userEvent.keyboard('{Escape}')
    expect(props.onClear).toHaveBeenCalled()
  })

  it('shows an answer when one is selected', () => {
    setup({
      stack: { current: { kind: 'answer', question: 'scope kya tha' }, history: [] },
      pack: { question: 'scope kya tha', sections: [], estimatedTokens: 0, truncated: false },
    })
    expect(screen.getByText('scope kya tha')).toBeTruthy()
  })
})
```

Run: `npx vitest run src/components/brain/atlas/DetailDrawer.test.tsx`
Expected: FAIL — cannot resolve `./DetailDrawer`.

- [ ] **Step 2: Read the component being replaced**

Run: `cat src/components/brain/detail/DetailPane.tsx`

It renders `AnswerDetail`, `DocumentDetail` and `TurnDetail` behind a `selection.kind` switch, with a back/close header and an empty state showing counters. Keep the switch and the header; drop the counters, which the status strip now owns.

- [ ] **Step 3: Write DetailDrawer**

Create `src/components/brain/atlas/DetailDrawer.tsx`:

```tsx
import { useEffect } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { AnswerDetail } from '../detail/AnswerDetail'
import { DocumentDetail } from '../detail/DocumentDetail'
import { TurnDetail } from '../detail/TurnDetail'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { Selection, SelectionStack } from '@/lib/brainSelection'
import type { AnswerPack, BrainEvent, DocumentNeighborhood, DocumentReadResult } from '@/types/brainKnowledge'

/**
 * The detail pane as a drawer floating over the map.
 *
 * Only the frame changed. The bodies — `DocumentDetail`, `AnswerDetail`,
 * `TurnDetail` — and the selection stack behind them are the ones the previous
 * design settled, and they were not what was wrong with it. What changed is
 * that nothing selected now means no drawer, so the map keeps the whole screen
 * until you ask for something.
 */
export function DetailDrawer({ stack, onBack, onClear, document, neighborhood, events, pack, onSelect }: {
  stack: SelectionStack
  onBack: () => void
  onClear: () => void
  document: DocumentReadResult | null
  neighborhood: DocumentNeighborhood | null
  events: BrainEvent[]
  pack: AnswerPack | null
  onSelect: (next: Selection) => void
}) {
  const selection = stack.current

  useEffect(() => {
    if (selection === null) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClear() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onClear])

  if (selection === null) return null

  const title = selection.kind === 'document' ? selection.path
    : selection.kind === 'answer' ? selection.question
      : 'Agent turn'

  return (
    <aside
      aria-label="Detail"
      className="flex h-full w-[420px] shrink-0 flex-col overflow-hidden rounded-xl border"
      style={{ background: OBSERVATORY.raised, borderColor: OBSERVATORY.border, borderLeftColor: OBSERVATORY.accent, borderLeftWidth: 2 }}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: OBSERVATORY.border }}>
        {stack.history.length > 0 && (
          <button onClick={onBack} aria-label="Back" className="rounded-lg p-1 transition hover:bg-white/5" style={{ color: OBSERVATORY.muted }}>
            <ArrowLeft size={15} />
          </button>
        )}
        <span className="font-retro-mono min-w-0 flex-1 truncate text-[11px]" style={{ color: OBSERVATORY.muted }}>{title}</span>
        <button onClick={onClear} aria-label="Close detail" className="rounded-lg p-1 transition hover:bg-white/5" style={{ color: OBSERVATORY.muted }}>
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ color: OBSERVATORY.text }}>
        {selection.kind === 'document' && (document
          ? <DocumentDetail document={document} neighborhood={neighborhood} events={events} onSelect={onSelect} />
          : <p className="font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>Khul raha hai…</p>)}
        {selection.kind === 'answer' && (pack
          ? <AnswerDetail pack={pack} onSelect={onSelect} />
          : <p className="font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>Jawab aa raha hai…</p>)}
        {selection.kind === 'turn' && (() => {
          const event = events.find(candidate => candidate.id === selection.eventId)
          return event
            ? <TurnDetail event={event} events={events} onSelect={onSelect} />
            : <p className="font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>Ye turn ab is window mein nahi hai.</p>
        })()}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run the test, then remove the old pane**

Run: `npx vitest run src/components/brain/atlas/DetailDrawer.test.tsx`
Expected: PASS — 5 tests.

In `src/pages/Brain.tsx`, replace the `DetailPane` import and its JSX with `DetailDrawer`, dropping the `counters` prop. Then:

```bash
git rm src/components/brain/detail/DetailPane.tsx
```

Ruling: `src/pages/Brain.test.tsx` has one existing test that depends on the
exact behaviour this task removes -- `DetailPane` used to show a counters
panel (`Documents` / `Review inbox` / `Unresolved links`) when nothing was
selected, and `DetailDrawer` renders nothing at all in that case. Left
unchanged, this task's own Step 5 verification would fail. Fix both spots now
rather than leaving the suite red for Task 11 to find:

1. Delete the whole `it('shows the counters in the detail pane when nothing
   is selected', ...)` test. Task 11 replaces it with an equivalent case
   ("shows no drawer until something is selected") when it rewrites this
   describe block.
2. In `it('clears the detail pane when the scope changes', ...)`, replace the
   final line --
   `expect(within(detail()).getByText('Documents')).toBeTruthy()` -- with
   `expect(screen.queryByRole('complementary', { name: 'Detail' })).toBeNull()`,
   since `detail()` itself throws once nothing renders.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/brain src/pages/Brain.tsx
git commit -m "feat: float the Brain detail pane over the map as a drawer"
```

---

### Task 10: Panels — Timeline, Review, Health

Three panels that replace four list components. Each loads nothing itself; the shell passes what it has.

**Files:**
- Create: `src/components/brain/atlas/panels/Timeline.tsx`
- Create: `src/components/brain/atlas/panels/Timeline.test.tsx`
- Create: `src/components/brain/atlas/panels/Review.tsx`
- Create: `src/components/brain/atlas/panels/Review.test.tsx`
- Create: `src/components/brain/atlas/panels/Health.tsx` (new file with `HealthPanel.tsx`'s content, restyled to `OBSERVATORY`; the old file is deleted in Task 11, not here — see Step 5)

Ruling: `src/components/brain/lists/AskList.tsx`, `LibraryList.tsx`, `ReviewList.tsx`,
`TodayList.tsx`, `src/components/brain/Card.tsx`, `src/components/brain/DocumentRow.tsx`
and `src/components/brain/HealthPanel.tsx` are **not** touched by this task. The
current `src/pages/Brain.tsx` still imports all of them; deleting them here would
break the build until Task 11's rewrite lands. Task 11 deletes them in the same
commit that stops importing them.

**Interfaces:**
- Consumes: `describeEvent`, `eventTime`, `documentsRead`, `isOpenableEvent` from `src/lib/brainFormat.ts`; `OBSERVATORY` (Task 3); `Selection` from `src/lib/brainSelection.ts`.
- Produces: `Timeline` with props `{ events: BrainEvent[]; onSelect: (next: Selection) => void; onHighlight: (paths: string[]) => void }`; `Review` with props `{ candidates: BrainCandidate[]; knowledgeCandidates: KnowledgeCandidate[]; unresolvedLinks: UnresolvedLink[]; onReview: (id: string, decision: 'accept' | 'reject') => void; onReviewKnowledge: (id: string, decision: 'accept' | 'reject') => void; onCreateStub: (targetPath: string) => void; onSelect: (next: Selection) => void }`; `Health` keeping `HealthPanel`'s existing props.

- [ ] **Step 1: Write the Timeline test**

Create `src/components/brain/atlas/panels/Timeline.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Timeline } from './Timeline'
import type { BrainEvent } from '@/types/brainKnowledge'

const turn = (id: string, metadata: Record<string, unknown>): BrainEvent => ({
  id, scopeId: 's', action: 'agent.turn', targetId: `t-${id}`,
  metadata, createdAt: '2026-09-18T11:55:00.000Z',
})

describe('Timeline', () => {
  it('shows a turn by what was asked', () => {
    render(<Timeline events={[turn('1', { prompt: 'yasir bhai ka scope', sessionId: 'abc' })]} onSelect={vi.fn()} onHighlight={vi.fn()} />)
    expect(screen.getByText(/yasir bhai ka scope/)).toBeTruthy()
  })

  // The nine identical "Agent turn" rows in the old surface were not a bug:
  // main.ts stores the prompt only when brain writes are allowed, so a
  // temporary-mode turn has none. Saying why beats looking broken.
  it('says why a turn has nothing to show instead of repeating a bare label', () => {
    render(<Timeline events={[turn('1', { sessionId: 'abc' })]} onSelect={vi.fn()} onHighlight={vi.fn()} />)
    expect(screen.getByText(/temporary mode/)).toBeTruthy()
  })

  it('lists the documents a turn read, and highlights one when picked', async () => {
    const onHighlight = vi.fn()
    render(
      <Timeline
        events={[turn('1', { prompt: 'q', sessionId: 'abc', documentsRead: ['wiki/me/profile.md'] })]}
        onSelect={vi.fn()}
        onHighlight={onHighlight}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'wiki/me/profile.md' }))
    expect(onHighlight).toHaveBeenCalledWith(['wiki/me/profile.md'])
  })

  it('opens the conversation behind a turn', async () => {
    const onSelect = vi.fn()
    render(<Timeline events={[turn('1', { prompt: 'q', sessionId: 'abc' })]} onSelect={onSelect} onHighlight={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /q/ }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'turn', eventId: '1' })
  })

  it('says the day was quiet rather than showing an empty box', () => {
    render(<Timeline events={[]} onSelect={vi.fn()} onHighlight={vi.fn()} />)
    expect(screen.getByText(/kuch nahi hua/)).toBeTruthy()
  })
})
```

Run: `npx vitest run src/components/brain/atlas/panels/Timeline.test.tsx`
Expected: FAIL — cannot resolve `./Timeline`.

- [ ] **Step 2: Write Timeline**

Create `src/components/brain/atlas/panels/Timeline.tsx`:

```tsx
import { describeEvent, documentsRead, eventTime, isOpenableEvent } from '@/lib/brainFormat'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { Selection } from '@/lib/brainSelection'
import type { BrainEvent } from '@/types/brainKnowledge'

/**
 * What happened, most recent first.
 *
 * An agent turn with no prompt is the interesting case. `main.ts` stores the
 * prompt only when brain writes are allowed, because temporary mode promises
 * not to keep what was said — so an empty row is the promise being kept, not
 * data going missing. The row says which it is.
 */
export function Timeline({ events, onSelect, onHighlight }: {
  events: BrainEvent[]
  onSelect: (next: Selection) => void
  onHighlight: (paths: string[]) => void
}) {
  if (events.length === 0) {
    return (
      <p className="font-retro-sans text-sm" style={{ color: OBSERVATORY.dim }}>
        Aaj abhi kuch nahi hua — Agent se baat karein ya Health se vault import karein.
      </p>
    )
  }

  return (
    <ol className="space-y-1">
      {[...events].reverse().map(event => {
        const described = describeEvent(event)
        const untitled = event.action === 'agent.turn' && typeof event.metadata.prompt !== 'string'
        const read = documentsRead(event)
        const body = (
          <span className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-retro-mono shrink-0 text-[11px]" style={{ color: OBSERVATORY.dim }}>{eventTime(event.createdAt)}</span>
            <span className="font-retro-sans min-w-0 flex-1 truncate text-sm" style={{ color: untitled ? OBSERVATORY.muted : OBSERVATORY.text }}>
              {untitled ? 'Agent turn · temporary mode — prompt save nahi hua' : described}
            </span>
          </span>
        )
        return (
          <li key={event.id} className="rounded-lg px-2 py-1.5 transition hover:bg-white/5">
            {isOpenableEvent(event)
              ? <button onClick={() => onSelect({ kind: 'turn', eventId: event.id })} className="w-full text-left">{body}</button>
              : body}
            {read.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1 pl-[54px]">
                {read.map(path => (
                  <button
                    key={path}
                    onClick={() => onHighlight([path])}
                    className="font-retro-mono rounded border px-1.5 py-0.5 text-[10px] transition hover:bg-white/5"
                    style={{ borderColor: OBSERVATORY.border, color: OBSERVATORY.muted }}
                  >
                    {path}
                  </button>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
```

Run: `npx vitest run src/components/brain/atlas/panels/Timeline.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 3: Write the Review test**

Create `src/components/brain/atlas/panels/Review.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Review } from './Review'

function setup(overrides: Partial<Parameters<typeof Review>[0]> = {}) {
  const props = {
    candidates: [], knowledgeCandidates: [], unresolvedLinks: [],
    onReview: vi.fn(), onReviewKnowledge: vi.fn(), onCreateStub: vi.fn(), onSelect: vi.fn(),
    ...overrides,
  }
  render(<Review {...props} />)
  return props
}

const LOOSE = { documentPath: 'wiki/me/profile.md', documentTitle: 'Profile', targetPath: 'me/tools' }

describe('Review', () => {
  it('says the queue is clear when there is nothing to decide', () => {
    setup()
    expect(screen.getByText(/kuch pending nahi/)).toBeTruthy()
  })

  it('accepts a knowledge candidate', async () => {
    const props = setup({
      knowledgeCandidates: [{
        id: 'k1', scopeId: 's', targetPath: null, type: 'note', title: 'Yasir Bhai — 2026-09-18',
        summary: 'Scope barhane ko kaha.', body: 'Scope barhane ko kaha.', origin: 'machine-inferred',
        sessionRef: 'job:1', status: 'pending', createdAt: '2026-09-18T00:00:00.000Z', decidedAt: null,
      }],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Accept Yasir Bhai — 2026-09-18' }))
    expect(props.onReviewKnowledge).toHaveBeenCalledWith('k1', 'accept')
  })

  // The loose end's whole point: one click turns it into an edge.
  it('offers to create the document a loose end points at', async () => {
    const props = setup({ unresolvedLinks: [LOOSE] })
    await userEvent.click(screen.getByRole('button', { name: 'Create me/tools' }))
    expect(props.onCreateStub).toHaveBeenCalledWith('me/tools')
  })

  it('opens the document a loose end came from', async () => {
    const props = setup({ unresolvedLinks: [LOOSE] })
    await userEvent.click(screen.getByRole('button', { name: /Profile/ }))
    expect(props.onSelect).toHaveBeenCalledWith({ kind: 'document', path: 'wiki/me/profile.md' })
  })
})
```

Run: `npx vitest run src/components/brain/atlas/panels/Review.test.tsx`
Expected: FAIL — cannot resolve `./Review`.

- [ ] **Step 4: Write Review**

Create `src/components/brain/atlas/panels/Review.tsx`:

```tsx
import { Check, Plus, X } from 'lucide-react'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { Selection } from '@/lib/brainSelection'
import type { BrainCandidate } from '@/types/brain'
import type { KnowledgeCandidate, UnresolvedLink } from '@/types/brainKnowledge'

/**
 * The write gate, and the loose ends beside it.
 *
 * Unresolved links sit here rather than in their own surface because they are
 * the same kind of thing as a candidate: a connection the store has noticed and
 * a human has not confirmed. The difference is the action — a candidate is
 * accepted, a loose end is given the document it was pointing at.
 */
export function Review({ candidates, knowledgeCandidates, unresolvedLinks, onReview, onReviewKnowledge, onCreateStub, onSelect }: {
  candidates: BrainCandidate[]
  knowledgeCandidates: KnowledgeCandidate[]
  unresolvedLinks: UnresolvedLink[]
  onReview: (id: string, decision: 'accept' | 'reject') => void
  onReviewKnowledge: (id: string, decision: 'accept' | 'reject') => void
  onCreateStub: (targetPath: string) => void
  onSelect: (next: Selection) => void
}) {
  const empty = candidates.length === 0 && knowledgeCandidates.length === 0 && unresolvedLinks.length === 0
  if (empty) {
    return <p className="font-retro-sans text-sm" style={{ color: OBSERVATORY.dim }}>Kuch pending nahi hai.</p>
  }

  const card = 'rounded-xl border p-3'
  const surface = { background: OBSERVATORY.canvas, borderColor: OBSERVATORY.border }
  const decide = 'rounded-lg p-1.5 transition hover:bg-white/10'

  return (
    <div className="space-y-2.5">
      {knowledgeCandidates.map(candidate => (
        <div key={candidate.id} className={`${card} flex items-start gap-2.5`} style={surface}>
          <div className="min-w-0 flex-1">
            <p className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.dim }}>
              {candidate.origin} · {candidate.type}
            </p>
            <p className="font-retro-sans mt-1 text-sm" style={{ color: OBSERVATORY.text }}>{candidate.title}</p>
            <p className="font-retro-sans mt-1 text-xs" style={{ color: OBSERVATORY.muted }}>{candidate.body}</p>
          </div>
          <button onClick={() => onReviewKnowledge(candidate.id, 'accept')} aria-label={`Accept ${candidate.title}`} className={decide} style={{ color: '#4ade80' }}><Check size={15} /></button>
          <button onClick={() => onReviewKnowledge(candidate.id, 'reject')} aria-label={`Reject ${candidate.title}`} className={decide} style={{ color: '#f87171' }}><X size={15} /></button>
        </div>
      ))}

      {candidates.map(candidate => (
        <div key={candidate.id} className={`${card} flex items-start gap-2.5`} style={surface}>
          <div className="min-w-0 flex-1">
            <p className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.dim }}>
              memory · {candidate.origin} · {candidate.kind}
            </p>
            <p className="font-retro-sans mt-1 text-sm" style={{ color: OBSERVATORY.text }}>{candidate.text}</p>
          </div>
          <button onClick={() => onReview(candidate.id, 'accept')} aria-label={`Accept ${candidate.text}`} className={decide} style={{ color: '#4ade80' }}><Check size={15} /></button>
          <button onClick={() => onReview(candidate.id, 'reject')} aria-label={`Reject ${candidate.text}`} className={decide} style={{ color: '#f87171' }}><X size={15} /></button>
        </div>
      ))}

      {unresolvedLinks.length > 0 && (
        <div className={card} style={surface}>
          <p className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.dim }}>
            Loose ends · {unresolvedLinks.length}
          </p>
          <div className="mt-2 space-y-1">
            {unresolvedLinks.slice(0, 40).map(link => (
              <div key={`${link.documentPath}->${link.targetPath}`} className="flex items-center gap-2">
                <button
                  onClick={() => onSelect({ kind: 'document', path: link.documentPath })}
                  className="font-retro-sans min-w-0 flex-1 truncate text-left text-xs transition hover:underline"
                  style={{ color: OBSERVATORY.muted }}
                >
                  {link.documentTitle} → <span className="font-retro-mono" style={{ color: OBSERVATORY.accent }}>{link.targetPath}</span>
                </button>
                <button
                  onClick={() => onCreateStub(link.targetPath)}
                  aria-label={`Create ${link.targetPath}`}
                  className="rounded-lg p-1 transition hover:bg-white/10"
                  style={{ color: OBSERVATORY.muted }}
                >
                  <Plus size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

Run: `npx vitest run src/components/brain/atlas/panels/Review.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Create Health.tsx from HealthPanel.tsx's content**

Read `src/components/brain/HealthPanel.tsx`, then create
`src/components/brain/atlas/panels/Health.tsx` as a new file (the old one stays
in place — Task 11 removes it once nothing imports it) with the same content:
rename the exported component from `HealthPanel` to `Health`, replace the
`Card` import with a local card defined in the same file (`rounded-xl border
p-4` with `background: OBSERVATORY.canvas, borderColor: OBSERVATORY.border`),
swap `text-stone-*` for `OBSERVATORY` values, and keep every button, report
line and prop exactly as they are — the operations are unchanged, only the
frame changes.

- [ ] **Step 6: Commit**

```bash
git add -A src/components/brain
git commit -m "feat: three Brain panels replace four list surfaces"
```

---

### Task 11: The shell

Rewrite `Brain.tsx` as the frame: cream housing, dark canvas inset, panels over it. This is the task that deletes the tabs.

**Files:**
- Modify: `src/pages/Brain.tsx` (rewrite)
- Modify: `src/lib/brainUi.ts` (delete `BRAIN_TABS` and its comment)
- Modify: `src/lib/brainUi.test.ts` (drop the `BRAIN_TABS` assertion)
- Modify: `src/pages/Brain.test.tsx` (rewrite the layout cases against the new shell)
- Test: `src/pages/Brain.test.tsx`, `src/pages/brainScopeIsolation.test.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 1–10.
- Produces: the default-exported `Brain` page.

- [ ] **Step 1: Write the failing shell tests**

In `src/pages/Brain.test.tsx`, replace the `describe('Brain three-column layout', ...)` block with:

```tsx
describe('Brain shell', () => {
  it('has no tabs — the map is the page', async () => {
    render(<Brain />)
    await screen.findByRole('searchbox')
    expect(screen.queryByRole('navigation', { name: 'Brain sections' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull()
  })

  it('names the scope once, not twice', async () => {
    render(<Brain />)
    await screen.findByRole('searchbox')
    expect(screen.getAllByText(/Global/)).toHaveLength(1)
  })

  it('opens a panel from the status strip and closes it again', async () => {
    render(<Brain />)
    const pill = await screen.findByRole('button', { name: /review/ })
    fireEvent.click(pill)
    expect(screen.getByRole('complementary', { name: 'Review' })).toBeTruthy()
    fireEvent.click(pill)
    expect(screen.queryByRole('complementary', { name: 'Review' })).toBeNull()
  })

  it('shows no drawer until something is selected', async () => {
    render(<Brain />)
    await screen.findByRole('searchbox')
    expect(screen.queryByRole('complementary', { name: 'Detail' })).toBeNull()
  })

  // The one behaviour worth carrying over from the describe block this
  // replaces: a document belonging to one client must never stay on screen
  // under another. The other three tests in that block existed only to prove
  // the old tab nav preserved a selection across a tab switch -- a nav that
  // no longer exists -- so they have no equivalent here.
  it('clears the drawer when the scope changes', async () => {
    api.brainKnowledgeGraph.mockResolvedValue({
      nodes: [{ path: document.path, title: document.title, type: document.type, degree: 7, updatedAt: document.updatedAt }],
      edges: [], unresolvedCount: 0,
    })
    render(<Brain />)
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'Yasir' } })
    fireEvent.click(await screen.findByRole('button', { name: /Yasir Bhai/ }))
    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Detail' })).toBeTruthy())

    fireEvent.change(screen.getByRole('combobox', { name: 'Brain scope' }), { target: { value: 'b' } })

    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Detail' })).toBeNull())
  })
})
```

Keep every other `describe` in the file as it is (`Brain document reader`, `Brain turn reader`, `Brain Ask`, `Brain Health entities`) -- they are the regression guard for this rewrite and do not reference the removed nav.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/pages/Brain.test.tsx`
Expected: FAIL — the nav is still rendered and the scope name still appears twice.

- [ ] **Step 3: Rewrite the shell**

Replace `src/pages/Brain.tsx` with:

```tsx
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { CommandBar } from '@/components/brain/atlas/CommandBar'
import { DetailDrawer } from '@/components/brain/atlas/DetailDrawer'
import { StatusStrip, type AtlasPanel } from '@/components/brain/atlas/StatusStrip'
import { Health } from '@/components/brain/atlas/panels/Health'
import { Review } from '@/components/brain/atlas/panels/Review'
import { Timeline } from '@/components/brain/atlas/panels/Timeline'
import { overlayPaths, type AtlasOverlay } from '@/lib/atlasOverlays'
import { searchAtlas } from '@/lib/atlasSearch'
import { OBSERVATORY } from '@/lib/atlasTheme'
import { EMPTY_SELECTION, popSelection, pushSelection, type Selection } from '@/lib/brainSelection'
import type { BrainCandidate, BrainScope, BrainStatus } from '@/types/brain'
import type {
  AnswerPack, BrainEntity, BrainEvent, CompactionReport, DocumentNeighborhood, DocumentReadResult,
  KnowledgeCandidate, KnowledgeGraph, ManifestRender, UnresolvedLink, VaultImportReport, VectorIndexReport,
} from '@/types/brainKnowledge'

const api = window.electronAPI

/** Where the last visit's moment is kept, for the "new" overlay. */
const LAST_VISIT_KEY = 'brain.lastVisit'

/** A week, because a day is too short to show what the agent has been reading. */
function weekBounds(): { from: string; to: string } {
  const now = new Date()
  return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() }
}

/**
 * Sigma and graphology are megabytes of WebGL renderer and every other surface
 * here is text, so the canvas loads when it is needed. jsdom has no WebGL2
 * context either, which is what lets the shell be tested at all.
 */
const AtlasCanvas = lazy(() => import('@/components/brain/atlas/AtlasCanvas').then(module => ({ default: module.AtlasCanvas })))

export default function Brain() {
  const scopeState = useBrainScope()
  // Scope-owned state is discarded synchronously, including when the next load fails.
  return <BrainScopeView key={scopeState.scope?.id ?? 'loading'} {...scopeState} />
}

function BrainScopeView({ scopes, scope, selectScope, loading: scopeLoading, error: scopeError }: ReturnType<typeof useBrainScope>) {
  const [status, setStatus] = useState<BrainStatus | null>(null)
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [candidates, setCandidates] = useState<BrainCandidate[]>([])
  const [knowledgeCandidates, setKnowledgeCandidates] = useState<KnowledgeCandidate[]>([])
  const [unresolvedLinks, setUnresolvedLinks] = useState<UnresolvedLink[]>([])
  const [events, setEvents] = useState<BrainEvent[]>([])
  const [error, setError] = useState('')

  const [panel, setPanel] = useState<AtlasPanel | null>(null)
  const [overlay, setOverlay] = useState<AtlasOverlay | null>(null)
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState(false)
  const [askPack, setAskPack] = useState<AnswerPack | null>(null)
  const [fitTo, setFitTo] = useState<Set<string> | null>(null)
  const [lastVisit, setLastVisit] = useState<string | null>(null)

  const [stack, setStack] = useState(EMPTY_SELECTION)
  const [selectedDocument, setSelectedDocument] = useState<DocumentReadResult | null>(null)
  const [neighborhood, setNeighborhood] = useState<DocumentNeighborhood | null>(null)

  // Health panel state, carried across from the Brain.tsx this replaces
  // (git show HEAD~1:src/pages/Brain.tsx) rather than retyped -- each of
  // these carries a stale-response guard that is easy to lose on the way.
  const [knowledgeVaultRoot, setKnowledgeVaultRoot] = useState<string | null>(null)
  const [knowledgeImportReport, setKnowledgeImportReport] = useState<VaultImportReport | null>(null)
  const [knowledgeImporting, setKnowledgeImporting] = useState(false)
  const [knowledgeManifest, setKnowledgeManifest] = useState<ManifestRender | null>(null)
  const [knowledgeCompactReport, setKnowledgeCompactReport] = useState<CompactionReport | null>(null)
  const [knowledgeCompacting, setKnowledgeCompacting] = useState(false)
  const [migrateReport, setMigrateReport] = useState<{ scanned: number; migrated: number; unchanged: number; dryRun: boolean } | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [vectorStatus, setVectorStatus] = useState<{ documents: number; vectors: number; model: string; failed: boolean } | null>(null)
  const [vectorBuilding, setVectorBuilding] = useState(false)
  const [vectorReport, setVectorReport] = useState<VectorIndexReport | null>(null)
  const [entities, setEntities] = useState<BrainEntity[]>([])
  const [entityBackfilling, setEntityBackfilling] = useState(false)
  const [entityReport, setEntityReport] = useState<{ scanned: number; created: number; linked: number } | null>(null)

  const selectedScopeId = useRef<string | null>(null)
  selectedScopeId.current = scope?.id ?? null
  const readRequest = useRef(0)
  const askRequest = useRef(0)
  const manifestRequest = useRef(0)
  const importRequest = useRef(0)
  const compactRequest = useRef(0)
  const migrateRequest = useRef(0)

  const refresh = useCallback(async (activeScope: BrainScope) => {
    const [nextStatus, nextGraph, nextCandidates, nextKnowledgeCandidates, nextUnresolved, nextEvents, nextVectorStatus, nextEntities] = await Promise.all([
      api.brainGetStatus(),
      api.brainKnowledgeGraph({ scopeId: activeScope.id }).catch(() => null),
      api.brainListCandidates(activeScope.id),
      api.brainKnowledgeListCandidates({ scopeId: activeScope.id }),
      api.brainKnowledgeListUnresolvedLinks({ scopeId: activeScope.id }),
      api.brainListEvents({ scopeId: activeScope.id, ...weekBounds() }).catch(() => [] as BrainEvent[]),
      api.brainKnowledgeVectorStatus({ scopeId: activeScope.id }).catch(() => null),
      api.brainEntityList({ scopeId: activeScope.id }).catch(() => [] as BrainEntity[]),
    ])
    if (selectedScopeId.current !== activeScope.id) return
    setStatus(nextStatus)
    setGraph(nextGraph)
    setVectorStatus(nextVectorStatus)
    setEntities(nextEntities)
    setCandidates(nextCandidates)
    setKnowledgeCandidates(nextKnowledgeCandidates)
    setUnresolvedLinks(nextUnresolved)
    setEvents(nextEvents)
  }, [])

  useEffect(() => {
    if (!scope) return
    selectedScopeId.current = scope.id
    const reload = () => void refresh(scope).catch(reason => {
      if (selectedScopeId.current === scope.id) setError(reason instanceof Error ? reason.message : String(reason))
    })
    reload()
    const unsubscribe = api.onBrainEvent(reload)
    return () => {
      selectedScopeId.current = null
      unsubscribe()
    }
  }, [refresh, scope])

  // Read once on the way in and written on the way out, so the "new" overlay
  // means "since you last looked" rather than "since this render".
  useEffect(() => {
    void api.storeGet(LAST_VISIT_KEY).then(value => setLastVisit(typeof value === 'string' ? value : null))
    return () => { void api.storeSet(LAST_VISIT_KEY, new Date().toISOString()) }
  }, [])

  useEffect(() => {
    void api.brainGetVaultRoot().then(setKnowledgeVaultRoot)
  }, [])

  const selection = stack.current

  // The spec gives `Esc` to both the drawer and the panels. The drawer owns its
  // own handler, so this one only fires when there is no drawer to close —
  // otherwise one key press would close two things.
  useEffect(() => {
    if (panel === null || selection !== null) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, selection])

  useEffect(() => {
    if (!scope || selection?.kind !== 'document') return
    const request = ++readRequest.current
    const path = selection.path
    void Promise.all([
      api.brainKnowledgeRead({ scopeId: scope.id, path }),
      api.brainKnowledgeNeighbors({ scopeId: scope.id, path, depth: 2 }).catch(() => null),
    ]).then(([document, links]) => {
      if (selectedScopeId.current !== scope.id || request !== readRequest.current) return
      setSelectedDocument(document)
      setNeighborhood(links)
    }).catch(reason => {
      if (selectedScopeId.current === scope.id) setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [scope, selection])

  const select = useCallback((next: Selection) => {
    if (next.kind === 'document') {
      // Clear first: otherwise the previous document lingers under the new
      // title for as long as the read takes.
      setSelectedDocument(null)
      setNeighborhood(null)
    }
    setStack(current => pushSelection(current, next))
  }, [])

  const openPath = useCallback((path: string) => select({ kind: 'document', path }), [select])

  const matches = useMemo(() => (graph ? searchAtlas(graph, query).matches : new Set<string>()), [graph, query])

  // The spec asks for zoom-to-fit on the matches while typing. Doing it per
  // keystroke moves the ground under the typist, so the query settles for a
  // beat first — and a query that matches nothing leaves the camera alone
  // rather than framing an empty box.
  useEffect(() => {
    if (query.trim() === '') return
    const settle = setTimeout(() => { if (matches.size > 0) setFitTo(new Set(matches)) }, 350)
    return () => clearTimeout(settle)
  }, [query, matches])
  const highlighted = useMemo(() => (
    overlay && graph ? overlayPaths(overlay, { graph, since: lastVisit, events }) : null
  ), [overlay, graph, lastVisit, events])

  async function ask(question: string) {
    if (!scope) return
    const request = ++askRequest.current
    setAsking(true)
    setError('')
    try {
      const pack = await api.brainKnowledgeAnswerPack({ scopeId: scope.id, question })
      if (selectedScopeId.current !== scope.id || request !== askRequest.current) return
      setAskPack(pack)
      setStack(current => pushSelection(current, { kind: 'answer', question: pack.question }))
      setFitTo(new Set(pack.sections.map(section => section.path)))
    } catch (reason) {
      if (askRequest.current === request) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (askRequest.current === request) setAsking(false)
    }
  }

  async function chooseVaultFolder() {
    try {
      const chosen = await api.brainChooseVaultFolder()
      if (chosen) setKnowledgeVaultRoot(chosen)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function importVault() {
    if (!scope || !knowledgeVaultRoot || selectedScopeId.current !== scope.id) return
    const request = ++importRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === importRequest.current
    setKnowledgeImporting(true)
    try {
      const report = await api.brainKnowledgeImportVault({ scopeId: scope.id, vaultRoot: knowledgeVaultRoot })
      if (isCurrent()) setKnowledgeImportReport(report)
      await refresh(scope)
    } finally {
      if (isCurrent()) setKnowledgeImporting(false)
    }
  }

  async function loadManifest() {
    if (!scope) return
    const request = ++manifestRequest.current
    const manifest = await api.brainKnowledgeManifest({ scopeId: scope.id })
    if (selectedScopeId.current === scope.id && request === manifestRequest.current) setKnowledgeManifest(manifest)
  }

  async function runCompaction() {
    if (!scope || selectedScopeId.current !== scope.id) return
    const request = ++compactRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === compactRequest.current
    setKnowledgeCompacting(true)
    try {
      const report = await api.brainKnowledgeCompact({ scopeId: scope.id })
      if (isCurrent()) setKnowledgeCompactReport(report)
      await refresh(scope)
    } finally {
      if (isCurrent()) setKnowledgeCompacting(false)
    }
  }

  async function buildVectors() {
    if (!scope) return
    setVectorBuilding(true)
    try {
      const report = await api.brainKnowledgeBuildVectors({ scopeId: scope.id })
      if (selectedScopeId.current === scope.id) setVectorReport(report)
      await refresh(scope)
    } finally {
      if (selectedScopeId.current === scope.id) setVectorBuilding(false)
    }
  }

  async function runEntityBackfill() {
    if (!scope) return
    setEntityBackfilling(true)
    try {
      const report = await api.brainEntityBackfill({ scopeId: scope.id })
      if (selectedScopeId.current === scope.id) setEntityReport(report)
      await refresh(scope)
    } finally {
      if (selectedScopeId.current === scope.id) setEntityBackfilling(false)
    }
  }

  async function runMigration(dryRun: boolean) {
    const request = ++migrateRequest.current
    setMigrating(true)
    try {
      const report = await api.brainKnowledgeMigrateMemories({ dryRun })
      if (request === migrateRequest.current) setMigrateReport(report)
      if (!dryRun && scope) await refresh(scope)
    } finally {
      if (request === migrateRequest.current) setMigrating(false)
    }
  }

  async function createStub(targetPath: string) {
    if (!scope) return
    const path = targetPath.endsWith('.md') ? targetPath : `${targetPath}.md`
    const title = path.replace(/\.md$/, '').split('/').pop() ?? path
    try {
      await api.brainKnowledgeProposeCandidate({
        scopeId: scope.id, targetPath: path, type: 'note', title,
        summary: '', body: `# ${title}\n`, origin: 'explicit-user', sessionRef: 'brain:review',
      })
      await refresh(scope)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const reviewCount = candidates.length + knowledgeCandidates.length

  return (
    <div className="flex h-full flex-col overflow-hidden p-3" style={{ background: '#FAF7F0' }}>
      <header
        className="flex shrink-0 items-center gap-3 rounded-t-xl border-x-2 border-t-2 px-4 py-3"
        style={{ background: '#EBE5D5', borderColor: '#D6CFC0' }}
      >
        <div className="rounded-xl border-2 p-1.5" style={{ background: '#FEF3C7', borderColor: '#F59E0B', color: '#B45309' }}>
          <BrainCircuit size={18} />
        </div>
        <div>
          <h1 className="font-retro-sans text-base font-bold text-stone-800">FlowDesk Brain</h1>
          <p className="font-retro-mono text-[10px] text-stone-500">Local, persistent, cited knowledge</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ScopePicker scopes={scopes} value={scope?.id ?? null} onChange={selectScope} disabled={scopeLoading} />
          <span
            className="font-retro-mono rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={status?.ready
              ? { background: '#D1FAE5', color: '#047857' }
              : { background: '#FEE2E2', color: '#B91C1C' }}
          >
            {status?.ready ? 'Ready · FTS5' : 'Degraded'}
          </span>
        </div>
      </header>

      {(scopeError || error) && (
        <div className="font-retro-mono shrink-0 border-x-2 px-4 py-1.5 text-[11px]" style={{ background: '#FEE2E2', borderColor: '#D6CFC0', color: '#B91C1C' }}>
          {scopeError || error}
        </div>
      )}

      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl border-x-2 border-b-2"
        style={{ borderColor: '#D6CFC0', background: OBSERVATORY.canvas }}
      >
        <Suspense fallback={<div className="font-retro-mono flex h-full items-center justify-center text-xs" style={{ color: OBSERVATORY.dim }}>Atlas load ho raha hai…</div>}>
          <AtlasCanvas
            graph={graph}
            selectedPath={selection?.kind === 'document' ? selection.path : null}
            matches={query.trim() ? matches : null}
            highlighted={highlighted}
            fitTo={fitTo}
            onSelect={openPath}
          />
        </Suspense>

        <div className="pointer-events-none absolute inset-0 flex flex-col p-3">
          <div className="pointer-events-auto flex justify-center">
            <CommandBar
              graph={graph}
              query={query}
              onQueryChange={setQuery}
              onOpen={openPath}
              onAsk={question => void ask(question)}
              asking={asking}
            />
          </div>

          <div className="mt-3 flex min-h-0 flex-1 gap-3">
            {panel && (
              <aside
                aria-label={panel === 'timeline' ? 'Timeline' : panel === 'review' ? 'Review' : 'Health'}
                className="pointer-events-auto w-[380px] shrink-0 overflow-y-auto rounded-xl border p-4"
                style={{ background: OBSERVATORY.raised, borderColor: OBSERVATORY.border, borderLeftColor: OBSERVATORY.accent, borderLeftWidth: 2 }}
              >
                {panel === 'timeline' && <Timeline events={events} onSelect={select} onHighlight={paths => setFitTo(new Set(paths))} />}
                {panel === 'review' && (
                  <Review
                    candidates={candidates}
                    knowledgeCandidates={knowledgeCandidates}
                    unresolvedLinks={unresolvedLinks}
                    onReview={(id, decision) => void api.brainDecideCandidate({ id, decision }).then(() => scope && refresh(scope))}
                    onReviewKnowledge={(id, decision) => void api.brainKnowledgeDecideCandidate({ id, decision }).then(() => scope && refresh(scope))}
                    onCreateStub={path => void createStub(path)}
                    onSelect={select}
                  />
                )}
                {panel === 'health' && (
                  <Health
                    knowledgeVaultRoot={knowledgeVaultRoot}
                    knowledgeImporting={knowledgeImporting}
                    knowledgeImportReport={knowledgeImportReport}
                    knowledgeManifest={knowledgeManifest}
                    knowledgeCompacting={knowledgeCompacting}
                    knowledgeCompactReport={knowledgeCompactReport}
                    migrating={migrating}
                    migrateReport={migrateReport}
                    vectorStatus={vectorStatus}
                    vectorBuilding={vectorBuilding}
                    vectorReport={vectorReport}
                    chooseVaultFolder={() => void chooseVaultFolder()}
                    importVault={() => void importVault()}
                    loadManifest={() => void loadManifest()}
                    runCompaction={() => void runCompaction()}
                    runMigration={dryRun => void runMigration(dryRun)}
                    buildVectors={() => void buildVectors()}
                    entityCount={entities.length}
                    entityBackfilling={entityBackfilling}
                    entityReport={entityReport}
                    runEntityBackfill={() => void runEntityBackfill()}
                  />
                )}
              </aside>
            )}

            <div className="flex-1" />

            <div className="pointer-events-auto">
              <DetailDrawer
                stack={stack}
                onBack={() => setStack(popSelection)}
                onClear={() => setStack(EMPTY_SELECTION)}
                document={selectedDocument}
                neighborhood={neighborhood}
                events={events}
                pack={askPack}
                onSelect={select}
              />
            </div>
          </div>

          <div className="pointer-events-auto mt-3">
            <StatusStrip
              documents={graph?.nodes.length ?? 0}
              links={graph?.edges.length ?? 0}
              review={reviewCount}
              looseEnds={unresolvedLinks.length}
              panel={panel}
              onPanel={setPanel}
              overlay={overlay}
              onOverlay={setOverlay}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
```

`Health` keeps `HealthPanel`'s twenty props exactly, and the code above
already declares every hook, ref and handler that feeds them, copied verbatim
from the `Brain.tsx` this replaces (each carries a stale-response guard that
is easy to lose retyping from memory) -- there is nothing left to move across.

- [ ] **Step 4: Remove the old list surfaces and BRAIN_TABS**

Task 10 created `Timeline.tsx`, `Review.tsx` and `Health.tsx` as new files and
deliberately left the components they replace in place, because deleting them
before this task would break the build: the `Brain.tsx` being replaced here is
the only thing that still imports `AskList`, `LibraryList`, `ReviewList`,
`TodayList`, `Card`, `DocumentRow` and the old `HealthPanel`. Now that this
task's rewrite stops importing all of them, remove them in this commit:

```bash
git rm src/components/brain/lists/AskList.tsx src/components/brain/lists/LibraryList.tsx src/components/brain/lists/ReviewList.tsx src/components/brain/lists/TodayList.tsx src/components/brain/Card.tsx src/components/brain/DocumentRow.tsx src/components/brain/HealthPanel.tsx
```

In `src/lib/brainUi.ts`, delete the `BRAIN_TABS` export and the doc comment above it that describes the five surfaces. Leave `INTELLIGENCE_TABS`, `MONITORABLE_RECIPE_IDS`, `MONITORABLE_RECIPE_CONTROLS` and `INTELLIGENCE_SOURCES` untouched.

In `src/lib/brainUi.test.ts`, delete the `BRAIN_TABS` import and the line asserting its contents. Keep the `INTELLIGENCE_TABS` assertion in the same test.

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npx vitest run src && npm run build`
Expected: PASS. `src/pages/brainScopeIsolation.test.tsx` must pass untouched — it is the proof the rewrite did not weaken scope isolation.

- [ ] **Step 6: Commit**

```bash
git add -A src/pages src/components/brain src/lib/brainUi.ts src/lib/brainUi.test.ts
git commit -m "feat: the Brain page is the map, and the panels float over it"
```

---

### Task 12: Verify against the real store, and record the result

The plan's own honesty check: the design's numbers came from a live profile, so the finished surface is checked against it.

**Files:**
- Modify: `docs/brain-architecture.md` (the Atlas section)

- [ ] **Step 1: Run the app and look at it**

Run: `npm run dev`

Open Brain. With the Global scope selected, confirm each of these against the real store — 163 documents, 755 links, 153 loose ends, 8 orphans:

1. The map opens at a zoom where labels do not overlap.
2. Zooming out reduces to roughly eighteen hubs and shows region names instead of node names.
3. Zooming in brings the smaller nodes and their labels back.
4. `skill` nodes read as the background; `client`, `project` and `me` stand out.
5. Typing `zap` dims the rest of the map and lists matches under the bar.
6. Pressing Enter on a question opens an answer in the drawer.
7. Clicking a node opens the drawer; clicking a neighbour inside it moves the map.
8. Each status pill opens its panel, and pressing it again closes it.
9. The `Orphans` overlay rings 8 nodes.
10. The `Loose ends` pill reads 153.

- [ ] **Step 2: Record what the thresholds turned out to be**

If any zoom threshold or degree floor needed changing in step 1, change it in `BAND_RULES` / `bandForRatio` only, re-run `npx vitest run src/lib/atlasGraph.test.ts`, and update the test's expected values to match. The constants live in one place precisely so this is a one-line tuning pass.

- [ ] **Step 3: Update the architecture doc**

In `docs/brain-architecture.md`, replace the Atlas section's description of the previous behaviour ("It opens **local** — two hops around the selected document — and is never global by default") with the zoom-band behaviour that shipped, and state the palette inversion and the region labels. Keep the licence paragraph about sigma and Cosmograph as it is.

- [ ] **Step 4: Commit**

```bash
git add docs/brain-architecture.md src/lib/atlasGraph.ts src/lib/atlasGraph.test.ts
git commit -m "docs: record how the Atlas reads against the real store"
```

---

## Notes for the executor

- **Do not construct `Sigma` in any test.** If a test needs to know what would be drawn, the answer belongs in a pure function in `src/lib/`, which is where every such decision already lives.
- **`git show HEAD~N:path`** is how you recover code the plan tells you to move — the Health panel's props and handlers in Task 11 especially. Do not retype them from memory.
- **The regression guard is `src/pages/brainScopeIsolation.test.tsx` and the surviving `describe` blocks in `src/pages/Brain.test.tsx`.** They describe behaviour the redesign keeps. If one fails, the rewrite broke something the old surface got right.
- **If the Observatory theme reads badly in Task 12**, the spec's stated fallback is warm paper (`#f6f1e7`), and it is a change to `src/lib/atlasTheme.ts` alone. Say so rather than adjusting individual components.
