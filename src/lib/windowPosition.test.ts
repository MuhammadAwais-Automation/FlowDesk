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
