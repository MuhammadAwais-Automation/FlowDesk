import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'fd-flow-holds-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))
const { flowHold, holdFlowAccount, heldError, HOLD_HOURS, UNUSUAL_ACTIVITY } = await import('./flowHolds')

describe('flowHolds', () => {
  it('parks a flagged account for HOLD_HOURS and saves it across restarts', () => {
    const now = Date.parse('2026-10-13T20:00:00Z')
    const until = holdFlowAccount('gmail-a', 'Failed: We noticed some unusual activity', now)
    expect(Date.parse(until) - now).toBe(HOLD_HOURS * 3_600_000)
    expect(flowHold('gmail-a', now + 60_000)?.until).toBe(until)
    expect(flowHold('gmail-b', now)).toBeNull()
    expect(JSON.parse(readFileSync(join(dir, 'flow-holds.json'), 'utf8'))['gmail-a'].until).toBe(until)
    expect(heldError(flowHold('gmail-a', now)!)).toContain(until)
  })

  it('lets the account go once the hold runs out', () => {
    const now = Date.parse('2026-10-13T20:00:00Z')
    holdFlowAccount('gmail-c', 'x', now)
    expect(flowHold('gmail-c', now + HOLD_HOURS * 3_600_000 + 1)).toBeNull()
  })

  it('recognises Flow\'s refusal in both its page and RPC wording', () => {
    expect(UNUSUAL_ACTIVITY.test('Failed: We noticed some unusual activity. Please visit the help centre')).toBe(true)
    expect(UNUSUAL_ACTIVITY.test('PUBLIC_ERROR_UNUSUAL_ACTIVITY')).toBe(true)
    expect(UNUSUAL_ACTIVITY.test('PUBLIC_ERROR_UNSAFE_GENERATION')).toBe(false)
  })
})
