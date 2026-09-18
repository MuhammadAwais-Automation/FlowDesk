/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusStrip } from './StatusStrip'

afterEach(cleanup)

function setup(overrides: Partial<Parameters<typeof StatusStrip>[0]> = {}) {
  const onPanel = vi.fn()
  const onOverlay = vi.fn()
  const props = {
    documents: 163, links: 755, review: 2, looseEnds: 153,
    panel: null, onPanel, overlay: null, onOverlay,
    ...overrides,
  }
  render(<StatusStrip {...props} />)
  return props as typeof props & { onPanel: typeof onPanel; onOverlay: typeof onOverlay }
}

describe('StatusStrip', () => {
  it('shows what the store holds', () => {
    setup()
    expect(screen.getByRole('button', { name: /163 documents/ })).toBeTruthy()
    expect(screen.getByText('755 links')).toBeTruthy()
  })

  it('opens a panel, and closes it when its own pill is pressed again', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: /2 review/ }))
    expect(props.onPanel).toHaveBeenCalledWith('review')

    props.onPanel.mockClear()
    render(<StatusStrip {...props} panel="review" />)
    await userEvent.click(screen.getAllByRole('button', { name: /2 review/ })[1])
    expect(props.onPanel).toHaveBeenCalledWith(null)
  })

  it('marks the open panel for assistive tech', () => {
    setup({ panel: 'timeline' })
    expect(screen.getByRole('button', { name: /163 documents/ }).getAttribute('aria-pressed')).toBe('true')
  })

  // Two overlays at once means two meanings for one ring.
  it('turns one overlay on and swaps it for another', async () => {
    const props = setup({ overlay: 'new' })
    await userEvent.click(screen.getByRole('button', { name: 'Orphans' }))
    expect(props.onOverlay).toHaveBeenCalledWith('orphans')
  })

  it('turns the active overlay off when its own control is pressed', async () => {
    const props = setup({ overlay: 'orphans' })
    await userEvent.click(screen.getByRole('button', { name: 'Orphans' }))
    expect(props.onOverlay).toHaveBeenCalledWith(null)
  })

  // Zero pending work should read as quiet, not as an alert with a zero in it.
  it('does not accent the review pill when nothing is pending', () => {
    setup({ review: 0 })
    const quiet = screen.getByRole('button', { name: /0 review/ }).style.color
    cleanup()
    setup({ review: 4 })
    expect(screen.getByRole('button', { name: /4 review/ }).style.color).not.toBe(quiet)
  })

  // The pending colour must not outrank the open-panel colour: with Review
  // open, the review pill reads as open like every other panel pill does.
  it('accents the review pill for its open panel even with work pending', () => {
    setup({ review: 2, panel: 'review' })
    const open = screen.getByRole('button', { name: /2 review/ }).style.color
    cleanup()
    setup({ review: 2, panel: null })
    expect(screen.getByRole('button', { name: /2 review/ }).style.color).not.toBe(open)
  })

  // An unresolved link has no document to ring, so this pill is a door into
  // Review — where the loose ends are listed and can be turned into documents —
  // not an overlay toggle.
  it('opens the review panel from the loose ends pill', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: /153 loose ends/ }))
    expect(props.onPanel).toHaveBeenCalledWith('review')
    expect(props.onOverlay).not.toHaveBeenCalled()
  })

  it('marks the loose ends pill pressed while Review is open', () => {
    setup({ panel: 'review' })
    expect(screen.getByRole('button', { name: /153 loose ends/ }).getAttribute('aria-pressed')).toBe('true')
  })
})
