# Studio UI Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Studio design section with a document-tab bar, a layers/artboards panel, a tool rail, a sectioned properties panel, and a three-state agent window — all reading and writing one shared node-style model.

**Architecture:** A pure, tested model module (`studioNode.ts`) defines what a node's style *is*. The iframe bridge gains two messages that read and apply that shape. The properties panel is the model's first consumer; the agent's `studio_*` tools become its second, so a panel edit and an agent edit produce identical document HTML. UI is React + Tailwind against FlowDesk's existing CSS variables, with a panel-scoped density scale so instrument-grade controls do not inherit the app's 12–24px radii.

**Tech Stack:** React 18, TypeScript, Tailwind (CSS-variable colours), Vitest, lucide-react icons, Electron IPC via `window.electronAPI`.

**Spec:** `docs/superpowers/specs/2026-09-02-studio-ui-design.md`

## Global Constraints

- Colours come from CSS variables only — `var(--bg)`, `var(--surface)`, `--surface-2`, `--surface-3`, `--border`, `--border-soft`, `--text`, `--text-2`, `--text-3`, `--accent`. **No hard-coded hex in new code.** `src/pages/Studio.tsx` currently hard-codes `#D6CFC0` / `#EBE5D5` / `#FAF7F0`; those are pre-existing and are replaced in Task 9, not by ad-hoc edits elsewhere.
- `--accent` (`#E5A853`) marks exactly three things: active tool, active tab, focused input ring. Nowhere else.
- Panel controls use the panel density scale from Task 1, never `rounded-md`/`rounded-lg`.
- Fonts: `font-sans` (DM Sans) for UI, `font-mono` (JetBrains Mono) for numeric inputs and the agent window. Numeric columns get `tabular-nums`.
- Every new pure module gets a colocated `*.test.ts` run by Vitest.
- The panel never reads the iframe DOM as its source of truth — it reads the model.
- Run tests with `npx vitest run <path>`. Type-check with `npx tsc --noEmit`.

---

### Task 1: Panel density scale and canvas void token

**Files:**
- Modify: `src/index.css` (append after the existing `[data-theme="light"]` block)

**Interfaces:**
- Produces: CSS custom properties `--panel-radius`, `--panel-control-h`, `--panel-label`, `--panel-input`, `--panel-gap`, and `--canvas-void`, plus a `.studio-panel` scope class.

- [ ] **Step 1: Add the tokens**

Append to `src/index.css`:

```css
/* Studio panel density.
   The app's radii (12-24px) are correct for cards and wrong for a column of
   26px-tall inputs, where they read as pills. This scope narrows radius and
   size for instrument controls only, and touches nothing app-wide. */
.studio-panel {
  --panel-radius: 5px;
  --panel-control-h: 26px;
  --panel-label: 11px;
  --panel-input: 12px;
  --panel-gap: 6px;
}

/* The void behind artboards. Artboards are usually white, so --surface makes
   them glare and --bg makes them merge with the app chrome. This value sits
   deliberately between the two. */
:root { --canvas-void: #0C0A09; }
[data-theme="light"] { --canvas-void: #E7E5E4; }
```

- [ ] **Step 2: Verify the app still builds and the tokens resolve**

Run: `npx vite build --config electron.vite.config.ts` is not needed; instead start the app and check in DevTools console:

```js
getComputedStyle(document.documentElement).getPropertyValue('--canvas-void')
```

Expected: `#0C0A09` (dark theme default).

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(studio): panel density scale and canvas void token"
```

---

### Task 2: The shared node-style model

This is the piece everything else consumes. It is pure — no DOM, no React — so it is fully testable and both the panel and the agent tools can depend on it.

**Files:**
- Create: `src/lib/studioNode.ts`
- Test: `src/lib/studioNode.test.ts`

**Interfaces:**
- Produces:
  - `type NodeStyles = Record<string, string>`
  - `interface NodeRef { artboardId: string; elementId: string }`
  - `interface NodeSummary { elementId: string; tag: string; label: string; depth: number; childCount: number }`
  - `const PANEL_PROPERTIES: readonly string[]`
  - `pickPanelStyles(computed: Record<string, string>): NodeStyles`
  - `stylePatch(before: NodeStyles, after: NodeStyles): NodeStyles`
  - `parseLength(input: string): string | null`
  - `formatLength(value: string): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/studioNode.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PANEL_PROPERTIES, pickPanelStyles, stylePatch, parseLength, formatLength } from './studioNode'

describe('pickPanelStyles', () => {
  it('keeps only properties the panel knows how to edit', () => {
    const picked = pickPanelStyles({ width: '100px', 'font-kerning': 'auto', opacity: '0.5' })
    expect(picked).toEqual({ width: '100px', opacity: '0.5' })
  })

  it('returns an empty object rather than throwing on an empty dump', () => {
    expect(pickPanelStyles({})).toEqual({})
  })

  it('lists every panel property exactly once', () => {
    expect(new Set(PANEL_PROPERTIES).size).toBe(PANEL_PROPERTIES.length)
  })
})

