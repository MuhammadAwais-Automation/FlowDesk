/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MONITORABLE_RECIPE_CONTROLS, MONITORABLE_RECIPE_IDS } from '@/lib/brainUi'
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
  brainListOpportunities: vi.fn(), brainCountOpportunities: vi.fn(), brainGetOpportunityEvidence: vi.fn(), brainReviewOpportunity: vi.fn(),
  brainBuildDecisionBrief: vi.fn(), brainListSourceMetrics: vi.fn(), brainListJobs: vi.fn(), brainGetConsent: vi.fn(),
  brainRunSocialRecipe: vi.fn(), brainGrantConsent: vi.fn(), onBrainEvent: vi.fn(),
  brainListMonitors: vi.fn(), brainCreateMonitor: vi.fn(), brainSetMonitorStatus: vi.fn(), brainDeleteMonitor: vi.fn(),
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
  api.brainCountOpportunities.mockResolvedValue(opportunities.length)
  api.brainGetOpportunityEvidence.mockImplementation(async ({ id }: { id: string }) => id === 'lead-1' ? [evidence] : [])
  api.brainReviewOpportunity.mockResolvedValue({ ...opportunities[0], status: 'qualified' })
  api.brainBuildDecisionBrief.mockResolvedValue(brief)
  api.brainListSourceMetrics.mockResolvedValue([{ id: 'metric-1', scopeId: scope.id, platform: 'linkedin', metric: 'support momentum', value: 12, percentile: 0.8, observedAt: '2026-09-06T00:00:00.000Z' }])
  api.brainListJobs.mockResolvedValue([{ id: 'job-1', scopeId: scope.id, recipeId: 'linkedin.opportunity_scan', recipeVersion: 1, accountId: null, status: 'failed', parameters: {}, result: { recordCount: 14, error: 'Login expired' }, createdAt: scope.createdAt, updatedAt: '2026-09-06T00:00:00.000Z' }])
  api.brainListMonitors.mockResolvedValue([])
  api.brainGetConsent.mockResolvedValue(true)
  api.onBrainEvent.mockReturnValue(() => undefined)
})

afterEach(cleanup)

/** jsdom does not toggle <details> from a summary click, so drive it directly. */
function expandEvidence(summaryText: string) {
  const details = screen.getByText(summaryText).closest('details') as HTMLDetailsElement
  details.open = true
  fireEvent(details, new Event('toggle'))
  return details
}

