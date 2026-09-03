import { describe, expect, it, vi } from 'vitest'
import type { AggregatedOverride } from './designMemory'

let preferences: AggregatedOverride[] = []
vi.mock('./designMemory', () => ({
  getLearnedPreferences: () => preferences,
}))

const { getDesignGuide } = await import('./designGuide')

describe('getDesignGuide', () => {
  it('returns non-empty text', () => {
    expect(getDesignGuide().length).toBeGreaterThan(100)
  })

  it('states the three-colour rule', () => {
    expect(getDesignGuide()).toMatch(/three colours/i)
  })

  it('states the two-typeface rule', () => {
    expect(getDesignGuide()).toMatch(/two typefaces/i)
  })

  it('warns against low-opacity per-element texture, the mistake that already happened once', () => {
    expect(getDesignGuide()).toMatch(/0\.14/)
  })

  it('warns against scaleX as a fake condensed face', () => {
    expect(getDesignGuide()).toMatch(/scaleX/)
  })

  it('is the same string every call — a stable tool result, not regenerated text', () => {
    expect(getDesignGuide()).toBe(getDesignGuide())
  })

  it('has no Learned preferences section when nothing has qualified yet', () => {
    preferences = []
    expect(getDesignGuide()).not.toMatch(/Learned preferences/)
  })

  it('appends a Learned preferences section, phrased as guidance, once a preference qualifies', () => {
    preferences = [
      { property: 'font-size', agentValue: '48px', userValue: '96px', count: 3, lastAt: '2026-01-01T00:00:00.000Z' },
    ]
    const guide = getDesignGuide()
    expect(guide).toMatch(/## Learned preferences/)
    // Guidance, not a raw data dump: no literal JSON keys like "count" or "lastAt".
    expect(guide).not.toMatch(/"count"/)
    expect(guide).not.toMatch(/"lastAt"/)
    expect(guide).toMatch(/increases/) // 96 > 48
    expect(guide).toMatch(/font-size/)
  })

  it('phrases a non-numeric preference (e.g. a colour) as a replacement, not an increase/decrease', () => {
    preferences = [
      { property: 'background-color', agentValue: '#000000', userValue: '#ff3366', count: 4, lastAt: '2026-01-01T00:00:00.000Z' },
    ]
    const guide = getDesignGuide()
    expect(guide).toMatch(/## Learned preferences/)
    expect(guide).toMatch(/replaces/)
    expect(guide).toMatch(/#ff3366/)
  })

  it('appends the section after the static ALWAYS/NEVER content, without altering it', () => {
    preferences = [
      { property: 'font-size', agentValue: '48px', userValue: '96px', count: 3, lastAt: '2026-01-01T00:00:00.000Z' },
    ]
    const guide = getDesignGuide()
    expect(guide.indexOf('## NEVER')).toBeLessThan(guide.indexOf('## Learned preferences'))
    expect(guide).toMatch(/three colours/i) // static content still present
  })
})