describe('stylePatch', () => {
  it('returns only the properties that actually changed', () => {
    const before = { width: '100px', opacity: '1' }
    const after = { width: '120px', opacity: '1' }
    expect(stylePatch(before, after)).toEqual({ width: '120px' })
  })

  it('returns an empty patch when nothing changed, so no write is issued', () => {
    const same = { width: '100px' }
    expect(stylePatch(same, { ...same })).toEqual({})
  })

  it('includes properties that appear only in after', () => {
    expect(stylePatch({}, { opacity: '0.4' })).toEqual({ opacity: '0.4' })
  })
})

describe('parseLength', () => {
  it('accepts a bare number and adds px', () => {
    expect(parseLength('12')).toBe('12px')
  })

  it('preserves an explicit unit', () => {
    expect(parseLength('2rem')).toBe('2rem')
  })

  it('accepts negatives and decimals, which offsets need', () => {
    expect(parseLength('-4.5')).toBe('-4.5px')
  })

  it('rejects nonsense rather than writing it into the document', () => {
    expect(parseLength('abc')).toBeNull()
    expect(parseLength('')).toBeNull()
  })
})

describe('formatLength', () => {
  it('strips px so the input shows a bare number', () => {
    expect(formatLength('12px')).toBe('12')
  })

  it('leaves other units visible', () => {
    expect(formatLength('2rem')).toBe('2rem')
  })

  it('shows an em dash for a missing value', () => {
    expect(formatLength('')).toBe('—')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/studioNode.test.ts`
Expected: FAIL — "Failed to resolve import './studioNode'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/studioNode.ts`:

```ts
/**
 * The shape of a node's style, shared by the properties panel and the agent's
 * studio_* tools. Both must agree byte-for-byte, which is only achievable if
 * they narrow, diff and format through the same functions — so those live
 * here, pure and tested, rather than inside either consumer.
 */

export type NodeStyles = Record<string, string>

export interface NodeRef {
  artboardId: string
  elementId: string
}

export interface NodeSummary {
  elementId: string
  tag: string
  /** Text content or a generated name — what the layer tree shows. */
  label: string
  depth: number
  childCount: number
}

/**
 * A computed style dump has hundreds of entries, almost all of them defaults
 * nobody asked for. Writing all of them back would bloat every document and
 * make two edits to the same node produce different HTML. The panel edits
 * exactly these.
 */
export const PANEL_PROPERTIES = [
  'left', 'top', 'width', 'height', 'rotate',
  'display', 'flex-direction', 'align-items', 'justify-content',
  'gap', 'padding', 'overflow',
  'border-radius',
  'opacity', 'mix-blend-mode',
  'background-color', 'color',
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height',
] as const

const PANEL_SET = new Set<string>(PANEL_PROPERTIES)

export function pickPanelStyles(computed: Record<string, string>): NodeStyles {
  const out: NodeStyles = {}
  for (const key of Object.keys(computed)) {
    if (PANEL_SET.has(key)) out[key] = computed[key]
  }
  return out
}

/**
 * Only changed properties are written. An empty patch means no write at all —
 * which is what keeps a click that changes nothing out of the undo stack.
 */
export function stylePatch(before: NodeStyles, after: NodeStyles): NodeStyles {
  const patch: NodeStyles = {}
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) patch[key] = after[key]
  }
  return patch
}

const NUMERIC = /^-?\d+(\.\d+)?$/
const WITH_UNIT = /^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/

export function parseLength(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (NUMERIC.test(trimmed)) return `${trimmed}px`
  if (WITH_UNIT.test(trimmed)) return trimmed
  return null
}

export function formatLength(value: string): string {
  if (!value) return '—'
  return value.endsWith('px') ? value.slice(0, -2) : value
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/studioNode.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/studioNode.ts src/lib/studioNode.test.ts
git commit -m "feat(studio): shared node-style model"
```

---

### Task 3: Bridge reads and writes node styles

The bridge script already assigns `data-fd-el` ids and reports clicks. It gains two capabilities: report the layer tree, and read/apply styles for one node.

**Files:**
- Modify: `src/lib/studioBridge.ts`
- Test: `src/lib/studioBridge.test.ts` (create if absent)

**Interfaces:**
- Consumes: `NodeStyles`, `NodeSummary`, `PANEL_PROPERTIES` from Task 2.
- Produces: two new `BridgeMessage` variants — `{ type: 'styles'; elementId: string; styles: NodeStyles }` and `{ type: 'tree'; nodes: NodeSummary[] }` — and two commands the host posts *into* the iframe: `{ cmd: 'readStyles'; elementId }` and `{ cmd: 'applyStyles'; elementId; patch }`.

- [ ] **Step 1: Write the failing tests**

Create or extend `src/lib/studioBridge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isBridgeMessage, BRIDGE_SCRIPT } from './studioBridge'

describe('isBridgeMessage', () => {
  it('accepts a styles message', () => {
    expect(isBridgeMessage({ source: 'fd-bridge', type: 'styles', elementId: 'e1', styles: { width: '10px' } })).toBe(true)
  })

  it('accepts a tree message', () => {
    expect(isBridgeMessage({ source: 'fd-bridge', type: 'tree', nodes: [] })).toBe(true)
  })

  it('rejects a message from another frame with no source marker', () => {
    expect(isBridgeMessage({ type: 'styles', elementId: 'e1' })).toBe(false)
  })

  it('rejects an unknown type', () => {
    expect(isBridgeMessage({ source: 'fd-bridge', type: 'evaluate' })).toBe(false)
  })
})

describe('BRIDGE_SCRIPT', () => {
  it('handles both host commands', () => {
    expect(BRIDGE_SCRIPT).toContain('readStyles')
    expect(BRIDGE_SCRIPT).toContain('applyStyles')
  })

  it('reads styles through the shared property list rather than dumping everything', () => {
    expect(BRIDGE_SCRIPT).toContain('FD_PANEL_PROPERTIES')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/studioBridge.test.ts`
Expected: FAIL — the styles/tree cases fail and `BRIDGE_SCRIPT` lacks the strings.

- [ ] **Step 3: Extend the bridge**

In `src/lib/studioBridge.ts`, extend the message union and the script. Add to the `BridgeMessage` union:

```ts
  | { source: 'fd-bridge'; type: 'styles'; elementId: string; styles: Record<string, string> }
  | { source: 'fd-bridge'; type: 'tree'; nodes: Array<{ elementId: string; tag: string; label: string; depth: number; childCount: number }> }
```

Add these cases to `isBridgeMessage`'s accepted `type` values: `'styles'`, `'tree'`.

Append inside `BRIDGE_SCRIPT`, before its closing:

```js
var FD_PANEL_PROPERTIES = ['left','top','width','height','rotate','display','flex-direction','align-items','justify-content','gap','padding','overflow','border-radius','opacity','mix-blend-mode','background-color','color','font-family','font-size','font-weight','letter-spacing','line-height'];

function fdFind(id) { return document.querySelector('[data-fd-el="' + id + '"]'); }

function fdLabel(el) {
  var text = (el.textContent || '').trim().replace(/\s+/g, ' ');
  if (text && text.length <= 40) return text;
  if (text) return text.slice(0, 37) + '…';
  return el.tagName.toLowerCase();
}

function fdTree() {
  var nodes = [];
  var walk = function (el, depth) {
    var kids = Array.prototype.filter.call(el.children, function (c) { return c.hasAttribute('data-fd-el'); });
    nodes.push({
      elementId: el.getAttribute('data-fd-el'),
      tag: el.tagName.toLowerCase(),
      label: fdLabel(el),
      depth: depth,
      childCount: kids.length,
    });
    kids.forEach(function (c) { walk(c, depth + 1); });
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-fd-el]'), function (el) {
    if (!el.parentElement || !el.parentElement.closest('[data-fd-el]')) walk(el, 0);
  });
  parent.postMessage({ source: 'fd-bridge', type: 'tree', nodes: nodes }, '*');
}

window.addEventListener('message', function (ev) {
  var d = ev.data;
  if (!d || typeof d !== 'object') return;

  if (d.cmd === 'readStyles') {
    var el = fdFind(d.elementId);
    if (!el) return;
    var cs = getComputedStyle(el);
    var styles = {};
    FD_PANEL_PROPERTIES.forEach(function (p) { styles[p] = cs.getPropertyValue(p).trim(); });
    parent.postMessage({ source: 'fd-bridge', type: 'styles', elementId: d.elementId, styles: styles }, '*');
  }

  if (d.cmd === 'applyStyles') {
    var target = fdFind(d.elementId);
    if (!target) return;
    Object.keys(d.patch || {}).forEach(function (p) { target.style.setProperty(p, d.patch[p]); });
    // Report back so the panel shows what the document actually accepted,
    // not what was requested — an invalid value silently does nothing.
    var cs2 = getComputedStyle(target);
    var after = {};
    FD_PANEL_PROPERTIES.forEach(function (p) { after[p] = cs2.getPropertyValue(p).trim(); });
    parent.postMessage({ source: 'fd-bridge', type: 'styles', elementId: d.elementId, styles: after }, '*');
  }

  if (d.cmd === 'readTree') fdTree();
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/studioBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/studioBridge.ts src/lib/studioBridge.test.ts
git commit -m "feat(studio): bridge reads and applies node styles"
```

---

### Task 4: `useStudioNode` hook

**Files:**
- Create: `src/hooks/useStudioNode.ts`
- Test: `src/hooks/useStudioNode.test.ts`

**Interfaces:**
- Consumes: `NodeStyles`, `stylePatch` (Task 2); the `styles`/`tree` messages (Task 3).
- Produces: `useStudioNode(iframe: HTMLIFrameElement | null)` returning `{ styles, tree, selected, select, update }` where `update(next: NodeStyles): void` posts only the diff.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStudioNode } from './useStudioNode'

function fakeIframe() {
  const posted: unknown[] = []
  return {
    posted,
    el: { contentWindow: { postMessage: (m: unknown) => { posted.push(m) } } } as unknown as HTMLIFrameElement,
  }
}

describe('useStudioNode', () => {
  it('asks the document for styles when a node is selected', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    expect(f.posted).toContainEqual({ cmd: 'readStyles', elementId: 'e1' })
  })

  it('sends only the changed property, so an unchanged edit writes nothing', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'fd-bridge', type: 'styles', elementId: 'e1', styles: { width: '100px', opacity: '1' } },
      }))
    })
    act(() => { result.current.update({ width: '120px', opacity: '1' }) })
    expect(f.posted).toContainEqual({ cmd: 'applyStyles', elementId: 'e1', patch: { width: '120px' } })
  })

  it('issues no write when nothing changed', () => {
    const f = fakeIframe()
    const { result } = renderHook(() => useStudioNode(f.el))
    act(() => { result.current.select('e1') })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { source: 'fd-bridge', type: 'styles', elementId: 'e1', styles: { width: '100px' } },
      }))
    })
    const before = f.posted.length
    act(() => { result.current.update({ width: '100px' }) })
    expect(f.posted.length).toBe(before)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/hooks/useStudioNode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { useCallback, useEffect, useState } from 'react'