describe('Intelligence live views', () => {
  it('shows a live per-recipe run status next to its own button, not only a top banner', async () => {
    api.brainRunSocialRecipe.mockResolvedValue({ requiresConsent: false, job: { id: 'job-7', status: 'queued' } })
    let emit = () => {}
    api.onBrainEvent.mockImplementation((handler: () => void) => { emit = handler; return () => undefined })
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Scan unread' }))
    await waitFor(() => expect(screen.getByText(/Job queued:/)).toBeTruthy())

    // Enqueueing does not itself update the jobs list — a Brain event does,
    // same as everywhere else on this page. The badge tracks the job live as
    // it moves toward completion, next to the button that started it, not
    // only in the top banner that needs a manual Dismiss.
    api.brainListJobs.mockResolvedValue([{ id: 'job-7', scopeId: scope.id, recipeId: 'whatsapp.unread_intelligence', recipeVersion: 1, accountId: null, status: 'queued', parameters: {}, result: null, createdAt: scope.createdAt, updatedAt: '2026-09-12T00:00:00.000Z' }])
    emit()
    await waitFor(() => expect(screen.getByText('Queued')).toBeTruthy())

    api.brainListJobs.mockResolvedValue([{ id: 'job-7', scopeId: scope.id, recipeId: 'whatsapp.unread_intelligence', recipeVersion: 1, accountId: null, status: 'completed', parameters: {}, result: { recordCount: 9 }, createdAt: scope.createdAt, updatedAt: '2026-09-12T00:05:00.000Z' }])
    emit()
    await waitFor(() => expect(screen.getByText('Completed')).toBeTruthy())
    expect(screen.queryByText('Queued')).toBeNull()
  })


  it('loads cited opportunities, filters statuses and reviews in the selected scope', async () => {
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))
    await waitFor(() => expect(screen.getByText('Needs React help')).toBeTruthy())
    expandEvidence('1 evidence item')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open LinkedIn evidence' })).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox', { name: 'Opportunity status' }), { target: { value: 'new' } })
    expect(screen.getByText('Support backlog')).toBeTruthy()
    expect(screen.queryByText('Needs React help')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Qualify opportunity' }))
    await waitFor(() => expect(api.brainReviewOpportunity).toHaveBeenCalledWith({ id: 'pain-1', scopeId: scope.id, decision: 'qualify' }))
  })

  it('says how many opportunities are hidden when the scope holds more than fit on one page', async () => {
    api.brainCountOpportunities.mockResolvedValue(opportunities.length + 40)
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))
    await waitFor(() => expect(screen.getByText('Needs React help')).toBeTruthy())
    expect(screen.getByText(/Showing the top 2 of 42 opportunities/)).toBeTruthy()
  })

  it('does not claim any opportunities are hidden when the count matches what is shown', async () => {
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))
    await waitFor(() => expect(screen.getByText('Needs React help')).toBeTruthy())
    expect(screen.queryByText(/Showing the top/)).toBeNull()
  })

  it('re-fetches an opportunity\'s evidence after a later capture changes its evidence count', async () => {
    let emit = () => {}
    api.onBrainEvent.mockImplementation((handler: () => void) => { emit = handler; return () => undefined })

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))
    await waitFor(() => expect(screen.getByText('Needs React help')).toBeTruthy())
    expandEvidence('1 evidence item')
    await waitFor(() => expect(api.brainGetOpportunityEvidence).toHaveBeenCalledTimes(1))
    // A later capture raised this opportunity's evidenceCount from 1 to 2. The
    // cache used to key only on "have we ever fetched this id", so the rail
    // kept showing the stale one-item list forever even as the count moved on.
    api.brainListOpportunities.mockResolvedValue(opportunities.map(item => item.id === 'lead-1' ? { ...item, evidenceCount: 2 } : item))
    emit()
    await waitFor(() => expect(screen.getByText('2 evidence items')).toBeTruthy())
    expandEvidence('2 evidence items')
    await waitFor(() => expect(api.brainGetOpportunityEvidence).toHaveBeenCalledTimes(2))
  })

  it('sets an error instead of doing nothing when the consent check returns an unusable response', async () => {
    api.brainRunSocialRecipe.mockResolvedValue({ requiresConsent: true })
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Scan unread' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Consent check returned an unusable response'))
    expect(screen.queryByRole('heading', { name: 'Private source consent required' })).toBeNull()
  })

  it('lets the job-queued notice be dismissed, and auto-clears it so it cannot survive a tab switch forever', async () => {
    api.brainRunSocialRecipe.mockResolvedValue({ requiresConsent: false, job: { id: 'job-42', status: 'queued' } })
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Scan unread' }))
    await waitFor(() => expect(screen.getByText(/Job queued:/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Job queued:/)).toBeNull()

    // The banner used to have no way to go away on its own — it survived
    // every tab switch within Intelligence and only cleared on a full page
    // remount (navigating to Brain and back). Fake time from here so a real
    // ten seconds does not have to pass in the test.
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Scan unread' }))
      await vi.advanceTimersByTimeAsync(0)
      expect(screen.getByText(/Job queued:/)).toBeTruthy()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(screen.queryByText(/Job queued:/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows real pain, trend and source state instead of placeholders', async () => {
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Pain Points' }))
    await waitFor(() => expect(screen.getByText('Support backlog')).toBeTruthy())
    expect(screen.getByText('3 repetitions')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trends' }))
    expect(await screen.findByText('support momentum')).toBeTruthy()
    // Was '80th percentile' — the stored percentile of a single observation
    // rendered as if it were a trend. Finding 8: one observation is not a rate
    // of change, so the card reports zero momentum and says so.
    expect(screen.getByText('0% momentum')).toBeTruthy()
    expect(screen.getByText(/Flat across the window/)).toBeTruthy()
    expect(screen.getByText(/1 observation/)).toBeTruthy()
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

/**
 * Consent is the load-bearing control for private capture ("Private capture ke
 * liye scope + recipe + provider consent lazmi hai"), so neither a refusal nor
 * a failure of it may look like a grant.
 */
describe('Intelligence consent handling', () => {
  async function openConsentBanner() {
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Scan opportunities' }))
    return await screen.findByRole('button', { name: 'Grant consent & run once' })
  }

  it('surfaces a refused consent grant and keeps the banner mounted', async () => {
    api.brainRunSocialRecipe.mockResolvedValue({ requiresConsent: true, provider: 'local-brain', fields: ['excerpt'], retentionDays: 30, destinationScopeId: scope.id })
    api.brainGrantConsent.mockResolvedValue(false)

    fireEvent.click(await openConsentBanner())

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Consent was not granted'))
    expect(screen.getByRole('button', { name: 'Grant consent & run once' })).toBeTruthy()
    // The refused grant must not be followed by the capture it was gating.
    expect(api.brainRunSocialRecipe).toHaveBeenCalledTimes(1)
  })

  it('surfaces a consent grant that throws', async () => {
    api.brainRunSocialRecipe.mockResolvedValue({ requiresConsent: true, provider: 'local-brain', fields: ['excerpt'], retentionDays: 30, destinationScopeId: scope.id })
    api.brainGrantConsent.mockRejectedValue(new Error('Brain utility process is unavailable'))

    fireEvent.click(await openConsentBanner())

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Brain utility process is unavailable'))
    expect(screen.getByRole('button', { name: 'Grant consent & run once' })).toBeTruthy()
    expect(api.brainRunSocialRecipe).toHaveBeenCalledTimes(1)
  })

  it('keeps the page populated when only the consent check fails', async () => {
    api.brainGetConsent.mockRejectedValue(new Error('consent ledger unavailable'))

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))

    // A consent-state read failure degrades the consent line, not the queue.
    await waitFor(() => expect(screen.getByText('Needs React help')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    expect(screen.getAllByText('Consent state unavailable').length).toBeGreaterThan(0)
  })

  it('derives every source consent line from the ledger, per recipe', async () => {
    api.brainGetConsent.mockImplementation(async ({ recipeId }: { recipeId: string }) => recipeId !== 'linkedin.community_scan')

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))

    await waitFor(() => expect(api.brainGetConsent).toHaveBeenCalledWith({ scopeId: scope.id, recipeId: 'notebooklm.research', provider: 'local-brain' }))
    for (const recipeId of ['notebooklm.artifact', 'whatsapp.unread_intelligence', 'linkedin.opportunity_scan', 'linkedin.community_scan']) {
      expect(api.brainGetConsent).toHaveBeenCalledWith({ scopeId: scope.id, recipeId, provider: 'local-brain' })
    }
    // LinkedIn declares two recipes; one consented recipe is not consent.
    const linkedin = screen.getByRole('heading', { name: 'LinkedIn' }).closest('section') as HTMLElement
    expect(linkedin.textContent).toContain('Consent required')
    const notebooklm = screen.getByRole('heading', { name: 'NotebookLM' }).closest('section') as HTMLElement
    expect(notebooklm.textContent).toContain('Consent granted')
  })
})


/**
 * Every recipe a monitor may schedule must be grantable from the UI.
 *
 * A monitor on a recipe the user cannot consent to is claimed every window and
 * silently skipped by `scheduler.runMonitor`, while its "Last run" keeps
 * advancing — a dead feature that looks healthy. The consent-granting path is
 * the Sources card, so every monitorable recipe needs a control there.
 */
describe('Intelligence consent reachability', () => {
  it.each(MONITORABLE_RECIPE_IDS)('reaches a consent grant for %s from the Sources card', async recipeId => {
    api.brainRunSocialRecipe.mockResolvedValue({ requiresConsent: true, provider: 'local-brain', fields: ['excerpt'], retentionDays: 30, destinationScopeId: scope.id })
    api.brainGrantConsent.mockResolvedValue(true)

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    fireEvent.click(await screen.findByRole('button', { name: MONITORABLE_RECIPE_CONTROLS[recipeId].actionLabel }))
    fireEvent.click(await screen.findByRole('button', { name: 'Grant consent & run once' }))

    await waitFor(() => expect(api.brainGrantConsent).toHaveBeenCalledWith({
      scopeId: scope.id, recipeId, provider: 'local-brain', fields: ['excerpt'],
    }))
    // The grant is followed by the capture it was gating, for this same recipe.
    await waitFor(() => expect(api.brainRunSocialRecipe).toHaveBeenCalledTimes(2))
    expect(api.brainRunSocialRecipe.mock.calls.every(call => (call[0] as { recipeId: string }).recipeId === recipeId)).toBe(true)
  })

  it('shows the per-recipe consent state LinkedIn needs for both of its recipes', async () => {
    api.brainGetConsent.mockImplementation(async ({ recipeId }: { recipeId: string }) => recipeId !== 'linkedin.community_scan')

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))

    const linkedin = (await screen.findByRole('heading', { name: 'LinkedIn' })).closest('section') as HTMLElement
    await waitFor(() => expect(linkedin.textContent).toContain('linkedin.community_scan: Consent required'))
    expect(linkedin.textContent).toContain('linkedin.opportunity_scan: Consent granted')
  })

  it('tells a monitor author when the selected recipe still needs consent', async () => {
    api.brainGetConsent.mockImplementation(async ({ recipeId }: { recipeId: string }) => recipeId !== 'linkedin.community_scan')
    api.brainListMonitors.mockResolvedValue([])

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Monitors' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Monitor recipe' }), { target: { value: 'linkedin.community_scan' } })

    await waitFor(() => expect(screen.getByText(/Grant it on the Sources tab/)).toBeTruthy())
  })
})

