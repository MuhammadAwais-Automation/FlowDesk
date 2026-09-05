import { describe, expect, it } from 'vitest'
import { brainModePolicy, normalizeAgentBrainMode } from './brainMode'

describe('Agent Brain mode', () => {
  it('defaults to continuity and learning', () => {
    expect(normalizeAgentBrainMode(undefined)).toEqual({ use: true, learn: true, temporary: false })
  })

  it('makes temporary sessions read-only without automatic context', () => {
    expect(brainModePolicy(normalizeAgentBrainMode({ use: true, learn: true, temporary: true }))).toEqual({
      automaticContext: false,
      durableWrites: false,
      explicitRead: true,
    })
  })

  it('allows retrieval without learning', () => {
    expect(brainModePolicy(normalizeAgentBrainMode({ use: true, learn: false }))).toEqual({
      automaticContext: true,
      durableWrites: false,
      explicitRead: true,
    })
  })
})
