/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetailDrawer } from './DetailDrawer'
import { EMPTY_SELECTION } from '@/lib/brainSelection'

afterEach(cleanup)

function setup(overrides: Partial<Parameters<typeof DetailDrawer>[0]> = {}) {
  const props = {
    stack: EMPTY_SELECTION, onBack: vi.fn(), onClear: vi.fn(),
    document: null, neighborhood: null, events: [], pack: null, onSelect: vi.fn(),
    ...overrides,
  }
  const view = render(<DetailDrawer {...props} />)
  return { ...props, view }
}

describe('DetailDrawer', () => {
  // Nothing selected means no drawer at all — the map gets the whole screen.
  it('renders nothing when nothing is selected', () => {
    const { view } = setup()
    expect(view.container.firstChild).toBeNull()
  })

  it('shows a document that is still loading without stranding the title', () => {
    setup({ stack: { current: { kind: 'document', path: 'wiki/me/profile.md' }, history: [] } })
    expect(screen.getByText('wiki/me/profile.md')).toBeTruthy()
    expect(screen.getByText('Khul raha hai…')).toBeTruthy()
  })

  it('offers back only once there is somewhere to go back to', () => {
    setup({ stack: { current: { kind: 'document', path: 'a.md' }, history: [] } })
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()

    setup({ stack: { current: { kind: 'document', path: 'b.md' }, history: [{ kind: 'document', path: 'a.md' }] } })
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })

  it('closes on Escape as well as its own control', async () => {
    const props = setup({ stack: { current: { kind: 'document', path: 'a.md' }, history: [] } })
    await userEvent.keyboard('{Escape}')
    expect(props.onClear).toHaveBeenCalled()
  })

  it('shows an answer when one is selected', () => {
    setup({
      stack: { current: { kind: 'answer', question: 'scope kya tha' }, history: [] },
      pack: {
        question: 'scope kya tha', evidence: '', sections: [], pointerFollowed: null,
        strategy: 'none', estimatedTokens: 0, candidatesConsidered: 0,
      },
    })
    // The header's title span and AnswerDetail's own heading both show the
    // question, so target the heading specifically to avoid an ambiguous match.
    expect(screen.getByRole('heading', { name: 'scope kya tha' })).toBeTruthy()
  })
})