describe('Intelligence Trends window', () => {
  const series = [
    { id: 'rise-late', scopeId: scope.id, platform: 'linkedin', metric: 'support momentum', value: 30, percentile: 0.9, observedAt: '2026-09-06T00:00:00.000Z' },
    { id: 'rise-early', scopeId: scope.id, platform: 'linkedin', metric: 'support momentum', value: 2, percentile: 0.2, observedAt: '2026-08-20T00:00:00.000Z' },
    { id: 'fall-late', scopeId: scope.id, platform: 'whatsapp', metric: 'unread pressure', value: 1, percentile: 0.1, observedAt: '2026-09-06T00:00:00.000Z' },
    { id: 'fall-early', scopeId: scope.id, platform: 'whatsapp', metric: 'unread pressure', value: 40, percentile: 0.95, observedAt: '2026-08-20T00:00:00.000Z' },
  ]

  it('requests a bounded window and renders one card per metric with momentum', async () => {
    api.brainListSourceMetrics.mockResolvedValue(series)

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Trends' }))

    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'support momentum' })).toHaveLength(1))
    // The empty state used to claim a date window that did not exist.
    const call = api.brainListSourceMetrics.mock.calls[0][0] as { scopeId: string; since?: string }
    expect(call.scopeId).toBe(scope.id)
    expect(typeof call.since).toBe('string')
    expect(Number.isNaN(Date.parse(call.since as string))).toBe(false)
    // Four rows, two series: the historical peak no longer gets its own card.
    expect(screen.getAllByRole('heading', { name: 'unread pressure' })).toHaveLength(1)
    expect(screen.getByText(/Last 30 days/)).toBeTruthy()
    expect(screen.getByText(/Rising/)).toBeTruthy()
    expect(screen.getByText(/Falling/)).toBeTruthy()
  })

  it('states the window in the empty state it actually applied', async () => {
    api.brainListSourceMetrics.mockResolvedValue([])
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Trends' }))
    expect(await screen.findByText(/No source metrics were recorded in the last 30 days/)).toBeTruthy()
  })
})