import { isBridgeMessage } from '@/lib/studioBridge'
import { stylePatch, type NodeStyles, type NodeSummary } from '@/lib/studioNode'

/**
 * One selection, one style record, one write path. The panel renders this and
 * the agent's tools write through the same bridge commands, so a value can
 * never mean two different things depending on who asked.
 */
export function useStudioNode(iframe: HTMLIFrameElement | null) {
  const [selected, setSelected] = useState<string | null>(null)
  const [styles, setStyles] = useState<NodeStyles>({})
  const [tree, setTree] = useState<NodeSummary[]>([])

  const post = useCallback((msg: unknown) => {
    iframe?.contentWindow?.postMessage(msg, '*')
  }, [iframe])

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!isBridgeMessage(ev.data)) return
      if (ev.data.type === 'styles') setStyles(ev.data.styles)
      if (ev.data.type === 'tree') setTree(ev.data.nodes)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const select = useCallback((elementId: string | null) => {
    setSelected(elementId)
    setStyles({})
    if (elementId) post({ cmd: 'readStyles', elementId })
  }, [post])

  const update = useCallback((next: NodeStyles) => {
    if (!selected) return
    const patch = stylePatch(styles, next)
    if (Object.keys(patch).length === 0) return
    post({ cmd: 'applyStyles', elementId: selected, patch })
  }, [selected, styles, post])

  const refreshTree = useCallback(() => { post({ cmd: 'readTree' }) }, [post])

  return { selected, styles, tree, select, update, refreshTree }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/hooks/useStudioNode.test.ts`
Expected: PASS, 3 tests.

If `@testing-library/react` is absent: `npm i -D @testing-library/react` first.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStudioNode.ts src/hooks/useStudioNode.test.ts
git commit -m "feat(studio): useStudioNode hook"
```

