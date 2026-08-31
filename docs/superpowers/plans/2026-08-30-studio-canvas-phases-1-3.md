# Studio Canvas Phases 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Studio canvas navigable (pan/zoom around fixed artboards) and make its elements selectable, on a foundation that persists edits and supports undo.

**Architecture:** A React viewport applies a pan/zoom transform to a "world" layer containing the document iframe, which stays at its natural size — artboards never scale internally, so exports keep matching the design's own numbers. Selection chrome is drawn in React above the iframe, never inside it. Element identity and edits are computed inside the iframe using the browser's real HTML parser, then persisted through the existing `replaceArtboardHtml` write path.

**Tech Stack:** TypeScript, React 19, Vitest, Electron IPC.

**Spec:** [docs/superpowers/specs/2026-08-30-studio-design-system-design.md](../specs/2026-08-30-studio-design-system-design.md)

## Global Constraints

- HTML is the source of truth. No parallel scene graph or JSON document model.
- Editor chrome (outlines, handles, guides) must never enter the document — exports re-render the same HTML offscreen via `electron/studio/render.ts`.
- Zoom range is 0.1–4.0 (10%–400%).
- Artboards render at natural size; zoom is applied by the outer world transform only.
- Existing tests must keep passing: `npx vitest run` (687 tests at plan time).
- Typecheck both projects: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.json`.

## Deliberate refinement of the spec

The spec called for a `htmlPatch.ts` module applying structured patches to stored HTML. Implementation makes a better option available, and this plan takes it.

The spec's real requirement was **"never do regex surgery on arbitrary HTML"** — that is the failure mode it was protecting against. Rather than satisfying that by adding an HTML-parser dependency to the main process, this plan performs identity assignment and edits **inside the iframe**, where a correct, battle-tested HTML parser already exists (the browser's own), and then persists the affected artboard's `innerHTML` through `replaceArtboardHtml` — the same tested write path the agent's `studio_write_html` tool already uses.

Consequences, accepted deliberately:
- A save rewrites one artboard's inner HTML, not one attribute. Artboard-sized writes are what the agent already does, and `documentStore.writeDocumentHtml` already serialises per document.
- Undo becomes a snapshot of the artboard's previous inner HTML rather than an inverse patch. Simpler to make correct, and artboard HTML is small.
- No new dependency, and no second HTML parser whose behaviour could disagree with the browser's.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/canvasViewport.ts` *(new)* | Pure pan/zoom maths. No DOM. |
| `src/lib/canvasViewport.test.ts` *(new)* | Tests for the above. |
| `src/lib/studioBridge.ts` *(new)* | The injected iframe script source + the message types crossing that boundary. |
| `src/lib/editHistory.ts` *(new)* | Pure undo/redo stack over artboard snapshots. |
| `src/lib/editHistory.test.ts` *(new)* | Tests for the above. |
| `src/pages/StudioCanvas.tsx` *(modify)* | Viewport shell, input handling, selection overlay. |
| `electron/main.ts` *(modify)* | `studio:writeArtboardHtml` IPC handler. |
| `electron/preload.ts` *(modify)* | `studioWriteArtboardHtml` binding. |
| `src/types/electron.d.ts` *(modify)* | Type for the new binding. |

---

## Task 1: Viewport maths

