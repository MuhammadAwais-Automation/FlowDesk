import { describe, it, expect } from 'vitest'
import { FONT_CATALOGUE, findFont, searchFonts } from './fontCatalogue'

describe('FONT_CATALOGUE', () => {
  it('ships at least 100 families', () => {
    expect(FONT_CATALOGUE.length).toBeGreaterThanOrEqual(100)
  })
  it('gives every family a unique id', () => {
    expect(new Set(FONT_CATALOGUE.map(f => f.id)).size).toBe(FONT_CATALOGUE.length)
  })
  it('gives every family at least one weight', () => {
    expect(FONT_CATALOGUE.every(f => f.weights.length > 0)).toBe(true)
  })
  it('covers every category the panel offers', () => {
    const categories = new Set(FONT_CATALOGUE.map(f => f.category))
    for (const c of ['display', 'sans', 'serif', 'mono']) expect(categories).toContain(c)
  })
  it('includes the condensed displays the reference posters need', () => {
    const families = FONT_CATALOGUE.map(f => f.family)
    expect(families).toContain('Anton')
    expect(families).toContain('Oswald')
  })
})

describe('searchFonts', () => {
  it('matches on family name, case-insensitively', () => {
    expect(searchFonts('anton').some(f => f.family === 'Anton')).toBe(true)
  })
  it('filters by category when one is given', () => {
    expect(searchFonts('', 'mono').every(f => f.category === 'mono')).toBe(true)
  })
  it('returns an empty list rather than throwing on nonsense', () => {
    expect(searchFonts('zzzznotafont')).toEqual([])
  })
})

describe('findFont', () => {
  it('finds by id', () => {
    expect(findFont(FONT_CATALOGUE[0].id)?.family).toBe(FONT_CATALOGUE[0].family)
  })
  it('returns undefined for an unknown id', () => {
    expect(findFont('nope')).toBeUndefined()
  })
})