---

### Task 5: Panel primitives

Shared controls, built once. Every later panel section uses these, so their density is set in one place.

**Files:**
- Create: `src/components/studio/panel/PanelSection.tsx`
- Create: `src/components/studio/panel/NumberField.tsx`
- Create: `src/components/studio/panel/Segmented.tsx`

**Interfaces:**
- Produces:
  - `<PanelSection title={string} defaultOpen?={boolean}>{children}</PanelSection>`
  - `<NumberField label={string} value={string} onCommit={(v: string) => void} />` — commits on blur and Enter, reverts on Escape.
  - `<Segmented options={{value: string; label: string; disabled?: boolean}[]} value={string} onChange={(v: string) => void} />`

- [ ] **Step 1: Write `PanelSection.tsx`**

```tsx
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props { title: string; defaultOpen?: boolean; children: ReactNode }

export default function PanelSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-border-soft">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-t2 hover:text-tx transition-colors"
      >
        <span className="text-[length:var(--panel-label)] font-medium">{title}</span>
        <ChevronDown size={13} className={open ? '' : '-rotate-90'} />
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-[var(--panel-gap)]">{children}</div>}
    </section>
  )
}
```

- [ ] **Step 2: Write `NumberField.tsx`**

```tsx
import { useEffect, useState } from 'react'

interface Props { label: string; value: string; onCommit: (raw: string) => void }

/**
 * Commits on blur and Enter rather than on every keystroke: a keystroke-level
 * write would put every intermediate value into the undo stack, so typing
 * "120" would record 1, 12, then 120.
 */
export default function NumberField({ label, value, onCommit }: Props) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  return (
    <label className="flex items-center gap-1.5 min-w-0">
      <span className="w-3 shrink-0 text-t3 text-[length:var(--panel-label)]">{label}</span>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={e => {
          if (e.key === 'Enter') { onCommit(draft); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
        }}
        className="min-w-0 flex-1 h-[var(--panel-control-h)] rounded-[var(--panel-radius)] bg-s2 border border-border-soft px-2
                   text-[length:var(--panel-input)] font-mono tabular-nums text-tx
                   focus:outline-none focus:border-accent-border focus:ring-1 focus:ring-accent-border transition-colors"
      />
    </label>
  )
}
```