**Files:**
- Create: `src/lib/canvasViewport.ts`
- Test: `src/lib/canvasViewport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ViewportState { panX: number; panY: number; zoom: number }`, `Size { width: number; height: number }`, `MIN_ZOOM`, `MAX_ZOOM`, `clampZoom(zoom: number): number`, `zoomAt(state: ViewportState, factor: number, cursorX: number, cursorY: number): ViewportState`, `panBy(state: ViewportState, dx: number, dy: number): ViewportState`, `fitToViewport(content: Size, viewport: Size, padding?: number): ViewportState`, `screenToWorld(state: ViewportState, x: number, y: number): { x: number; y: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/canvasViewport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  clampZoom, zoomAt, panBy, fitToViewport, screenToWorld,
  MIN_ZOOM, MAX_ZOOM, type ViewportState,
} from './canvasViewport'

const IDENTITY: ViewportState = { panX: 0, panY: 0, zoom: 1 }

describe('clampZoom', () => {
  it('holds zoom inside the usable range', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(1.5)).toBe(1.5)
  })
})

describe('zoomAt', () => {
  // The whole point of zoom-at-cursor: whatever the pointer is over must not
  // move. Zooming about the viewport centre instead is what makes a canvas
  // feel like it is fighting you.
  it('keeps the world point under the cursor fixed', () => {
    const before = screenToWorld(IDENTITY, 300, 200)
    const next = zoomAt(IDENTITY, 2, 300, 200)
    const after = screenToWorld(next, 300, 200)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('holds the anchor even when already panned and zoomed', () => {
    const state: ViewportState = { panX: -140, panY: 62, zoom: 0.75 }
    const before = screenToWorld(state, 410, 315)
    const next = zoomAt(state, 1.25, 410, 315)
    const after = screenToWorld(next, 410, 315)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('returns the same state when already clamped, so the anchor cannot drift', () => {
    const state: ViewportState = { panX: 10, panY: 20, zoom: MAX_ZOOM }
    expect(zoomAt(state, 2, 100, 100)).toEqual(state)
  })
})

describe('panBy', () => {
  it('moves the world without touching zoom', () => {
    expect(panBy({ panX: 5, panY: 5, zoom: 2 }, 10, -3))
      .toEqual({ panX: 15, panY: 2, zoom: 2 })
  })
})

describe('fitToViewport', () => {
  it('scales content down to fit and centres it', () => {
    const state = fitToViewport({ width: 1000, height: 500 }, { width: 600, height: 600 }, 50)
    expect(state.zoom).toBeCloseTo(0.5, 6)
    expect(state.panX).toBeCloseTo(50, 6)
    expect(state.panY).toBeCloseTo(175, 6)
  })

  it('never exceeds the zoom ceiling for tiny content', () => {
    const state = fitToViewport({ width: 2, height: 2 }, { width: 1000, height: 1000 }, 0)
    expect(state.zoom).toBeLessThanOrEqual(MAX_ZOOM)
  })

  // An empty document must not produce NaN and blank the canvas.
  it('falls back to identity for empty content', () => {
    expect(fitToViewport({ width: 0, height: 0 }, { width: 800, height: 600 }))
      .toEqual({ panX: 0, panY: 0, zoom: 1 })
  })

  it('survives a viewport smaller than its own padding', () => {
    const state = fitToViewport({ width: 100, height: 100 }, { width: 10, height: 10 }, 48)
    expect(Number.isFinite(state.zoom)).toBe(true)
    expect(state.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/canvasViewport.test.ts`
Expected: FAIL — cannot resolve `./canvasViewport`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/canvasViewport.ts`:

```ts
/**
 * Pan/zoom maths for the Studio canvas, kept free of React and the DOM.
 *
 * This lives apart from the component because it is the part where a subtle
 * error is invisible: zoom that drifts by a few pixels per step reads as "the
 * canvas feels wrong" rather than as a bug, and is near-impossible to pin down
 * by clicking. Here it is pinned by tests instead.
 */

export interface ViewportState {
  /** Screen-space offset of the world's origin. */
  panX: number
  panY: number
  zoom: number
}

