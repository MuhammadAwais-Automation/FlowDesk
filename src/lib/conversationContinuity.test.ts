import { describe, expect, it } from 'vitest'
import {
  appendUniqueContinuityEntry,
  appendContinuityEntry,
  buildContextPassport,
  buildHandoffPrompt,
  createContinuityThread,
  getContinuityStats,
  getContinuityEntrySignature,
} from './conversationContinuity'

const now = '2026-06-13T12:00:00.000Z'

describe('conversation continuity helpers', () => {
  it('creates a local continuity thread with stable metadata', () => {
    const thread = createContinuityThread(
      { title: 'Landing page copy', workspaceId: 'workspace-1' },
      () => 'thread-1',
      () => now,
    )

    expect(thread).toEqual({
      id: 'thread-1',
      title: 'Landing page copy',
      workspace_id: 'workspace-1',
      summary: '',
      entries: [],
      created_at: now,
      updated_at: now,
    })
  })

  it('appends trimmed entries without mutating the previous thread', () => {
    const thread = createContinuityThread(
      { title: 'Research task', workspaceId: null },
      () => 'thread-1',
      () => now,
    )

    const updated = appendContinuityEntry(
      thread,
      {
        role: 'assistant',
        content: '  Use a local handoff summary.  ',
        provider: 'claude',
        accountEmail: 'first@example.com',
      },
      () => 'entry-1',
      () => '2026-06-13T12:05:00.000Z',
    )

    expect(thread.entries).toHaveLength(0)
    expect(updated.entries).toEqual([
      {
        id: 'entry-1',
        role: 'assistant',
        content: 'Use a local handoff summary.',
        provider: 'claude',
        account_email: 'first@example.com',
        created_at: '2026-06-13T12:05:00.000Z',
      },
    ])
    expect(updated.updated_at).toBe('2026-06-13T12:05:00.000Z')
  })

  it('rejects empty captured content', () => {
    const thread = createContinuityThread(
      { title: 'Empty capture', workspaceId: null },
      () => 'thread-1',
      () => now,
    )

    expect(() =>
      appendContinuityEntry(
        thread,
        { role: 'assistant', content: '   ', provider: 'chatgpt', accountEmail: null },
        () => 'entry-1',
        () => now,
      ),
    ).toThrow('Cannot add an empty continuity entry')
  })

  it('builds a handoff prompt from summary and recent turns', () => {
    const initial = {
      ...createContinuityThread({ title: 'Feature design', workspaceId: null }, () => 'thread-1', () => now),
      summary: 'We decided to build a user-controlled conversation continuity layer, not a limit bypass tool.',
    }
    const withUser = appendContinuityEntry(
      initial,
      {
        role: 'user',
        content: 'Plan the MVP with capture and continue buttons.',
        provider: 'chatgpt',
        accountEmail: 'first@example.com',
      },
      () => 'entry-1',
      () => '2026-06-13T12:05:00.000Z',
    )
    const withAssistant = appendContinuityEntry(
      withUser,
      {
        role: 'assistant',
        content: 'Use selected-text capture, local storage, and a generated handoff prompt.',
        provider: 'claude',
        accountEmail: 'second@example.com',
      },
      () => 'entry-2',
      () => '2026-06-13T12:06:00.000Z',
    )

    const prompt = buildHandoffPrompt(withAssistant, {
      targetProvider: 'gemini',
      targetAccountEmail: 'third@example.com',
    })

    expect(prompt).toContain('You are continuing a previous conversation in FlowDesk.')
    expect(prompt).toContain('Target provider: gemini')
    expect(prompt).toContain('Target account: third@example.com')
    expect(prompt).toContain('not a limit bypass tool')
    expect(prompt).toContain('[user via chatgpt / first@example.com]')
    expect(prompt).toContain('[assistant via claude / second@example.com]')
  })

  it('reports continuity stats for UI labels', () => {
    const thread = appendContinuityEntry(
      createContinuityThread({ title: 'Stats', workspaceId: null }, () => 'thread-1', () => now),
      { role: 'user', content: 'Hello', provider: 'chatgpt', accountEmail: null },
      () => 'entry-1',
      () => now,
    )

    expect(getContinuityStats(thread)).toEqual({
      entryCount: 1,
      hasContext: true,
      lastUpdatedAt: now,
    })
  })

  it('dedupes repeated auto-captured assistant responses', () => {
    const thread = createContinuityThread({ title: 'Auto capture', workspaceId: null }, () => 'thread-1', () => now)

    const first = appendUniqueContinuityEntry(
      thread,
      {
        role: 'assistant',
        content: 'The final answer is to use a Context Passport.',
        provider: 'claude',
        accountEmail: 'first@example.com',
      },
      () => 'entry-1',
      () => '2026-06-13T12:10:00.000Z',
    )

    const second = appendUniqueContinuityEntry(
      first.thread,
      {
        role: 'assistant',
        content: '  The final answer is to use a Context Passport.  ',
        provider: 'claude',
        accountEmail: 'first@example.com',
      },
      () => 'entry-2',
      () => '2026-06-13T12:11:00.000Z',
    )

    expect(first.added).toBe(true)
    expect(second.added).toBe(false)
    expect(second.thread.entries).toHaveLength(1)
  })

  it('creates stable signatures for continuity entries', () => {
    expect(getContinuityEntrySignature('  Hello   world  ')).toBe(getContinuityEntrySignature('hello world'))
    expect(getContinuityEntrySignature('Different text')).not.toBe(getContinuityEntrySignature('hello world'))
  })

  it('builds a structured context passport from captured turns', () => {
    const initial = createContinuityThread({ title: 'AI workstation feature', workspaceId: null }, () => 'thread-1', () => now)
    const withUser = appendContinuityEntry(
      initial,
      {
        role: 'user',
        content: 'Implement auto response capture and a context handoff system.',
        provider: 'chatgpt',
        accountEmail: 'first@example.com',
      },
      () => 'entry-1',
      () => '2026-06-13T12:10:00.000Z',
    )
    const withAssistant = appendContinuityEntry(
      withUser,
      {
        role: 'assistant',
        content: 'Use provider adapters, dedupe captured responses, and inject a Context Passport into the next chat.',
        provider: 'claude',
        accountEmail: 'second@example.com',
      },
      () => 'entry-2',
      () => '2026-06-13T12:11:00.000Z',
    )

    const passport = buildContextPassport(withAssistant, {
      targetProvider: 'gemini',
      targetAccountEmail: 'third@example.com',
    })

    expect(passport).toContain('FLOWDESK CONTEXT PASSPORT')
    expect(passport).toContain('Target: gemini / third@example.com')
    expect(passport).toContain('Latest user request:')
    expect(passport).toContain('Implement auto response capture')
    expect(passport).toContain('Useful assistant context:')
    expect(passport).toContain('provider adapters')
    expect(passport).toContain('Continue from this passport')
  })
})
