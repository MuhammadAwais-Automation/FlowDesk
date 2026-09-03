import { describe, it, expect } from 'vitest'
import { effectToCss, EFFECT_DEFAULTS, type EffectKind } from './textEffects'

/**
 * Counts distinct shadow layers in a `text-shadow` value by matching the
 * `dx dy blur` triple that opens each layer, rather than splitting on commas —
 * echo/glitch colours are `rgba(r, g, b, a)`, which contain internal commas
 * that would make a naive comma-split overcount a single layer as several.
 */
function countShadowLayers(textShadow: string): number {
  return (textShadow.match(/-?\d+(\.\d+)?px\s+-?\d+(\.\d+)?px\s+-?\d+(\.\d+)?px/g) ?? []).length
}

describe('effectToCss', () => {
  it('returns nothing for none, so a cleared effect writes no properties', () => {
    expect(effectToCss({ kind: 'none' })).toEqual({})
  })
  it('places a shadow at the requested angle and distance', () => {
    const css = effectToCss({ kind: 'shadow', offset: 10, direction: 0, blur: 4, color: '#000' })
    expect(css.textShadow).toMatch(/10px 0px 4px/)
  })
  it('hollow leaves the fill transparent and draws a stroke', () => {
    const css = effectToCss({ kind: 'hollow', thickness: 2, color: '#fff' })
    expect(css.color).toBe('transparent')
    expect(css.webkitTextStroke).toBe('2px #fff')
  })
  it('neon stacks several shadows of increasing blur, not one', () => {
    const css = effectToCss({ kind: 'neon', intensity: 60, color: '#0ff' })
    expect((css.textShadow ?? '').split(',').length).toBeGreaterThanOrEqual(3)
  })
  it('echo repeats the text offset at decreasing opacity', () => {
    const css = effectToCss({ kind: 'echo', offset: 8, color: '#f00' })
    // Counts actual shadow layers, not raw commas — echo's rgba() colours contain
    // internal commas, so a naive split(',').length would pass even if echo
    // regressed to emitting a single shadow.
    expect(countShadowLayers(css.textShadow ?? '')).toBe(2)
  })
  it('echo copy count grows with intensity, so its slider is not decorative either', () => {
    const low = effectToCss({ kind: 'echo', offset: 8, intensity: 30, color: '#f00' })
    const high = effectToCss({ kind: 'echo', offset: 8, intensity: 80, color: '#f00' })
    expect(countShadowLayers(low.textShadow ?? '')).toBe(2)
    expect(countShadowLayers(high.textShadow ?? '')).toBe(3)
  })
  it('intensity actually changes the output, so the slider is not decorative', () => {
    const low = effectToCss({ kind: 'neon', intensity: 10, color: '#0ff' })
    const high = effectToCss({ kind: 'neon', intensity: 90, color: '#0ff' })
    expect(low.textShadow).not.toBe(high.textShadow)
  })
})

describe('EFFECT_DEFAULTS', () => {
  it('has an entry for every kind, so selecting one never yields undefined', () => {
    for (const kind of ['none', 'shadow', 'lift', 'hollow', 'splice', 'echo', 'neon', 'glitch'] as const) {
      expect(EFFECT_DEFAULTS[kind].kind).toBe(kind)
    }
  })
})

describe('effectToCss additional coverage', () => {
  const kinds: EffectKind[] = ['none', 'shadow', 'lift', 'hollow', 'splice', 'echo', 'neon', 'glitch']

  it('round-trips every default through effectToCss without emitting "undefined" in the CSS', () => {
    for (const kind of kinds) {
      const css = effectToCss(EFFECT_DEFAULTS[kind])
      const serialized = JSON.stringify(css)
      expect(serialized).not.toMatch(/undefined/)
    }
  })

  it('direction 0 puts the shadow purely on the +x axis with no floating-point noise', () => {
    const css = effectToCss({ kind: 'shadow', offset: 10, direction: 0, blur: 0, color: '#000' })
    expect(css.textShadow).toBe('10px 0px 0px #000')
  })

  it('lift places its shadow directly below regardless of direction (it is not user-steerable)', () => {
    const css = effectToCss({ kind: 'lift', offset: 6, blur: 12, intensity: 40, color: '#000000' })
    expect(css.textShadow).toMatch(/^0px \d/)
  })

  it('glitch produces two colour-offset copies', () => {
    const css = effectToCss({ kind: 'glitch', offset: 4, direction: 0, color: '#00fff9' })
    const shadows = (css.textShadow ?? '').split(',')
    expect(shadows.length).toBe(2)
  })

  it('splice combines a stroke with an offset shadow', () => {
    const css = effectToCss({ kind: 'splice', offset: 6, direction: 45, thickness: 2, color: '#000' })
    expect(css.webkitTextStroke).toBe('2px #000')
    expect(css.textShadow).toBeTruthy()
  })

  it('every kind but none produces at least one CSS property', () => {
    for (const kind of kinds) {
      const css = effectToCss(EFFECT_DEFAULTS[kind])
      if (kind === 'none') {
        expect(Object.keys(css).length).toBe(0)
      } else {
        expect(Object.keys(css).length).toBeGreaterThan(0)
      }
    }
  })
})