export interface Size {
  width: number
  height: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Screen coordinates (relative to the viewport box) to world coordinates. */
export function screenToWorld(state: ViewportState, x: number, y: number): { x: number; y: number } {
  return { x: (x - state.panX) / state.zoom, y: (y - state.panY) / state.zoom }
}

/**
 * Zooms by `factor` while holding the world point under (cursorX, cursorY)
 * still — the property the tests pin, and the one users feel.
 *
 * Returns the identical state when the zoom is already clamped, so a user
 * holding a wheel at the limit does not slowly slide the canvas away.
 */
export function zoomAt(state: ViewportState, factor: number, cursorX: number, cursorY: number): ViewportState {
  const zoom = clampZoom(state.zoom * factor)
  if (zoom === state.zoom) return state
  const world = screenToWorld(state, cursorX, cursorY)
  return { zoom, panX: cursorX - world.x * zoom, panY: cursorY - world.y * zoom }
}

export function panBy(state: ViewportState, dx: number, dy: number): ViewportState {
  return { ...state, panX: state.panX + dx, panY: state.panY + dy }
}

/** Zoom-to-fit with the content centred in the viewport. */
export function fitToViewport(content: Size, viewport: Size, padding = 48): ViewportState {
  if (content.width <= 0 || content.height <= 0) return { panX: 0, panY: 0, zoom: 1 }
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  const zoom = clampZoom(Math.min(availableWidth / content.width, availableHeight / content.height))
  return {
    zoom,
    panX: (viewport.width - content.width * zoom) / 2,
    panY: (viewport.height - content.height * zoom) / 2,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/canvasViewport.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvasViewport.ts src/lib/canvasViewport.test.ts
git commit -m "feat: add pure pan/zoom maths for the Studio canvas"
```

---

## Task 2: Viewport shell — world transform and iframe sizing

Replaces the fit-to-panel scaling with a world layer the later tasks transform. After this task the canvas shows artboards at natural size inside a measured world; input handling arrives in Tasks 3–4.

**Files:**
- Modify: `src/pages/StudioCanvas.tsx`
- Create: `src/lib/studioBridge.ts`

**Interfaces:**
- Consumes: `ViewportState`, `fitToViewport` from Task 1.
- Produces: `BRIDGE_SCRIPT: string`, `type BridgeMessage = { __fdCanvas: 'bounds'; width: number; height: number }` from `src/lib/studioBridge.ts`.

- [ ] **Step 1: Create the bridge module**

Create `src/lib/studioBridge.ts`:

```ts
/**
 * The script injected into the Studio document iframe, and the message shapes
 * that cross that boundary.
 *
 * It is a string rather than a module because it executes in the iframe's own
 * realm, not the app's. Everything it sends is namespaced under `__fdCanvas`
 * so the canvas can ignore postMessage traffic from anything else.
 */

export type BridgeMessage = {
  __fdCanvas: 'bounds'
  width: number
  height: number
}

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return typeof data === 'object' && data !== null && '__fdCanvas' in data
}

/**
 * Reports the document's natural size so the host can size the iframe to it.
 *
 * Measured from the artboards' declared `data-fd-w`/`data-fd-h` rather than
 * from laid-out geometry: the declared numbers are what export uses, and they
 * are correct immediately, before fonts or images settle. Re-reported on load
 * and on fonts-ready anyway, since an artboard whose height is `auto` in some
 * future document would only be measurable then.
 */
export const BRIDGE_SCRIPT = `
(function () {
  var MARGIN = 24;
  function report() {
    var boards = document.querySelectorAll('.fd-artboard');
    var width = 0;
    var height = MARGIN;
    for (var i = 0; i < boards.length; i++) {
      var el = boards[i];
      var w = Number(el.getAttribute('data-fd-w')) || el.offsetWidth || 0;
      var h = Number(el.getAttribute('data-fd-h')) || el.offsetHeight || 0;
      if (w > width) width = w;
      height += h + MARGIN;
    }
    parent.postMessage({
      __fdCanvas: 'bounds',
      width: width + MARGIN * 2,
      height: height,
    }, '*');
  }
  report();
  window.addEventListener('load', report);
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(report); }
})();
`
```

- [ ] **Step 2: Rewrite the canvas surface**

In `src/pages/StudioCanvas.tsx`:

Delete the `FIT_SCRIPT` constant entirely (lines 14–35) — artboards must no longer scale themselves.

Replace the imports at the top:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, FileText, Image as ImageIcon, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import StudioChat from '@/components/studio/StudioChat'
import { BRIDGE_SCRIPT, isBridgeMessage } from '@/lib/studioBridge'
import { fitToViewport, type Size, type ViewportState } from '@/lib/canvasViewport'
import type { StudioDocumentMeta } from '@/types/electron'
```

Replace the `const [zoom, setZoom] = useState(1)` line with:

```tsx
  const [view, setView] = useState<ViewportState>({ panX: 0, panY: 0, zoom: 1 })
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
```

Add, after the existing effects:

```tsx
  // The document reports its own natural size; the iframe is sized to it so
  // the world layer can transform a box that exactly contains the artboards.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event.data) || event.data.__fdCanvas !== 'bounds') return
      setBounds({ width: event.data.width, height: event.data.height })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const fit = useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect()
    if (!box) return
    setView(fitToViewport(bounds, { width: box.width, height: box.height }))
  }, [bounds])

  // Fit once per document, when its size first becomes known — not on every
  // bounds report, or the user's own zoom would be undone mid-session.
  const fittedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!activeId || bounds.width === 0) return
    if (fittedFor.current === activeId) return
    fittedFor.current = activeId
    fit()
  }, [activeId, bounds, fit])
```

Replace the `framedHtml` line with:

```tsx
  const framedHtml = useMemo(
    () => (html ? html.replace('</body>', `<script>${BRIDGE_SCRIPT}</script></body>`) : ''),
    [html],
  )
```

Replace the whole canvas surface `<div className="flex-1 min-h-0 bg-[#e9e6df]">…</div>` block with:

```tsx
        <div
          ref={viewportRef}
          className="flex-1 min-h-0 relative overflow-hidden bg-[#e9e6df]"
        >
          {framedHtml ? (
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{
                transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                width: bounds.width || 1,
                height: bounds.height || 1,
              }}
            >
              <iframe
                title="Studio canvas"
                srcDoc={framedHtml}
                sandbox="allow-same-origin allow-scripts"
                className="border-0 block"
                style={{ width: bounds.width || 1, height: bounds.height || 1 }}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="font-retro-mono text-xs text-stone-500">
                Select or create a document, then ask the agent to design it.
              </p>
            </div>
          )}
        </div>
```

Replace the two zoom buttons and the percentage readout in the toolbar with:

```tsx
          <button onClick={() => setView(v => ({ ...v, zoom: Math.max(0.1, v.zoom - 0.25) }))} title="Zoom out"><ZoomOut size={14} /></button>
          <span className="font-retro-mono text-[11px] text-stone-600 w-10 text-center">{Math.round(view.zoom * 100)}%</span>
          <button onClick={() => setView(v => ({ ...v, zoom: Math.min(4, v.zoom + 0.25) }))} title="Zoom in"><ZoomIn size={14} /></button>
          <button onClick={fit} title="Fit to screen"><Maximize2 size={14} /></button>
          <button
            onClick={() => setView(v => ({ ...v, zoom: 1 }))}
            title="Actual size"
            className="font-retro-mono text-[11px] font-bold text-stone-700 px-1"
          >
            1:1
          </button>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Verify in the running app**

Start the app if it is not running (`npm run dev`), open Studio, and select a document that has at least one artboard. Expected: the artboard appears at a fitted zoom, centred, with the percentage readout matching. Fit and 1:1 both change the view.

If the canvas is blank, check the DevTools console for the `bounds` message — a document with zero artboards legitimately reports `width: 48`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/studioBridge.ts src/pages/StudioCanvas.tsx
git commit -m "feat: render Studio artboards at natural size in a transformable world"
```

---

## Task 3: Pan

**Files:**
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `panBy` from Task 1; `viewportRef`, `setView` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Add pan state and handlers**

Add `panBy` to the `canvasViewport` import.

Add after the `fit` callback:

```tsx
  // Space-to-pan is modal, so the held state has to live outside React's
  // event flow: the key can be pressed while focus is anywhere in the page.
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panning = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement | null
      // Never steal the spacebar from someone typing — the chat panel sits
      // in the same page.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false) }
    // A lost blur (alt-tab mid-drag) would otherwise leave the canvas stuck
    // in pan mode with no way back except pressing space again.
    const blur = () => { setSpaceHeld(false); panning.current = null }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    const isPan = spaceHeld || e.button === 1
    if (!isPan) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    panning.current = { x: e.clientX, y: e.clientY }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const from = panning.current
    if (!from) return
    panning.current = { x: e.clientX, y: e.clientY }
    setView(v => panBy(v, e.clientX - from.x, e.clientY - from.y))
  }

  const endPan = (e: React.PointerEvent) => {
    if (!panning.current) return
    panning.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
```

- [ ] **Step 2: Attach to the viewport**

On the viewport `<div ref={viewportRef}>`, add:

```tsx
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          style={{ cursor: panning.current ? 'grabbing' : spaceHeld ? 'grab' : 'default' }}
```

On the **world** `<div>` add, so the iframe cannot swallow the drag mid-pan:

```tsx
              // An iframe consumes pointer events in its own document, which
              // would end the drag the moment the cursor crossed an artboard.
              pointerEvents: spaceHeld ? 'none' : 'auto',
```

placed inside its existing `style={{ … }}` object.

- [ ] **Step 3: Add wheel panning**

Add to the same viewport div:

```tsx
          onWheel={e => {
            if (e.ctrlKey || e.metaKey) return // zoom, added in Task 4
            setView(v => panBy(v, e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY))
          }}
```

- [ ] **Step 4: Typecheck and verify**

Run: `npx tsc --noEmit -p tsconfig.json` — expect exit 0.

In the app: hold Space (cursor becomes a grab hand), drag — the artboard moves with the pointer and keeps moving while crossing over the artboard itself. Middle-mouse drag pans without Space. Wheel scrolls vertically, Shift+wheel horizontally. Typing a space in the chat box still types a space.

- [ ] **Step 5: Commit**

```bash
git add src/pages/StudioCanvas.tsx
git commit -m "feat: pan the Studio canvas with space-drag, middle-drag, and the wheel"
```

---

## Task 4: Zoom at cursor

**Files:**
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `zoomAt` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Handle ctrl/cmd + wheel**

Add `zoomAt` to the `canvasViewport` import. Replace the `onWheel` handler from Task 3 with:

```tsx
          onWheel={e => {
            if (e.ctrlKey || e.metaKey) {
              const box = viewportRef.current?.getBoundingClientRect()
              if (!box) return
              // Exponential so each wheel notch is the same proportional step
              // whether zoomed far in or far out; a linear delta feels fast at
              // 400% and glacial at 10%.
              const factor = Math.exp(-e.deltaY * 0.002)
              setView(v => zoomAt(v, factor, e.clientX - box.left, e.clientY - box.top))
              return
            }
            setView(v => panBy(v, e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY))
          }}
```

- [ ] **Step 2: Stop the page zooming instead of the canvas**

Chromium treats ctrl+wheel as browser zoom; React's synthetic `onWheel` listener is passive, so `preventDefault()` there is ignored. Register a non-passive listener on the viewport. Add after the pan effect:

```tsx
  // React attaches wheel listeners passively, so preventDefault inside
  // onWheel silently does nothing and ctrl+wheel zooms the whole app instead
  // of the canvas. This listener exists only to cancel that default.
  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    node.addEventListener('wheel', block, { passive: false })
    return () => node.removeEventListener('wheel', block)
  }, [])
```

- [ ] **Step 3: Typecheck and verify**

Run: `npx tsc --noEmit -p tsconfig.json` — expect exit 0.

In the app: point at a corner of an artboard and Ctrl+wheel. **That corner must stay under the cursor** — this is the behaviour Task 1's tests pin, verified here end to end. The app's own UI must not zoom. The readout tracks, and stops at 10% and 400%.

- [ ] **Step 4: Commit**

```bash
git add src/pages/StudioCanvas.tsx
git commit -m "feat: zoom the Studio canvas at the cursor with ctrl/cmd+wheel"
```

---

## Task 5: Element identity and hit-testing in the bridge

Gives every element inside an artboard a stable `data-fd-el` id, assigned using the iframe's real HTML parser, and reports what was clicked.

**Files:**
- Modify: `src/lib/studioBridge.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: extended `BridgeMessage` union —
  `{ __fdCanvas: 'bounds'; width: number; height: number }`
  `| { __fdCanvas: 'sealed'; artboardId: string; html: string }`
  `| { __fdCanvas: 'selected'; artboardId: string; elementId: string; tag: string; rect: { x: number; y: number; width: number; height: number } }`
  `| { __fdCanvas: 'cleared' }`

- [ ] **Step 1: Extend the message types**

Replace the `BridgeMessage` type in `src/lib/studioBridge.ts` with:

```ts
export interface BridgeRect { x: number; y: number; width: number; height: number }

export type BridgeMessage =
  | { __fdCanvas: 'bounds'; width: number; height: number }
  /** Ids were assigned to previously unidentified elements; persist this artboard. */
  | { __fdCanvas: 'sealed'; artboardId: string; html: string }
  | { __fdCanvas: 'selected'; artboardId: string; elementId: string; tag: string; rect: BridgeRect }
  | { __fdCanvas: 'cleared' }
```

- [ ] **Step 2: Add sealing and hit-testing to the injected script**

Append inside the `BRIDGE_SCRIPT` IIFE, immediately before its closing `})();`:

```js
  // Identity is assigned here, inside the iframe, because this realm has a
  // real HTML parser. Doing it with regex over stored HTML is how this
  // feature would rot: the first attribute containing a quote or a '>'
  // produces silently corrupt markup.
  //
  // Ids must not be positional — a path like ':nth-child(3)' retargets the
  // moment the agent inserts a sibling, which it does constantly.
  var counter = 0;
  function seal() {
    var boards = document.querySelectorAll('.fd-artboard');
    for (var i = 0; i < boards.length; i++) {
      var board = boards[i];
      var added = 0;
      var nodes = board.querySelectorAll('*');
      for (var j = 0; j < nodes.length; j++) {
        if (!nodes[j].hasAttribute('data-fd-el')) {
          counter++;
          nodes[j].setAttribute('data-fd-el', 'e' + Date.now().toString(36) + counter.toString(36));
          added++;
        }
      }
      if (added > 0) {
        parent.postMessage({
          __fdCanvas: 'sealed',
          artboardId: board.getAttribute('data-fd-id'),
          html: board.innerHTML,
        }, '*');
      }
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body && !el.hasAttribute('data-fd-el')) el = el.parentElement;
    if (!el || el === document.body) {
      parent.postMessage({ __fdCanvas: 'cleared' }, '*');
      return;
    }
    var board = el.closest('.fd-artboard');
    if (!board) { parent.postMessage({ __fdCanvas: 'cleared' }, '*'); return; }
    var r = el.getBoundingClientRect();
    parent.postMessage({
      __fdCanvas: 'selected',
      artboardId: board.getAttribute('data-fd-id'),
      elementId: el.getAttribute('data-fd-el'),
      tag: el.tagName.toLowerCase(),
      // Page coordinates, so the host can place its overlay in world space
      // without knowing anything about scroll inside the frame.
      rect: { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height },
    }, '*');
  });

  seal();
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/studioBridge.ts
git commit -m "feat: assign stable element ids and report clicks from the Studio document"
```

---

## Task 6: Persist an artboard's HTML

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- Consumes: `studioStore.readDocumentHtml`, `studioStore.writeDocumentHtml`, `replaceArtboardHtml` from `electron/studio/artboards.ts`, `asStudioDocumentId` (already in `main.ts`).
- Produces: `window.electronAPI.studioWriteArtboardHtml(documentId: string, artboardId: string, html: string): Promise<void>`.

- [ ] **Step 1: Add the IPC handler**

In `electron/main.ts`, add `replaceArtboardHtml` to the existing import from `./studio/artboards` (add the import if the file has none), then add beside the other `studio:` handlers (near line 1348):

```ts
// The canvas edits inside the iframe, where a real HTML parser lives, and
// sends back the affected artboard's inner HTML. Persisting goes through
// replaceArtboardHtml — the same path the agent's studio_write_html tool
// uses — so a user edit and an agent edit cannot produce different files.
ipcMain.handle('studio:writeArtboardHtml', async (_e, documentId: unknown, artboardId: unknown, html: unknown) => {
  const id = asStudioDocumentId(documentId)
  if (typeof artboardId !== 'string' || !artboardId) throw new Error('An artboard id is required.')
  if (typeof html !== 'string') throw new Error('Artboard HTML must be a string.')
  const current = await studioStore.readDocumentHtml(id)
  if (current === null) throw new Error(`No Studio document "${id}".`)
  await studioStore.writeDocumentHtml(id, replaceArtboardHtml(current, artboardId, html))
})
```

- [ ] **Step 2: Add the preload binding**

In `electron/preload.ts`, after `studioExportPdf` (line 179):

```ts
  studioWriteArtboardHtml: (documentId: string, artboardId: string, html: string) =>
    ipcRenderer.invoke('studio:writeArtboardHtml', documentId, artboardId, html),
