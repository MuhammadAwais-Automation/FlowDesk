/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrainOpportunity, BrainScope, OpportunityEvidence } from '@/types/brain'
import { OpportunityCard } from './OpportunityCard'

const scope: BrainScope = {
  id: 'client-a', type: 'client', externalRef: 'client-a', name: 'Acme', parentId: null,
  createdAt: '2026-09-05T00:00:00.000Z',
}
const opportunity: BrainOpportunity = {
  id: 'opportunity-1', scopeId: scope.id, category: 'direct_lead', title: 'Needs a React developer',
  summary: 'A team is actively looking for implementation help.', score: 86, confidence: 0.78,
  freshness: '2026-09-05T00:00:00.000Z', status: 'new', evidenceCount: 2,
  createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
}
const evidence: OpportunityEvidence[] = [{
  opportunityId: opportunity.id, evidenceId: 'evidence-1', sourceId: 'source-1',
  excerpt: 'Looking for a React developer this month.', confidence: 0.9,
  sourceRef: 'https://example.test/post/1', platform: 'linkedin', observedAt: opportunity.freshness,
  stale: false, createdAt: opportunity.createdAt,
}]

afterEach(cleanup)

describe('OpportunityCard', () => {
  it('shows review context, evidence citations and invokes safe review actions', () => {
    const qualify = vi.fn()
    const dismiss = vi.fn()
    render(<OpportunityCard opportunity={opportunity} scope={scope} evidence={evidence} onQualify={qualify} onDismiss={dismiss} />)

    expect(screen.getByText('Client · Acme')).toBeTruthy()
    expect(screen.getByText('Direct lead')).toBeTruthy()
    expect(screen.getByLabelText('Opportunity score 86 out of 100')).toBeTruthy()
    expect(screen.getByText('78% confidence')).toBeTruthy()
    expect(screen.getByText('2 evidence items')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open LinkedIn evidence' }).getAttribute('href')).toBe('https://example.test/post/1')
    fireEvent.click(screen.getByRole('button', { name: 'Qualify opportunity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss opportunity' }))
    expect(qualify).toHaveBeenCalledWith(opportunity.id)
    expect(dismiss).toHaveBeenCalledWith(opportunity.id)
  })
})

/**
 * Retention purges raw captures after their window, and the sweep marks the
 * evidence rows that pointed at them `stale` — the source they cite no longer
 * exists. The Agent surface already routes stale evidence to counter-signals;
 * the human review queue used to render it as a live, openable citation and
 * count it in the evidence total, so a fully-purged opportunity looked fully
 * cited in exactly the screen where a user decides to act on it.
 */
describe('OpportunityCard stale evidence', () => {
  const stale: OpportunityEvidence = { ...evidence[0], evidenceId: 'evidence-stale', excerpt: 'Hiring a React contractor.', sourceRef: 'https://example.test/post/2', stale: true }

  it('marks a stale citation, refuses to link it and counts only live citations', () => {
    render(<OpportunityCard opportunity={opportunity} scope={scope} evidence={[evidence[0], stale]} onQualify={vi.fn()} onDismiss={vi.fn()} />)

    // The expired source is not something to click through to.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Open LinkedIn evidence' }).getAttribute('href')).toBe('https://example.test/post/1')
    expect(screen.getByText('Source expired')).toBeTruthy()
    expect(screen.getByText(stale.excerpt).className).toContain('line-through')
    // The count no longer advertises citations that cannot be read.
    expect(screen.getByText('1 of 2 citations still available')).toBeTruthy()
  })

  it('keeps the plain evidence count when nothing has been purged', () => {
    render(<OpportunityCard opportunity={opportunity} scope={scope} evidence={evidence} onQualify={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('2 evidence items')).toBeTruthy()
    expect(screen.queryByText('Source expired')).toBeNull()
  })
})

/**
 * `sourceRef` is copied verbatim off captured social content — a LinkedIn post
 * body, a WhatsApp message — so it is a string a stranger wrote. This renderer
 * holds `window.electronAPI`, i.e. Brain writes, consent grants and backup
 * import/export, so a `javascript:` ref that became a live href would be a
 * one-click path from stranger text into the privileged bridge.
 */
describe('OpportunityCard citation safety', () => {
  it.each([
    'javascript:window.electronAPI.brainImportBackup()',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'data:text/html,<script>alert(1)</script>',
    'not a url at all',
  ])('renders %s as inert text instead of a link', hostile => {
    render(<OpportunityCard opportunity={opportunity} scope={scope} evidence={[{ ...evidence[0], sourceRef: hostile }]} onQualify={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Source link unavailable')).toBeTruthy()
  })

  it('still links an http(s) citation', () => {
    render(<OpportunityCard opportunity={opportunity} scope={scope} evidence={evidence} onQualify={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Open LinkedIn evidence' }).getAttribute('href')).toBe('https://example.test/post/1')
  })
})
