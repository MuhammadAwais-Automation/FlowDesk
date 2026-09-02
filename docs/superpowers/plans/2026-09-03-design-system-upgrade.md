# Design System Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Studio the typography, effects, fill, stroke and layer control of Figma/Canva/Photoshop, expose every one of them to the agent, and add three agent-native features no manual tool has.

**Architecture:** Pure, tested model modules define each capability (fonts, effects, layers, lint). The properties panel and the agent's `studio_*` tools are both consumers of those same modules, so a panel edit and an agent edit produce identical document HTML. Fonts ship as Fontsource packages injected lazily into both the app and the artboard iframe.

**Tech Stack:** React 18, TypeScript, Tailwind (CSS variables), Vitest, lucide-react, Electron IPC, Fontsource.

**Spec:** `docs/superpowers/specs/2026-09-03-design-system-upgrade.md`

## Global Constraints

- Colours from CSS variables only; panel controls use the `--panel-*` density scale; `--accent` marks only active tool / active tab / focus ring.
- No CDN font loading anywhere. Every family renders offline or it does not ship.
- Every pure module gets a colocated `*.test.ts`. Run `npx vitest run <path>`.
- The project's real gate is `npm run typecheck` (two tsconfig projects), **not** bare `tsc --noEmit`. Both must be clean before any commit.
- Never wrap written HTML in `<![CDATA[ ]]>`.
- The panel never reads the iframe DOM as its source of truth.

---

### Task 1: Font catalogue

**Files:**
- Create: `scripts/build-font-catalogue.mjs`
- Create: `src/lib/fontCatalogue.ts` (generated, committed)
- Create: `src/lib/fontCatalogue.test.ts`
- Modify: `package.json` (fontsource dependencies + `fonts:build` script)

**Interfaces:**
- Produces: `interface FontFamily { id: string; family: string; category: 'display'|'sans'|'serif'|'mono'|'script'|'handwriting'; weights: number[]; variable: boolean; italic: boolean; package: string }`, `FONT_CATALOGUE: readonly FontFamily[]`, `findFont(id: string): FontFamily | undefined`, `searchFonts(query: string, category?: string): FontFamily[]`.

- [ ] **Step 1: Install a curated 100+ family set**

Install Fontsource packages covering every category the reference work needs — condensed
displays (Anton, Oswald, Bebas Neue, Archivo Narrow, Fjalla One, Barlow Condensed,
Teko, Khand), script/swash serifs for the qualifier line (Playfair Display, Cormorant
Garamond, Libre Baskerville, Lora, DM Serif Display, Abril Fatface, Yeseva One), grotesques,
monos, and handwriting faces. Use `@fontsource-variable/<x>` where a variable build exists,
`@fontsource/<x>` otherwise. Aim for at least 100 families.

- [ ] **Step 2: Write the generator**

`scripts/build-font-catalogue.mjs` reads `node_modules/@fontsource*/*/metadata.json`
(Fontsource ships one per package), and emits `src/lib/fontCatalogue.ts` as a typed
constant. Category comes from Fontsource's own `category` field, remapped: `display` and
`handwriting` pass through, `sans-serif`→`sans`, `serif`→`serif`, `monospace`→`mono`.
The script is idempotent and its output is committed so a fresh clone needs no build step.

- [ ] **Step 3: Write the tests**