- [ ] **Step 3: Write `Segmented.tsx`**

```tsx
interface Option { value: string; label: string; disabled?: boolean }
interface Props { options: Option[]; value: string; onChange: (v: string) => void }

export default function Segmented({ options, value, onChange }: Props) {
  return (
    <div role="tablist" className="flex gap-0.5 rounded-[var(--panel-radius)] bg-s2 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`flex-1 h-[calc(var(--panel-control-h)-4px)] rounded-[calc(var(--panel-radius)-1px)]
                      text-[length:var(--panel-label)] transition-colors
                      ${value === o.value ? 'bg-s3 text-tx' : 'text-t3 hover:text-t2'}
                      disabled:opacity-40 disabled:cursor-not-allowed`}
          title={o.disabled ? 'Not in this version' : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors from these three files.

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/panel
git commit -m "feat(studio): panel primitives"
```

---

### Task 6: Properties panel

**Files:**
- Create: `src/components/studio/PropertiesPanel.tsx`

**Interfaces:**
- Consumes: `useStudioNode`'s `styles` and `update` (Task 4); the three primitives (Task 5); `formatLength`, `parseLength` (Task 2).
- Produces: `<PropertiesPanel styles={NodeStyles} onUpdate={(next: NodeStyles) => void} hasSelection={boolean} />`

- [ ] **Step 1: Implement**

```tsx
import PanelSection from './panel/PanelSection'
import NumberField from './panel/NumberField'
import Segmented from './panel/Segmented'
import { formatLength, parseLength, type NodeStyles } from '@/lib/studioNode'

interface Props { styles: NodeStyles; onUpdate: (next: NodeStyles) => void; hasSelection: boolean }

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']

export default function PropertiesPanel({ styles, onUpdate, hasSelection }: Props) {
  // A rejected value must not silently vanish, and must not be written either.
  const setLength = (prop: string) => (raw: string) => {
    const parsed = parseLength(raw)
    if (parsed !== null) onUpdate({ ...styles, [prop]: parsed })
  }

  if (!hasSelection) {
    return (
      <div className="studio-panel w-[260px] shrink-0 border-l border-border bg-surface flex items-center justify-center p-6">
        <p className="text-t3 text-xs text-center leading-relaxed">
          Select a layer to edit it.<br />Click on the canvas, or pick one from the tree.
        </p>
      </div>
    )
  }

  return (
    <div className="studio-panel w-[260px] shrink-0 border-l border-border bg-surface overflow-y-auto">
      <PanelSection title="Layout">
        <div className="grid grid-cols-2 gap-[var(--panel-gap)]">
          <NumberField label="X" value={formatLength(styles.left ?? '')} onCommit={setLength('left')} />
          <NumberField label="Y" value={formatLength(styles.top ?? '')} onCommit={setLength('top')} />
          <NumberField label="W" value={formatLength(styles.width ?? '')} onCommit={setLength('width')} />
          <NumberField label="H" value={formatLength(styles.height ?? '')} onCommit={setLength('height')} />
        </div>
      </PanelSection>

      <PanelSection title="Radius">
        <NumberField label="R" value={formatLength(styles['border-radius'] ?? '')} onCommit={setLength('border-radius')} />
      </PanelSection>

      <PanelSection title="Blending">
        <NumberField
          label="%"
          value={String(Math.round(Number(styles.opacity ?? '1') * 100))}
          onCommit={raw => {
            const n = Number(raw)
            if (Number.isFinite(n) && n >= 0 && n <= 100) onUpdate({ ...styles, opacity: String(n / 100) })
          }}
        />
        <select
          value={styles['mix-blend-mode'] ?? 'normal'}
          onChange={e => onUpdate({ ...styles, 'mix-blend-mode': e.target.value })}
          className="h-[var(--panel-control-h)] rounded-[var(--panel-radius)] bg-s2 border border-border-soft px-2
                     text-[length:var(--panel-input)] text-tx focus:outline-none focus:border-accent-border"
        >
          {BLEND_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </PanelSection>

      <PanelSection title="Fill">
        <Segmented
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient', disabled: true },
            { value: 'image', label: 'Image', disabled: true },
          ]}
          value="solid"
          onChange={() => {}}
        />
        <input
          type="color"
          value={toHex(styles['background-color'] ?? '')}
          onChange={e => onUpdate({ ...styles, 'background-color': e.target.value })}
          className="h-[var(--panel-control-h)] w-full rounded-[var(--panel-radius)] bg-s2 border border-border-soft cursor-pointer"
        />
      </PanelSection>
    </div>
  )
}

/** getComputedStyle returns rgb(); <input type="color"> needs #rrggbb. */
function toHex(value: string): string {
  const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return '#000000'
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/studio/PropertiesPanel.tsx
git commit -m "feat(studio): properties panel"
```

---

### Task 7: Left panel — artboards and layers

**Files:**
- Create: `src/components/studio/LayersPanel.tsx`

