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
