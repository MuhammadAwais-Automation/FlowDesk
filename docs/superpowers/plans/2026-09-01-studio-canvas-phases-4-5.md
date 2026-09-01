# Studio Canvas Phases 4–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag elements to move them, resize them with handles, nudge them with arrow keys, and double-click to edit text in place — all undoable, all persisted through the existing artboard-HTML path.

**Architecture:** DOM mutation for a gesture happens wherever the browser already gives correct, zoom-corrected coordinates for it: a drag that starts ON the selected element (move, text edit) is driven entirely inside the iframe's own script, because pointer events dispatched inside a cross-document iframe are automatically translated into that iframe's own layout coordinates regardless of the ancestor's CSS `scale()` — no manual zoom math needed. A drag that starts on host-page chrome (resize handles, drawn in the overlay like Task 7's selection outline) is host-driven, and a new pure helper converts host-viewport pixel deltas into world/artboard pixel deltas by dividing by `view.zoom`. Every gesture — move, resize, nudge, text edit — ends the same way: the bridge script captures the artboard's `innerHTML` before and after the change and posts one `'edited'` message; the host calls the SAME `applyEdit(artboardId, before, after)` Task 9 of the previous plan already built, so every gesture in this plan is undoable for free, through code that already exists and is already tested.

**Tech Stack:** TypeScript, React 19, Vitest, Electron IPC. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-30-studio-design-system-design.md](../specs/2026-08-30-studio-design-system-design.md) (Phase 4 — Transform, Phase 5 — Text)

**Builds on:** [docs/superpowers/plans/2026-08-30-studio-canvas-phases-1-3.md](2026-08-30-studio-canvas-phases-1-3.md), merged to `main` at commit `eff664e`.

## Global Constraints

- HTML is the source of truth. Every persisted change goes through `applyEdit(artboardId, before, after)` (already built — `src/pages/StudioCanvas.tsx`, moved to `src/hooks/useEditHistory.ts` by Task 2 of this plan), which itself goes through `api.studioWriteArtboardHtml`.
- Editor chrome (resize handles, the selection outline) lives in the HOST page overlay, never written into the iframe's own document.
- Live drag/resize preview is applied directly to the DOM for smoothness and is **not** persisted mid-drag — only the gesture's end produces a call to `applyEdit`.
- Zoom range stays 0.1–4.0 (unchanged from Phase 1).
- Existing tests must keep passing: `npx vitest run`.
- Typecheck both: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.json`.
- **Scope boundary, explicitly out of this plan:** snapping/alignment guides, typography controls, the property panel, and inserting new elements are Phases 6–7 and are not built here. Resize handles exist and work; they do not snap to anything yet.

---

## Why the previous plan's final review requires Tasks 1–3 before any new gesture lands

The final whole-branch review of the previous plan found two integration bugs (both fixed and merged): undo history being wiped by the write that created it, and keyboard shortcuts going dead the moment an iframe element gained focus. Both were **seam bugs** — state or event-handling owned by one concern sitting inside code triggered by a different concern, invisible because nothing about either piece looked wrong in isolation.

Phase 4 adds exactly the kind of code that makes seams like that worse: a pointer-drag state machine (for resize) living on the same viewport div that already runs pan's pointer-drag state machine, plus a new keydown handler (arrow-key nudge) added into the same focus situation Task 3 below has to fix at its root. The reviewer's explicit recommendation — extract `useCanvasViewport`, `useEditHistory`, and a bridge-messaging hook before Phase 4, not after — is followed here as Tasks 1–3. This is a mechanical, behavior-preserving refactor: nothing in Tasks 1–3 changes what the app does; everything after Task 3 depends on the seams they make explicit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/hooks/useCanvasViewport.ts` *(new)* | Pan/zoom/fit state and handlers — extracted from `StudioCanvas.tsx`, behavior-preserving. |
| `src/hooks/useEditHistory.ts` *(new)* | Undo/redo stack, `applyEdit`, the Ctrl+Z keydown handler — extracted, behavior-preserving. |
| `src/hooks/useStudioBridge.ts` *(new)* | The `message` listener, `selection`, `framedHtml`, the iframe ref, post-selection refocus (the C2 fix, relocated here) — extracted, behavior-preserving, plus the new `'edited'` message handler. |
| `src/lib/studioBridge.ts` *(modify)* | New `BridgeMessage` variants (`'edited'`, `'resizePreview'`/`'resizeCommit'` acks) and the injected script's move/resize/nudge/text-edit logic. |
| `src/lib/canvasViewport.ts` *(modify)* | New pure helper `hostDeltaToWorldDelta`. |
| `src/lib/canvasViewport.test.ts` *(modify)* | Tests for the above. |
| `src/pages/StudioCanvas.tsx` *(modify)* | Shrinks to composition of the three hooks above, plus the new resize-handle overlay JSX. |

---

## Task 1: Extract `useCanvasViewport`

**Files:**
- Create: `src/hooks/useCanvasViewport.ts`
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `clampZoom, fitToViewport, panBy, zoomAt, type Size, type ViewportState` from `@/lib/canvasViewport` (unchanged, already exist).
- Produces: `useCanvasViewport(bounds: Size, activeId: string | null): { view: ViewportState; setView: React.Dispatch<React.SetStateAction<ViewportState>>; viewportRef: React.RefObject<HTMLDivElement>; fit: () => void; spaceHeld: boolean; panning: React.RefObject<{ x: number; y: number } | null>; cursor: 'grabbing' | 'grab' | 'default'; onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; endPan: (e: React.PointerEvent) => void; onWheel: (e: React.WheelEvent) => void }`