```

- [ ] **Step 3: Add the type**

In `src/types/electron.d.ts`, beside the other `studio*` members:

```ts
  studioWriteArtboardHtml: (documentId: string, artboardId: string, html: string) => Promise<void>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json` then `npx tsc --noEmit -p tsconfig.json`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/types/electron.d.ts
git commit -m "feat: add IPC to persist one artboard's HTML from the canvas"
```

---

## Task 7: Selection overlay

**Files:**
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `BridgeMessage` from Task 5; `studioWriteArtboardHtml` from Task 6.
- Produces: `selection` state consumed by Task 9.

- [ ] **Step 1: Hold the selection and persist sealed ids**

Add to the state block:

```tsx
  const [selection, setSelection] = useState<
    { artboardId: string; elementId: string; tag: string; rect: { x: number; y: number; width: number; height: number } } | null
  >(null)
```

Extend the message effect from Task 2 to handle the new kinds:

```tsx
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event.data)) return
      const msg = event.data
      if (msg.__fdCanvas === 'bounds') { setBounds({ width: msg.width, height: msg.height }); return }
      if (msg.__fdCanvas === 'selected') { setSelection({ artboardId: msg.artboardId, elementId: msg.elementId, tag: msg.tag, rect: msg.rect }); return }
      if (msg.__fdCanvas === 'cleared') { setSelection(null); return }
      if (msg.__fdCanvas === 'sealed' && activeId) {
        // Ids are assigned once and written straight back, so a selection
        // made now still refers to the same element after a reload.
        void api.studioWriteArtboardHtml(activeId, msg.artboardId, msg.html)
      }
    }
```