describe('Intelligence refresh behaviour', () => {
  it('does not blank the page or refetch every evidence rail on a Brain event', async () => {
    let emit = () => {}
    api.onBrainEvent.mockImplementation((handler: () => void) => { emit = handler; return () => undefined })

    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }))
    await waitFor(() => expect(screen.getByText('Needs React help')).toBeTruthy())

    // Evidence is fetched for the rail the reviewer opened, not for all 100.
    expect(api.brainGetOpportunityEvidence).not.toHaveBeenCalled()
    expandEvidence('1 evidence item')
    await waitFor(() => expect(api.brainGetOpportunityEvidence).toHaveBeenCalledTimes(1))

    emit()

    // The card the reviewer is reading stays on screen: no full-page loader,
    // so the open rail is not remounted and collapsed mid-review.
    expect(screen.queryByText('Loading intelligence for this scope…')).toBeNull()
    expect(screen.getByText('Needs React help')).toBeTruthy()
    await waitFor(() => expect(api.brainListOpportunities).toHaveBeenCalledTimes(2))
    expect(api.brainGetOpportunityEvidence).toHaveBeenCalledTimes(1)
  })

  it('still shows the loader on the first load for a scope', async () => {
    let resolve = (value: BrainOpportunity[]) => { void value }
    api.brainListOpportunities.mockReturnValue(new Promise<BrainOpportunity[]>(done => { resolve = done }))

    render(<Intelligence />)
    expect(screen.getByText('Loading intelligence for this scope…')).toBeTruthy()
    resolve(opportunities)
    await waitFor(() => expect(screen.queryByText('Loading intelligence for this scope…')).toBeNull())
  })
})

