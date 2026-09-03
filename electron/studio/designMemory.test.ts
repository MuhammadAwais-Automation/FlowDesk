import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

const designMemory = await import('./designMemory')
const {
  aggregateOverrides,
  sameShape,
  recordAgentProposal,
  detectOverride,
  clearPendingProposals,
  checkForOverrides,
  recordOverride,
  loadDesignMemory,
  getLearnedPreferences,
  resetDesignMemoryForTests,
  PREFERENCE_THRESHOLD,
} = designMemory

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fd-studio-design-memory-'))
  resetDesignMemoryForTests()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

function event(overrides: Partial<{ property: string; agentValue: string; userValue: string; at: string }> = {}) {
  return {
    property: 'font-size',
    agentValue: '48px',
    userValue: '96px',
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('aggregateOverrides — pure logic', () => {
  it('treats a single override as noise: nothing surfaces', () => {
    expect(aggregateOverrides([event()])).toEqual([])
  })

  it('treats two overrides of the same shape as still noise', () => {
    expect(aggregateOverrides([event({ at: '2026-01-01T00:00:00.000Z' }), event({ at: '2026-01-01T00:01:00.000Z' })])).toEqual([])
  })

  it('three overrides of the same shape becomes a stated preference', () => {
    expect(PREFERENCE_THRESHOLD).toBe(3)
    const events = [
      event({ at: '2026-01-01T00:00:00.000Z', userValue: '96px' }),
      event({ at: '2026-01-01T00:01:00.000Z', userValue: '98px' }), // within font-size tolerance
      event({ at: '2026-01-01T00:02:00.000Z', userValue: '95px' }),
    ]
    const result = aggregateOverrides(events)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ property: 'font-size', count: 3, userValue: '95px', lastAt: '2026-01-01T00:02:00.000Z' })
  })

  it('contradictory overrides keep only the most recent cluster once it also reaches the threshold', () => {
    const events = [
      // First pattern: bump to ~96px, three times.
      event({ at: '2026-01-01T00:00:00.000Z', userValue: '96px' }),
      event({ at: '2026-01-01T00:01:00.000Z', userValue: '95px' }),
      event({ at: '2026-01-01T00:02:00.000Z', userValue: '97px' }),
      // User reverses course: now consistently drops it to ~60px, three times.
      event({ at: '2026-01-01T01:00:00.000Z', userValue: '60px' }),
      event({ at: '2026-01-01T01:01:00.000Z', userValue: '61px' }),
      event({ at: '2026-01-01T01:02:00.000Z', userValue: '59px' }),
    ]
    const result = aggregateOverrides(events)
    // Exactly one preference for font-size — the newer pattern, not both.
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ property: 'font-size', userValue: '59px', count: 3 })
  })

  it('does not let a not-yet-qualifying contradictory cluster suppress a qualifying older one', () => {
    const events = [
      event({ at: '2026-01-01T00:00:00.000Z', userValue: '96px' }),
      event({ at: '2026-01-01T00:01:00.000Z', userValue: '95px' }),
      event({ at: '2026-01-01T00:02:00.000Z', userValue: '97px' }),
      // Only one override the other way — does not reach the threshold.
      event({ at: '2026-01-01T01:00:00.000Z', userValue: '60px' }),
    ]
    const result = aggregateOverrides(events)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ userValue: '97px', count: 3 })
  })

  it('keeps preferences for different properties independent', () => {
    const fontSize = [0, 1, 2].map(i => event({ at: `2026-01-01T00:0${i}:00.000Z`, property: 'font-size', userValue: '96px' }))
    const family = [0, 1, 2].map(i => event({
      at: `2026-01-01T01:0${i}:00.000Z`, property: 'font-family', agentValue: "'Anton', sans-serif", userValue: "'Oswald', sans-serif",
    }))
    const result = aggregateOverrides([...fontSize, ...family])
    expect(result.map(r => r.property).sort()).toEqual(['font-family', 'font-size'])
  })
})

describe('sameShape', () => {
  it('treats font-size values within tolerance as the same shape', () => {
    expect(sameShape('font-size', '96px', '98px')).toBe(true)
    expect(sameShape('font-size', '96px', '150px')).toBe(false)
  })

  it('requires exact match for a discrete property like font-family', () => {
    expect(sameShape('font-family', "'Anton', sans-serif", "'Anton', sans-serif")).toBe(true)
    expect(sameShape('font-family', "'Anton', sans-serif", "'Oswald', sans-serif")).toBe(false)
  })

  it('requires exact match for colours — no numeric tolerance applies', () => {
    expect(sameShape('background-color', '#ff0000', '#fe0000')).toBe(false)
    expect(sameShape('background-color', '#FF0000', '#ff0000')).toBe(true)
  })

  it('does not treat mismatched units as the same shape even if the numbers are close', () => {
    expect(sameShape('font-size', '96px', '96%')).toBe(false)
  })
})

