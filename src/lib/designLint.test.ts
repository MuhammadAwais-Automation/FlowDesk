import { describe, it, expect } from 'vitest'
import { lintArtboard, type LintNode } from './designLint'

const CANVAS = { width: 1000, height: 1000 }

function node(overrides: Partial<LintNode> = {}): LintNode {
  return {
    elementId: 'n1',
    tag: 'div',
    computedStyles: {},
    rect: { x: 100, y: 100, width: 100, height: 100 },
    ...overrides,
  }
}

describe('lintArtboard', () => {
  describe('rule: more than two font families', () => {
    it('fires when three distinct families are used', () => {
      const nodes = [
        node({ elementId: 'a', tag: 'h1', computedStyles: { 'font-family': 'Anton, sans-serif' } }),
        node({ elementId: 'b', tag: 'p', computedStyles: { 'font-family': '"Playfair Display", serif' } }),
        node({ elementId: 'c', tag: 'span', computedStyles: { 'font-family': 'Courier New, monospace' } }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'font-family-count')).toBe(true)
    })

    it('stays silent with only two distinct families, ignoring fallback stacks', () => {
      const nodes = [
        node({ elementId: 'a', tag: 'h1', computedStyles: { 'font-family': 'Anton, sans-serif' } }),
        node({ elementId: 'b', tag: 'p', computedStyles: { 'font-family': 'Anton, Helvetica, sans-serif' } }),
        node({ elementId: 'c', tag: 'span', computedStyles: { 'font-family': '"Playfair Display", serif' } }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'font-family-count')).toBe(false)
    })
  })

  describe('rule: more than one saturated accent hue', () => {
    it('fires when two distinct saturated hues appear', () => {
      const nodes = [
        node({ elementId: 'a', computedStyles: { color: 'rgb(230, 30, 30)' } }), // red
        node({ elementId: 'b', computedStyles: { 'background-color': 'rgb(30, 60, 230)' } }), // blue
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'accent-hue-count')).toBe(true)
    })

    it('stays silent with one saturated hue plus neutral ground/ink', () => {
      const nodes = [
        node({ elementId: 'a', computedStyles: { color: 'rgb(230, 30, 30)' } }), // red accent
        node({ elementId: 'b', computedStyles: { 'background-color': '#111111' } }), // near-black ground
        node({ elementId: 'c', computedStyles: { color: '#f5f5f5' } }), // near-white ink
        node({ elementId: 'd', computedStyles: { color: 'rgb(235, 25, 25)' } }), // same hue bin as 'a'
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'accent-hue-count')).toBe(false)
    })
  })

  describe('rule: texture layer under 0.25 opacity', () => {
    it('catches the real regression: opacity 0.16 with mix-blend-mode overlay', () => {
      const nodes = [
        node({
          elementId: 'texture',
          computedStyles: { opacity: '0.16', 'mix-blend-mode': 'overlay' },
        }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      const finding = findings.find(f => f.rule === 'texture-opacity-too-low')
      expect(finding).toBeDefined()
      expect(finding?.elementId).toBe('texture')
      expect(finding?.severity).toBe('error')
    })

    it('does not fire on an ordinary fade at the same opacity with no texture blend mode', () => {
      const nodes = [
        node({
          elementId: 'fade',
          computedStyles: { opacity: '0.16' },
        }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'texture-opacity-too-low')).toBe(false)
    })

    it('stays silent when a texture layer is at a healthy opacity', () => {
      const nodes = [
        node({
          elementId: 'texture',
          computedStyles: { opacity: '0.35', 'mix-blend-mode': 'multiply' },
        }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'texture-opacity-too-low')).toBe(false)
    })
  })

  describe('rule: nothing bleeds off the canvas edge', () => {
    it('fires when every node sits fully inside the canvas', () => {
      const nodes = [
        node({ rect: { x: 10, y: 10, width: 50, height: 50 } }),
        node({ elementId: 'b', rect: { x: 500, y: 500, width: 100, height: 100 } }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'nothing-bleeds')).toBe(true)
    })

    it('stays silent when one element bleeds past an edge', () => {
      const nodes = [
        node({ rect: { x: 10, y: 10, width: 50, height: 50 } }),
        node({ elementId: 'b', rect: { x: -20, y: 500, width: 100, height: 100 } }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'nothing-bleeds')).toBe(false)
    })
  })

  describe('rule: hero word under 60% of canvas width', () => {
    it('fires when the largest text node is narrower than 60% of canvas width', () => {
      const nodes = [
        node({
          elementId: 'hero',
          tag: 'h1',
          computedStyles: { 'font-size': '120px' },
          rect: { x: 100, y: 100, width: 300, height: 150 },
        }),
        node({
          elementId: 'body',
          tag: 'p',
          computedStyles: { 'font-size': '16px' },
          rect: { x: 100, y: 300, width: 200, height: 30 },
        }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      const finding = findings.find(f => f.rule === 'hero-word-too-narrow')
      expect(finding).toBeDefined()
      expect(finding?.elementId).toBe('hero')
    })

    it('stays silent when the hero word spans at least 60% of canvas width', () => {
      const nodes = [
        node({
          elementId: 'hero',
          tag: 'h1',
          computedStyles: { 'font-size': '120px' },
          rect: { x: 50, y: 100, width: 800, height: 150 },
        }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'hero-word-too-narrow')).toBe(false)
    })

    it('skips the rule entirely when there are no text nodes', () => {
      const nodes = [
        node({ elementId: 'box', tag: 'div', rect: { x: 0, y: 0, width: 50, height: 50 } }),
      ]
      const findings = lintArtboard(nodes, CANVAS)
      expect(findings.some(f => f.rule === 'hero-word-too-narrow')).toBe(false)
    })
  })

  it('gives every finding a fixHint distinct from its message', () => {
    const nodes = [
      node({ elementId: 'a', tag: 'h1', computedStyles: { 'font-family': 'Anton, sans-serif', 'font-size': '20px' } }),
      node({ elementId: 'b', tag: 'p', computedStyles: { 'font-family': 'Playfair Display, serif' } }),
      node({ elementId: 'c', tag: 'span', computedStyles: { 'font-family': 'Courier New, monospace' } }),
    ]
    const findings = lintArtboard(nodes, CANVAS)
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.fixHint.length).toBeGreaterThan(0)
      expect(f.fixHint).not.toBe(f.message)
    }
  })
})