and change that effect's dependency array to `[activeId, api]`.

- [ ] **Step 2: Draw the outline**

Inside the world `<div>`, immediately after the `<iframe>`:

```tsx
              {selection && (
                <div
                  className="absolute pointer-events-none border-2 border-[#D97706]"
                  style={{
                    left: selection.rect.x,
                    top: selection.rect.y,
                    width: selection.rect.width,
                    height: selection.rect.height,
                    // Drawn in world space but kept one screen pixel thick at
                    // any zoom — a scaled border reads as blur at 400% and
                    // vanishes at 10%.
                    borderWidth: 1 / view.zoom,
                  }}
                />
              )}
```

- [ ] **Step 3: Clear selection when the document changes**

Add to the effect that loads `html`:

```tsx
    setSelection(null)
```

- [ ] **Step 4: Show what is selected**

In the toolbar, before the zoom controls:

```tsx
          {selection && (
            <span className="font-retro-mono text-[10px] text-stone-500 truncate max-w-[160px]">
              &lt;{selection.tag}&gt; {selection.elementId}
            </span>
          )}
```

- [ ] **Step 5: Typecheck and verify**

Run: `npx tsc --noEmit -p tsconfig.json` — expect exit 0.

In the app: click an element inside an artboard. An outline appears exactly around it and the toolbar names it. Clicking blank space clears it. Zoom in and out — the outline stays one pixel thick and stays aligned. Reload the document: clicking the same element reports the **same** `elementId`, proving the ids were persisted.

