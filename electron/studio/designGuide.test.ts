import { describe, expect, it } from 'vitest'
import { getDesignGuide } from './designGuide'

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
})
