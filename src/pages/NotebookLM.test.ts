import { describe, expect, it } from 'vitest'
import { recoverInterruptedNotebookChat } from '../lib/notebooklmContinuity'

describe('NotebookLM Studio restart recovery', () => {
  it('marks an unfinished answer as interrupted while preserving partial text', () => {
    const recovered = recoverInterruptedNotebookChat([
      { id: 'user-1', role: 'user', text: 'Summarize this', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'chat-1', role: 'assistant', text: 'Partial answer', state: 'streaming', prompt: 'Summarize this', createdAt: '2026-01-01T00:00:00.000Z' },
    ])

    expect(recovered[1]).toMatchObject({ state: 'error', text: 'Partial answer', prompt: 'Summarize this' })
  })

  it('adds a useful restart message when no answer text was saved', () => {
    const recovered = recoverInterruptedNotebookChat([
      { id: 'chat-2', role: 'assistant', text: '', state: 'thinking', prompt: 'Question', createdAt: '2026-01-01T00:00:00.000Z' },
    ])

    expect(recovered[0].state).toBe('error')
    expect(recovered[0].text).toContain('FlowDesk closed')
  })

  it('does not change completed chat messages', () => {
    const complete = { id: 'chat-3', role: 'assistant' as const, text: 'Done', state: 'complete' as const, createdAt: '2026-01-01T00:00:00.000Z' }
    expect(recoverInterruptedNotebookChat([complete])).toEqual([complete])
  })
})
