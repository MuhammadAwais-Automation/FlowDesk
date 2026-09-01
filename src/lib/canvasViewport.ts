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
