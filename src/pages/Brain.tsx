import { useCallback, useEffect, useRef, useState } from 'react'
import { Ban, BrainCircuit, Check, Database, FileText, GitBranch, RotateCcw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { BRAIN_TABS } from '@/lib/brainUi'
import type { BrainCandidate, BrainContextPack, BrainJob, BrainMemory, BrainScope, BrainStatus, MemoryKind } from '@/types/brain'

const api = window.electronAPI

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">{children}</section>
}

export default function Brain() {
  const [tab, setTab] = useState<(typeof BRAIN_TABS)[number]>('Overview')
  const scopeState = useBrainScope()
  // Scope-owned state is discarded synchronously, including when the next load fails.
  return <BrainScopeView key={scopeState.scope?.id ?? 'loading'} {...scopeState} tab={tab} setTab={setTab} />
}

function BrainScopeView({ scopes, scope, selectScope, loading: scopeLoading, error: scopeError, tab, setTab }: ReturnType<typeof useBrainScope> & {
  tab: (typeof BRAIN_TABS)[number]
  setTab: (tab: (typeof BRAIN_TABS)[number]) => void
}) {
  const [status, setStatus] = useState<BrainStatus | null>(null)
  const [overview, setOverview] = useState({ memories: 0, candidates: 0, jobs: 0, activeJobs: 0 })
  const [memories, setMemories] = useState<BrainMemory[]>([])
  const [candidates, setCandidates] = useState<BrainCandidate[]>([])
  const [jobs, setJobs] = useState<BrainJob[]>([])
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<BrainContextPack | null>(null)
  const [memoryText, setMemoryText] = useState('')
  const [memoryKind, setMemoryKind] = useState<MemoryKind>('note')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [vault, setVault] = useState<{ root: string; watching: boolean; conflicts: number } | null>(null)
  const [vaultConflicts, setVaultConflicts] = useState<Array<Record<string, unknown>>>([])
  const [graph, setGraph] = useState<{ nodes: Array<{ id: string; type: string; name: string }>; edges: Array<{ id: string; from: string; to: string; relation: string; confidence: number; sourceRef: string }> }>({ nodes: [], edges: [] })
  const [artifact, setArtifact] = useState<Record<string, unknown> | null>(null)
  const selectedScopeId = useRef<string | null>(null)
  selectedScopeId.current = scope?.id ?? null
  const searchRequest = useRef(0)
  const artifactRequest = useRef(0)
  const vaultRequest = useRef(0)

  const refresh = useCallback(async (activeScope: BrainScope) => {
    const [nextStatus, nextOverview, nextMemories, nextCandidates, nextJobs] = await Promise.all([
      api.brainGetStatus(), api.brainGetOverview(activeScope.id), api.brainListMemories(activeScope.id),
      api.brainListCandidates(activeScope.id), api.brainListJobs(),
    ])
    if (selectedScopeId.current !== activeScope.id) return
    setStatus(nextStatus)
    setOverview(nextOverview)
    setMemories(nextMemories)
    setCandidates(nextCandidates)
    setJobs(nextJobs.filter(job => job.scopeId === activeScope.id))
  }, [])

  useEffect(() => {
    if (!scope) return
    selectedScopeId.current = scope.id
    const reload = () => void refresh(scope).catch(reason => {
      if (selectedScopeId.current === scope.id) setError(reason instanceof Error ? reason.message : String(reason))
    })
    reload()
    const unsubscribe = api.onBrainEvent(reload)
    return () => {
      selectedScopeId.current = null
      unsubscribe()
    }
  }, [refresh, scope])

  useEffect(() => {
    if (!scope || tab !== 'Graph') return
    let active = true
    setGraph({ nodes: [], edges: [] })
    void api.brainGetGraph(scope.id).then(nextGraph => {
      if (active) setGraph(nextGraph)
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    return () => { active = false }
  }, [scope, tab])

  async function loadVault() {
    if (!scope || selectedScopeId.current !== scope.id) return
    const request = ++vaultRequest.current
    const [nextVault, conflicts] = await Promise.all([api.brainGetVaultStatus(), api.brainListVaultConflicts(scope.id)])
    if (selectedScopeId.current !== scope.id || request !== vaultRequest.current) return
    setVault(nextVault)
    setVaultConflicts(conflicts)
  }

  async function resolveVaultConflict(id: string, resolution: 'database' | 'file') {
    if (!scope || selectedScopeId.current !== scope.id) return
    await api.brainResolveVaultConflict({ id, scopeId: scope.id, resolution })
    await loadVault()
  }

  async function loadArtifact(jobId: string) {
    if (!scope || selectedScopeId.current !== scope.id) return
    const request = ++artifactRequest.current
    const nextArtifact = await api.brainGetArtifactManifest(jobId)
    if (selectedScopeId.current === scope.id && request === artifactRequest.current) setArtifact(nextArtifact)
  }

  async function askBrain() {
    if (!scope || !query.trim()) return
    const request = ++searchRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === searchRequest.current
    setBusy(true)
    setError('')
    try {
      const nextAnswer = await api.brainSearch({ text: query, scopeId: scope.id, includeParents: true, tokenBudget: 1200, limit: 12 })
      if (isCurrent()) setAnswer(nextAnswer)
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }

  async function saveMemory() {
    if (!scope || !memoryText.trim()) return
    setBusy(true)
    try {
      await api.brainRemember({ scopeId: scope.id, kind: memoryKind, text: memoryText.trim(), shareable: true })
      setMemoryText('')
      await refresh(scope)
    } finally {
      setBusy(false)
    }
  }

  async function review(id: string, decision: 'accept' | 'reject') {
    if (!scope) return
    await api.brainDecideCandidate({ id, decision })
    await refresh(scope)
  }

  const metricCards = [
    ['Accepted memories', overview.memories], ['Review inbox', overview.candidates],
    ['Durable jobs', overview.jobs], ['Active jobs', overview.activeJobs],
  ] as const

  return (
    <div className="flex h-full flex-col overflow-hidden text-stone-800">
      <header className="border-b border-stone-200 bg-white/90 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-100 p-2 text-amber-700"><BrainCircuit size={22} /></div>
          <div><h1 className="text-xl font-bold">FlowDesk Brain</h1><p className="text-xs text-stone-500">Local, persistent, cited knowledge</p></div>
          <div className="ml-auto flex items-center gap-3">
            <ScopePicker scopes={scopes} value={scope?.id ?? null} onChange={selectScope} disabled={scopeLoading} />
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status?.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {status?.ready ? 'Ready · FTS5' : 'Degraded'}
            </span>
          </div>
        </div>
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {BRAIN_TABS.map(item => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>{item}</button>)}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {(scopeError || error) && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{scopeError || error}</div>}

        {tab === 'Overview' && <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{metricCards.map(([label, value]) => <Card key={label}><p className="text-xs text-stone-500">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></Card>)}</div>
          <Card><div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} className="text-emerald-600" /> Memory policy active</div><p className="mt-2 text-sm text-stone-600">Explicit facts save directly. Inferences aur external content Review Inbox mein jata hai. Current scope: {scope?.name ?? 'Loading'}.</p></Card>
        </div>}

        {tab === 'Ask Brain' && <div className="mx-auto max-w-3xl space-y-4">
          <Card><label className="text-sm font-semibold">Ask with scoped retrieval</label><div className="mt-3 flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void askBrain()} placeholder="Client, decision ya research ke bare mein poochein…" className="min-w-0 flex-1 rounded-xl border border-stone-300 px-4 py-2 text-sm outline-none focus:border-amber-500" /><button onClick={() => void askBrain()} disabled={busy} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white"><Search size={16} /></button></div></Card>
          {answer && <Card><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Context pack · ~{answer.estimatedTokens} tokens</p><div className="mt-3 space-y-3">{answer.citations.length === 0 ? <p className="text-sm text-stone-500">Koi relevant accepted memory nahi mili.</p> : answer.citations.map(item => <div key={item.id} className="rounded-xl bg-stone-50 p-3"><p className="text-sm">{item.text}</p><p className="mt-1 text-xs text-amber-700">{item.kind} · {item.sourceRef}</p></div>)}</div></Card>}
        </div>}

        {tab === 'Memories' && <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <Card><h2 className="font-semibold">Remember something</h2><select value={memoryKind} onChange={event => setMemoryKind(event.target.value as MemoryKind)} className="mt-3 w-full rounded-lg border border-stone-300 p-2 text-sm">{['fact', 'preference', 'decision', 'goal', 'person', 'organization', 'opportunity', 'procedure', 'note'].map(kind => <option key={kind}>{kind}</option>)}</select><textarea value={memoryText} onChange={event => setMemoryText(event.target.value)} rows={6} className="mt-3 w-full rounded-lg border border-stone-300 p-3 text-sm" placeholder="Explicit memory…" /><button onClick={() => void saveMemory()} disabled={busy || !memoryText.trim()} className="mt-3 w-full rounded-lg bg-stone-900 py-2 text-sm font-semibold text-white">Save with Undo-safe history</button></Card>
          <div className="space-y-3">{memories.map(memory => <Card key={memory.id}><div className="flex gap-3"><Database size={17} className="mt-0.5 text-amber-600" /><div className="min-w-0 flex-1"><div className="flex gap-2 text-xs text-stone-500"><span>{memory.kind}</span><span>·</span><span>{memory.status}</span></div><p className="mt-1 text-sm">{memory.text}</p><p className="mt-2 truncate text-xs text-amber-700">{memory.sourceRef}</p></div><button title="Forget" onClick={async () => { await api.brainForget(memory.id); if (scope) await refresh(scope) }} className="text-stone-400 hover:text-red-600"><Trash2 size={16} /></button></div></Card>)}</div>
        </div>}

        {tab === 'Review Inbox' && <div className="space-y-3">{candidates.length === 0 ? <Card><p className="text-sm text-stone-500">Review Inbox empty hai.</p></Card> : candidates.map(candidate => <Card key={candidate.id}><div className="flex items-start gap-3"><div className="flex-1"><p className="text-xs text-stone-500">{candidate.origin} · {candidate.kind}</p><p className="mt-1 text-sm">{candidate.text}</p></div><button onClick={() => void review(candidate.id, 'accept')} className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Check size={16} /></button><button onClick={() => void review(candidate.id, 'reject')} className="rounded-lg bg-red-100 p-2 text-red-700"><X size={16} /></button></div></Card>)}</div>}

        {tab === 'Jobs' && <div className="space-y-3">{jobs.length === 0 ? <Card><p className="text-sm text-stone-500">Abhi koi durable job nahi.</p></Card> : jobs.map(job => <Card key={job.id}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{job.recipeId}</p><p className="truncate text-xs text-stone-500">{job.id}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-stone-100 px-3 py-1 text-xs">{job.status}</span><button title="Artifact manifest" onClick={() => void loadArtifact(job.id)} className="rounded-lg bg-blue-50 p-2 text-blue-700"><FileText size={15} /></button>{!['completed', 'failed', 'cancelled'].includes(job.status) && <button title="Cancel" onClick={async () => { await api.brainControlJob({ id: job.id, action: 'cancel' }); if (scope) await refresh(scope) }} className="rounded-lg bg-red-50 p-2 text-red-700"><Ban size={15} /></button>}{['failed', 'cancelled'].includes(job.status) && <button title="Retry" onClick={async () => { await api.brainControlJob({ id: job.id, action: 'retry' }); if (scope) await refresh(scope) }} className="rounded-lg bg-amber-50 p-2 text-amber-700"><RotateCcw size={15} /></button>}</div></div></Card>)}{artifact && <Card><div className="flex items-center justify-between"><h2 className="font-semibold">Artifact manifest</h2><button onClick={() => setArtifact(null)}><X size={16} /></button></div><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs text-stone-600">{JSON.stringify(artifact, null, 2)}</pre></Card>}</div>}

        {tab === 'Graph' && <div className="grid gap-4 xl:grid-cols-2"><Card><div className="flex items-center gap-2"><GitBranch size={17} /><h2 className="font-semibold">Curated nodes</h2></div><div className="mt-3 space-y-2">{graph.nodes.length === 0 ? <p className="text-sm text-stone-500">Abhi curated entities nahi hain.</p> : graph.nodes.map(node => <div key={node.id} className="rounded-lg bg-stone-50 p-3"><p className="text-sm font-medium">{node.name}</p><p className="text-xs text-stone-500">{node.type}</p></div>)}</div></Card><Card><h2 className="font-semibold">Evidence-backed edges</h2><div className="mt-3 space-y-2">{graph.edges.length === 0 ? <p className="text-sm text-stone-500">Abhi verified relations nahi hain.</p> : graph.edges.map(edge => <div key={edge.id} className="rounded-lg bg-stone-50 p-3 text-xs"><p>{edge.from} → {edge.relation} → {edge.to}</p><p className="mt-1 text-stone-500">Confidence {Math.round(edge.confidence * 100)}% · {edge.sourceRef}</p></div>)}</div></Card></div>}

        {tab === 'Vault' && <div className="space-y-4"><Card><h2 className="font-semibold">Obsidian-compatible Vault</h2><p className="mt-2 break-all text-sm text-stone-500">{vault?.root ?? 'Status load karein'}</p><div className="mt-4 flex gap-2"><button onClick={() => void loadVault()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Check status</button><button onClick={async () => { await api.brainSyncVault(); await loadVault() }} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white">Reconcile now</button></div>{vault && <p className="mt-3 text-xs text-stone-600">Watcher: {vault.watching ? 'on' : 'off'} · Conflicts: {vaultConflicts.length}</p>}</Card>{vaultConflicts.map(conflict => <Card key={String(conflict.id)}><p className="text-sm font-semibold">Vault conflict</p><p className="mt-1 break-all text-xs text-stone-500">{String(conflict.file_path)}</p><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-lg bg-blue-50 p-3 text-xs"><p className="mb-1 font-semibold">Brain version</p>{String(conflict.database_text)}</div><div className="rounded-lg bg-amber-50 p-3 text-xs"><p className="mb-1 font-semibold">File version</p>{String(conflict.file_text)}</div></div><div className="mt-3 flex gap-2"><button onClick={() => void resolveVaultConflict(String(conflict.id), 'database')} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Keep Brain</button><button onClick={() => void resolveVaultConflict(String(conflict.id), 'file')} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white">Keep file</button></div></Card>)}</div>}

        {tab === 'Settings' && <Card><h2 className="font-semibold">Backup & portability</h2><p className="mt-2 text-sm text-stone-500">Export mein consistent SQLite snapshot aur curated vault hota hai. Credentials, cookies aur raw artifacts include nahi hote.</p><div className="mt-4 flex gap-2"><button onClick={() => void api.brainExportBackup()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Export backup</button><button onClick={() => void api.brainImportBackup()} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">Import backup</button></div></Card>}

        {!['Overview', 'Ask Brain', 'Memories', 'Review Inbox', 'Graph', 'Jobs', 'Vault', 'Settings'].includes(tab) && <Card><h2 className="font-semibold">{tab}</h2><p className="mt-2 text-sm text-stone-500">Yeh view Brain ke same scoped knowledge ledger se driven hai. Data available hone par curated items yahan appear honge; raw social messages graph mein auto-load nahi honge.</p></Card>}
      </div>
    </div>
  )
}
