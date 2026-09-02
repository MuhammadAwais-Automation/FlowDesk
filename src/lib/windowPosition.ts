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
