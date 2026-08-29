import { describe, expect, it } from 'vitest'
import { buildCatchUp, type CatchUpTurn } from './agentCatchUp'

const turns: CatchUpTurn[] = [
  { role: 'user', content: 'fix the image bug' },
  { role: 'assistant', content: 'fixed the timeout' },
  { role: 'user', content: 'now add a view tool' },
  { role: 'assistant', content: 'view tool added' },
]

describe('buildCatchUp', () => {
  it('returns null when the provider has already seen every turn', () => {
    // The common case by far: the user stayed on one provider, so no
    // catch-up text is sent and the turn costs nothing extra.
    expect(buildCatchUp(turns, 4)).toBeNull()
  })

  it('returns null for an empty transcript', () => {
    expect(buildCatchUp([], 0)).toBeNull()
  })

  it('covers exactly the turns the provider missed, and no others', () => {
    const text = buildCatchUp(turns, 2)
    expect(text).toContain('now add a view tool')
    expect(text).toContain('view tool added')
    expect(text).not.toContain('fix the image bug')
    expect(text).not.toContain('fixed the timeout')
  })

  it('covers the whole transcript when the provider has never seen it', () => {
    const text = buildCatchUp(turns, 0)
    expect(text).toContain('fix the image bug')
    expect(text).toContain('view tool added')
  })

  it('labels each turn with its role so the provider can tell them apart', () => {
    const text = buildCatchUp(turns, 3) ?? ''
    expect(text).toContain('[assistant]')
  })

  it('truncates an overlong turn instead of sending it whole', () => {
    const long: CatchUpTurn[] = [{ role: 'user', content: 'x'.repeat(5000) }]
    const text = buildCatchUp(long, 0, 100) ?? ''
    expect(text.length).toBeLessThan(400)
    expect(text).toContain('[truncated]')
  })

  it('treats a watermark ahead of the transcript as fully synced', () => {
    // Defensive: a stale watermark must never index past the end and throw.
    expect(buildCatchUp(turns, 99)).toBeNull()
  })
})
