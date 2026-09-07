/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrainDecisionBrief, BrainOpportunity, BrainScope, OpportunityEvidence } from '@/types/brain'

const scope: BrainScope = { id: 'client-a', type: 'client', externalRef: 'client-a', name: 'Acme', parentId: null, createdAt: '2026-09-05T00:00:00.000Z' }
const opportunities: BrainOpportunity[] = [
  { id: 'pain-1', scopeId: scope.id, category: 'product_opportunity', title: 'Support backlog', summary: 'Repeated support pain.', score: 75, confidence: 0.7, freshness: '2026-09-05T00:00:00.000Z', status: 'new', evidenceCount: 3, createdAt: scope.createdAt, updatedAt: scope.createdAt },
  { id: 'lead-1', scopeId: scope.id, category: 'direct_lead', title: 'Needs React help', summary: 'Buyer is looking now.', score: 88, confidence: 0.85, freshness: '2026-09-06T00:00:00.000Z', status: 'qualified', evidenceCount: 1, createdAt: scope.createdAt, updatedAt: scope.createdAt },
]
const evidence: OpportunityEvidence = { opportunityId: 'lead-1', evidenceId: 'evidence-1', sourceId: 'source-1', excerpt: 'Need React help', confidence: 0.9, sourceRef: 'https://example.test/lead', platform: 'linkedin', observedAt: '2026-09-06T00:00:00.000Z', stale: false, createdAt: scope.createdAt }
const brief: BrainDecisionBrief = {
  question: 'Should we pursue React work?', recommendation: 'Prioritize review of Needs React help; current cited signals are stronger than counter-signals.',
  supportingSignals: [{ text: 'Need React help', citation: { id: 'evidence-1', memoryId: 'lead-1', text: 'Need React help', kind: 'opportunity', scopeId: scope.id, sourceRef: 'https://example.test/lead', score: 0.7 } }],
  counterSignals: [], risks: [], nextActions: ['Verify the source.'], estimatedTokens: 90,
}

const api = {
  brainListOpportunities: vi.fn(), brainGetOpportunityEvidence: vi.fn(), brainReviewOpportunity: vi.fn(),
  brainBuildDecisionBrief: vi.fn(), brainListSourceMetrics: vi.fn(), brainListJobs: vi.fn(), brainGetConsent: vi.fn(),
  brainRunSocialRecipe: vi.fn(), brainGrantConsent: vi.fn(), onBrainEvent: vi.fn(),
}
let Intelligence: typeof import('./Intelligence').default

vi.mock('@/components/brain/ScopePicker', () => ({
  ScopePicker: () => <span>Client · Acme</span>,
  useBrainScope: () => ({ scopes: [scope], scope, selectScope: vi.fn(), loading: false, error: '' }),
}))

beforeAll(async () => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
  Intelligence = (await import('./Intelligence')).default
})

beforeEach(() => {
  vi.resetAllMocks()
  api.brainListOpportunities.mockResolvedValue(opportunities)
  api.brainGetOpportunityEvidence.mockImplementation(async ({ id }: { id: string }) => id === 'lead-1' ? [evidence] : [])
  api.brainReviewOpportunity.mockResolvedValue({ ...opportunities[0], status: 'qualified' })
  api.brainBuildDecisionBrief.mockResolvedValue(brief)
  api.brainListSourceMetrics.mockResolvedValue([{ id: 'metric-1', scopeId: scope.id, platform: 'linkedin', metric: 'support momentum', value: 12, percentile: 0.8, observedAt: '2026-09-06T00:00:00.000Z' }])
  api.brainListJobs.mockResolvedValue([{ id: 'job-1', scopeId: scope.id, recipeId: 'linkedin.opportunity_scan', recipeVersion: 1, accountId: null, status: 'failed', parameters: {}, result: { recordCount: 14, error: 'Login expired' }, createdAt: scope.createdAt, updatedAt: '2026-09-06T00:00:00.000Z' }])
  api.brainGetConsent.mockResolvedValue(true)
  api.onBrainEvent.mockReturnValue(() => undefined)
})

afterEach(cleanup)

describe('Intelligence live views', () => {
  it('loads cited opportunities, filters statuses and reviews in the selected scope', async () => {
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))
    await waitFor(() => expect(screen.getByText('Needs React help')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Open LinkedIn evidence' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Opportunity status' }), { target: { value: 'new' } })
    expect(screen.getByText('Support backlog')).toBeTruthy()
    expect(screen.queryByText('Needs React help')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Qualify opportunity' }))
    await waitFor(() => expect(api.brainReviewOpportunity).toHaveBeenCalledWith({ id: 'pain-1', scopeId: scope.id, decision: 'qualify' }))
  })

  it('shows real pain, trend and source state instead of placeholders', async () => {
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Pain Points' }))
    await waitFor(() => expect(screen.getByText('Support backlog')).toBeTruthy())
    expect(screen.getByText('3 repetitions')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trends' }))
    expect(await screen.findByText('support momentum')).toBeTruthy()
    expect(screen.getByText('80th percentile')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    expect(await screen.findByText('14 records')).toBeTruthy()
    expect(screen.getByText('Login expired')).toBeTruthy()
    expect(screen.getAllByText('Consent granted').length).toBeGreaterThan(0)
  })

  it('builds and renders a cited decision brief', async () => {
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Decision Briefs' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Decision question' }), { target: { value: brief.question } })
    fireEvent.click(screen.getByRole('button', { name: 'Build decision brief' }))
    await waitFor(() => expect(api.brainBuildDecisionBrief).toHaveBeenCalledWith({ scopeId: scope.id, question: brief.question, tokenBudget: 1200 }))
    expect(screen.getByText(brief.recommendation)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open source 1' }).getAttribute('href')).toBe('https://example.test/lead')
    expect(screen.getByText('90 estimated tokens')).toBeTruthy()
  })
})