This task moves code verbatim — it does not change behavior. Read the CURRENT `src/pages/StudioCanvas.tsx` (it has grown since Phase 1–3's plan text; the line numbers below are illustrative of what to look for, not literal) and find:
- The `fittedFor` ref, `spaceHeld` state, `panning` ref
- The `fit` callback
- The `[activeId]`-only effect's `bounds`/`fittedFor` portion — **wait**, `bounds` itself is NOT owned by this hook (it comes from the bridge/iframe reporting its size — Task 3 owns it). This hook takes `bounds` as a **parameter** (passed in by the component from `useStudioBridge`'s return value) and only owns the VIEW/pan/zoom/fit state that reacts to it.
- The fit-once-per-document effect
- The space-to-pan keydown/keyup/blur effect
- The non-passive wheel-preventDefault effect
- The middle-mouse capture-phase pointerdown effect (the I1 fix from the previous plan's final review)
- `onPointerDown`, `onPointerMove`, `endPan`
- The `onWheel` inline handler (currently inline JSX — pull it out into a named function this hook returns)
- The cursor style expression (`panning.current ? 'grabbing' : spaceHeld ? 'grab' : 'default'`) — return it as a plain value, not a style object, so the component decides how to apply it.

Write `src/hooks/useCanvasViewport.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { clampZoom, fitToViewport, panBy, zoomAt, type Size, type ViewportState } from '@/lib/canvasViewport'

/**
 * Pan/zoom/fit state and input handling for the Studio canvas, extracted
 * from StudioCanvas.tsx so this concern's seams are explicit rather than
 * interleaved with selection and history state in one component. Behavior-
 * preserving: this is the same code that lived inline, moved verbatim.
 *
 * `bounds` is owned by the caller (see useStudioBridge) — this hook only
 * reacts to it (for fit-once-per-document), it does not measure it.
 */
export function useCanvasViewport(bounds: Size, activeId: string | null) {
  const [view, setView] = useState<ViewportState>({ panX: 0, panY: 0, zoom: 1 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const fittedFor = useRef<string | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panning = useRef<{ x: number; y: number } | null>(null)

  const fit = useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect()
    if (!box) return
    setView(fitToViewport(bounds, { width: box.width, height: box.height }))
  }, [bounds])

  // Fit once per document, when its size first becomes known — not on every
  // bounds report, or the user's own zoom would be undone mid-session.
  useEffect(() => {
    if (!activeId || bounds.width === 0) return
    if (fittedFor.current === activeId) return
    fittedFor.current = activeId
    fit()
  }, [activeId, bounds, fit])

  // Reset fit-tracking when the document changes, so the NEW document gets
  // its own fit-once pass instead of inheriting the previous one's.
  useEffect(() => {
    fittedFor.current = null
  }, [activeId])

  // Space-to-pan is modal, so the held state has to live outside React's
  // event flow: the key can be pressed while focus is anywhere in the page.
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

  // A middle-button press over the iframe is consumed by the iframe's own
  // document before it reaches a bubble-phase React handler on this div, so
  // a capture-phase native listener is required to start the pan before the
  // event can be dispatched into the iframe. (Space-drag doesn't need this:
  // pointerEvents is set to 'none' on the world div proactively before the
  // drag starts, which a middle-click can't be predicted ahead of time.)
  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const onMiddleDown = (e: PointerEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      node.setPointerCapture(e.pointerId)
      panning.current = { x: e.clientX, y: e.clientY }
    }
    node.addEventListener('pointerdown', onMiddleDown, { capture: true })
    return () => node.removeEventListener('pointerdown', onMiddleDown, { capture: true })
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const isPan = spaceHeld || e.button === 1
    if (!isPan) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    panning.current = { x: e.clientX, y: e.clientY }
  }, [spaceHeld])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const from = panning.current
    if (!from) return
    panning.current = { x: e.clientX, y: e.clientY }
    setView(v => panBy(v, e.clientX - from.x, e.clientY - from.y))
  }, [])

  const endPan = useCallback((e: React.PointerEvent) => {
    if (!panning.current) return
    panning.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
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
  }, [])

  const cursor: 'grabbing' | 'grab' | 'default' = panning.current ? 'grabbing' : spaceHeld ? 'grab' : 'default'

  return { view, setView, viewportRef, fit, spaceHeld, panning, cursor, onPointerDown, onPointerMove, endPan, onWheel }
}
```

- [ ] Create the file above.
- [ ] In `src/pages/StudioCanvas.tsx`: remove everything this hook now owns (the state/refs/effects/handlers listed above), add `import { useCanvasViewport } from '@/hooks/useCanvasViewport'`, and call it: `const { view, setView, viewportRef, fit, spaceHeld, panning, cursor, onPointerDown, onPointerMove, endPan, onWheel } = useCanvasViewport(bounds, activeId)` — **note `bounds` is still a local variable in `StudioCanvas.tsx` at this point in the plan; Task 3 moves it into `useStudioBridge`, so for THIS task leave `bounds` exactly where it already is (its own `useState` in the component) and just pass it into the hook call.**
- [ ] Update the viewport `<div>`'s JSX: `onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPan} onPointerCancel={endPan} onWheel={onWheel} style={{ cursor, ...restOfExistingStyleIfAny }}` — check whether the div currently has other inline styles merged in and preserve them.
- [ ] Update the world `<div>`'s `pointerEvents: spaceHeld ? 'none' : 'auto'` — `spaceHeld` now comes from the hook's return value, same behavior.
- [ ] Update the zoom toolbar buttons (`clampZoom(v.zoom - 0.25)` etc.) and the Fit/1:1 buttons to use the hook's `setView`/`fit`/`view.zoom` — same behavior, different source.
- [ ] Update the selection outline's `borderWidth: 1 / view.zoom` — same, `view` now from the hook.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — confirm exit 0.
- [ ] Run `npx vitest run` — confirm the full suite still passes (this is a pure refactor; no test should change behavior).
- [ ] Manual self-review: read the resulting `StudioCanvas.tsx` and confirm NOTHING about pan/zoom/fit changed — every removed line has an equivalent now coming from the hook.
- [ ] Commit with message: `refactor: extract useCanvasViewport from StudioCanvas`

---

## Task 2: Extract `useEditHistory`

**Files:**
- Create: `src/hooks/useEditHistory.ts`
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `emptyHistory, record, undo, redo, type History, type EditEntry` from `@/lib/editHistory` (unchanged, already exist). `api: Window['electronAPI']`, `activeId: string | null`.
- Produces: `useEditHistory(activeId: string | null, api: Window['electronAPI']): { applyEdit: (artboardId: string, before: string, after: string) => Promise<void>; resetHistory: () => void }`

Read the current `StudioCanvas.tsx` and find: the `history` state, the `applyEdit` callback, the `window.__fdApplyEdit` debug-surface effect, and the Ctrl+Z/Ctrl+Shift+Z keydown effect. Also find the `[activeId]`-only reset effect (the C1 fix) — the `setHistory(emptyHistory())` line inside it belongs to this hook; the OTHER three resets in that same effect (`bounds`, `selection`, `fittedFor.current`) do NOT — they stay in the component (or move to Task 1/3's hooks respectively) as their own effect. This hook exposes a `resetHistory()` function instead of doing the reset itself, so the component's single `[activeId]` effect can call every hook's reset function together and the "what resets on document switch" contract stays visible in one place (exactly the gap the final review's Recommendations called out).

Write `src/hooks/useEditHistory.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyHistory, record, undo as undoHistory, redo as redoHistory, type History } from '@/lib/editHistory'

/**
 * Undo/redo stack and the persisted-edit entry point, extracted from
 * StudioCanvas.tsx. Behavior-preserving except for one structural change:
 * the document-switch reset is now `resetHistory()`, called explicitly by
 * the component alongside every other hook's own reset — see this plan's
 * Task 1-3 header for why (the previous plan's C1 finding was exactly a
 * reset like this one living in the wrong effect).
 */
export function useEditHistory(activeId: string | null, api: Window['electronAPI']) {
  const [history, setHistory] = useState<History>(emptyHistory())

  const resetHistory = useCallback(() => setHistory(emptyHistory()), [])

  /**
   * The single path every canvas edit takes: persist, then record. Every
   * Phase 4+ gesture (move, resize, nudge, text edit) calls this rather than
   * writing to disk itself, so undo can never fall out of step with disk.
   */
  const applyEdit = useCallback(async (artboardId: string, before: string, after: string) => {
    if (!activeId || before === after) return
    await api.studioWriteArtboardHtml(activeId, artboardId, after)
    setHistory(h => record(h, { artboardId, before, after }))
  }, [activeId, api])

  // Reachable from DevTools for manual testing without a UI gesture.
  useEffect(() => {
    ;(window as unknown as { __fdApplyEdit?: typeof applyEdit }).__fdApplyEdit = applyEdit
    return () => { delete (window as unknown as { __fdApplyEdit?: typeof applyEdit }).__fdApplyEdit }
  }, [applyEdit])

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
      const restored = e.shiftKey ? step.entry.after : step.entry.before
      void api.studioWriteArtboardHtml(activeId, step.entry.artboardId, restored)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, api, history])

  return { applyEdit, resetHistory }
}
```

- [ ] Create the file above.
- [ ] In `src/pages/StudioCanvas.tsx`: remove `history` state, `applyEdit`, the debug-surface effect, and the Ctrl+Z effect. Add `import { useEditHistory } from '@/hooks/useEditHistory'` and call `const { applyEdit, resetHistory } = useEditHistory(activeId, api)`.
- [ ] In the `[activeId]`-only reset effect, replace the `setHistory(emptyHistory())` line with `resetHistory()`.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — confirm exit 0.
- [ ] Run `npx vitest run` — confirm the full suite still passes.
- [ ] Manual self-review: confirm the `[activeId]` reset effect now calls `resetHistory()` (from this hook) alongside its remaining direct resets — read it once end to end and confirm nothing was dropped.
- [ ] Commit with message: `refactor: extract useEditHistory from StudioCanvas`

---

## Task 3: Extract `useStudioBridge`, with the C2 fix relocated and a new `'edited'` message

This is the task where new message-handling surface for Phase 4 gets added, so it is larger than Tasks 1–2.

**Files:**
- Create: `src/hooks/useStudioBridge.ts`
- Modify: `src/lib/studioBridge.ts`
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `BRIDGE_SCRIPT, isBridgeMessage, type BridgeMessage` from `@/lib/studioBridge`; `applyEdit` from Task 2's hook.
- Produces:
  - `useStudioBridge(html: string, activeId: string | null, api: Window['electronAPI'], applyEdit: (artboardId: string, before: string, after: string) => Promise<void>): { framedHtml: string; bounds: Size; selection: SelectionState | null; iframeRef: React.RefObject<HTMLIFrameElement>; resetSelection: () => void }` where `SelectionState = { artboardId: string; elementId: string; tag: string; rect: BridgeRect }`.
  - A new `BridgeMessage` variant: `{ __fdCanvas: 'edited'; artboardId: string; before: string; after: string }` — posted by the bridge script itself whenever a gesture (move/resize/nudge/text-edit, added in later tasks) completes. This hook's message listener calls `applyEdit(msg.artboardId, msg.before, msg.after)` when it arrives.

### Step 1: Add the message type and an origin-check helper to `studioBridge.ts`

In `src/lib/studioBridge.ts`, extend the `BridgeMessage` union:

```ts
export type BridgeMessage =
  | { __fdCanvas: 'bounds'; width: number; height: number }
  /** Ids were assigned to previously unidentified elements; persist this artboard. */
  | { __fdCanvas: 'sealed'; artboardId: string; html: string }
  | { __fdCanvas: 'selected'; artboardId: string; elementId: string; tag: string; rect: BridgeRect }
  | { __fdCanvas: 'cleared' }
  /**
   * A gesture (move, resize, nudge, or text edit — added by later tasks in
   * this plan) completed. `before`/`after` are the artboard's own innerHTML
   * snapshotted by the bridge at gesture-start and gesture-end, so the host
   * never has to compute a diff — it hands both straight to applyEdit,
   * which is what makes every one of these gestures undoable for free.
   */
  | { __fdCanvas: 'edited'; artboardId: string; before: string; after: string }
```

Add an origin-checking helper below `isBridgeMessage` (closes M2 from the final review — this iframe's content is agent-authored, and while the agent already has write access through its own tools, checking the message actually came from the iframe this component owns costs one line):

```ts
/**
 * Confirms a message actually came from the iframe this hook owns, not from
 * some other postMessage traffic in the page. isBridgeMessage alone only
 * checks the payload SHAPE; this checks the SOURCE.
 */
export function isFromIframe(event: MessageEvent, iframe: HTMLIFrameElement | null): boolean {
  return iframe != null && event.source === iframe.contentWindow
}
```

### Step 2: Write `src/hooks/useStudioBridge.ts`

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BRIDGE_SCRIPT, isBridgeMessage, isFromIframe, type BridgeRect } from '@/lib/studioBridge'
import type { Size } from '@/lib/canvasViewport'

export interface SelectionState {
  artboardId: string
  elementId: string
  tag: string
  rect: BridgeRect
}

/**
 * Everything about talking to the injected iframe: sizing it to the
 * document's own reported bounds, tracking the current selection, and
 * routing a completed gesture into applyEdit. Extracted from
 * StudioCanvas.tsx.
 *
 * Owns the post-selection refocus fix: clicking an element inside the
 * iframe moves browser focus into the iframe's own document, which
 * silently kills the parent window's keydown listeners (Ctrl+Z, space-pan)
 * until the user clicks the grey background again. Refocusing the
 * viewport on every 'selected'/'cleared' message is what keeps those
 * listeners alive — this was previously a fix applied directly in
 * StudioCanvas.tsx; it belongs here now, next to the messages that trigger it.
 */
export function useStudioBridge(
  html: string,
  activeId: string | null,
  api: Window['electronAPI'],
  applyEdit: (artboardId: string, before: string, after: string) => Promise<void>,
  refocusTarget: React.RefObject<HTMLElement>,
) {
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 })
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const resetSelection = useCallback(() => setSelection(null), [])

  const framedHtml = useMemo(
    () => (html ? html.replace('</body>', `<script>${BRIDGE_SCRIPT}</script></body>`) : ''),
    [html],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isBridgeMessage(event.data)) return
      if (!isFromIframe(event, iframeRef.current)) return
      const msg = event.data
      if (msg.__fdCanvas === 'bounds') { setBounds({ width: msg.width, height: msg.height }); return }
      if (msg.__fdCanvas === 'selected') {
        setSelection({ artboardId: msg.artboardId, elementId: msg.elementId, tag: msg.tag, rect: msg.rect })
        refocusTarget.current?.focus()
        return
      }
      if (msg.__fdCanvas === 'cleared') {
        setSelection(null)
        refocusTarget.current?.focus()
        return
      }
      if (msg.__fdCanvas === 'sealed' && activeId) {
        // Ids are assigned once and written straight back, so a selection
        // made now still refers to the same element after a reload.
        void api.studioWriteArtboardHtml(activeId, msg.artboardId, msg.html)
        return
      }
      if (msg.__fdCanvas === 'edited') {
        void applyEdit(msg.artboardId, msg.before, msg.after)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [activeId, api, applyEdit, refocusTarget])

  return { framedHtml, bounds, selection, iframeRef, resetSelection }
}
```

Note the added `event.source === iframe.contentWindow` guard changes how the hook must be tested manually — the iframe's `contentWindow` is only non-null once the iframe has actually mounted and its `srcDoc` has started loading, which is already true by the time any bridge message could arrive (the bridge script only runs once the iframe's document exists), so this introduces no new timing hazard.

### Step 3: Wire it into `StudioCanvas.tsx`

- [ ] Remove `bounds`/`selection` state, the `framedHtml` memo, the `message` listener effect, and (if not already moved by Task 1) any leftover selection-outline-specific state from the component.
- [ ] Add `import { useStudioBridge } from '@/hooks/useStudioBridge'`.
- [ ] Call it — note the dependency on `applyEdit` from Task 2 and `viewportRef` from Task 1, both already available by this point in the plan:
  ```tsx
  const { framedHtml, bounds, selection, iframeRef, resetSelection } = useStudioBridge(html, activeId, api, applyEdit, viewportRef)
  ```
- [ ] Now that `bounds` comes from this hook, pass it into `useCanvasViewport(bounds, activeId)` from Task 1 as before — same call, `bounds` just originates from a different hook now.
- [ ] Give the viewport `<div ref={viewportRef}>` (from Task 1) a `tabIndex={-1}` prop and merge `outline: 'none'` into its inline style — this is what makes `refocusTarget.current?.focus()` actually work (an element needs `tabIndex` to be programmatically focusable if it isn't naturally focusable) and suppresses the resulting focus-ring.
- [ ] In the `[activeId]`-only reset effect, replace whatever was resetting `selection` with `resetSelection()`, alongside `resetHistory()` from Task 2. The effect should now read, in full:
  ```tsx
  useEffect(() => {
    resetSelection()
    resetHistory()
    // any other activeId-scoped reset from Task 1 (fittedFor) stays here or in its own hook
  }, [activeId, resetSelection, resetHistory])
  ```
  Read the CURRENT state of this effect carefully — Tasks 1 and 2 each already touched it — and confirm every reset that was there is still there, just calling the hook's reset function instead of a local setter.
- [ ] Update the `<iframe>` JSX: add `ref={iframeRef}`.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — confirm exit 0.
- [ ] Run `npx vitest run` — confirm the full suite still passes.
- [ ] Manual self-review — this is the highest-risk task in this trio, re-verify by reading:
  1. Does `refocusTarget.current?.focus()` actually fire on both `'selected'` and `'cleared'` (not just one)?
  2. Does the `[activeId]` reset effect still reset every piece of state it did before Tasks 1-3 (bounds/fittedFor from Task 1's territory conceptually reset by that hook's own `[activeId]` effect, `history` via `resetHistory()`, `selection` via `resetSelection()`)? Nothing should be silently dropped across this three-task split.
  3. Does the new `isFromIframe` guard actually get exercised — is `iframeRef` populated by the time messages can arrive (yes, per the note in Step 2, but confirm by reading the JSX order: iframe renders, THEN its own script can post)?
- [ ] Commit with message: `refactor: extract useStudioBridge, relocate the post-selection focus fix, add the 'edited' message`

---

## Task 4: Bridge — drag to move the selected element

**Files:**
- Modify: `src/lib/studioBridge.ts`

**Interfaces:**
- Consumes: nothing new (uses the `'edited'` message type from Task 3).
- Produces: nothing new for later tasks to import — this is pure injected-script behavior, verified by reading and by the app itself.

Append to the `BRIDGE_SCRIPT` IIFE, immediately before its existing `seal();` call at the very end:

```js
  // Move: pointerdown on an already-selected element starts a drag. Applied
  // as a CSS transform (translate), not left/top — this works regardless of
  // the element's own position scheme (static, relative, absolute) and
  // doesn't disturb sibling layout. Known, accepted limitation for this
  // pass: an element that already has its OWN transform (set by the agent)
  // has it overwritten by dragging, since this sets style.transform outright
  // rather than composing with an existing value — revisit if this proves
  // disruptive in practice.
  //
  // Coordinates here are the iframe's OWN document coordinates. A CSS
  // scale() on the ancestor world div does not need to be compensated for:
  // the browser translates cross-document pointer coordinates through an
  // ancestor's transform automatically, so clientX/clientY inside this
  // iframe are already correct in this document's own pixel units.
  var dragState = null;

  function elementForDrag(target) {
    var el = target;
    while (el && el !== document.body && !el.hasAttribute('data-fd-el')) el = el.parentElement;
    if (!el || el === document.body) return null;
    if (el.getAttribute('data-fd-el') !== window.__fdSelectedElementId) return null;
    return el;
  }

  // Tracks the currently-selected element id so a drag only starts on the
  // element the host believes is selected — clicking elsewhere already
  // re-selects via the click handler below, which fires before a drag would.
  window.__fdSelectedElementId = null;

  document.addEventListener('pointerdown', function (e) {
    var el = elementForDrag(e.target);
    if (!el) return;
    var board = el.closest('.fd-artboard');
    if (!board) return;
    e.preventDefault();
    var startTransform = el.style.transform || '';
    var match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(startTransform);
    dragState = {
      el: el,
      board: board,
      before: board.innerHTML,
      startX: e.clientX,
      startY: e.clientY,
      baseX: match ? parseFloat(match[1]) : 0,
      baseY: match ? parseFloat(match[2]) : 0,
    };
    el.setPointerCapture(e.pointerId);
  });

  document.addEventListener('pointermove', function (e) {
    if (!dragState) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    dragState.el.style.transform = 'translate(' + (dragState.baseX + dx) + 'px, ' + (dragState.baseY + dy) + 'px)';
  });

  document.addEventListener('pointerup', function (e) {
    if (!dragState) return;
    var after = dragState.board.innerHTML;
    var artboardId = dragState.board.getAttribute('data-fd-id');
    var before = dragState.before;
    dragState = null;
    if (before !== after) {
      parent.postMessage({ __fdCanvas: 'edited', artboardId: artboardId, before: before, after: after }, '*');
    }
  });