describe('Intelligence monitors', () => {
  const monitor = {
    id: 'monitor-1', scopeId: scope.id, recipeId: 'linkedin.opportunity_scan', intervalMinutes: 60,
    minimumScore: 70, status: 'active' as const, lastRunAt: '2026-09-06T00:00:00.000Z',
    nextRunAt: '2026-09-06T01:00:00.000Z', createdAt: scope.createdAt, updatedAt: scope.createdAt,
  }

  it('shows the schedule, score bar and run times for each monitor in the scope', async () => {
    api.brainListMonitors.mockResolvedValue([monitor])
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Monitors' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'linkedin.opportunity_scan' })).toBeTruthy())
    expect(api.brainListMonitors).toHaveBeenCalledWith(scope.id)
    expect(screen.getByText('60 minutes')).toBeTruthy()
    expect(screen.getByText('70')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('creates a monitor with the default minimum score of 70', async () => {
    api.brainListMonitors.mockResolvedValue([])
    api.brainCreateMonitor.mockResolvedValue(monitor)
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Monitors' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Monitor recipe' })).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox', { name: 'Monitor recipe' }), { target: { value: 'linkedin.opportunity_scan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add monitor' }))
    await waitFor(() => expect(api.brainCreateMonitor).toHaveBeenCalledWith({
      scopeId: scope.id, recipeId: 'linkedin.opportunity_scan', intervalMinutes: 60, minimumScore: 70,
    }))
  })

  it('pauses a monitor and deletes only after an explicit confirmation', async () => {
    api.brainListMonitors.mockResolvedValue([monitor])
    api.brainSetMonitorStatus.mockResolvedValue({ ...monitor, status: 'paused' })
    api.brainDeleteMonitor.mockResolvedValue(true)
    render(<Intelligence />)
    fireEvent.click(screen.getByRole('button', { name: 'Monitors' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    // Scoped: monitor mutation carries the scope it was read from, so a stale
    // id can never reach another scope's monitor.
    await waitFor(() => expect(api.brainSetMonitorStatus).toHaveBeenCalledWith({ id: 'monitor-1', scopeId: scope.id, status: 'paused' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.brainDeleteMonitor).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(api.brainDeleteMonitor).toHaveBeenCalledWith({ id: 'monitor-1', scopeId: scope.id }))
  })
})