- [ ] **Step 6: Commit**

```bash
git add src/pages/StudioCanvas.tsx
git commit -m "feat: select elements on the Studio canvas with an overlay outline"
```

---

## Task 8: Undo/redo stack

**Files:**
- Create: `src/lib/editHistory.ts`
- Test: `src/lib/editHistory.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EditEntry { artboardId: string; before: string; after: string }`, `History { past: EditEntry[]; future: EditEntry[] }`, `emptyHistory(): History`, `record(history: History, entry: EditEntry): History`, `undo(history: History): { history: History; entry: EditEntry } | null`, `redo(history: History): { history: History; entry: EditEntry } | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/editHistory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { emptyHistory, record, undo, redo, type EditEntry } from './editHistory'

const A: EditEntry = { artboardId: 'a1', before: '<p>0</p>', after: '<p>1</p>' }
const B: EditEntry = { artboardId: 'a1', before: '<p>1</p>', after: '<p>2</p>' }

describe('editHistory', () => {
  it('has nothing to undo when empty', () => {
    expect(undo(emptyHistory())).toBeNull()
    expect(redo(emptyHistory())).toBeNull()
  })

  it('undoes the most recent edit first', () => {
    const history = record(record(emptyHistory(), A), B)
    const step = undo(history)
    expect(step?.entry).toEqual(B)
    expect(undo(step!.history)?.entry).toEqual(A)
  })

  it('redoes what was undone, in order', () => {
    const history = record(record(emptyHistory(), A), B)
    const undone = undo(history)!
    const step = redo(undone.history)
    expect(step?.entry).toEqual(B)
    expect(redo(step!.history)).toBeNull()
  })

  // Otherwise a redo after new work would resurrect an edit that no longer
  // has anything to apply to, silently reverting the user's newest change.
  it('drops the redo branch once a new edit is recorded', () => {
    const history = record(record(emptyHistory(), A), B)
    const undone = undo(history)!
    const next = record(undone.history, { artboardId: 'a1', before: '<p>1</p>', after: '<p>9</p>' })
    expect(redo(next)).toBeNull()
  })

  it('does not mutate the history it is given', () => {
    const history = record(emptyHistory(), A)
    const snapshot = JSON.stringify(history)
    undo(history)
    record(history, B)
    expect(JSON.stringify(history)).toBe(snapshot)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/editHistory.test.ts`