```

Update the existing `click` listener (already in the file, from Task 5 of the previous plan) to also maintain `window.__fdSelectedElementId`:

```js
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body && !el.hasAttribute('data-fd-el')) el = el.parentElement;
    if (!el || el === document.body) {
      window.__fdSelectedElementId = null;
      parent.postMessage({ __fdCanvas: 'cleared' }, '*');
      return;
    }
    var board = el.closest('.fd-artboard');
    if (!board) { window.__fdSelectedElementId = null; parent.postMessage({ __fdCanvas: 'cleared' }, '*'); return; }
    window.__fdSelectedElementId = el.getAttribute('data-fd-el');
    var r = el.getBoundingClientRect();
    parent.postMessage({
      __fdCanvas: 'selected',
      artboardId: board.getAttribute('data-fd-id'),
      elementId: el.getAttribute('data-fd-el'),
      tag: el.tagName.toLowerCase(),
      rect: { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height },
    }, '*');
  });
```

(This changes the existing listener's body — find it by its `document.addEventListener('click', ...)` signature and replace it with the version above, which is identical except for the two `window.__fdSelectedElementId = ...` lines added.)

- [ ] Apply the two changes above to `src/lib/studioBridge.ts`.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — confirm exit 0 (this file has no test file; typecheck only covers the TypeScript type declarations, not the injected JS string's own correctness — that's verified by reading, per the note below).
- [ ] Run `npx vitest run` — confirm the full suite still passes.
- [ ] Self-review the injected JS by hand (typecheck cannot check inside a template string):
  1. Does `elementForDrag` correctly return `null` (no drag starts) for a pointerdown on an element that ISN'T the currently-selected one — confirming a drag can only start on something already selected, not on a bare click-and-immediately-drag?
  2. Does the drag correctly compose with an existing `translate()` transform from a PREVIOUS drag (the regex parsing `baseX`/`baseY`), so dragging the same element twice accumulates correctly rather than resetting to origin each time?
  3. Is `before` captured at `pointerdown` time (before any mutation) and `after` at `pointerup` time (after the final `style.transform` write)?
  4. Does the `'edited'` message only get posted when `before !== after` (i.e., a genuine no-op drag, such as a click-and-immediate-release with zero movement, does not pollute undo history)?
- [ ] Commit with message: `feat: drag the selected element to move it, undoable`

---

## Task 5: Pure helper — host pixel deltas to world pixel deltas

**Files:**
- Modify: `src/lib/canvasViewport.ts`
- Modify: `src/lib/canvasViewport.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `hostDeltaToWorldDelta(dx: number, dy: number, zoom: number): { dx: number; dy: number }`