```ts
import { describe, it, expect } from 'vitest'
import { FONT_CATALOGUE, findFont, searchFonts } from './fontCatalogue'

describe('FONT_CATALOGUE', () => {
  it('ships at least 100 families', () => {
    expect(FONT_CATALOGUE.length).toBeGreaterThanOrEqual(100)
  })
  it('gives every family a unique id', () => {
    expect(new Set(FONT_CATALOGUE.map(f => f.id)).size).toBe(FONT_CATALOGUE.length)
  })
  it('gives every family at least one weight', () => {
    expect(FONT_CATALOGUE.every(f => f.weights.length > 0)).toBe(true)
  })
  it('covers every category the panel offers', () => {
    const categories = new Set(FONT_CATALOGUE.map(f => f.category))
    for (const c of ['display', 'sans', 'serif', 'mono']) expect(categories).toContain(c)
  })
  it('includes the condensed displays the reference posters need', () => {
    const families = FONT_CATALOGUE.map(f => f.family)
    expect(families).toContain('Anton')
    expect(families).toContain('Oswald')
  })
})

describe('searchFonts', () => {
  it('matches on family name, case-insensitively', () => {
    expect(searchFonts('anton').some(f => f.family === 'Anton')).toBe(true)
  })
  it('filters by category when one is given', () => {
    expect(searchFonts('', 'mono').every(f => f.category === 'mono')).toBe(true)
  })
  it('returns an empty list rather than throwing on nonsense', () => {
    expect(searchFonts('zzzznotafont')).toEqual([])
  })
})

describe('findFont', () => {
  it('finds by id', () => {
    expect(findFont(FONT_CATALOGUE[0].id)?.family).toBe(FONT_CATALOGUE[0].family)
  })
  it('returns undefined for an unknown id', () => {
    expect(findFont('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 4: Run, verify, commit**

`npx vitest run src/lib/fontCatalogue.test.ts` → PASS. `npm run typecheck` → clean.

```bash
git add package.json package-lock.json scripts/build-font-catalogue.mjs src/lib/fontCatalogue.ts src/lib/fontCatalogue.test.ts
git commit -m "feat(studio): 100+ font catalogue from Fontsource"
```

---

### Task 2: Lazy font loading

**Files:**
- Create: `src/lib/fontLoader.ts`, `src/lib/fontLoader.test.ts`

**Interfaces:**
- Consumes: `FontFamily`, `findFont` (Task 1).
- Produces: `fontFaceCss(font: FontFamily): string` — the `@font-face` block(s) pointing at the package's latin woff2 files; `loadFontInDocument(font: FontFamily, doc: Document): void` — idempotent injection, keyed by `data-fd-font="<id>"`; `fontFaceCssFor(ids: string[]): string` — one blob for injecting into an artboard iframe or an export.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { fontFaceCss, fontFaceCssFor, loadFontInDocument } from './fontLoader'
import { FONT_CATALOGUE } from './fontCatalogue'

const sample = FONT_CATALOGUE[0]

describe('fontFaceCss', () => {
  it('names the family exactly as the catalogue does', () => {
    expect(fontFaceCss(sample)).toContain(`font-family: '${sample.family}'`)
  })
  it('references a woff2 file, never a remote url', () => {
    const css = fontFaceCss(sample)
    expect(css).toContain('woff2')
    expect(css).not.toContain('https://')
    expect(css).not.toContain('fonts.googleapis.com')
  })
})

describe('fontFaceCssFor', () => {
  it('joins several families into one blob', () => {
    const css = fontFaceCssFor(FONT_CATALOGUE.slice(0, 3).map(f => f.id))
    expect((css.match(/@font-face/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
  it('silently skips ids that do not exist rather than throwing', () => {
    expect(() => fontFaceCssFor(['nope'])).not.toThrow()
  })
})

describe('loadFontInDocument', () => {
  it('injects one style element the first time', () => {
    const doc = document.implementation.createHTMLDocument()
    loadFontInDocument(sample, doc)
    expect(doc.querySelectorAll(`[data-fd-font="${sample.id}"]`)).toHaveLength(1)
  })
  it('is idempotent — a second call adds nothing', () => {
    const doc = document.implementation.createHTMLDocument()
    loadFontInDocument(sample, doc)
    loadFontInDocument(sample, doc)
    expect(doc.querySelectorAll(`[data-fd-font="${sample.id}"]`)).toHaveLength(1)
  })
})
```

First line of the test file must be `// @vitest-environment jsdom`.

- [ ] **Step 2: Implement, run, commit**

Resolve woff2 paths through Vite's `import.meta.glob('/node_modules/@fontsource*/**/latin-*.woff2', { eager: false, query: '?url' })` so the bundler emits them as real assets. Run tests + `npm run typecheck`, then commit.

---

### Task 3: Effects model

**Files:**
- Create: `src/lib/textEffects.ts`, `src/lib/textEffects.test.ts`

