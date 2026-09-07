import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, Radar, Radio } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { DecisionBrief } from '@/components/intelligence/DecisionBrief'
import { OpportunityCard } from '@/components/intelligence/OpportunityCard'
import { INTELLIGENCE_SOURCES, INTELLIGENCE_TABS } from '@/lib/brainUi'
import type { BrainDecisionBrief, BrainJob, BrainOpportunity, BrainOpportunityStatus, BrainScope, BrainSourceMetric, OpportunityEvidence } from '@/types/brain'

const sourceRecipes: Record<string, string[]> = {
  notebooklm: ['notebooklm.research', 'notebooklm.artifact'],
  whatsapp: ['whatsapp.unread_intelligence'],
  linkedin: ['linkedin.opportunity_scan', 'linkedin.community_scan'],
  reddit: [],
}

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
  const [evidence, setEvidence] = useState<Record<string, OpportunityEvidence[]>>({})
  const [metrics, setMetrics] = useState<BrainSourceMetric[]>([])
  const [jobs, setJobs] = useState<BrainJob[]>([])
  const [consents, setConsents] = useState<Record<string, boolean>>({})
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
  const briefRequest = useRef(0)

  const refresh = useCallback(async (activeScope: BrainScope) => {
    const request = ++refreshRequest.current
    setLoading(true)
    setError('')
    try {
      const [nextOpportunities, nextMetrics, nextJobs, whatsappConsent, linkedinConsent] = await Promise.all([
        api.brainListOpportunities({ scopeId: activeScope.id, limit: 100 }),
        api.brainListSourceMetrics({ scopeId: activeScope.id }),
        api.brainListJobs(),
        api.brainGetConsent({ scopeId: activeScope.id, recipeId: 'whatsapp.unread_intelligence', provider: 'local-brain' }),
        api.brainGetConsent({ scopeId: activeScope.id, recipeId: 'linkedin.opportunity_scan', provider: 'local-brain' }),
      ])
      const evidenceEntries = await Promise.all(nextOpportunities.map(async opportunity => [
        opportunity.id,
        await api.brainGetOpportunityEvidence({ id: opportunity.id, scopeId: activeScope.id }),
      ] as const))
      if (!active.current || request !== refreshRequest.current) return
      setOpportunities(nextOpportunities)
      setEvidence(Object.fromEntries(evidenceEntries))
      setMetrics(nextMetrics)
      setJobs(nextJobs.filter(job => job.scopeId === activeScope.id))
      setConsents({ whatsapp: whatsappConsent, linkedin: linkedinConsent, notebooklm: true, reddit: false })
    } catch (reason) {
      if (active.current && request === refreshRequest.current) {
        setOpportunities([])
        setEvidence({})
        setMetrics([])
        setJobs([])
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

  async function runRecipe(recipeId: 'whatsapp.unread_intelligence' | 'linkedin.opportunity_scan') {
    if (!scope || !active.current) return
    const request = ++captureRequest.current
    setPendingConsent(null)
    setNotice('')
    try {
      const response = await api.brainRunSocialRecipe({ recipeId, scopeId: scope.id, accountId: null, parameters: { limit: 50, retentionDays: 30, mode: 'background' } }) as { requiresConsent: boolean; provider?: string; fields?: string[]; retentionDays?: number; destinationScopeId?: string; job?: { id: string; status: string } }
      if (!active.current || request !== captureRequest.current) return
      if (response.requiresConsent) {
        if (!response.provider || !response.fields || response.destinationScopeId !== scope.id) return
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
    await api.brainGrantConsent({ scopeId: pendingConsent.destinationScopeId, recipeId: pendingConsent.recipeId, provider: pendingConsent.provider, fields: pendingConsent.fields })
    if (!active.current || request !== captureRequest.current) return
    const recipeId = pendingConsent.recipeId as 'whatsapp.unread_intelligence' | 'linkedin.opportunity_scan'
    setPendingConsent(null)
    await runRecipe(recipeId)
  }

  const painPoints = opportunities
    .filter(item => ['product_opportunity', 'market_signal', 'warm_opportunity'].includes(item.category))
    .sort((left, right) => right.evidenceCount - left.evidenceCount || right.score - left.score)
  const filteredOpportunities = statusFilter === 'all' ? opportunities : opportunities.filter(item => item.status === statusFilter)
  const rankedMetrics = [...metrics].sort((left, right) => right.percentile - left.percentile || right.observedAt.localeCompare(left.observedAt))

  return <div className="flex h-full flex-col overflow-hidden text-stone-800">
    <header className="border-b border-stone-200 bg-white/90 px-6 py-4">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-100 p-2 text-violet-700"><Radar size={22} /></div><div><h1 className="text-xl font-bold">Intelligence</h1><p className="text-xs text-stone-500">Evidence-led signals across connected sources</p></div><div className="ml-auto"><ScopePicker scopes={scopes} value={scope?.id ?? null} onChange={selectScope} disabled={scopeLoading} /></div></div>
      <nav aria-label="Intelligence sections" className="mt-4 flex gap-2 overflow-x-auto pb-1">{INTELLIGENCE_TABS.map(item => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-violet-700 text-white' : 'bg-stone-100 text-stone-600'}`}>{item}</button>)}</nav>
    </header>
    <main className="flex-1 overflow-y-auto p-6">
      {(scopeError || error || notice) && <p role={scopeError || error ? 'alert' : 'status'} className={`mb-4 rounded-xl p-3 text-sm ${scopeError || error ? 'bg-red-50 text-red-700' : 'bg-violet-50 text-violet-700'}`}>{scopeError || error || notice}</p>}
      {pendingConsent && <section className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold text-amber-900">Private source consent required</h2><p className="mt-2 text-sm text-amber-800">Provider: {pendingConsent.provider} · Retention: {pendingConsent.retentionDays} days · Scope: {pendingConsent.destinationScopeId}</p><p className="mt-1 text-xs text-amber-700">Fields: {pendingConsent.fields.join(', ')}</p><button onClick={() => void grantAndRun()} className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Grant consent & run once</button></section>}
      {loading && <p role="status" className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-500">Loading intelligence for this scope…</p>}

      {!loading && tab === 'Overview' && <div className="space-y-5"><Overview opportunities={opportunities} metrics={metrics} jobs={jobs} /><Sources jobs={jobs} consents={consents} onRun={recipe => void runRecipe(recipe)} /></div>}
      {!loading && tab === 'Sources' && <Sources jobs={jobs} consents={consents} onRun={recipe => void runRecipe(recipe)} />}
      {!loading && tab === 'Monitors' && <section className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2 font-semibold"><Activity size={18} /> Actionable-only monitors</div><p className="mt-2 text-sm text-stone-500">Monitor controls become available with the scheduler. FlowDesk band ho to koi background service nahi chalegi.</p></section>}
      {!loading && tab === 'Pain Points' && <section><h2 className="text-sm font-semibold">Pain clusters by repetition and severity</h2>{painPoints.length === 0 ? <Empty text="No repeated pain points have been captured for this scope." /> : <div className="mt-3 space-y-3">{painPoints.map(item => <article key={item.id} className="rounded-2xl border border-stone-200 bg-white p-4"><div className="flex items-center justify-between gap-4"><h3 className="font-semibold">{item.title}</h3><span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">{item.evidenceCount} repetitions</span></div><p className="mt-2 text-sm text-stone-600">{item.summary}</p><p className="mt-3 text-xs text-stone-500">Severity score {Math.round(item.score)} · {Math.round(item.confidence * 100)}% confidence</p></article>)}</div>}</section>}
      {!loading && tab === 'Trends' && <section><h2 className="text-sm font-semibold">Source-relative momentum</h2>{rankedMetrics.length === 0 ? <Empty text="No source metrics are available for this date window." /> : <div className="mt-3 grid gap-3 md:grid-cols-2">{rankedMetrics.map(metric => <article key={metric.id} className="rounded-2xl border border-stone-200 bg-white p-4"><div className="flex items-center justify-between"><BarChart3 size={17} className="text-violet-700" /><span className="text-xs text-stone-500">{metric.platform}</span></div><h3 className="mt-3 font-semibold">{metric.metric}</h3><p className="mt-1 text-2xl font-bold tabular-nums">{Math.round(metric.percentile * 100)}th percentile</p><p className="mt-2 text-xs text-stone-500">Value {metric.value} · {new Date(metric.observedAt).toLocaleDateString()}</p></article>)}</div>}</section>}
      {!loading && tab === 'Opportunities' && <section><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Evidence review queue</h2><label className="text-xs text-stone-600">Status <select aria-label="Opportunity status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as BrainOpportunityStatus | 'all')} className="ml-2 rounded-lg border border-stone-300 bg-white px-3 py-2"><option value="all">All review states</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="qualified">Qualified</option></select></label></div>{filteredOpportunities.length === 0 ? <Empty text={`No ${statusFilter} opportunities in this scope.`} /> : <div className="mt-3 space-y-4">{filteredOpportunities.map(item => <OpportunityCard key={item.id} opportunity={item} scope={scope as BrainScope} evidence={evidence[item.id] ?? []} busy={reviewingId === item.id} onQualify={id => void reviewOpportunity(id, 'qualify')} onDismiss={id => void reviewOpportunity(id, 'dismiss')} />)}</div>}</section>}
      {!loading && tab === 'Decision Briefs' && <section className="mx-auto max-w-4xl"><form onSubmit={event => { event.preventDefault(); void buildBrief() }} className="rounded-2xl border border-stone-200 bg-white p-5"><label htmlFor="decision-question" className="text-sm font-semibold">Decision question</label><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input id="decision-question" aria-label="Decision question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Should we pursue this client segment?" className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" /><button disabled={briefBusy || !question.trim()} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{briefBusy ? 'Building…' : 'Build decision brief'}</button></div><p className="mt-2 text-xs text-stone-500">Only stored, scoped evidence is used. External instructions are treated as source text, never executed.</p></form>{brief && <div className="mt-4"><DecisionBrief brief={brief} /></div>}</section>}
    </main>
  </div>
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

function Sources({ jobs, consents, onRun }: { jobs: BrainJob[]; consents: Record<string, boolean>; onRun: (recipe: 'whatsapp.unread_intelligence' | 'linkedin.opportunity_scan') => void }) {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{INTELLIGENCE_SOURCES.map(source => {
    const sourceJobs = jobs.filter(job => sourceRecipes[source.id].includes(job.recipeId))
    const latest = [...sourceJobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    const recordCount = typeof latest?.result?.recordCount === 'number' ? latest.result.recordCount : 0
    const sourceError = latest?.status === 'failed' && typeof latest.result?.error === 'string' ? latest.result.error : ''
    return <section key={source.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><Radio size={18} className={source.status === 'available' ? 'text-emerald-600' : 'text-stone-400'} /><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${source.status === 'available' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{source.status === 'available' ? 'Available' : 'Not connected'}</span></div><h2 className="mt-4 font-semibold">{source.title}</h2><p className="mt-1 text-xs text-stone-500">{source.detail}</p>{source.status === 'available' && <dl className="mt-3 space-y-1 text-xs"><div className="flex justify-between gap-2"><dt className="text-stone-500">Consent</dt><dd>{consents[source.id] ? 'Consent granted' : 'Consent required'}</dd></div><div className="flex justify-between gap-2"><dt className="text-stone-500">Last capture</dt><dd>{latest ? new Date(latest.updatedAt).toLocaleDateString() : 'Never'}</dd></div><div className="flex justify-between gap-2"><dt className="text-stone-500">Records</dt><dd>{recordCount} records</dd></div></dl>}{sourceError && <p className="mt-3 flex items-start gap-1 rounded-lg bg-red-50 p-2 text-xs text-red-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {sourceError}</p>}{source.id === 'whatsapp' && <button onClick={() => onRun('whatsapp.unread_intelligence')} className="mt-3 rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Scan unread</button>}{source.id === 'linkedin' && <button onClick={() => onRun('linkedin.opportunity_scan')} className="mt-3 rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Scan opportunities</button>}{source.id === 'reddit' && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Live capture excluded; fake data show nahi hogi.</p>}</section>
  })}</div>
}
