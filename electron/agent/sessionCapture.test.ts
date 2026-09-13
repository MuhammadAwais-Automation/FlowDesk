import { describe, expect, it, vi } from 'vitest'
import { captureSessionTurns, type BrainRequestFn } from './sessionCapture'

function baseInput(overrides: Partial<Parameters<typeof captureSessionTurns>[0]> = {}) {
  return {
    scopeId: 'scope-1',
    userText: 'Remember that the client prefers weekly check-ins.',
    userSessionRef: 'agent-session://session-1/turn-user-1',
    assistantText: 'Noted — I will check in weekly.',
    assistantSessionRef: 'agent-session://session-1/turn-assistant-1',
    brainRequest: vi.fn().mockResolvedValue({}) as unknown as BrainRequestFn,
    ...overrides,
  }
}

describe('captureSessionTurns', () => {
  it('proposes an explicit-user candidate for non-empty user text', async () => {
    const brainRequest = vi.fn().mockResolvedValue({})
    await captureSessionTurns(baseInput({ brainRequest: brainRequest as unknown as BrainRequestFn }))

    expect(brainRequest).toHaveBeenCalledWith('knowledge.proposeCandidate', expect.objectContaining({
      scopeId: 'scope-1',
      origin: 'explicit-user',
      sessionRef: 'agent-session://session-1/turn-user-1',
      body: 'Remember that the client prefers weekly check-ins.',
      type: 'note',
      summary: '',
    }))
  })

  it('proposes a machine-inferred candidate for non-empty assistant text', async () => {
    const brainRequest = vi.fn().mockResolvedValue({})
    await captureSessionTurns(baseInput({ brainRequest: brainRequest as unknown as BrainRequestFn }))

    expect(brainRequest).toHaveBeenCalledWith('knowledge.proposeCandidate', expect.objectContaining({
      scopeId: 'scope-1',
      origin: 'machine-inferred',
      sessionRef: 'agent-session://session-1/turn-assistant-1',
      body: 'Noted — I will check in weekly.',
    }))
  })

  it('skips empty or whitespace-only user text', async () => {
    const brainRequest = vi.fn().mockResolvedValue({})
    await captureSessionTurns(baseInput({ userText: '   \n\t  ', brainRequest: brainRequest as unknown as BrainRequestFn }))

    expect(brainRequest).not.toHaveBeenCalledWith('knowledge.proposeCandidate', expect.objectContaining({ origin: 'explicit-user' }))
  })

  it('skips empty or whitespace-only assistant text', async () => {
    const brainRequest = vi.fn().mockResolvedValue({})
    await captureSessionTurns(baseInput({ assistantText: '', brainRequest: brainRequest as unknown as BrainRequestFn }))

    expect(brainRequest).not.toHaveBeenCalledWith('knowledge.proposeCandidate', expect.objectContaining({ origin: 'machine-inferred' }))
  })

  it('skips a pure-tool-call assistant turn with no text', async () => {
    // AgentTurn.content is the model's own final text; a turn that only
    // issued tool calls has empty content even though toolCalls is populated
    // elsewhere on the turn — sessionCapture only ever sees the content string.
    const brainRequest = vi.fn().mockResolvedValue({})
    await captureSessionTurns(baseInput({ assistantText: '', brainRequest: brainRequest as unknown as BrainRequestFn }))

    const calls = brainRequest.mock.calls.filter(([, payload]) => (payload as { origin: string }).origin === 'machine-inferred')
    expect(calls).toHaveLength(0)
  })

  it('truncates the title at a word boundary and keeps it within the 200-char protocol limit', async () => {
    const brainRequest = vi.fn().mockResolvedValue({})
    const longText = 'a'.repeat(50) + ' ' + 'b'.repeat(300)
    await captureSessionTurns(baseInput({ userText: longText, brainRequest: brainRequest as unknown as BrainRequestFn }))

    const call = brainRequest.mock.calls.find(([, payload]) => (payload as { origin: string }).origin === 'explicit-user')
    expect(call).toBeDefined()
    const title = (call![1] as { title: string }).title
    expect(title.length).toBeLessThanOrEqual(200)
    expect(title).toBe('a'.repeat(50))
    expect(title.endsWith('b')).toBe(false)
  })

  it('does not propagate an error thrown by brainRequest', async () => {
    const brainRequest = vi.fn().mockRejectedValue(new Error('backend not implemented'))
    await expect(captureSessionTurns(baseInput({ brainRequest: brainRequest as unknown as BrainRequestFn }))).resolves.toBeUndefined()
  })
})
