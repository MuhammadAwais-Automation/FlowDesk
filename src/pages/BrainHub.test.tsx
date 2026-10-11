/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/pages/Brain', () => ({ default: () => <div>atlas library</div> }))

const calls: Array<[string, unknown]> = []
const brands = [{ id: 'alpha-paws', name: 'Alpha Paws', status: 'active', fields: { niche: 'cat videos' }, createdAt: '2026-10-09T00:00:00.000Z' }]

const answers: Record<string, () => unknown> = {
  overview: () => ({ brands: 1, accounts: 1, content: 0, inboxNew: 1, jobsActive: 0, learnings: 2, tasksWaiting: 0 }),
  'files.get': () => ({ text: '# Hot Cache\n\n## Now\n- nothing scheduled' }),
  'inbox.list': () => [{ id: 'in-1', at: '2026-10-09T10:00:00.000Z', kind: 'job_result', title: 'Weekly review', body: '12 actions', refId: 'job-1', needsAgent: true, status: 'new', takenBy: null, packet: null, updatedAt: '' }],
  'task.list': () => [],
  'brand.list': () => brands,
  'account.list': () => [{ platform: 'tiktok', slotId: 'social-tiktok', label: 'Account 1', lastActionAt: null, fields: { brand: 'alpha-paws', purpose: 'main' } }],
  'learning.list': () => [],
  'profile.get': () => ({ fields: {} }),
  'agents.set': () => ({ ok: true }),
}

beforeEach(() => {
  calls.length = 0
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    brainOperator: vi.fn(async (op: string, args: unknown) => { calls.push([op, args]); return answers[op]?.() ?? [] }),
    brainJobs: vi.fn(async () => []),
    brainOpenOperatorFolder: vi.fn(),
    operatorCreateKit: vi.fn(),
  }
})

afterEach(cleanup)

let BrainHub: ComponentType
beforeAll(async () => { BrainHub = (await import('./BrainHub')).default }, 60_000)

describe('Brain hub', () => {
  it('opens on Home with the hot cache and inbox, with nothing for the user to approve', async () => {
    render(<BrainHub />)
    expect(await screen.findByText('Weekly review')).toBeTruthy()
    expect(screen.getByText('Claude ka kaam')).toBeTruthy()
    expect(await screen.findByText('Hot Cache')).toBeTruthy()
    expect(screen.getByText('Seekh (learnings)').previousSibling?.textContent).toBe('2')
    expect(screen.queryByLabelText('Ho gaya')).toBeNull()
  })

  it('shows brands and account tags the agents saved, without edit controls', async () => {
    render(<BrainHub />)
    fireEvent.click(screen.getByRole('tab', { name: /Brands/ }))
    expect(await screen.findByText('cat videos')).toBeTruthy()
    expect(await screen.findByText('main')).toBeTruthy()
    expect(screen.queryByText('Haan')).toBeNull()
    expect(screen.queryByText('Edit')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(calls.map(c => c[0])).not.toContain('brand.upsert')
  })

  it('saves AGENTS.md from the Rules tab and keeps the Library tab', async () => {
    render(<BrainHub />)
    fireEvent.click(screen.getByRole('tab', { name: /Rules/ }))
    const box = await screen.findByLabelText('AGENTS.md') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '# AGENTS.md\nnew rules for every agent' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(calls).toContainEqual(['agents.set', { text: '# AGENTS.md\nnew rules for every agent' }]))
    fireEvent.click(screen.getByRole('tab', { name: /Library/ }))
    expect(await screen.findByText('atlas library')).toBeTruthy()
  })
})