Expected: FAIL — cannot resolve `./editHistory`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/editHistory.ts`:

```ts
/**
 * Undo/redo for canvas edits, as snapshots of one artboard's inner HTML.
 *
 * Snapshots rather than inverse patches: artboard HTML is small, and a
 * snapshot cannot disagree with the document the way a computed inverse can
 * after a concurrent agent write.
 *
 * Agent edits are recorded here too. A user who nudges something, asks the
 * agent to restyle the section, then hits Ctrl+Z expects the agent's change
 * to come off first — one timeline, or undo is a trap.
 */

export interface EditEntry {
  artboardId: string
  /** Inner HTML before the edit — what undo restores. */
  before: string
  /** Inner HTML after the edit — what redo restores. */
  after: string
}

export interface History {
  past: EditEntry[]
  future: EditEntry[]
}

export function emptyHistory(): History {
  return { past: [], future: [] }
}

export function record(history: History, entry: EditEntry): History {
  return { past: [...history.past, entry], future: [] }
}

export function undo(history: History): { history: History; entry: EditEntry } | null {
  const entry = history.past[history.past.length - 1]
  if (!entry) return null
  return {
    history: { past: history.past.slice(0, -1), future: [entry, ...history.future] },
    entry,
  }
}

export function redo(history: History): { history: History; entry: EditEntry } | null {
  const entry = history.future[0]
  if (!entry) return null
  return {
    history: { past: [...history.past, entry], future: history.future.slice(1) },
    entry,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/editHistory.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/editHistory.ts src/lib/editHistory.test.ts
git commit -m "feat: add an undo/redo stack for Studio canvas edits"
```

---

## Task 9: Wire undo/redo to the canvas

Connects the stack to real persistence. No user-facing edit exists yet (that is Phase 4+), so this task proves the wiring with the one edit that does exist: restoring an artboard's HTML.

**Files:**
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `emptyHistory`, `record`, `undo`, `redo`, `EditEntry` from Task 8; `studioWriteArtboardHtml` from Task 6.
- Produces: `applyEdit(artboardId: string, before: string, after: string): Promise<void>` — the function every Phase 4+ editing gesture will call.

- [ ] **Step 1: Add history state and the apply path**

Add the import:

```tsx
import { emptyHistory, record, undo as undoHistory, redo as redoHistory, type History } from '@/lib/editHistory'
```

Add to state:

```tsx
  const [history, setHistory] = useState<History>(emptyHistory())
```

Add the shared entry point:

```tsx
  /**
   * The single path every canvas edit takes: persist, then record. Phase 4+
   * gestures call this rather than writing to disk themselves, so undo can
   * never fall out of step with what is on disk.
   */
  const applyEdit = useCallback(async (artboardId: string, before: string, after: string) => {
    if (!activeId || before === after) return
    await api.studioWriteArtboardHtml(activeId, artboardId, after)
    setHistory(h => record(h, { artboardId, before, after }))
  }, [activeId, api])
```

- [ ] **Step 2: Reset history per document**

In the effect that loads `html` (beside the `setSelection(null)` from Task 7):

```tsx
    setHistory(emptyHistory())
```

- [ ] **Step 3: Bind the keys**

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (!activeId) return
      e.preventDefault()
      const step = e.shiftKey ? redoHistory(history) : undoHistory(history)
      if (!step) return
      setHistory(step.history)
      const html = e.shiftKey ? step.entry.after : step.entry.before
      void api.studioWriteArtboardHtml(activeId, step.entry.artboardId, html)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, api, history])
```

- [ ] **Step 4: Keep `applyEdit` from being dead code**

`applyEdit` has no caller until Phase 4. Rather than leave an unused symbol for the linter to flag, expose it on the debug surface so it can be exercised now:

```tsx
  // Phase 4 gestures will call this directly. Until then it is reachable from
  // DevTools so the persistence + undo path can be tested without waiting for
  // a drag implementation to exist.
  useEffect(() => {
    ;(window as unknown as { __fdApplyEdit?: typeof applyEdit }).__fdApplyEdit = applyEdit
    return () => { delete (window as unknown as { __fdApplyEdit?: typeof applyEdit }).__fdApplyEdit }
  }, [applyEdit])
```

- [ ] **Step 5: Typecheck, test, verify**

Run: `npx tsc --noEmit -p tsconfig.json` — expect exit 0.
Run: `npx vitest run` — expect all tests passing.

In the app, with a document open, in DevTools console:

```js
await window.__fdApplyEdit('<artboard-id>', '<current inner html>', '<p>edited</p>')
```

The canvas reloads showing the edit. Ctrl+Z restores the original; Ctrl+Shift+Z reapplies it. Get `<artboard-id>` from the document sidebar and the current inner HTML from the file on disk.

- [ ] **Step 6: Commit**

```bash
git add src/pages/StudioCanvas.tsx
git commit -m "feat: route Studio canvas edits through a persisted undo stack"
```

---

## Self-review notes

**Spec coverage.** Phase 1 (navigation) → Tasks 1–4. Phase 2 (selection, `data-fd-el`, bridge, migration) → Tasks 5–7; the spec's "migration for existing documents" is Task 5's `seal()` plus Task 7's persistence of the `sealed` message, which backfills lazily on first open rather than as a batch pass. Phase 3 (patches and history) → Tasks 6, 8, 9, implemented as artboard snapshots per the refinement noted at the top.

**Not covered here, by design.** The `:root` token-aware colour picker, the "Ask the agent…" affordance, the closed editable-property set, and agent tool descriptions requiring `data-fd-el` all belong to Phases 4–6 and are not part of this batch. Elements the agent writes *after* this lands will be sealed on next open by the same lazy pass, so nothing breaks in the meantime.

**Known limitation to carry forward.** `seal()` writes ids on first open of every document, which counts as a document change and will fire `studioDocumentChanged`. This is idempotent — a second open finds nothing to seal — but Phase 4 should confirm it does not fight the canvas's own reload-on-change effect. If it does, the fix is to skip the reload when the change originated from a `sealed` write.