Unlike Task 4's move gesture (driven inside the iframe, where the browser auto-corrects cross-document pointer coordinates through the ancestor's CSS transform), Task 6's resize handles are HOST-page elements — plain React divs in `StudioCanvas.tsx`'s own document. Pointer events on a host-page element are always reported in host viewport pixels, with NO automatic correction for any CSS transform applied to an ancestor (that auto-correction is a cross-document-iframe-specific browser behavior; it does not apply within a single document). So a resize handle's own pointer deltas must be manually converted into world/artboard-pixel deltas before being applied to the dragged element's width/height — dividing by `zoom` is the whole of that conversion, but it's exactly the kind of one-line arithmetic that's easy to get backwards (multiply vs divide) and invisible until tested at a non-100% zoom.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/canvasViewport.test.ts`:

```ts
import { hostDeltaToWorldDelta } from './canvasViewport'

describe('hostDeltaToWorldDelta', () => {
  it('passes deltas through unchanged at 100% zoom', () => {
    expect(hostDeltaToWorldDelta(10, -6, 1)).toEqual({ dx: 10, dy: -6 })
  })

  it('scales UP a host delta at 50% zoom — the same physical drag covers more world pixels when zoomed out', () => {
    expect(hostDeltaToWorldDelta(10, 10, 0.5)).toEqual({ dx: 20, dy: 20 })
  })

  it('scales DOWN a host delta at 200% zoom — the same physical drag covers fewer world pixels when zoomed in', () => {
    expect(hostDeltaToWorldDelta(10, 10, 2)).toEqual({ dx: 5, dy: 5 })
  })

  it('never divides by zero even if zoom is somehow 0', () => {
    const result = hostDeltaToWorldDelta(10, 10, 0)
    expect(Number.isFinite(result.dx)).toBe(true)
    expect(Number.isFinite(result.dy)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/canvasViewport.test.ts`
Expected: FAIL — `hostDeltaToWorldDelta` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/canvasViewport.ts`, near `screenToWorld` (same category of coordinate-conversion helper):

```ts
/**
 * Converts a pointer-movement delta measured in HOST-page viewport pixels
 * (e.g. from a resize handle, which is a plain element in the host
 * document — unlike a drag inside the iframe, host-page pointer events get
 * NO automatic correction for the world div's CSS scale()) into the
 * equivalent delta in world/artboard pixels.
 *
 * Guards against zoom === 0 (should be unreachable given MIN_ZOOM, but a
 * resize handler dividing by an unclamped zoom value is exactly the kind of
 * thing that should never produce Infinity/NaN even defensively).
 */
export function hostDeltaToWorldDelta(dx: number, dy: number, zoom: number): { dx: number; dy: number } {
  const safeZoom = zoom === 0 ? MIN_ZOOM : zoom
  return { dx: dx / safeZoom, dy: dy / safeZoom }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/canvasViewport.test.ts`
Expected: PASS (13 tests: 9 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvasViewport.ts src/lib/canvasViewport.test.ts
git commit -m "feat: add hostDeltaToWorldDelta for resize-handle drag math"
```

---

## Task 6: Resize handles

**Files:**
- Modify: `src/lib/studioBridge.ts`
- Modify: `src/hooks/useStudioBridge.ts`
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `hostDeltaToWorldDelta` from Task 5; `selection`, `iframeRef` from Task 3's hook; `view.zoom` from Task 1's hook.
- Produces: nothing new for later tasks.

### Step 1: Add host→iframe message handling to the bridge script

Resize is initiated by the HOST (a handle the user drags), so for the first time this plan needs the HOST to post INTO the iframe, not just receive from it. Append to `BRIDGE_SCRIPT`, after the move-drag code from Task 4 and before `seal();`:

```js
  // Resize: driven from the host page (the handles are host-side overlay
  // elements, not inside this document), so unlike move, this iframe is a
  // RECEIVER here — the host computes zoom-corrected deltas and posts them
  // in. This iframe's only job is applying them to the DOM and reporting
  // the before/after snapshot once the gesture ends.
  var resizeState = null;

  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.__fdHost === 'resizeStart') {
      var el = document.querySelector('[data-fd-el="' + msg.elementId + '"]');
      if (!el) return;
      var board = el.closest('.fd-artboard');
      if (!board) return;
      var rect = el.getBoundingClientRect();
      resizeState = {
        el: el,
        board: board,
        before: board.innerHTML,
        baseWidth: rect.width,
        baseHeight: rect.height,
      };
      el.style.boxSizing = 'border-box';
      return;
    }

    if (msg.__fdHost === 'resizePreview' && resizeState) {
      var newWidth = Math.max(4, resizeState.baseWidth + (msg.dWidth || 0));
      var newHeight = Math.max(4, resizeState.baseHeight + (msg.dHeight || 0));
      resizeState.el.style.width = newWidth + 'px';
      resizeState.el.style.height = newHeight + 'px';
      return;
    }

    if (msg.__fdHost === 'resizeCommit' && resizeState) {
      var after = resizeState.board.innerHTML;
      var artboardId = resizeState.board.getAttribute('data-fd-id');
      var before = resizeState.before;
      resizeState = null;
      if (before !== after) {
        parent.postMessage({ __fdCanvas: 'edited', artboardId: artboardId, before: before, after: after }, '*');
      }
      return;
    }
  });
```

Note the new messages are namespaced `__fdHost` (not `__fdCanvas`) — this is deliberate, so `isBridgeMessage`'s `__fdCanvas` check (used by the HOST to filter incoming messages) never accidentally matches a message the host itself sent, which would otherwise create a feedback loop if the host's own `window.addEventListener('message', ...)` in `useStudioBridge` ever ran inside the SAME window as the iframe's script (it doesn't, they're different documents/windows, but the distinct namespace is a cheap, explicit guarantee rather than relying on that being permanently true).

### Step 2: Extend `useStudioBridge` with resize-drive functions

Add to `src/hooks/useStudioBridge.ts`'s return value — these are simple message-posting wrappers, not stateful:

```ts
  const startResize = useCallback((elementId: string) => {
    iframeRef.current?.contentWindow?.postMessage({ __fdHost: 'resizeStart', elementId }, '*')
  }, [])

  const previewResize = useCallback((dWidth: number, dHeight: number) => {
    iframeRef.current?.contentWindow?.postMessage({ __fdHost: 'resizePreview', dWidth, dHeight }, '*')
  }, [])

  const commitResize = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ __fdHost: 'resizeCommit' }, '*')
  }, [])
