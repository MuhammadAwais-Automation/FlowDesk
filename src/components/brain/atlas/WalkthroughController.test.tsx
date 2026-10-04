/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalkthroughController, type WalkthroughStep } from './WalkthroughController'

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

const sampleSteps: WalkthroughStep[] = [
  {
    path: 'wiki/clients/yasir.md',
    title: 'Yasir Bhai Retainer',
    explanation: 'Monthly retainer contract and revision terms.',
    headingPath: 'Rates',
  },
  {
    path: 'wiki/projects/flowdesk.md',
    title: 'FlowDesk Project Architecture',
    explanation: 'Core Electron + React modules and local-first SQLite indexing.',
  },
  {
    path: 'wiki/decisions/graph.md',
    title: 'Observatory Knowledge Graph',
    explanation: 'Sigma WebGL renderer with forceatlas2 cluster positioning.',
  },
]

describe('WalkthroughController', () => {
  it('renders nothing when steps list is empty or absent', () => {
    const { container: c1 } = render(<WalkthroughController steps={[]} />)
    expect(c1.firstChild).toBeNull()

    const { container: c2 } = render(<WalkthroughController />)
    expect(c2.firstChild).toBeNull()
  })

  it('renders current step index, total steps, title, and explanation', () => {
    render(<WalkthroughController steps={sampleSteps} />)

    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    expect(screen.getByText('Yasir Bhai Retainer')).toBeTruthy()
    expect(screen.getByText('Monthly retainer contract and revision terms.')).toBeTruthy()
    expect(screen.getByText('#Rates')).toBeTruthy()
  })

  it('navigates with Next and Prev buttons, invoking onStepChange and onSelect', () => {
    const onStepChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <WalkthroughController
        steps={sampleSteps}
        onStepChange={onStepChange}
        onSelect={onSelect}
      />,
    )

    const prevBtn = screen.getByRole('button', { name: 'Previous step' })
    const nextBtn = screen.getByRole('button', { name: 'Next step' })

    // On first step, Prev is disabled
    expect(prevBtn).toHaveProperty('disabled', true)
    expect(nextBtn).toHaveProperty('disabled', false)

    // Click Next -> Step 2
    fireEvent.click(nextBtn)
    expect(onStepChange).toHaveBeenCalledWith(1)
    expect(onSelect).toHaveBeenCalledWith('wiki/projects/flowdesk.md')
    expect(screen.getByText('Step 2 of 3')).toBeTruthy()
    expect(screen.getByText('FlowDesk Project Architecture')).toBeTruthy()

    // Click Next -> Step 3
    fireEvent.click(nextBtn)
    expect(onStepChange).toHaveBeenCalledWith(2)
    expect(onSelect).toHaveBeenCalledWith('wiki/decisions/graph.md')
    expect(screen.getByText('Step 3 of 3')).toBeTruthy()
    expect(nextBtn).toHaveProperty('disabled', true)

    // Click Prev -> Step 2
    fireEvent.click(prevBtn)
    expect(onStepChange).toHaveBeenCalledWith(1)
    expect(onSelect).toHaveBeenCalledWith('wiki/projects/flowdesk.md')
    expect(screen.getByText('Step 2 of 3')).toBeTruthy()
  })

  it('allows clicking step dots to jump directly to a step', () => {
    const onStepChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <WalkthroughController
        steps={sampleSteps}
        onStepChange={onStepChange}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Go to step 3' }))
    expect(onStepChange).toHaveBeenCalledWith(2)
    expect(onSelect).toHaveBeenCalledWith('wiki/decisions/graph.md')
    expect(screen.getByText('Step 3 of 3')).toBeTruthy()
  })

  it('advances automatically when auto-play is toggled on', () => {
    vi.useFakeTimers()
    const onStepChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <WalkthroughController
        steps={sampleSteps}
        onStepChange={onStepChange}
        onSelect={onSelect}
        autoPlayIntervalMs={2000}
      />,
    )

    const autoPlayBtn = screen.getByRole('button', { name: 'Start auto-play' })
    fireEvent.click(autoPlayBtn)
    expect(screen.getByRole('button', { name: 'Pause auto-play' })).toBeTruthy()

    // Advance timer by 2000ms -> step 1
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onStepChange).toHaveBeenCalledWith(1)
    expect(onSelect).toHaveBeenCalledWith('wiki/projects/flowdesk.md')

    // Advance timer by 2000ms -> step 2
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onStepChange).toHaveBeenCalledWith(2)
    expect(onSelect).toHaveBeenCalledWith('wiki/decisions/graph.md')

    // Toggling off pauses auto-play
    fireEvent.click(screen.getByRole('button', { name: 'Pause auto-play' }))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    // No additional calls
    expect(onStepChange).toHaveBeenCalledTimes(2)
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<WalkthroughController steps={sampleSteps} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close walkthrough' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('supports walkthrough object with text field as explanation fallback', () => {
    const walkthrough = {
      title: 'Guided Tour',
      steps: [
        { path: 'doc1.md', title: 'Doc One', text: 'Excerpt from text field' },
      ],
    }

    render(<WalkthroughController walkthrough={walkthrough} />)
    expect(screen.getByText('Doc One')).toBeTruthy()
    expect(screen.getByText('Excerpt from text field')).toBeTruthy()
  })

  it('respects controlled currentStep prop', () => {
    const { rerender } = render(
      <WalkthroughController steps={sampleSteps} currentStep={0} />,
    )
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()

    rerender(<WalkthroughController steps={sampleSteps} currentStep={2} />)
    expect(screen.getByText('Step 3 of 3')).toBeTruthy()
    expect(screen.getByText('Observatory Knowledge Graph')).toBeTruthy()
  })
})