**Interfaces:**
- Consumes: `NodeSummary` (Task 2); `tree` and `select` from `useStudioNode` (Task 4); `StudioDocumentMeta` from `@/types/electron`.
- Produces: `<LayersPanel artboards={{id: string; name: string}[]} activeArtboard={string | null} onSelectArtboard={(id: string) => void} tree={NodeSummary[]} selected={string | null} onSelectNode={(id: string) => void} />`

- [ ] **Step 1: Implement**

```tsx
import { Square, Layers } from 'lucide-react'
import type { NodeSummary } from '@/lib/studioNode'

interface Props {
  artboards: { id: string; name: string }[]
  activeArtboard: string | null
  onSelectArtboard: (id: string) => void
  tree: NodeSummary[]
  selected: string | null
  onSelectNode: (id: string) => void
}

export default function LayersPanel({ artboards, activeArtboard, onSelectArtboard, tree, selected, onSelectNode }: Props) {
  return (
    <div className="w-[240px] shrink-0 border-r border-border bg-surface flex flex-col overflow-hidden">
      <Group icon={<Square size={12} />} title="Artboards" />
      <ul className="px-1 pb-2">
        {artboards.map(a => (
          <li key={a.id}>
            <button
              onClick={() => onSelectArtboard(a.id)}
              className={`w-full text-left px-2 py-1 rounded-sm text-xs truncate transition-colors
                          ${activeArtboard === a.id ? 'bg-s2 text-tx' : 'text-t2 hover:bg-s2/60'}`}
            >
              {a.name}
            </button>
          </li>
        ))}
      </ul>

      <Group icon={<Layers size={12} />} title="Layers" />
      <ul className="px-1 pb-2 overflow-y-auto flex-1">
        {tree.map(n => (
          <li key={n.elementId}>
            <button
              onClick={() => onSelectNode(n.elementId)}
              style={{ paddingLeft: 8 + n.depth * 12 }}
              className={`w-full text-left pr-2 py-1 rounded-sm text-xs truncate transition-colors
                          ${selected === n.elementId ? 'bg-accent-m text-tx' : 'text-t2 hover:bg-s2/60'}`}
            >
              <span className="text-t3 mr-1.5 font-mono text-[10px]">{n.tag}</span>
              {n.label}
            </button>
          </li>
        ))}
        {tree.length === 0 && <li className="px-2 py-1 text-t3 text-xs">No layers yet.</li>}
      </ul>
    </div>
  )
}

function Group({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5 text-t3">
      {icon}
      <span className="text-[11px] font-medium uppercase tracking-wider">{title}</span>
    </div>
  )
}
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/components/studio/LayersPanel.tsx
git commit -m "feat(studio): artboards and layers panel"
```

---

### Task 8: Tool rail

**Files:**
- Create: `src/components/studio/ToolRail.tsx`

**Interfaces:**
- Produces: `type StudioTool = 'select' | 'pan' | 'frame' | 'rect'` and `<ToolRail tool={StudioTool} onChange={(t: StudioTool) => void} />`

- [ ] **Step 1: Implement**

```tsx
import { MousePointer2, Hand, Frame, Square } from 'lucide-react'

export type StudioTool = 'select' | 'pan' | 'frame' | 'rect'

const TOOLS: { id: StudioTool; icon: typeof Hand; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'pan', icon: Hand, label: 'Pan', key: 'H' },
  { id: 'frame', icon: Frame, label: 'Artboard', key: 'A' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
]

export default function ToolRail({ tool, onChange }: { tool: StudioTool; onChange: (t: StudioTool) => void }) {
  return (
    <div className="w-11 shrink-0 border-r border-border bg-surface flex flex-col items-center gap-1 py-3">
      {TOOLS.map(t => {
        const Icon = t.icon
        const active = tool === t.id
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            title={`${t.label} (${t.key})`}
            aria-pressed={active}
            className={`w-8 h-8 rounded-sm flex items-center justify-center transition-colors
                        ${active ? 'bg-accent-m text-accent ring-1 ring-accent-border' : 'text-t3 hover:text-t2 hover:bg-s2'}`}
          >
            <Icon size={15} />
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Type-check and commit**

```bash
git add src/components/studio/ToolRail.tsx
git commit -m "feat(studio): tool rail"
```

---

### Task 9: Document tabs and shell assembly

Replaces the hard-coded colours in `Studio.tsx` and wires every piece together.

**Files:**
- Create: `src/components/studio/DocumentTabs.tsx`
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: everything from Tasks 4–8.
- Produces: `<DocumentTabs documents={StudioDocumentMeta[]} activeId={string | null} onSelect={(id: string) => void} onClose={(id: string) => void} onNew={() => void} />`

- [ ] **Step 1: Write `DocumentTabs.tsx`**

```tsx
import { X, Plus, FileText } from 'lucide-react'
import type { StudioDocumentMeta } from '@/types/electron'