describe('recordAgentProposal + detectOverride', () => {
  it('is not an override when the panel writes back the same value the agent set', () => {
    recordAgentProposal('el-1', 'font-size', '96px')
    expect(detectOverride('el-1', 'font-size', '96px')).toBeNull()
  })

  it('is an override when the panel writes a different value shortly after', () => {
    recordAgentProposal('el-1', 'font-size', '48px')
    const result = detectOverride('el-1', 'font-size', '96px')
    expect(result).toMatchObject({ property: 'font-size', agentValue: '48px', userValue: '96px' })
  })

  it('is not an override once the proposal has expired (TTL)', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    recordAgentProposal('el-1', 'font-size', '48px', start)
    const threeMinutesLater = start + 3 * 60 * 1000
    expect(detectOverride('el-1', 'font-size', '96px', threeMinutesLater)).toBeNull()
  })

  it('is an override right up to the TTL boundary', () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z')
    recordAgentProposal('el-1', 'font-size', '48px', start)
    const almostTwoMinutesLater = start + 2 * 60 * 1000 - 1
    expect(detectOverride('el-1', 'font-size', '96px', almostTwoMinutesLater)).not.toBeNull()
  })

  it('consumes the proposal — a second write in the same window does not double-count', () => {
    recordAgentProposal('el-1', 'font-size', '48px')
    expect(detectOverride('el-1', 'font-size', '96px')).not.toBeNull()
    expect(detectOverride('el-1', 'font-size', '120px')).toBeNull()
  })

  it('ignores a write to a property with no pending proposal', () => {
    expect(detectOverride('el-1', 'font-size', '96px')).toBeNull()
  })

  it('clearPendingProposals drops everything pending', () => {
    recordAgentProposal('el-1', 'font-size', '48px')
    clearPendingProposals()
    expect(detectOverride('el-1', 'font-size', '96px')).toBeNull()
  })
})

describe('checkForOverrides — reading current values out of artboard HTML', () => {
  it('records an override when the artboard HTML now disagrees with a pending agent proposal', async () => {
    recordAgentProposal('hero', 'font-size', '48px')
    const artboardHtml = `<div data-fd-el="hero" style="font-size: 96px;">Hero</div>`
    await checkForOverrides(artboardHtml)
    expect(getLearnedPreferences()).toEqual([]) // one override alone is still noise
    // Repeat twice more to cross the threshold and confirm it was actually recorded.
    recordAgentProposal('hero', 'font-size', '48px')
    await checkForOverrides(`<div data-fd-el="hero" style="font-size: 95px;">Hero</div>`)
    recordAgentProposal('hero', 'font-size', '48px')
    await checkForOverrides(`<div data-fd-el="hero" style="font-size: 97px;">Hero</div>`)
    const prefs = getLearnedPreferences()
    expect(prefs).toHaveLength(1)
    expect(prefs[0]).toMatchObject({ property: 'font-size', count: 3 })
  })

  it('records nothing when the panel HTML matches what the agent proposed', async () => {
    recordAgentProposal('hero', 'font-size', '96px')
    await checkForOverrides(`<div data-fd-el="hero" style="font-size: 96px;">Hero</div>`)
    expect(getLearnedPreferences()).toEqual([])
  })

  it('records nothing for an element with no pending proposal — the ordinary, non-correcting edit', async () => {
    await checkForOverrides(`<div data-fd-el="other" style="font-size: 200px;">Other</div>`)
    expect(getLearnedPreferences()).toEqual([])
  })
})

describe('file persistence', () => {
  it('recordOverride persists to userData as a sibling of studio-documents, not inside a document folder', async () => {
    await recordOverride(event())
    const raw = await readFile(join(root, 'studio-design-memory.json'), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.overrides).toHaveLength(1)
    expect(parsed.overrides[0]).toMatchObject({ property: 'font-size', userValue: '96px' })
  })

  it('loadDesignMemory reads back a persisted log into the in-memory cache getLearnedPreferences reads from', async () => {
    await recordOverride(event({ at: '2026-01-01T00:00:00.000Z', userValue: '96px' }))
    await recordOverride(event({ at: '2026-01-01T00:01:00.000Z', userValue: '95px' }))
    await recordOverride(event({ at: '2026-01-01T00:02:00.000Z', userValue: '97px' }))

    resetDesignMemoryForTests() // simulate the cache being empty, as at process start
    expect(getLearnedPreferences()).toEqual([]) // nothing loaded yet

    await loadDesignMemory()
    const prefs = getLearnedPreferences()
    expect(prefs).toHaveLength(1)
    expect(prefs[0]).toMatchObject({ property: 'font-size', count: 3 })
  })

  it('is missing-file tolerant — no persisted log yet is an empty log, not an error', async () => {
    await loadDesignMemory()
    expect(getLearnedPreferences()).toEqual([])
  })
})
