import { describe, expect, it } from 'vitest'
import { composePromptWithBrain } from './brainContext'

describe('composePromptWithBrain', () => {
  it('adds only compact cited memory before the current user prompt', () => {
    const prompt = composePromptWithBrain('Draft the proposal', {
      summary: '[1] Client prefers weekly delivery',
      citations: [{ id: 'c1', memoryId: 'm1', text: 'Client prefers weekly delivery', kind: 'preference', scopeId: 's1', sourceRef: 'brain://memory/m1', score: 1 }],
      conflicts: [], scopePath: ['s1'], estimatedTokens: 12,
    })
    expect(prompt).toContain('Trusted FlowDesk Brain context')
    expect(prompt).toContain('brain://memory/m1')
    expect(prompt.endsWith('Draft the proposal')).toBe(true)
  })

  it('leaves the prompt unchanged when retrieval is empty', () => {
    expect(composePromptWithBrain('Hello', { summary: '', citations: [], conflicts: [], scopePath: [], estimatedTokens: 0 })).toBe('Hello')
  })
})