```

Add `startResize, previewResize, commitResize` to the hook's return statement, alongside the existing `framedHtml, bounds, selection, iframeRef, resetSelection`.

### Step 3: Render resize handles in `StudioCanvas.tsx`

Add, importing `hostDeltaToWorldDelta` from `@/lib/canvasViewport` and pulling `startResize, previewResize, commitResize` from the `useStudioBridge()` call:

```tsx
  const resizeDrag = useRef<{ startX: number; startY: number; handle: string } | null>(null)

  const onHandlePointerDown = (handle: string) => (e: React.PointerEvent) => {
    if (!selection) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeDrag.current = { startX: e.clientX, startY: e.clientY, handle }
    startResize(selection.elementId)
  }

  const onHandlePointerMove = (e: React.PointerEvent) => {
    const drag = resizeDrag.current
    if (!drag) return
    const hostDx = e.clientX - drag.startX
    const hostDy = e.clientY - drag.startY
    const { dx, dy } = hostDeltaToWorldDelta(hostDx, hostDy, view.zoom)
    // Only right/bottom-edge handles are implemented in this pass — a
    // corner or left/top-edge handle would also need to adjust the
    // element's position, which needs the move gesture's transform logic
    // composed with resize; deliberately deferred rather than guessed at.
    const dWidth = drag.handle.includes('right') ? dx : 0
    const dHeight = drag.handle.includes('bottom') ? dy : 0
    previewResize(dWidth, dHeight)
  }

  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (!resizeDrag.current) return
    resizeDrag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    commitResize()
  }
