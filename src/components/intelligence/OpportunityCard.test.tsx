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