**Interfaces:**
- Produces: `type EffectKind = 'none'|'shadow'|'lift'|'hollow'|'splice'|'echo'|'neon'|'glitch'`; `interface EffectParams { kind: EffectKind; offset?: number; direction?: number; blur?: number; intensity?: number; thickness?: number; color?: string }`; `effectToCss(p: EffectParams): { textShadow?: string; webkitTextStroke?: string; color?: string }`; `EFFECT_DEFAULTS: Record<EffectKind, EffectParams>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { effectToCss, EFFECT_DEFAULTS } from './textEffects'

describe('effectToCss', () => {
  it('returns nothing for none, so a cleared effect writes no properties', () => {
    expect(effectToCss({ kind: 'none' })).toEqual({})
  })
  it('places a shadow at the requested angle and distance', () => {
    const css = effectToCss({ kind: 'shadow', offset: 10, direction: 0, blur: 4, color: '#000' })
    expect(css.textShadow).toMatch(/10px 0px 4px/)
  })
  it('hollow leaves the fill transparent and draws a stroke', () => {
    const css = effectToCss({ kind: 'hollow', thickness: 2, color: '#fff' })
    expect(css.color).toBe('transparent')
    expect(css.webkitTextStroke).toBe('2px #fff')
  })
  it('neon stacks several shadows of increasing blur, not one', () => {
    const css = effectToCss({ kind: 'neon', intensity: 60, color: '#0ff' })
    expect((css.textShadow ?? '').split(',').length).toBeGreaterThanOrEqual(3)
  })
  it('echo repeats the text offset at decreasing opacity', () => {
    const css = effectToCss({ kind: 'echo', offset: 8, color: '#f00' })
    expect((css.textShadow ?? '').split(',').length).toBeGreaterThanOrEqual(2)
  })
  it('intensity actually changes the output, so the slider is not decorative', () => {
    const low = effectToCss({ kind: 'neon', intensity: 10, color: '#0ff' })
    const high = effectToCss({ kind: 'neon', intensity: 90, color: '#0ff' })
    expect(low.textShadow).not.toBe(high.textShadow)
  })
})

describe('EFFECT_DEFAULTS', () => {
  it('has an entry for every kind, so selecting one never yields undefined', () => {
    for (const kind of ['none','shadow','lift','hollow','splice','echo','neon','glitch'] as const) {
      expect(EFFECT_DEFAULTS[kind].kind).toBe(kind)
    }
  })
})
```

- [ ] **Step 2: Implement, run, commit.**

---

### Task 4: Layer operations model

**Files:**
- Create: `src/lib/layerOps.ts`, `src/lib/layerOps.test.ts`

**Interfaces:**
- Produces: pure functions over an ordered node list — `moveUp`, `moveDown`, `moveToFront`, `moveToBack`, `reorder(ids, from, to)`, and the command shapes the bridge will execute: `type LayerCommand = { cmd: 'reorder'; elementId: string; beforeId: string | null } | { cmd: 'group'; elementIds: string[] } | { cmd: 'ungroup'; elementId: string } | { cmd: 'setHidden'; elementId: string; hidden: boolean } | { cmd: 'setLocked'; elementId: string; locked: boolean } | { cmd: 'rename'; elementId: string; name: string } | { cmd: 'delete'; elementId: string } | { cmd: 'duplicate'; elementId: string }`.

- [ ] **Step 1: Write tests covering each reorder function including the no-op edges (first item cannot move up, last cannot move down), then implement and commit.**

---

### Task 5: Font picker component

**Files:**
- Create: `src/components/studio/panel/FontPicker.tsx`

Searchable dropdown over `FONT_CATALOGUE`: a text input filtering by family name, category
chips (All / Display / Sans / Serif / Mono / Script / Handwriting), and a virtualised list
where **each row renders its own name in its own face** — the picker calls
`loadFontInDocument` for rows as they scroll into view, which is what makes 100+ families
usable rather than a wall of identical text. Selecting a family reports `{ id, family }`.

Match Canva's affordance: the current family sits in the closed control, search is focused
on open, Escape closes without changing.

- [ ] Implement, typecheck, commit.

---

### Task 6: Typography panel section

**Files:**
- Create: `src/components/studio/panel/TypographySection.tsx`
- Modify: `src/components/studio/PropertiesPanel.tsx`