interface Props {
  documents: StudioDocumentMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export default function DocumentTabs({ documents, activeId, onSelect, onClose, onNew }: Props) {
  return (
    <div className="h-10 shrink-0 flex items-center gap-0.5 px-2 border-b border-border bg-surface overflow-x-auto">
      {documents.map(d => {
        const active = d.id === activeId
        return (
          <div
            key={d.id}
            className={`group flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-sm text-xs cursor-pointer shrink-0 transition-colors
                        ${active ? 'bg-s2 text-tx' : 'text-t3 hover:text-t2 hover:bg-s2/50'}`}
            onClick={() => onSelect(d.id)}
          >
            <FileText size={12} className={active ? 'text-accent' : ''} />
            <span className="max-w-[140px] truncate">{d.name}</span>
            <button
              onClick={e => { e.stopPropagation(); onClose(d.id) }}
              aria-label={`Close ${d.name}`}
              className="w-4 h-4 rounded-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-s3 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
      <button
        onClick={onNew}
        aria-label="New document"
        className="w-7 h-7 shrink-0 rounded-sm flex items-center justify-center text-t3 hover:text-tx hover:bg-s2 transition-colors"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Restructure `StudioCanvas.tsx`'s returned tree**

Replace the component's returned JSX with this shell, keeping every existing hook, effect and handler untouched:

```tsx
  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <DocumentTabs
        documents={documents}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={handleCloseDocument}
        onNew={handleNewDocument}
      />
      <div className="flex flex-1 min-h-0">
        <LayersPanel
          artboards={artboards}
          activeArtboard={activeArtboard}
          onSelectArtboard={setActiveArtboard}
          tree={node.tree}
          selected={node.selected}
          onSelectNode={node.select}
        />
        <ToolRail tool={tool} onChange={setTool} />
        <div
          ref={viewportRef}
          tabIndex={-1}
          style={{ outline: 'none', background: 'var(--canvas-void)' }}
          className="flex-1 relative overflow-hidden"
        >
          {/* existing iframe and zoom controls, unchanged */}
        </div>
        <PropertiesPanel
          styles={node.styles}
          onUpdate={node.update}
          hasSelection={node.selected !== null}
        />
      </div>
      <AgentWindow />
    </div>
  )
```

Add near the other hooks:

```tsx
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const node = useStudioNode(iframeRef.current)
  const [tool, setTool] = useState<StudioTool>('select')
```

Attach `ref={iframeRef}` to the existing iframe. When the iframe reports `sealed`, call `node.refreshTree()` so the layer tree fills as soon as ids exist.

- [ ] **Step 3: Verify in the running app**

Start the app (`npm run dev`), open Studio, and confirm: tabs render one per document; clicking a canvas element highlights the matching row in the layer tree; the Layout section shows that element's real numbers; typing a new W and pressing Enter resizes it.

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/DocumentTabs.tsx src/pages/StudioCanvas.tsx
git commit -m "feat(studio): document tabs and panel shell"
```

---

### Task 10: Agent window — pill, floating, docked

**Files:**
- Create: `src/components/studio/AgentWindow.tsx`
- Test: `src/lib/windowPosition.ts` + `src/lib/windowPosition.test.ts`

**Interfaces:**
- Produces: `type AgentWindowMode = 'pill' | 'floating' | 'docked'`; `clampToViewport(pos, size, viewport)` keeping the title bar reachable.

- [ ] **Step 1: Write the failing test for the pure part**

```ts
import { describe, it, expect } from 'vitest'
import { clampToViewport } from './windowPosition'

describe('clampToViewport', () => {
  it('leaves a window that already fits where it is', () => {
    expect(clampToViewport({ x: 100, y: 100 }, { width: 400, height: 300 }, { width: 1200, height: 800 }))
      .toEqual({ x: 100, y: 100 })
  })

  it('pulls a window back when it is dragged off the right edge', () => {
    expect(clampToViewport({ x: 1100, y: 100 }, { width: 400, height: 300 }, { width: 1200, height: 800 }))
      .toEqual({ x: 800, y: 100 })
  })

  it('never lets the title bar go above the top, which would make it undraggable', () => {
    expect(clampToViewport({ x: 100, y: -50 }, { width: 400, height: 300 }, { width: 1200, height: 800 }))
      .toEqual({ x: 100, y: 0 })
  })

  it('keeps the title bar on screen when the viewport shrinks below the window', () => {
    const r = clampToViewport({ x: 0, y: 700 }, { width: 400, height: 300 }, { width: 1200, height: 800 })
    expect(r.y).toBeLessThanOrEqual(800 - 32)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/windowPosition.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `windowPosition.ts`**

```ts
export interface Point { x: number; y: number }
export interface Box { width: number; height: number }

const TITLE_BAR = 32

/**
 * A window dragged past an edge must stay grabbable. Clamping the whole box
 * inside the viewport is wrong when the viewport is smaller than the window —
 * so the invariant is the title bar, not the body.
 */
export function clampToViewport(pos: Point, size: Box, viewport: Box): Point {
  const maxX = Math.max(0, viewport.width - size.width)
  const maxY = Math.max(0, viewport.height - TITLE_BAR)
  return {
    x: Math.min(Math.max(pos.x, 0), maxX),
    y: Math.min(Math.max(pos.y, 0), maxY),
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/windowPosition.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement `AgentWindow.tsx`**

```tsx
import { useCallback, useRef, useState } from 'react'
import { Terminal, Minus, Maximize2, PanelBottom } from 'lucide-react'
import StudioChat from '@/components/studio/StudioChat'
import { clampToViewport, type Point } from '@/lib/windowPosition'

export type AgentWindowMode = 'pill' | 'floating' | 'docked'

const SIZE = { width: 420, height: 360 }

export default function AgentWindow() {
  const [mode, setMode] = useState<AgentWindowMode>('pill')
  const [pos, setPos] = useState<Point>({ x: 120, y: 120 })
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    setPos(clampToViewport(
      { x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy },
      SIZE,
      { width: window.innerWidth, height: window.innerHeight },
    ))
  }, [])

  const onPointerUp = useCallback(() => { drag.current = null }, [])

  if (mode === 'pill') {
    return (
      <button
        onClick={() => setMode('floating')}
        className="fixed bottom-4 right-4 z-[var(--z-overlay)] flex items-center gap-2 h-9 px-3
                   rounded-full bg-surface border border-border shadow-md
                   text-xs text-t2 hover:text-tx transition-colors"
      >
        <Terminal size={13} className="text-accent" />
        Agent
      </button>
    )
  }

  const docked = mode === 'docked'

  return (
    <div
      style={docked ? undefined : { left: pos.x, top: pos.y, width: SIZE.width, height: SIZE.height }}
      className={docked
        ? 'shrink-0 h-64 border-t border-border bg-surface flex flex-col'
        : 'fixed z-[var(--z-overlay)] rounded-md border border-border bg-surface shadow-lg flex flex-col overflow-hidden'}
    >
      <div
        onPointerDown={docked ? undefined : onPointerDown}
        onPointerMove={docked ? undefined : onPointerMove}
        onPointerUp={docked ? undefined : onPointerUp}
        className={`h-8 shrink-0 flex items-center gap-2 px-3 border-b border-border-soft
                    ${docked ? '' : 'cursor-grab active:cursor-grabbing'}`}
      >
        <Terminal size={12} className="text-accent" />
        <span className="text-[11px] font-mono text-t3 flex-1 truncate">agent</span>
        <button onClick={() => setMode(docked ? 'floating' : 'docked')} aria-label={docked ? 'Float' : 'Dock to bottom'}
                className="w-5 h-5 rounded-xs flex items-center justify-center text-t3 hover:text-tx hover:bg-s2">
          {docked ? <Maximize2 size={11} /> : <PanelBottom size={11} />}
        </button>
        <button onClick={() => setMode('pill')} aria-label="Collapse"
                className="w-5 h-5 rounded-xs flex items-center justify-center text-t3 hover:text-tx hover:bg-s2">
          <Minus size={11} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <StudioChat />
      </div>
    </div>
  )
}
```

Note: when `mode === 'docked'` the window must render as a sibling *after* the canvas row inside `StudioCanvas`'s column, which the Task 9 shell already does.

- [ ] **Step 6: Verify in the running app**

Confirm all three states: the pill sits bottom-right; clicking it opens the floating window; the window drags and cannot be pushed off-screen; the dock button moves it to a full-width strip under the canvas; minimise returns it to a pill.

- [ ] **Step 7: Commit**

```bash
git add src/lib/windowPosition.ts src/lib/windowPosition.test.ts src/components/studio/AgentWindow.tsx
git commit -m "feat(studio): three-state agent window"
```

---

## Self-review

**Spec coverage.** Tabs → Task 9. Two stacked trees → Task 7. Tool rail → Task 8. Sectioned properties panel → Tasks 5–6. Floating agent → Task 10. Density scale → Task 1. Canvas void → Task 1. Shared model → Tasks 2–4. Accent restricted to three uses → Global Constraints, and honoured in Tasks 8 (active tool), 9 (active tab), 5 (focus ring). Deliberate omissions — no avatars, no copy-link, no pen tool, no gradient/image fill — appear as the disabled options in Task 6 and the four-tool rail in Task 8.

**Success criteria.** Criteria 1 and 2 are structural: one `useStudioNode` instance owns selection and writing, and both doors post the same `applyStyles` command. Criterion 4 holds because `PropertiesPanel` receives `styles` as a prop and never touches the iframe.

**Known gap, deliberate:** criterion 3 — the panel reflecting an agent-made change without a manual refresh — needs the agent's `studio_*` tools to route through the same bridge, which is the *next* plan, not this one. Until then a panel showing stale values after an agent edit is expected, not a defect. The Flex section from the screenshot is also deferred; the model already carries its five properties (Task 2), so adding the section later touches only `PropertiesPanel`.

**Type consistency.** `NodeStyles`, `NodeSummary`, `NodeRef` are defined once in Task 2 and imported everywhere. `select` takes `string | null` in Task 4 and Task 7 passes `string` — assignable. `StudioTool` is defined and exported in Task 8, imported in Task 9.
