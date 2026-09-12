import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, Radar, Radio } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { DecisionBrief } from '@/components/intelligence/DecisionBrief'
import { OpportunityCard } from '@/components/intelligence/OpportunityCard'
import { INTELLIGENCE_SOURCES, INTELLIGENCE_TABS, MONITORABLE_RECIPE_CONTROLS, MONITORABLE_RECIPE_IDS, type MonitorableRecipeId } from '@/lib/brainUi'
import { summarizeTrends, TREND_WINDOW_DAYS, windowStart } from '@/lib/sourceTrends'
import type { BrainDecisionBrief, BrainJob, BrainMonitor, BrainOpportunity, BrainOpportunityStatus, BrainScope, BrainSourceMetric, OpportunityEvidence } from '@/types/brain'

const sourceRecipes: Record<string, string[]> = {
  notebooklm: ['notebooklm.research', 'notebooklm.artifact'],
  whatsapp: ['whatsapp.unread_intelligence'],
  linkedin: ['linkedin.opportunity_scan', 'linkedin.community_scan'],
  reddit: [],
}

/** Consent is per-scope AND per-recipe, so every declared recipe is read. */
const consentChecks = Object.entries(sourceRecipes).flatMap(([sourceId, recipes]) => recipes.map(recipeId => ({ sourceId, recipeId })))

type ConsentState = 'granted' | 'required' | 'unknown'
/** Per-source aggregate plus the per-recipe states the aggregate is built from. */
interface ConsentView { sources: Record<string, ConsentState>; recipes: Record<string, ConsentState> }
const EMPTY_CONSENTS: ConsentView = { sources: {}, recipes: {} }

/**
 * Only recipes the Brain job runner claims can be monitored; the utility process
 * re-checks this. NotebookLM recipes are absent on purpose: their Brain jobs are
 * mirrors of the NotebookLM queue, so a monitor on one would never run.
 */
const monitorRecipes: readonly MonitorableRecipeId[] = MONITORABLE_RECIPE_IDS

/** The run/consent controls a source card renders, in declaration order. */
const sourceControls: Record<string, Array<{ recipeId: MonitorableRecipeId; actionLabel: string }>> = MONITORABLE_RECIPE_IDS.reduce((map, recipeId) => {
  const control = MONITORABLE_RECIPE_CONTROLS[recipeId]
  return { ...map, [control.sourceId]: [...(map[control.sourceId] ?? []), { recipeId, actionLabel: control.actionLabel }] }
}, {} as Record<string, Array<{ recipeId: MonitorableRecipeId; actionLabel: string }>>)
const MONITOR_MINIMUM_INTERVAL_MINUTES = 15
const MONITOR_DEFAULT_MINIMUM_SCORE = 70

export default function Intelligence() {
  const [tab, setTab] = useState<(typeof INTELLIGENCE_TABS)[number]>('Overview')
  const scopeState = useBrainScope()
  return <IntelligenceScopeView key={scopeState.scope?.id ?? 'loading'} {...scopeState} tab={tab} setTab={setTab} />
}