Family (FontPicker) · weight (select over the family's real weights) · size · letter-spacing ·
line-height · paragraph spacing · alignment (4 buttons) · case (4 buttons) · italic ·
underline/strikethrough · an OpenType row listing the features the selected family declares.

Every control writes through `onUpdate`, never touches the DOM, and commits on blur or
Enter — not per keystroke.

- [ ] Implement, typecheck, commit.

---

### Task 7: Fill, stroke and effects panel sections

**Files:**
- Create: `src/components/studio/panel/FillSection.tsx`, `StrokeSection.tsx`, `EffectsSection.tsx`
- Modify: `PropertiesPanel.tsx`

Fill gains gradient: a Solid/Linear/Radial segmented control, colour stops with positions,
and an angle for linear. Stroke: width, colour, and (for text) `-webkit-text-stroke`.
Effects: the `EffectKind` picker plus the parameters that kind actually uses, driven by
`textEffects.ts` — selecting Neon shows intensity and colour, selecting Shadow shows
offset, direction and blur.

- [ ] Implement, typecheck, commit.

---

### Task 8: Layers panel upgrade

**Files:**
- Modify: `src/components/studio/LayersPanel.tsx`

Per-row: hide (eye), lock (padlock), drag handle for reorder, double-click to rename,
and a disclosure triangle for groups. Panel footer: group, ungroup, duplicate, delete,
move to front/back. Selected row shows opacity and blend inline.

- [ ] Implement, typecheck, commit.

---

### Task 9: Bridge and hook — carry every new property

**Files:**
- Modify: `src/lib/studioBridge.ts`, `src/hooks/useStudioNode.ts`, `src/lib/studioNode.ts`

Extend `PANEL_PROPERTIES` with the typography, stroke, effect and layer properties. Add
bridge commands for the layer operations from Task 4 (`reorder`, `group`, `ungroup`,
`setHidden`, `setLocked`, `rename`, `delete`, `duplicate`), each mutating the iframe DOM and
then posting the owning artboard's HTML back through the existing `sealed` path so the edit
persists and enters undo.

- [ ] Implement with tests for the new message shapes, typecheck, commit.

---

### Task 10: Agent tools — parity with the panel

**Files:**
- Modify: `electron/agent/studioTools.ts`, `electron/studio/designGuide.ts`

New tools: `studio_list_fonts` (searchable catalogue), `studio_set_text_style` (typography
in one call), `studio_set_effect`, `studio_set_fill`, `studio_set_stroke`,
`studio_layer_op` (the Task 4 command union), `studio_get_computed_styles`. Add each to
`STUDIO_TOOL_NAMES` — a tool missing from that list exists but is never enabled.

- [ ] Implement, update the count assertion in `studioTools.test.ts`, typecheck, commit.

---

### Task 11: Design Lint

**Files:**
- Create: `src/lib/designLint.ts`, `src/lib/designLint.test.ts`
- Create: `src/components/studio/LintPanel.tsx`

**Interfaces:**
- Produces: `interface LintFinding { rule: string; severity: 'error'|'warning'; message: string; elementId?: string; fixHint: string }`; `lintArtboard(nodes: LintNode[]): LintFinding[]` where `LintNode` carries the computed styles the bridge already reports.

Rules, taken from the guide so the two cannot disagree: more than two font families;
more than one saturated accent hue; a texture layer under 0.25 opacity; nothing bleeding
off the canvas edge; a hero word under 60% of canvas width.

Each finding renders with a *Fix with agent* button that sends the agent the rule text and
the offending element id.

- [ ] Write the tests first — one per rule, each asserting the finding fires on a violating
  input and stays silent on a clean one, plus a case proving the 0.16-opacity texture from
  the real generated poster is caught. Implement, typecheck, commit.

---

### Task 12: Variant fan-out

**Files:**
- Modify: `electron/agent/studioTools.ts`
- Create: `src/components/studio/VariantBar.tsx`

`studio_create_variants(documentId, artboardId, count, brief)` duplicates the source
artboard N times and returns their ids so the agent can write a different direction into
each. The UI shows a bar above the canvas — *N variants · keep this one · discard others*.

- [ ] Implement, typecheck, commit.

---

### Task 13: Design memory

**Files:**
- Create: `electron/studio/designMemory.ts`, `designMemory.test.ts`
- Modify: `electron/studio/designGuide.ts`, `electron/agent/studioTools.ts`

Record every panel edit that follows an agent write to the same element within a short
window as an *override*: `{ property, agentValue, userValue, at }`, persisted in userData.
`getDesignGuide()` appends a **Learned preferences** section derived from repeated
overrides — three or more of the same shape becomes a stated preference.

- [ ] Write tests for the aggregation (a single override is noise, three is a preference;
  contradictory overrides keep the most recent), implement, typecheck, commit.

---

## Self-review

**Spec coverage.** 100+ fonts → Tasks 1, 2, 5. Typography controls → Task 6. Colour, shadows,
every property → Task 7. Photoshop layering → Tasks 4, 8. Agent tools for any design →
Tasks 9, 10. The three unique features → Tasks 11, 12, 13.

**Ordering.** Every task depends only on ones before it: the models (1–4) precede their UI
(5–8), which precedes the shared bridge (9), which precedes the agent surface (10), which
the three features (11–13) build on.

**Type consistency.** `FontFamily` is defined once in Task 1 and imported by 2, 5, 6, 10.
`EffectParams` in Task 3 is imported by 7 and 10. `LayerCommand` in Task 4 is imported by
8, 9 and 10 — the same union crosses the panel, the bridge and the agent, which is what
keeps the three doors identical.