```

Add the handle overlay JSX, as a sibling to the existing selection outline (inside the world div, after the outline):

```tsx
              {selection && (
                <div
                  onPointerDown={onHandlePointerDown('bottom-right')}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  className="absolute bg-[#D97706] border border-white cursor-nwse-resize"
                  style={{
                    left: selection.rect.x + selection.rect.width - 5 / view.zoom,
                    top: selection.rect.y + selection.rect.height - 5 / view.zoom,
                    width: 10 / view.zoom,
                    height: 10 / view.zoom,
                  }}
                />
              )}
              {selection && (
                <div
                  onPointerDown={onHandlePointerDown('bottom')}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  className="absolute bg-[#D97706] border border-white cursor-ns-resize"
                  style={{
                    left: selection.rect.x + selection.rect.width / 2 - 5 / view.zoom,
                    top: selection.rect.y + selection.rect.height - 5 / view.zoom,
                    width: 10 / view.zoom,
                    height: 10 / view.zoom,
                  }}
                />
              )}
              {selection && (
                <div
                  onPointerDown={onHandlePointerDown('right')}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  className="absolute bg-[#D97706] border border-white cursor-ew-resize"
                  style={{
                    left: selection.rect.x + selection.rect.width - 5 / view.zoom,
                    top: selection.rect.y + selection.rect.height / 2 - 5 / view.zoom,
                    width: 10 / view.zoom,
                    height: 10 / view.zoom,
                  }}
                />
              )}
