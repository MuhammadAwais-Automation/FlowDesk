import { describe, expect, it } from 'vitest'
import { resolveInlineDictationTarget, validateInlineDictationTranscript } from './inlineDictation'

const accounts = [{ email: 'First@Example.com', partition: 'gmail-first' }, { email: 'second@example.com', partition: 'gmail-second' }]

describe('inline dictation boundary', () => {
  it('binds a run to the selected account partition and never accepts a renderer partition', () => {
    expect(resolveInlineDictationTarget({ provider: 'gemini', accountId: 'SECOND@example.com', partition: 'evil', surface: 'universal', surfaceSessionId: 'u-1' }, accounts)).toEqual({
      ok: true,
      target: { provider: 'gemini', accountId: 'second@example.com', accountEmail: 'second@example.com', partition: 'gmail-second', surface: 'universal', surfaceSessionId: 'u-1' },
    })
  })

  it('rejects unregistered accounts and invalid surface values', () => {
    expect(resolveInlineDictationTarget({ provider: 'chatgpt', accountId: 'none@example.com', surface: 'agent', surfaceSessionId: 'a' }, accounts)).toEqual({ ok: false, error: 'account_not_found' })
    expect(resolveInlineDictationTarget({ provider: 'chatgpt', accountId: 'first@example.com', surface: 'other', surfaceSessionId: 'a' }, accounts)).toEqual({ ok: false, error: 'invalid_request' })
  })

  it('accepts only bounded, non-empty transcript events', () => {
    expect(validateInlineDictationTranscript('  hello world  ')).toBe('hello world')
    expect(validateInlineDictationTranscript('')).toBeNull()
    expect(validateInlineDictationTranscript('x'.repeat(20_001))).toBeNull()
  })
})
