import { describe, expect, it } from 'vitest'
import { buildContinuationPrompt, groupContinuations, planContinuationTurns } from './continuations'

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

describe('exactly-once continuation drain', () => {
  // One 10-second drain window holding an interactive completion and two
  // monitor resumes for the same session plus one for another session.
  const window = [
    { id: 'c1', jobId: 'j1', sessionId: 'session-a' },
    { id: 'c2', jobId: 'j2', sessionId: 'monitor-scope-1' },
    { id: 'c3', jobId: 'j3', sessionId: 'monitor-scope-1' },
    { id: 'c4', jobId: 'j4', sessionId: 'monitor-scope-2' },
  ]

  it('still coalesces one session to one turn when monitor resumes join the window', () => {
    const turns = planContinuationTurns({ continuations: window, manualTurnActive: false })
    expect(turns.map(turn => [turn.sessionId, turn.items.length])).toEqual([
      ['session-a', 1],
      ['monitor-scope-1', 2],
      ['monitor-scope-2', 1],
    ])
    // Every queued continuation is accounted for exactly once across the turns.
    expect(turns.flatMap(turn => turn.items.map(item => item.id)).sort()).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('never interrupts a manual Agent turn that is already running', () => {
    expect(planContinuationTurns({ continuations: window, manualTurnActive: true })).toEqual([])
  })

  it('keeps monitor scopes in separate turns so no turn mixes two scopes', () => {
    const turns = planContinuationTurns({ continuations: window, manualTurnActive: false })
    const monitorTurns = turns.filter(turn => turn.sessionId.startsWith('monitor-'))
    expect(monitorTurns).toHaveLength(2)
    expect(new Set(monitorTurns.map(turn => turn.sessionId)).size).toBe(2)
  })

  it('builds one compact prompt for a monitor turn that carries several jobs', () => {
    const turn = planContinuationTurns({ continuations: window, manualTurnActive: false })
      .find(candidate => candidate.sessionId === 'monitor-scope-1')
    const prompt = buildContinuationPrompt(turn?.sessionId ?? '', [
      { id: 'j2', recipeId: 'linkedin.opportunity_scan', status: 'completed', result: { recordCount: 12, artifactRefs: ['artifact://j2/manifest'], rawPayload: 'must-not-leak' } },
      { id: 'j3', recipeId: 'whatsapp.unread_intelligence', status: 'completed', result: { recordCount: 4, rawPayload: 'must-not-leak' } },
    ])
    expect(prompt).toContain('monitor-scope-1')
    expect(prompt).toContain('artifact://j2/manifest')
    expect(prompt).not.toContain('must-not-leak')
    expect(prompt.length).toBeLessThan(2000)
  })
})
