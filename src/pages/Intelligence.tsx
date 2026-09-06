import { useEffect, useRef, useState } from 'react'
import { Activity, LockKeyhole, Radar, Radio } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { INTELLIGENCE_SOURCES, INTELLIGENCE_TABS } from '@/lib/brainUi'

export default function Intelligence() {
  const [tab, setTab] = useState<(typeof INTELLIGENCE_TABS)[number]>('Overview')
  const scopeState = useBrainScope()
  return <IntelligenceScopeView key={scopeState.scope?.id ?? 'loading'} {...scopeState} tab={tab} setTab={setTab} />
}

function IntelligenceScopeView({ scopes, scope, selectScope, loading: scopeLoading, error: scopeError, tab, setTab }: ReturnType<typeof useBrainScope> & {
  tab: (typeof INTELLIGENCE_TABS)[number]
  setTab: (tab: (typeof INTELLIGENCE_TABS)[number]) => void
}) {
  const [notice, setNotice] = useState('')
  const [pendingConsent, setPendingConsent] = useState<{ recipeId: string; provider: string; fields: string[]; retentionDays: number; destinationScopeId: string } | null>(null)
  const active = useRef(true)
  const captureRequest = useRef(0)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  async function runRecipe(recipeId: 'whatsapp.unread_intelligence' | 'linkedin.opportunity_scan') {
    if (!scope || !active.current) return
    const request = ++captureRequest.current
    setPendingConsent(null)
    setNotice('')
    const response = await window.electronAPI.brainRunSocialRecipe({ recipeId, scopeId: scope.id, accountId: null, parameters: { limit: 50, retentionDays: 30, mode: 'background' } }) as { requiresConsent: boolean; provider?: string; fields?: string[]; retentionDays?: number; destinationScopeId?: string; manifest?: { recordCount?: number } }
    if (!active.current || request !== captureRequest.current) return
    if (response.requiresConsent) {
      if (!response.provider || !response.fields || response.destinationScopeId !== scope.id) return
      setPendingConsent({ recipeId, provider: response.provider, fields: response.fields, retentionDays: response.retentionDays ?? 30, destinationScopeId: response.destinationScopeId })
      return
    }
    setPendingConsent(null)
    setNotice(`Capture complete: ${response.manifest?.recordCount ?? 0} records`)
  }

  async function grantAndRun() {
    if (!scope || !active.current || !pendingConsent || pendingConsent.destinationScopeId !== scope.id) return
    const request = captureRequest.current
    await window.electronAPI.brainGrantConsent({ scopeId: pendingConsent.destinationScopeId, recipeId: pendingConsent.recipeId, provider: pendingConsent.provider, fields: pendingConsent.fields })
    if (!active.current || request !== captureRequest.current) return
    const recipeId = pendingConsent.recipeId as 'whatsapp.unread_intelligence' | 'linkedin.opportunity_scan'
    setPendingConsent(null)
    await runRecipe(recipeId)
  }

  return <div className="flex h-full flex-col overflow-hidden text-stone-800">
    <header className="border-b border-stone-200 bg-white/90 px-6 py-4">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-100 p-2 text-violet-700"><Radar size={22} /></div><div><h1 className="text-xl font-bold">Intelligence</h1><p className="text-xs text-stone-500">Evidence-led signals across connected sources</p></div><div className="ml-auto"><ScopePicker scopes={scopes} value={scope?.id ?? null} onChange={selectScope} disabled={scopeLoading} /></div></div>
      <nav className="mt-4 flex gap-2 overflow-x-auto pb-1">{INTELLIGENCE_TABS.map(item => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-violet-700 text-white' : 'bg-stone-100 text-stone-600'}`}>{item}</button>)}</nav>
    </header>
    <div className="flex-1 overflow-y-auto p-6">
      {(scopeError || notice) && <p className={`mb-4 rounded-xl p-3 text-sm ${scopeError ? 'bg-red-50 text-red-700' : 'bg-violet-50 text-violet-700'}`}>{scopeError || notice}</p>}
      {pendingConsent && <section className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold text-amber-900">Private source consent required</h2><p className="mt-2 text-sm text-amber-800">Provider: {pendingConsent.provider} · Retention: {pendingConsent.retentionDays} days · Scope: {pendingConsent.destinationScopeId}</p><p className="mt-1 text-xs text-amber-700">Fields: {pendingConsent.fields.join(', ')}</p><button onClick={() => void grantAndRun()} className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Grant consent & run once</button></section>}
      {(tab === 'Overview' || tab === 'Sources') && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{INTELLIGENCE_SOURCES.map(source => <section key={source.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><Radio size={18} className={source.status === 'available' ? 'text-emerald-600' : 'text-stone-400'} /><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${source.status === 'available' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{source.status === 'available' ? 'Available' : 'Not connected'}</span></div><h2 className="mt-4 font-semibold">{source.title}</h2><p className="mt-1 text-xs text-stone-500">{source.detail}</p>{source.id === 'whatsapp' && <button onClick={() => void runRecipe('whatsapp.unread_intelligence')} className="mt-3 rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Scan unread</button>}{source.id === 'linkedin' && <button onClick={() => void runRecipe('linkedin.opportunity_scan')} className="mt-3 rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Scan opportunities</button>}{source.id === 'reddit' && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Live capture excluded; fake data show nahi hogi.</p>}</section>)}</div>}
      {tab === 'Monitors' && <section className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2 font-semibold"><Activity size={18} /> Actionable-only monitors</div><p className="mt-2 text-sm text-stone-500">Monitors sirf meaningful result par Agent continuation queue karenge. FlowDesk band ho to koi background service nahi chalegi.</p></section>}
      {!['Overview', 'Sources', 'Monitors'].includes(tab) && <section className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2 font-semibold"><LockKeyhole size={18} /> {tab}</div><p className="mt-2 text-sm text-stone-500">Private source processing per-recipe consent ke baad chalegi. Insights citations, freshness aur confidence ke saath yahan appear honge.</p></section>}
    </div>
  </div>
}
