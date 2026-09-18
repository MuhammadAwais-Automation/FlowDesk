/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Timeline } from './Timeline'
import type { BrainEvent } from '@/types/brainKnowledge'

afterEach(cleanup)

const turn = (id: string, metadata: Record<string, unknown>): BrainEvent => ({
  id, scopeId: 's', action: 'agent.turn', targetId: `t-${id}`,
  metadata, createdAt: '2026-09-18T11:55:00.000Z',
})

describe('Timeline', () => {
  it('shows a turn by what was asked', () => {
    render(<Timeline events={[turn('1', { prompt: 'yasir bhai ka scope', sessionId: 'abc' })]} onSelect={vi.fn()} onHighlight={vi.fn()} />)
    expect(screen.getByText(/yasir bhai ka scope/)).toBeTruthy()
  })

  // The nine identical "Agent turn" rows in the old surface were not a bug:
  // main.ts stores the prompt only when brain writes are allowed, so a
  // temporary-mode turn has none. Saying why beats looking broken.
  it('says why a turn has nothing to show instead of repeating a bare label', () => {
    render(<Timeline events={[turn('1', { sessionId: 'abc' })]} onSelect={vi.fn()} onHighlight={vi.fn()} />)
    expect(screen.getByText(/temporary mode/)).toBeTruthy()
  })

  it('lists the documents a turn read, and highlights one when picked', async () => {
    const onHighlight = vi.fn()
    render(
      <Timeline
        events={[turn('1', { prompt: 'q', sessionId: 'abc', documentsRead: ['wiki/me/profile.md'] })]}
        onSelect={vi.fn()}
        onHighlight={onHighlight}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'wiki/me/profile.md' }))
    expect(onHighlight).toHaveBeenCalledWith(['wiki/me/profile.md'])
  })

  it('opens the conversation behind a turn', async () => {
    const onSelect = vi.fn()
    render(<Timeline events={[turn('1', { prompt: 'q', sessionId: 'abc' })]} onSelect={onSelect} onHighlight={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /q/ }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'turn', eventId: '1' })
  })

  it('says the day was quiet rather than showing an empty box', () => {
    render(<Timeline events={[]} onSelect={vi.fn()} onHighlight={vi.fn()} />)
    expect(screen.getByText(/kuch nahi hua/)).toBeTruthy()
  })
})
