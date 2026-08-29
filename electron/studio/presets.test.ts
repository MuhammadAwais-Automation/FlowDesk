import { describe, expect, it } from 'vitest'
import { STUDIO_PRESETS, findPreset } from './presets'

describe('STUDIO_PRESETS', () => {
  it('holds all 31 presets from the reference repo', () => {
    expect(STUDIO_PRESETS).toHaveLength(31)
  })

  it('gives every preset the fields the agent chooses on', () => {
    for (const preset of STUDIO_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9-]+$/)
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.vibe.length).toBeGreaterThan(0)
    }
  })

  it('carries real CSS tokens, since a preset with none is just a name', () => {
    expect(STUDIO_PRESETS.filter(p => p.cssTokens.includes(':root')).length).toBeGreaterThanOrEqual(25)
  })
})

describe('findPreset', () => {
  it('finds by name regardless of case, and by id', () => {
    const first = STUDIO_PRESETS[0]
    expect(findPreset(first.name)?.id).toBe(first.id)
    expect(findPreset(first.name.toUpperCase())?.id).toBe(first.id)
    expect(findPreset(first.id)?.name).toBe(first.name)
  })

  it('returns null for an unknown or empty name rather than guessing', () => {
    expect(findPreset('not a preset')).toBeNull()
    expect(findPreset('')).toBeNull()
  })
})