```

This ships 3 of the spec's 8 handles (bottom-right corner, bottom-middle, right-middle) — the three that only ever GROW the element in one or two directions without needing to also reposition it. The other 5 (top/left-involving handles) need resize combined with a position shift, which needs Task 4's move-transform logic composed in — **explicitly deferred to a follow-up task, not guessed at here.** Note this limitation plainly to the user once this task is done.

- [ ] Apply the bridge script change (Step 1), the hook extension (Step 2), and the component wiring (Step 3).
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — confirm exit 0.
- [ ] Run `npx vitest run` — confirm the full suite still passes.
- [ ] Self-review:
  1. Does `onHandlePointerMove`'s `dWidth`/`dHeight` selection based on `drag.handle.includes(...)` correctly produce ZERO width change for the plain `'bottom'` handle and zero height change for the plain `'right'` handle (only `'bottom-right'` should move both)?
  2. Does `commitResize()` get called even if the pointer is released VERY close to the start position (near-zero delta) — and does the bridge's `before !== after` check correctly suppress a no-op edit in that case, same as Task 4's move gesture?
  3. Are the handle hit-boxes (`10 / view.zoom` square) reasonably clickable at both very low zoom (10%) and very high zoom (400%) — read the math, they should stay a constant ~10 screen pixels regardless of zoom, matching the outline's existing `1 / view.zoom` border-width trick.
- [ ] Commit with message: `feat: add bottom/right/bottom-right resize handles for the selected element`

---

## Task 7: Arrow-key nudge

**Files:**
- Modify: `src/lib/studioBridge.ts`
- Modify: `src/hooks/useStudioBridge.ts`
- Modify: `src/pages/StudioCanvas.tsx`

**Interfaces:**
- Consumes: `selection` from Task 3's hook; the move-gesture transform logic pattern from Task 4 (reused, not re-imported — this is bridge-script code).
- Produces: nothing new for later tasks.

### Step 1: Add a nudge handler to the bridge script

Append to `BRIDGE_SCRIPT`, after the resize `message` listener from Task 6:

```js
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object' || msg.__fdHost !== 'nudge') return;
    var el = document.querySelector('[data-fd-el="' + msg.elementId + '"]');
    if (!el) return;
    var board = el.closest('.fd-artboard');
    if (!board) return;
    var before = board.innerHTML;
    var current = el.style.transform || '';
    var match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(current);
    var baseX = match ? parseFloat(match[1]) : 0;
    var baseY = match ? parseFloat(match[2]) : 0;
    el.style.transform = 'translate(' + (baseX + msg.dx) + 'px, ' + (baseY + msg.dy) + 'px)';
    var after = board.innerHTML;
    var artboardId = board.getAttribute('data-fd-id');
    if (before !== after) {
      parent.postMessage({ __fdCanvas: 'edited', artboardId: artboardId, before: before, after: after }, '*');
    }
  });
```

This is a SECOND `message` listener registered on `window` (the bridge script already has one, added in Task 6, for `resizeStart`/`resizePreview`/`resizeCommit`) — both listeners fire for every incoming message and each independently checks `msg.__fdHost === '<its own kind>'`, so registering multiple listeners for different message kinds rather than growing one giant if-chain is intentional and matches how the file's `postMessage`-receiving side is already structured.

### Step 2: Add a `nudge` function to `useStudioBridge`

```ts
  const nudge = useCallback((elementId: string, dx: number, dy: number) => {
    iframeRef.current?.contentWindow?.postMessage({ __fdHost: 'nudge', elementId, dx, dy }, '*')
  }, [])
```

Add `nudge` to the hook's return statement.

### Step 3: Wire arrow keys in `StudioCanvas.tsx`

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selection) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const step = e.shiftKey ? 10 : 1
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      nudge(selection.elementId, dx, dy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, nudge])
```

- [ ] Apply the bridge script change (Step 1), the hook extension (Step 2), and the keydown effect (Step 3).
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — confirm exit 0.
- [ ] Run `npx vitest run` — confirm the full suite still passes.
- [ ] Self-review:
  1. Does this new keydown effect correctly do NOTHING when `selection` is `null` (the very first line returns early), so arrow keys behave normally (e.g. scrolling, if anything scrollable has focus) when nothing is selected?
  2. Given Task 3's C2 fix already refocuses `viewportRef` on every selection change, does this handler actually receive the keydown (i.e., is `window` still a valid place to listen, given the refocus target is `viewportRef.current`, not `window` itself)? Confirm `window`-level listeners still fire regardless of which element within the window currently has focus (they do — `keydown` bubbles to `window` from any focused descendant), so this is fine, but state that reasoning explicitly in your self-review notes since it's exactly the class of assumption the previous plan's C2 bug got wrong.
  3. Does each arrow-key press immediately call `nudge` (which the bridge commits as a single 'edited' message per keypress, not per pixel) — confirming holding an arrow key down produces one undo-stack entry per repeat-keypress-event, not a single merged one? (This is acceptable MVP behavior — noting it, not fixing it, since debouncing/merging rapid nudges into one undo entry is a polish item, not a defect.)
