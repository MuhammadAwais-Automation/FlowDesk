import { describe, expect, it } from 'vitest'
import { buildContinuationPrompt, groupContinuations } from './continuations'

describe('Agent continuations', () => {
  it('coalesces completed jobs by session', () => {
    const groups = groupContinuations([
      { id: 'c1', jobId: 'j1', sessionId: 's1' },
      { id: 'c2', jobId: 'j2', sessionId: 's1' },
      { id: 'c3', jobId: 'j3', sessionId: 's2' },
    ])
    expect(groups.map(group => [group.sessionId, group.items.length])).toEqual([['s1', 2], ['s2', 1]])
  })

  it('builds a compact manifest-only resume prompt', () => {
    const prompt = buildContinuationPrompt('s1', [
      { id: 'j1', recipeId: 'notebooklm.research', status: 'completed', result: { recordCount: 20, artifactRefs: ['artifact://j1/report'], rawPayload: 'must-not-leak' } },
    ])
    expect(prompt).toContain('artifact://j1/report')
    expect(prompt).toContain('20')
    expect(prompt).not.toContain('must-not-leak')
    expect(prompt.length).toBeLessThan(2000)
  })
})
