/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivityPulse } from './ActivityPulse'
import type { BrainEvent } from '@/types/brainKnowledge'

afterEach(cleanup)

describe('ActivityPulse', () => {
  it('renders quiescent HUD status when idle', () => {
    render(<ActivityPulse />)
    expect(screen.getByRole('region', { name: 'Agent Activity HUD' })).toBeTruthy()
    expect(screen.getByText('Cognition quiescent')).toBeTruthy()
  })

  it('displays reasoning status when asking is true', () => {
    render(<ActivityPulse asking={true} />)
    expect(screen.getByText('Reasoning & Querying…')).toBeTruthy()
    expect(screen.getByText('Cognition')).toBeTruthy()
  })

  it('displays active node count when activeNodes are provided', () => {
    render(<ActivityPulse activeNodes={['notes/idea.md', 'skills/search.md']} />)
    expect(screen.getByText('2 nodes active')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('toggles the expandable activity log on button click', () => {
    render(<ActivityPulse activeNodes={['skills/test.md']} />)
    const toggleButton = screen.getByRole('button', { name: 'Expand activity log' })
    expect(screen.queryByRole('complementary', { name: 'Agent Activity Log' })).toBeNull()

    fireEvent.click(toggleButton)
    expect(screen.getByRole('complementary', { name: 'Agent Activity Log' })).toBeTruthy()
    expect(screen.getByText('Live Activity & Cognition')).toBeTruthy()

    // Close button
    const closeButton = screen.getByRole('button', { name: 'Close activity log' })
    fireEvent.click(closeButton)
    expect(screen.queryByRole('complementary', { name: 'Agent Activity Log' })).toBeNull()
  })

  it('calls onSelectNode when an active node in the log is clicked', () => {
    const onSelectNode = vi.fn()
    render(
      <ActivityPulse
        activeNodes={['notes/deep-dive.md']}
        onSelectNode={onSelectNode}
        initialExpanded={true}
      />,
    )

    const nodeButton = screen.getByRole('button', { name: /notes\/deep-dive\.md/ })
    fireEvent.click(nodeButton)
    expect(onSelectNode).toHaveBeenCalledWith('notes/deep-dive.md')
  })

  it('renders recent events when provided', () => {
    const mockEvent: BrainEvent = {
      id: 'event-1',
      scopeId: 'global',
      action: 'agent.turn',
      targetId: 'turn-1',
      metadata: { prompt: 'Explain the observatory theme' },
      createdAt: new Date().toISOString(),
    }

    render(
      <ActivityPulse
        events={[mockEvent]}
        initialExpanded={true}
      />,
    )

    expect(screen.getByText('Explain the observatory theme')).toBeTruthy()
    expect(screen.getByText('agent.turn')).toBeTruthy()
  })

  it('toggles simulation mode when button is clicked', () => {
    render(<ActivityPulse initialExpanded={true} />)
    expect(screen.getByText('Cognition quiescent')).toBeTruthy()

    const simButton = screen.getByRole('button', { name: 'Simulate pulse' })
    fireEvent.click(simButton)

    expect(screen.getByText(/nodes active/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset simulation' })).toBeTruthy()
  })
})