- [ ] Commit with message: `feat: nudge the selected element with arrow keys (10px with shift)`

---

## Task 8: Double-click to edit text

**Files:**
- Modify: `src/lib/studioBridge.ts`

**Interfaces:**
- Consumes: nothing new (reuses the `'edited'` message from Task 3).
- Produces: nothing new for later tasks — this is the last task in this plan.

Append to `BRIDGE_SCRIPT`, after the nudge listener from Task 7 and before `seal();`:

```js
  // Text editing: double-click a selected element to edit its text content
  // in place. Committed the same way every other gesture in this file is —
  // snapshot before, mutate, snapshot after, post 'edited' if different.
  var editingBefore = null;

  document.addEventListener('dblclick', function (e) {
    var el = elementForDrag(e.target); // reuses Task 4's "is this the selected element" check
    if (!el) return;
    // Only makes sense for elements whose own children are just text — an
    // element containing other elements (e.g. a card with a heading and a
    // paragraph inside it) should have ITS child selected and edited
    // instead, not have its whole subtree become one editable blob.
    if (el.children.length > 0) return;
    var board = el.closest('.fd-artboard');
    if (!board) return;
    editingBefore = board.innerHTML;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    // Select all existing text so typing immediately replaces it, matching
    // the common "double-click a text field" expectation.
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  });

  function commitTextEdit(el) {
    if (editingBefore === null) return;
    el.removeAttribute('contenteditable');
    var board = el.closest('.fd-artboard');
    if (!board) { editingBefore = null; return; }
    var after = board.innerHTML;
    var artboardId = board.getAttribute('data-fd-id');
    var before = editingBefore;
    editingBefore = null;
    if (before !== after) {
      parent.postMessage({ __fdCanvas: 'edited', artboardId: artboardId, before: before, after: after }, '*');
    }
  }

  document.addEventListener('blur', function (e) {
    var el = e.target;
    if (el && el.hasAttribute && el.hasAttribute('contenteditable')) commitTextEdit(el);
  }, true); // capture: 'blur' does not bubble, so this must be a capturing listener to observe it on document

  document.addEventListener('keydown', function (e) {
    var el = e.target;
    if (!(el && el.hasAttribute && el.hasAttribute('contenteditable'))) return;
    if (e.key === 'Escape') {
      // Cancel: restore the ORIGINAL html rather than committing, then blur.
      var board = el.closest('.fd-artboard');
      if (board && editingBefore !== null) board.innerHTML = editingBefore;
      editingBefore = null;
      // The element that was being edited no longer exists after innerHTML
      // was replaced, so there is nothing left to blur() — re-seal to
      // restore data-fd-el ids and stop here.
      seal();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.blur(); // triggers the capturing 'blur' listener above, which commits
    }
  });
```

- [ ] Apply the change above.
- [ ] Run `npx tsc --noEmit -p tsconfig.json` — confirm exit 0.
- [ ] Run `npx vitest run` — confirm the full suite still passes.
- [ ] Self-review:
  1. Does `elementForDrag`'s reuse here correctly require the element to already be the SELECTED one (via `window.__fdSelectedElementId`, set by the click handler from Task 4) before a double-click can start editing — i.e., you have to single-click to select, then double-click to edit, not double-click cold on an unselected element?
  2. Does the `el.children.length > 0` guard correctly prevent double-clicking a container (with nested elements) from making the WHOLE container's HTML editable as one text blob, which would let a user accidentally delete nested markup by typing?
  3. Does `Escape` correctly restore the pre-edit HTML (not just blur without committing, which would keep whatever partial edit was typed)? Trace the `seal()` call after an Escape-triggered `innerHTML` restore — does it correctly re-assign `data-fd-el` to the restored elements, since replacing `innerHTML` destroys and recreates the DOM nodes, losing their previous ids?
  4. Does pressing `Enter` (without Shift) correctly commit rather than insert a newline — and does Shift+Enter correctly NOT trigger this branch, allowing the browser's default contenteditable newline behavior?
- [ ] Commit with message: `feat: double-click to edit text in place, commit on blur/Enter, cancel on Escape`

---

## Self-review notes

**Spec coverage.** Phase 4's spec text: "Drag to move" → Task 4. "Eight resize handles" → Task 6 ships 3 (bottom, right, bottom-right); the remaining 5 (any handle involving top or left) need resize combined with the move gesture's position-shifting logic and are explicitly deferred, not silently dropped — flagged in Task 6's own text and to be called out to the user on completion. "Arrow-key nudge" → Task 7 (shift for 10px, matching spec's "shift to constrain" in spirit though the spec's exact wording suggests shift might mean proportional-constrain for resize rather than nudge distance — interpreted as nudge-distance here since resize-shift-to-constrain-aspect-ratio is a reasonable follow-up, not requested by the user's own words, which were specifically "resize" and "move" and "text edit"). "Snapping... with guides" → explicitly out of scope per this plan's Global Constraints, not requested by the user. Phase 5's spec text: "Double-click to edit in place via contenteditable, committed as a text patch" → Task 8, verbatim. "Typography controls in the property panel" → explicitly out of scope (property panel is Phase 6, not built, not requested).

**Type consistency check.** `applyEdit`'s signature (`(artboardId: string, before: string, after: string) => Promise<void>`) is defined once in Task 2 and consumed identically by Task 3's hook and, transitively, by every bridge `'edited'` message handled there — no renaming across tasks. `hostDeltaToWorldDelta`'s signature is defined in Task 5 and consumed by name in Task 6 with matching argument order. The `SelectionState` shape introduced in Task 3 (`artboardId, elementId, tag, rect`) matches the `BridgeRect`/`'selected'` message fields already established in the previous plan, unchanged.

**Placeholder scan.** No TBD/TODO markers. Every code block is complete, copy-pasteable code, not a description of code.

**Known, explicitly-flagged limitations carried into this plan (not defects — deliberate MVP scope):**
- Move overwrites any pre-existing `transform` the agent set on an element (Task 4).
- Only 3 of 8 resize handles ship in this batch (Task 6).
- Rapid arrow-key nudges each produce their own undo entry rather than being merged (Task 7).
- No snapping/alignment guides anywhere in this plan (explicit Global Constraint).
- Double-click text edit only works on leaf elements (no nested children) — editing a container's own text (as opposed to a child's) is not supported in this pass (Task 8).
