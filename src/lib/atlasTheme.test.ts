import { describe, expect, it } from 'vitest'
import { GROUND_TYPE, OBSERVATORY, TYPE_COLOR } from './atlasTheme'
import { KNOWLEDGE_DOC_TYPES } from '@/types/brainKnowledge'

function saturation(hex: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(...channels)
  const min = Math.min(...channels)
  if (max === min) return 0
  const lightness = (max + min) / 2
  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}

describe('TYPE_COLOR', () => {
  it('covers every document type with a distinct colour', () => {
    for (const type of KNOWLEDGE_DOC_TYPES) expect(TYPE_COLOR[type]).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(Object.values(TYPE_COLOR)).size).toBe(KNOWLEDGE_DOC_TYPES.length)
  })

  // 106 of the real store's 163 documents are skills. When the majority is the
  // loudest colour, the map is one green and colour says nothing. The majority
  // has to be the ground the rest is read against.
  it('keeps the ground type quieter than every type it carries', () => {
    expect(GROUND_TYPE).toBe('skill')
    const ground = saturation(TYPE_COLOR[GROUND_TYPE])
    for (const type of KNOWLEDGE_DOC_TYPES) {
      if (type === GROUND_TYPE || type === 'note') continue
      expect(saturation(TYPE_COLOR[type])).toBeGreaterThan(ground)
    }
  })

  it('gives client the strongest accent, since there are three of them', () => {
    const others = KNOWLEDGE_DOC_TYPES
      .filter(type => type !== 'client')
      .map(type => saturation(TYPE_COLOR[type]))
    expect(saturation(TYPE_COLOR.client)).toBeGreaterThanOrEqual(Math.max(...others))
  })
})

describe('OBSERVATORY', () => {
  it('is a dark surface with readable text on it', () => {
    for (const value of Object.values(OBSERVATORY)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    const luminance = (hex: string) => [1, 3, 5]
      .map(offset => parseInt(hex.slice(offset, offset + 2), 16))
      .reduce((total, channel) => total + channel, 0) / 3
    expect(luminance(OBSERVATORY.canvas)).toBeLessThan(40)
    expect(luminance(OBSERVATORY.text)).toBeGreaterThan(160)
    expect(luminance(OBSERVATORY.nodeDim)).toBeLessThan(luminance(OBSERVATORY.text))
  })
})
