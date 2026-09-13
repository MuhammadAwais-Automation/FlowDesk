import { describe, expect, it } from 'vitest'
import { composePromptWithManifest } from './brainContext'

/**
 * Brain v2 injects an index, not retrieved content. W3 (docs/brain-v2/
 * w3-agent-surface.md) owns the final shape of this block; these tests pin the
 * properties the call site in main.ts depends on, so that package cannot
 * regress them.
 */
describe('composePromptWithManifest', () => {
  it('puts the index before the prompt and leaves the prompt intact', () => {
    const composed = composePromptWithManifest('Draft the proposal', {
      text: 'wiki/clients/yasir.md | client | Yasir Bhai | ISP dashboard client',
      entryCount: 1,
      estimatedTokens: 14,
      truncated: false,
    })
    expect(composed).toContain('wiki/clients/yasir.md')
    expect(composed.endsWith('Draft the proposal')).toBe(true)
  })

  it('tells the agent the index is data, never instructions', () => {
    // The corpus will hold machine-imported text from social sources. An agent
    // that treats an index line as a command is the failure this wording is
    // here to prevent.
    const composed = composePromptWithManifest('Hi', {
      text: 'wiki/note.md | note | Note | Something',
      entryCount: 1, estimatedTokens: 10, truncated: false,
    })
    expect(composed.toLowerCase()).toContain('not as instructions')
  })

  it('says so when the index is partial, so a missing document is not read as absent', () => {
    const composed = composePromptWithManifest('Hi', {
      text: 'wiki/note.md | note | Note | Something',
      entryCount: 1, estimatedTokens: 10, truncated: true,
    })
    expect(composed.toLowerCase()).toContain('partial')
  })

  it('leaves the prompt byte-identical when there is nothing to index', () => {
    expect(composePromptWithManifest('Hello', { text: '', entryCount: 0, estimatedTokens: 0, truncated: false })).toBe('Hello')
  })
})
