// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fontFaceCss, fontFaceCssFor, loadFontInDocument } from './fontLoader'
import { FONT_CATALOGUE } from './fontCatalogue'

const sample = FONT_CATALOGUE[0]

describe('fontFaceCss', () => {
  it('names the family exactly as the catalogue does', () => {
    expect(fontFaceCss(sample)).toContain(`font-family: '${sample.family}'`)
  })
  it('references a woff2 file, never a remote url', () => {
    const css = fontFaceCss(sample)
    expect(css).toContain('woff2')
    expect(css).not.toContain('https://')
    expect(css).not.toContain('fonts.googleapis.com')
  })
})

describe('fontFaceCssFor', () => {
  it('joins several families into one blob', () => {
    const css = fontFaceCssFor(FONT_CATALOGUE.slice(0, 3).map((f) => f.id))
    expect((css.match(/@font-face/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
  it('silently skips ids that do not exist rather than throwing', () => {
    expect(() => fontFaceCssFor(['nope'])).not.toThrow()
  })
})

describe('loadFontInDocument', () => {
  it('injects one style element the first time', () => {
    const doc = document.implementation.createHTMLDocument()
    loadFontInDocument(sample, doc)
    expect(doc.querySelectorAll(`[data-fd-font="${sample.id}"]`)).toHaveLength(1)
  })
  it('is idempotent — a second call adds nothing', () => {
    const doc = document.implementation.createHTMLDocument()
    loadFontInDocument(sample, doc)
    loadFontInDocument(sample, doc)
    expect(doc.querySelectorAll(`[data-fd-font="${sample.id}"]`)).toHaveLength(1)
  })
})
