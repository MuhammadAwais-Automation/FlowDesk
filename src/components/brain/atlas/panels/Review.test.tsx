/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Review } from './Review'

afterEach(cleanup)

function setup(overrides: Partial<Parameters<typeof Review>[0]> = {}) {
  const props = {
    candidates: [], knowledgeCandidates: [], unresolvedLinks: [],
    onReview: vi.fn(), onReviewKnowledge: vi.fn(), onCreateStub: vi.fn(), onSelect: vi.fn(),
    ...overrides,
  }
  render(<Review {...props} />)
  return props
}

const LOOSE = { documentPath: 'wiki/me/profile.md', documentTitle: 'Profile', targetPath: 'me/tools' }

describe('Review', () => {
  it('says the queue is clear when there is nothing to decide', () => {
    setup()
    // The rendered text is "Kuch pending nahi hai." (sentence-case, matching
    // every other Roman-Urdu string in this codebase) -- the regex needs `i`.
    expect(screen.getByText(/kuch pending nahi/i)).toBeTruthy()
  })

  it('accepts a knowledge candidate', async () => {
    const props = setup({
      knowledgeCandidates: [{
        id: 'k1', scopeId: 's', targetPath: null, type: 'note', title: 'Yasir Bhai — 2026-09-18',
        summary: 'Scope barhane ko kaha.', body: 'Scope barhane ko kaha.', origin: 'machine-inferred',
        sessionRef: 'job:1', status: 'pending', createdAt: '2026-09-18T00:00:00.000Z', decidedAt: null,
      }],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Accept Yasir Bhai — 2026-09-18' }))
    expect(props.onReviewKnowledge).toHaveBeenCalledWith('k1', 'accept')
  })

  // The loose end's whole point: one click turns it into an edge.
  it('offers to create the document a loose end points at', async () => {
    const props = setup({ unresolvedLinks: [LOOSE] })
    await userEvent.click(screen.getByRole('button', { name: 'Create me/tools' }))
    expect(props.onCreateStub).toHaveBeenCalledWith('me/tools')
  })

  it('opens the document a loose end came from', async () => {
    const props = setup({ unresolvedLinks: [LOOSE] })
    await userEvent.click(screen.getByRole('button', { name: /Profile/ }))
    expect(props.onSelect).toHaveBeenCalledWith({ kind: 'document', path: 'wiki/me/profile.md' })
  })
})