function IntelligenceScopeView({ scopes, scope, selectScope, loading: scopeLoading, error: scopeError, tab, setTab }: ReturnType<typeof useBrainScope> & {
  tab: (typeof INTELLIGENCE_TABS)[number]
  setTab: (tab: (typeof INTELLIGENCE_TABS)[number]) => void
}) {
  const api = window.electronAPI
  const [opportunities, setOpportunities] = useState<BrainOpportunity[]>([])
  const [opportunityTotal, setOpportunityTotal] = useState(0)
  const [evidence, setEvidence] = useState<Record<string, OpportunityEvidence[]>>({})
  const [metrics, setMetrics] = useState<BrainSourceMetric[]>([])
  const [jobs, setJobs] = useState<BrainJob[]>([])
  const [monitors, setMonitors] = useState<BrainMonitor[]>([])
  const [consents, setConsents] = useState<ConsentView>(EMPTY_CONSENTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reviewingId, setReviewingId] = useState('')
  const [statusFilter, setStatusFilter] = useState<BrainOpportunityStatus | 'all'>('all')
  const [question, setQuestion] = useState('')
  const [brief, setBrief] = useState<BrainDecisionBrief | null>(null)
  const [briefBusy, setBriefBusy] = useState(false)
  const [pendingConsent, setPendingConsent] = useState<{ recipeId: string; provider: string; fields: string[]; retentionDays: number; destinationScopeId: string } | null>(null)
  const active = useRef(true)
  const captureRequest = useRef(0)
  const refreshRequest = useRef(0)
  const loaded = useRef(false)
  const briefRequest = useRef(0)

  // The "Job queued: ... completed" notice used to have no way to go away on
  // its own: nothing cleared it after the job it named actually finished, so
  // it sat at the top of the page through every tab switch (tabs are plain
  // state on this same component) and only vanished when the whole page
  // unmounted — leaving to Brain and back, never navigating within
  // Intelligence itself. A capture is done long before ten seconds pass, so
  // auto-clearing on a short timer removes the stale banner without needing
  // to track the named job's live status.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 10_000)
    return () => clearTimeout(timer)
  }, [notice])

  const refresh = useCallback(async (activeScope: BrainScope) => {
    const request = ++refreshRequest.current
    // Only the first load for a scope blanks the page. Brain events fire while
    // a capture runs, and re-entering the loader on each one remounted every
    // card — collapsing the evidence rail the reviewer had open and throwing
    // away their scroll position, repeatedly, for the length of the capture.
    if (!loaded.current) setLoading(true)
    setError('')
    try {
      // Consent reads are settled independently of the intelligence reads: a
      // consent-ledger failure must degrade the consent line on the Sources
      // card, not empty the reviewer's opportunity queue, pain points and
      // trends — which would read as "this scope has no intelligence".
      const [[nextOpportunities, nextOpportunityTotal, nextMetrics, nextJobs, nextMonitors], nextConsents] = await Promise.all([
        Promise.all([
          api.brainListOpportunities({ scopeId: activeScope.id, limit: 500 }),
          api.brainCountOpportunities({ scopeId: activeScope.id }),
          api.brainListSourceMetrics({ scopeId: activeScope.id, since: windowStart(TREND_WINDOW_DAYS) }),
          api.brainListJobs(),
          api.brainListMonitors(activeScope.id),
        ]),
        readConsents(activeScope.id),
      ])
      if (!active.current || request !== refreshRequest.current) return
      setOpportunities(nextOpportunities)
      setOpportunityTotal(nextOpportunityTotal)
      setMetrics(nextMetrics)
      setJobs(nextJobs.filter(job => job.scopeId === activeScope.id))
      // The utility process already scopes this read; the filter keeps a stale or
      // over-broad response from ever rendering under another scope.
      setMonitors(nextMonitors.filter(monitor => monitor.scopeId === activeScope.id))
      setConsents(nextConsents)
      loaded.current = true
    } catch (reason) {
      if (active.current && request === refreshRequest.current) {
        setOpportunities([])
        setOpportunityTotal(0)
        setEvidence({})
        setMetrics([])
        setJobs([])
        setMonitors([])
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (active.current && request === refreshRequest.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    active.current = true
    if (!scope) return () => { active.current = false }
    void refresh(scope)
    const unsubscribe = api.onBrainEvent(() => { if (active.current) void refresh(scope) })
    return () => { active.current = false; unsubscribe() }
  }, [refresh, scope])

  /**
   * Reads one opportunity's evidence when its rail is opened, and re-reads it
   * if a later capture changed how much evidence exists. Caching forever on
   * first open meant a background capture that added evidence to an
   * already-open opportunity left the rail showing the old list while the
   * collapsed card's own evidenceCount moved on without it.
   */
  async function loadEvidence(id: string) {
    if (!scope || !active.current) return
    const current = opportunities.find(item => item.id === id)
    if (evidence[id] && current && evidence[id].length === current.evidenceCount) return
    try {
      const items = await api.brainGetOpportunityEvidence({ id, scopeId: scope.id })
      if (active.current) setEvidence(current => ({ ...current, [id]: items }))
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function reviewOpportunity(id: string, decision: 'qualify' | 'dismiss') {
    if (!scope || !active.current) return
    setReviewingId(id)
    setError('')
    try {
      await api.brainReviewOpportunity({ id, scopeId: scope.id, decision })
      if (active.current) await refresh(scope)
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active.current) setReviewingId('')
    }
  }

  async function buildBrief() {
    if (!scope || !question.trim()) return
    const request = ++briefRequest.current
    setBriefBusy(true)
    setError('')
    try {
      const result = await api.brainBuildDecisionBrief({ scopeId: scope.id, question: question.trim(), tokenBudget: 1200 })
      if (active.current && request === briefRequest.current) setBrief(result)
    } catch (reason) {
      if (active.current && request === briefRequest.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active.current && request === briefRequest.current) setBriefBusy(false)
    }
  }

  // Every recipe a monitor may schedule is runnable — and therefore consentable
  // — from this page. Consent is granted only through a recipe's own run
  // control, so a narrower type here would leave a monitorable recipe with no
  // consent path at all: a monitor on it would be skipped forever.
  async function runRecipe(recipeId: MonitorableRecipeId) {
    if (!scope || !active.current) return
    const request = ++captureRequest.current
    setPendingConsent(null)
    setNotice('')
    try {
      const response = await api.brainRunSocialRecipe({ recipeId, scopeId: scope.id, accountId: null, parameters: { limit: 50, retentionDays: 30, mode: 'background' } }) as { requiresConsent: boolean; provider?: string; fields?: string[]; retentionDays?: number; destinationScopeId?: string; job?: { id: string; status: string } }
      if (!active.current || request !== captureRequest.current) return
      if (response.requiresConsent) {
        // A malformed or wrong-scope consent response used to just `return`
        // here with the notice already cleared above — the user pressed the
        // scan button and saw nothing at all, no error, no banner, as if
        // the click had done nothing.
        if (!response.provider || !response.fields || response.destinationScopeId !== scope.id) {
          setError('Consent check returned an unusable response — the capture was refused rather than run.')
          return
        }
        setPendingConsent({ recipeId, provider: response.provider, fields: response.fields, retentionDays: response.retentionDays ?? 30, destinationScopeId: response.destinationScopeId })
        return
      }
      setNotice(response.job ? `Job queued: ${response.job.id} · ${response.job.status}` : 'Unable to queue capture job')
    } catch (reason) {
      if (active.current && request === captureRequest.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function grantAndRun() {
    if (!scope || !active.current || !pendingConsent || pendingConsent.destinationScopeId !== scope.id) return
    const request = captureRequest.current
    setError('')
    let granted = false
    try {
      granted = await api.brainGrantConsent({ scopeId: pendingConsent.destinationScopeId, recipeId: pendingConsent.recipeId, provider: pendingConsent.provider, fields: pendingConsent.fields }) === true
    } catch (reason) {
      if (active.current && request === captureRequest.current) setError(reason instanceof Error ? reason.message : String(reason))
      return
    }
    if (!active.current || request !== captureRequest.current) return
    // A refused grant is not a grant. The banner stays mounted and the capture
    // it was gating does not run, so the user can tell consent from silence.
    if (!granted) {
      setError('Consent was not granted, so the capture did not run.')
      return
    }
    const recipeId = pendingConsent.recipeId as MonitorableRecipeId
    setPendingConsent(null)
    await runRecipe(recipeId)
  }

  const painPoints = opportunities
    .filter(item => ['product_opportunity', 'market_signal', 'warm_opportunity'].includes(item.category))
    .sort((left, right) => right.evidenceCount - left.evidenceCount || right.score - left.score)
  const filteredOpportunities = statusFilter === 'all' ? opportunities : opportunities.filter(item => item.status === statusFilter)
  const trends = summarizeTrends(metrics)

  return <div className="flex h-full flex-col overflow-hidden text-stone-800">
    <header className="border-b border-stone-200 bg-white/90 px-6 py-4">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-100 p-2 text-violet-700"><Radar size={22} /></div><div><h1 className="text-xl font-bold">Intelligence</h1><p className="text-xs text-stone-500">Evidence-led signals across connected sources</p></div><div className="ml-auto"><ScopePicker scopes={scopes} value={scope?.id ?? null} onChange={selectScope} disabled={scopeLoading} /></div></div>
      <nav aria-label="Intelligence sections" className="mt-4 flex gap-2 overflow-x-auto pb-1">{INTELLIGENCE_TABS.map(item => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-violet-700 text-white' : 'bg-stone-100 text-stone-600'}`}>{item}</button>)}</nav>
    </header>
    <main className="flex-1 overflow-y-auto p-6">
      {(scopeError || error || notice) && <p role={scopeError || error ? 'alert' : 'status'} className={`mb-4 flex items-center justify-between gap-3 rounded-xl p-3 text-sm ${scopeError || error ? 'bg-red-50 text-red-700' : 'bg-violet-50 text-violet-700'}`}><span>{scopeError || error || notice}</span>{notice && !scopeError && !error && <button aria-label="Dismiss" onClick={() => setNotice('')} className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-100">Dismiss</button>}</p>}
      {pendingConsent && <section className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold text-amber-900">Private source consent required</h2><p className="mt-2 text-sm text-amber-800">Provider: {pendingConsent.provider} · Retention: {pendingConsent.retentionDays} days · Scope: {pendingConsent.destinationScopeId}</p><p className="mt-1 text-xs text-amber-700">Fields: {pendingConsent.fields.join(', ')}</p><button onClick={() => void grantAndRun()} className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Grant consent & run once</button></section>}
      {loading && <p role="status" className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-500">Loading intelligence for this scope…</p>}

      {!loading && tab === 'Overview' && <div className="space-y-5"><Overview opportunities={opportunities} metrics={metrics} jobs={jobs} /><Sources jobs={jobs} consents={consents} onRun={recipe => void runRecipe(recipe)} /></div>}
      {!loading && tab === 'Sources' && <Sources jobs={jobs} consents={consents} onRun={recipe => void runRecipe(recipe)} />}
      {!loading && tab === 'Monitors' && scope && <Monitors scope={scope} monitors={monitors} consents={consents} onChanged={() => void refresh(scope)} onError={setError} />}
      {!loading && tab === 'Pain Points' && <section><h2 className="text-sm font-semibold">Pain clusters by repetition and severity</h2>{painPoints.length === 0 ? <Empty text="No repeated pain points have been captured for this scope." /> : <div className="mt-3 space-y-3">{painPoints.map(item => <article key={item.id} className="rounded-2xl border border-stone-200 bg-white p-4"><div className="flex items-center justify-between gap-4"><h3 className="font-semibold">{item.title}</h3><span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">{item.evidenceCount} repetitions</span></div><p className="mt-2 text-sm text-stone-600">{item.summary}</p><p className="mt-3 text-xs text-stone-500">Severity score {Math.round(item.score)} · {Math.round(item.confidence * 100)}% confidence</p></article>)}</div>}</section>}
      {!loading && tab === 'Trends' && <section><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">Source-relative momentum</h2><span className="text-xs text-stone-500">Last {TREND_WINDOW_DAYS} days · ranked within each source</span></div>{trends.length === 0 ? <Empty text={`No source metrics were recorded in the last ${TREND_WINDOW_DAYS} days for this scope.`} /> : <div className="mt-3 grid gap-3 md:grid-cols-2">{trends.map(trend => <article key={trend.id} className="rounded-2xl border border-stone-200 bg-white p-4"><div className="flex items-center justify-between"><BarChart3 size={17} className="text-violet-700" /><span className="text-xs text-stone-500">{trend.platform}</span></div><h3 className="mt-3 font-semibold">{trend.metric}</h3><p className="mt-1 text-2xl font-bold tabular-nums">{Math.round(trend.momentum * 100)}% momentum</p><p className="mt-1 text-xs font-medium text-stone-600">{trend.delta > 0 ? `Rising ${Math.round(trend.delta * 100)} pts` : trend.delta < 0 ? `Falling ${Math.round(Math.abs(trend.delta) * 100)} pts` : 'Flat across the window'}</p><p className="mt-2 text-xs text-stone-500">Latest value {trend.value} · {trend.observations} observation{trend.observations === 1 ? '' : 's'} · {new Date(trend.observedAt).toLocaleDateString()}</p></article>)}</div>}</section>}
      {!loading && tab === 'Opportunities' && <section><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Evidence review queue</h2><label className="text-xs text-stone-600">Status <select aria-label="Opportunity status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as BrainOpportunityStatus | 'all')} className="ml-2 rounded-lg border border-stone-300 bg-white px-3 py-2"><option value="all">All review states</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="qualified">Qualified</option></select></label></div>{opportunityTotal > opportunities.length && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Showing the top {opportunities.length} of {opportunityTotal} opportunities by score. Qualify or dismiss some to bring the rest into view.</p>}{filteredOpportunities.length === 0 ? <Empty text={`No ${statusFilter} opportunities in this scope.`} /> : <div className="mt-3 space-y-4">{filteredOpportunities.map(item => <OpportunityCard key={item.id} opportunity={item} scope={scope as BrainScope} evidence={evidence[item.id]} busy={reviewingId === item.id} onExpand={id => void loadEvidence(id)} onQualify={id => void reviewOpportunity(id, 'qualify')} onDismiss={id => void reviewOpportunity(id, 'dismiss')} />)}</div>}</section>}
      {!loading && tab === 'Decision Briefs' && <section className="mx-auto max-w-4xl"><form onSubmit={event => { event.preventDefault(); void buildBrief() }} className="rounded-2xl border border-stone-200 bg-white p-5"><label htmlFor="decision-question" className="text-sm font-semibold">Decision question</label><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input id="decision-question" aria-label="Decision question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Should we pursue this client segment?" className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" /><button disabled={briefBusy || !question.trim()} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{briefBusy ? 'Building…' : 'Build decision brief'}</button></div><p className="mt-2 text-xs text-stone-500">Only stored, scoped evidence is used. External instructions are treated as source text, never executed.</p></form>{brief && <div className="mt-4"><DecisionBrief brief={brief} /></div>}</section>}
    </main>
  </div>
}

/**
 * Monitor controls: one recurring recipe run per scope, actionable results only.
 *
 * Every mutation re-reads through the page's own guarded refresh, so a scope
 * switch during a write can never leave another scope's monitors on screen.
 */
function Monitors({ scope, monitors, consents, onChanged, onError }: {
  scope: BrainScope
  monitors: BrainMonitor[]
  consents: ConsentView
  onChanged: () => void
  onError: (message: string) => void
}) {
  const api = window.electronAPI
  const [recipeId, setRecipeId] = useState(monitorRecipes[0])
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [minimumScore, setMinimumScore] = useState(MONITOR_DEFAULT_MINIMUM_SCORE)
  const [busyId, setBusyId] = useState('')
  const [confirmingId, setConfirmingId] = useState('')

  async function mutate(id: string, action: () => Promise<unknown>) {
    setBusyId(id)
    onError('')
    try {
      await action()
      onChanged()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyId('')
    }
  }

  return <section className="space-y-4">
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-center gap-2 font-semibold"><Activity size={18} /> Actionable-only monitors</div>
      <p className="mt-2 text-xs text-stone-500">A monitor runs a recipe on a schedule and resumes the Agent only when a new signal reaches its minimum score. Monitors run inside FlowDesk: band ho to koi background service nahi chalegi.</p>
      <form
        onSubmit={event => { event.preventDefault(); void mutate('new', () => api.brainCreateMonitor({ scopeId: scope.id, recipeId, intervalMinutes, minimumScore })) }}
        className="mt-4 grid gap-3 sm:grid-cols-4"
      >
        <label className="text-xs text-stone-600">Recipe
          <select aria-label="Monitor recipe" value={recipeId} onChange={event => setRecipeId(event.target.value as MonitorableRecipeId)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm">
            {monitorRecipes.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-xs text-stone-600">Interval (minutes)
          <input aria-label="Monitor interval in minutes" type="number" min={MONITOR_MINIMUM_INTERVAL_MINUTES} step={5} value={intervalMinutes} onChange={event => setIntervalMinutes(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm" />
        </label>
        <label className="text-xs text-stone-600">Minimum score
          <input aria-label="Monitor minimum score" type="number" min={0} max={100} value={minimumScore} onChange={event => setMinimumScore(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm" />
        </label>
        <button disabled={busyId !== '' || intervalMinutes < MONITOR_MINIMUM_INTERVAL_MINUTES} className="self-end rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Add monitor</button>
      </form>
      <p className="mt-2 text-xs text-stone-500">Minimum interval {MONITOR_MINIMUM_INTERVAL_MINUTES} minutes. Private sources still need consent before a monitor can capture anything.</p>
      {/* A monitor whose recipe has no consent is claimed every window and then
          skipped, while its "Last run" still advances — so the missing grant is
          said here, before the monitor is created, and pointed at the one place
          that can grant it. */}
      {consents.recipes[recipeId] !== 'granted' && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{consentLabels[consents.recipes[recipeId] ?? 'unknown']} for {recipeId}. Grant it on the Sources tab with that recipe&apos;s own run control, or this monitor will be skipped every window.</p>}
    </section>
    {monitors.length === 0
      ? <Empty text="No monitors in this scope yet." />
      : <div className="space-y-3">{monitors.map(monitor => <article key={monitor.id} className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{monitor.recipeId}</h3>
          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${monitor.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{monitor.status === 'active' ? 'Active' : 'Paused'}</span>
        </div>
        <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-2"><dt className="text-stone-500">Scope</dt><dd>{scope.name}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-stone-500">Every</dt><dd>{monitor.intervalMinutes} minutes</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-stone-500">Minimum score</dt><dd>{monitor.minimumScore}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-stone-500">Last run</dt><dd>{monitor.lastRunAt ? new Date(monitor.lastRunAt).toLocaleString() : 'Never'}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-stone-500">Next run</dt><dd>{new Date(monitor.nextRunAt).toLocaleString()}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            disabled={busyId === monitor.id}
            onClick={() => void mutate(monitor.id, () => api.brainSetMonitorStatus({ id: monitor.id, scopeId: scope.id, status: monitor.status === 'active' ? 'paused' : 'active' }))}
            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >{monitor.status === 'active' ? 'Pause' : 'Resume'}</button>
          {confirmingId === monitor.id
            ? <>
              <button disabled={busyId === monitor.id} onClick={() => { setConfirmingId(''); void mutate(monitor.id, () => api.brainDeleteMonitor({ id: monitor.id, scopeId: scope.id })) }} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirm delete</button>
              <button onClick={() => setConfirmingId('')} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-600">Keep monitor</button>
              <span className="text-xs text-red-700">Deleting also forgets what this monitor has already reported.</span>
            </>
            : <button onClick={() => setConfirmingId(monitor.id)} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-600">Delete</button>}
        </div>
      </article>)}</div>}
  </section>
}

/**
 * Reads consent for every declared recipe, one settled promise each.
 *
 * A source counts as consented only when all of its recipes are — LinkedIn
 * declares two, and one consented recipe is not consent for the other. A read
 * that throws yields 'unknown' rather than a fabricated boolean: displaying
 * "Consent required" for a ledger we could not reach would be a guess, and
 * displaying "Consent granted" would be a dangerous one.
 */
async function readConsents(scopeId: string): Promise<ConsentView> {
  const api = window.electronAPI
  const results = await Promise.all(consentChecks.map(async check => {
    try {
      return { ...check, state: (await api.brainGetConsent({ scopeId, recipeId: check.recipeId, provider: 'local-brain' })) === true ? 'granted' as const : 'required' as const }
    } catch {
      return { ...check, state: 'unknown' as const }
    }
  }))
  const sources = Object.fromEntries(Object.keys(sourceRecipes).map(sourceId => {
    const forSource = results.filter(result => result.sourceId === sourceId)
    if (!forSource.length) return [sourceId, 'required' as ConsentState]
    if (forSource.some(result => result.state === 'unknown')) return [sourceId, 'unknown' as ConsentState]
    return [sourceId, forSource.every(result => result.state === 'granted') ? 'granted' as ConsentState : 'required' as ConsentState]
  }))
  return { sources, recipes: Object.fromEntries(results.map(result => [result.recipeId, result.state])) }
}

const consentLabels: Record<ConsentState, string> = {
  granted: 'Consent granted',
  required: 'Consent required',
  unknown: 'Consent state unavailable',
}

function Empty({ text }: { text: string }) {
  return <p className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-500">{text}</p>
}

function Overview({ opportunities, metrics, jobs }: { opportunities: BrainOpportunity[]; metrics: BrainSourceMetric[]; jobs: BrainJob[] }) {
  const cards = [
    ['Open opportunities', opportunities.filter(item => ['new', 'reviewing'].includes(item.status)).length],
    ['Qualified', opportunities.filter(item => item.status === 'qualified').length],
    ['Tracked trends', metrics.length],
    ['Capture jobs', jobs.length],
  ] as const
  return <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{cards.map(([label, value]) => <section key={label} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-xs text-stone-500">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></section>)}</div>
}

function Sources({ jobs, consents, onRun }: { jobs: BrainJob[]; consents: ConsentView; onRun: (recipe: MonitorableRecipeId) => void }) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{INTELLIGENCE_SOURCES.map(source => {
    const sourceJobs = jobs.filter(job => sourceRecipes[source.id].includes(job.recipeId))
    const latest = [...sourceJobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    const recordCount = typeof latest?.result?.recordCount === 'number' ? latest.result.recordCount : 0
    const sourceError = latest?.status === 'failed' && typeof latest.result?.error === 'string' ? latest.result.error : ''
    return <section key={source.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><Radio size={18} className={source.status === 'available' ? 'text-emerald-600' : 'text-stone-400'} /><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${source.status === 'available' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{source.status === 'available' ? 'Available' : 'Not connected'}</span></div><h2 className="mt-4 font-semibold">{source.title}</h2><p className="mt-1 text-xs text-stone-500">{source.detail}</p>{source.status === 'available' && <dl className="mt-3 space-y-1 text-xs"><div className="flex justify-between gap-2"><dt className="text-stone-500">Consent</dt><dd>{consentLabels[consents.sources[source.id] ?? 'unknown']}</dd></div><div className="flex justify-between gap-2"><dt className="text-stone-500">Last capture</dt><dd>{latest ? new Date(latest.updatedAt).toLocaleDateString() : 'Never'}</dd></div><div className="flex justify-between gap-2"><dt className="text-stone-500">Records</dt><dd>{recordCount} records</dd></div></dl>}{sourceError && <p className="mt-3 flex items-start gap-1 rounded-lg bg-red-50 p-2 text-xs text-red-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {sourceError}</p>}{(sourceControls[source.id] ?? []).map(control => <div key={control.recipeId} className="mt-3">
      <button onClick={() => onRun(control.recipeId)} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">{control.actionLabel}</button>
      {/* Per recipe, not per source: consent is keyed on scope + recipe +
          provider, so LinkedIn's two recipes each need their own state and
          their own way to be granted. Running the recipe opens the consent
          banner when the ledger has no grant yet. */}
      <p className="mt-1 text-[11px] text-stone-500">{control.recipeId}: {consentLabels[consents.recipes[control.recipeId] ?? 'unknown']}</p>
    </div>)}{source.id === 'reddit' &&<p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Live capture excluded; fake data show nahi hogi.</p>}</section>
  })}</div>
}
