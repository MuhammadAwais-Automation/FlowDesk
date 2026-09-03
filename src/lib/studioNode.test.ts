import { describe, it, expect } from 'vitest'
import { PANEL_PROPERTIES, pickPanelStyles, stylePatch, parseLength, formatLength, isTextTag } from './studioNode'

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

  it('covers the typography, stroke/effect output, fill and border properties Tasks 6-7 write', () => {
    const required = [
      'font-family', 'font-weight', 'font-size', 'letter-spacing', 'line-height',
      'text-align', 'text-transform', 'font-style', 'text-decoration-line', 'font-feature-settings',
      '-webkit-text-stroke', 'text-shadow', 'background', 'border',
    ]
    for (const prop of required) {
      expect(PANEL_PROPERTIES).toContain(prop)
    }
  })
})

describe('isTextTag', () => {
  it('treats common copy-bearing tags as text', () => {
    expect(isTextTag('h1')).toBe(true)
    expect(isTextTag('P')).toBe(true) // case-insensitive, since tagName is uppercase in the DOM
    expect(isTextTag('span')).toBe(true)
  })

  it('treats container tags as boxes, not text', () => {
    expect(isTextTag('div')).toBe(false)
    expect(isTextTag('section')).toBe(false)
  })

  it('falls back to "box" for null/undefined/unknown tags rather than throwing', () => {
    expect(isTextTag(null)).toBe(false)
    expect(isTextTag(undefined)).toBe(false)
    expect(isTextTag('marquee')).toBe(false)
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
