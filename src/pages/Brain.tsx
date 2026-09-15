import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit, Check, Clock, FolderOpen, Link2, RotateCcw, Search, Sparkles, Upload, X } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { BRAIN_TABS } from '@/lib/brainUi'
import { layoutNeighborhood } from '@/lib/neighborhoodLayout'
import type { BrainCandidate, BrainScope, BrainStatus } from '@/types/brain'
import { KNOWLEDGE_DOC_TYPES } from '@/types/brainKnowledge'
import type {
  BrainEvent,
  CompactionReport,
  DocumentNeighborhood,
  DocumentReadResult,
  DocumentSearchHit,
  KnowledgeCandidate,
  KnowledgeDocType,
  KnowledgeDocument,
  ManifestRender,
  UnresolvedLink,
  VaultImportReport,
} from '@/types/brainKnowledge'

const api = window.electronAPI

/** Local-day bounds for the events query — the day the user is having, not UTC. */
function todayBounds(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

function eventTime(iso: string): string {
  const at = new Date(iso)
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`
}

function describeEvent(event: BrainEvent): string {
  const meta = event.metadata
  const text = (key: string) => typeof meta[key] === 'string' ? meta[key] as string : ''
  const count = (key: string) => typeof meta[key] === 'number' ? meta[key] as number : 0
  switch (event.action) {
    case 'agent.turn': {
      const prompt = text('prompt').replace(/\s+/g, ' ').trim()
      return prompt.length > 0 ? prompt : 'Agent turn'
    }
    case 'knowledge.accepted': return `Saved ${text('title') || text('path')} to the Library`
    case 'knowledge.imported': return `Imported ${count('imported')} documents from the vault`
    case 'knowledge.compacted': return `Folded ${count('merged')} captures into existing documents`
    case 'job.completed': return `${text('recipeId') || 'Job'} — ${text('status') || 'completed'}`
    case 'tool.action': return `${text('label') || 'Action'}${meta.failed === true ? ' — failed' : ''}`
  }
}

const NODE_FILL: Record<number, string> = { 0: '#f59e0b', 1: '#a8a29e', 2: '#d6d3d1' }

/**
 * A document's link neighbourhood, two hops at most.
 *
 * Deliberately local. A whole-vault graph is the thing every source warns about
 * — legible under ~50 notes, a hairball past 200 — and nobody reports using one
 * to find anything. Two hops around the document you are already reading is the
 * variant practitioners actually defend.
 */
function NeighborhoodGraph({ neighborhood, onOpen }: {
  neighborhood: DocumentNeighborhood
  onOpen: (path: string) => void
}) {
  const layout = layoutNeighborhood(neighborhood, 360)
  if (layout.nodes.length <= 1) {
    return <p className="text-sm text-stone-500">Is document ka koi link nahi — na andar, na bahar.</p>
  }
  return (
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="mx-auto block h-auto w-full max-w-sm">
      {layout.edges.map(edge => (
        <line key={`${edge.from}-${edge.to}`} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke="#d6d3d1" strokeWidth={1} />
      ))}
      {layout.nodes.map(node => (
        <g key={node.path} onClick={() => onOpen(node.path)} className="cursor-pointer">
          <title>{`${node.path} — ${node.depth} hop${node.depth === 1 ? '' : 's'}`}</title>
          <circle cx={node.x} cy={node.y} r={node.depth === 0 ? 9 : 6} fill={NODE_FILL[node.depth] ?? '#d6d3d1'} />
          <text x={node.x} y={node.y - 12} textAnchor="middle" className="fill-stone-600 text-[9px]">
            {node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title}
          </text>
        </g>
      ))}
    </svg>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">{children}</section>
}

export default function Brain() {
  const [tab, setTab] = useState<(typeof BRAIN_TABS)[number]>('Today')
  const scopeState = useBrainScope()
  // Scope-owned state is discarded synchronously, including when the next load fails.
  return <BrainScopeView key={scopeState.scope?.id ?? 'loading'} {...scopeState} tab={tab} setTab={setTab} />
}

function DocumentHit({ path, type, title, snippet, onOpen }: { path: string; type: string; title: string; snippet: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="block w-full rounded-lg bg-stone-50 p-3 text-left hover:bg-stone-100">
      <p className="text-xs text-stone-500">{type} · {path}</p>
      <p className="mt-1 text-sm font-medium">{title}</p>
      {snippet && <p className="mt-1 text-xs text-stone-600">{snippet}</p>}
    </button>
  )
}

function BrainScopeView({ scopes, scope, selectScope, loading: scopeLoading, error: scopeError, tab, setTab }: ReturnType<typeof useBrainScope> & {
  tab: (typeof BRAIN_TABS)[number]
  setTab: (tab: (typeof BRAIN_TABS)[number]) => void
}) {
  const [status, setStatus] = useState<BrainStatus | null>(null)
  const [candidates, setCandidates] = useState<BrainCandidate[]>([])
  const [knowledgeCandidates, setKnowledgeCandidates] = useState<KnowledgeCandidate[]>([])
  const [unresolvedLinks, setUnresolvedLinks] = useState<UnresolvedLink[]>([])
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeDocument[]>([])
  const [error, setError] = useState('')

  // Library
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<KnowledgeDocType | ''>('')
  const [libraryHits, setLibraryHits] = useState<DocumentSearchHit[] | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)

  // Ask — deliberately search-only (no passive browse list) so it reads as
  // "ask a question", not a second copy of Library.
  const [askQuery, setAskQuery] = useState('')
  const [askHits, setAskHits] = useState<DocumentSearchHit[] | null>(null)
  const [askBusy, setAskBusy] = useState(false)

  // Shared document reader — whichever tab opened it last owns it.
  const [selectedDocument, setSelectedDocument] = useState<DocumentReadResult | null>(null)
  const [neighborhood, setNeighborhood] = useState<DocumentNeighborhood | null>(null)

  // Health
  const [knowledgeVaultRoot, setKnowledgeVaultRoot] = useState<string | null>(null)
  const [knowledgeImportReport, setKnowledgeImportReport] = useState<VaultImportReport | null>(null)
  const [knowledgeImporting, setKnowledgeImporting] = useState(false)
  const [knowledgeManifest, setKnowledgeManifest] = useState<ManifestRender | null>(null)
  const [knowledgeCompactReport, setKnowledgeCompactReport] = useState<CompactionReport | null>(null)
  const [knowledgeCompacting, setKnowledgeCompacting] = useState(false)
  const [migrateReport, setMigrateReport] = useState<{ scanned: number; migrated: number; unchanged: number; dryRun: boolean } | null>(null)
  const [migrating, setMigrating] = useState(false)

  // Today — the activity timeline, and the daily note materialised from it.
  const [events, setEvents] = useState<BrainEvent[]>([])
  const [dailyNotePath, setDailyNotePath] = useState<string | null>(null)

  const selectedScopeId = useRef<string | null>(null)
  selectedScopeId.current = scope?.id ?? null
  const libraryRequest = useRef(0)
  const askRequest = useRef(0)
  const readRequest = useRef(0)
  const manifestRequest = useRef(0)
  const importRequest = useRef(0)
  const compactRequest = useRef(0)
  const migrateRequest = useRef(0)

  const refresh = useCallback(async (activeScope: BrainScope) => {
    // Materialise first, then list: the daily note is written from the same
    // events this refresh is about to show, so doing it in the other order
    // shows a note that is one refresh stale.
    const daily = await api.brainKnowledgeDailyNote({ scopeId: activeScope.id })
      .catch(() => ({ written: false, path: '' }))
    const [nextStatus, nextCandidates, nextKnowledgeCandidates, nextUnresolvedLinks, nextKnowledgeList, nextEvents] = await Promise.all([
      api.brainGetStatus(), api.brainListCandidates(activeScope.id),
      api.brainKnowledgeListCandidates({ scopeId: activeScope.id }),
      api.brainKnowledgeListUnresolvedLinks({ scopeId: activeScope.id }),
      api.brainKnowledgeList({ scopeId: activeScope.id, limit: 200 }),
      api.brainListEvents({ scopeId: activeScope.id, ...todayBounds() }).catch(() => [] as BrainEvent[]),
    ])
    if (selectedScopeId.current !== activeScope.id) return
    setStatus(nextStatus)
    setCandidates(nextCandidates)
    setKnowledgeCandidates(nextKnowledgeCandidates)
    setUnresolvedLinks(nextUnresolvedLinks)
    setKnowledgeList(nextKnowledgeList)
    setEvents(nextEvents)
    setDailyNotePath(daily.written ? daily.path : null)
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
    void api.brainGetVaultRoot().then(setKnowledgeVaultRoot)
  }, [])

  async function review(id: string, decision: 'accept' | 'reject') {
    if (!scope) return
    await api.brainDecideCandidate({ id, decision })
    await refresh(scope)
  }

  async function reviewKnowledge(id: string, decision: 'accept' | 'reject') {
    if (!scope) return
    await api.brainKnowledgeDecideCandidate({ id, decision })
    await refresh(scope)
  }

  async function readDocument(path: string) {
    if (!scope) return
    const request = ++readRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === readRequest.current
    const [document, links] = await Promise.all([
      api.brainKnowledgeRead({ scopeId: scope.id, path }),
      api.brainKnowledgeNeighbors({ scopeId: scope.id, path, depth: 2 }).catch(() => null),
    ])
    if (!isCurrent()) return
    setSelectedDocument(document)
    setNeighborhood(links)
  }

  async function searchLibrary() {
    if (!scope) return
    const request = ++libraryRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === libraryRequest.current
    setLibraryBusy(true)
    try {
      const types = libraryTypeFilter ? [libraryTypeFilter] : undefined
      if (libraryQuery.trim()) {
        const hits = await api.brainKnowledgeSearch({ scopeId: scope.id, query: libraryQuery.trim(), types, limit: 30 })
        if (isCurrent()) setLibraryHits(hits)
      } else if (isCurrent()) {
        setLibraryHits(null)
      }
    } finally {
      if (isCurrent()) setLibraryBusy(false)
    }
  }

  async function askBrain() {
    if (!scope || !askQuery.trim()) return
    const request = ++askRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === askRequest.current
    setAskBusy(true)
    setError('')
    try {
      const hits = await api.brainKnowledgeSearch({ scopeId: scope.id, query: askQuery.trim(), limit: 12 })
      if (isCurrent()) setAskHits(hits)
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isCurrent()) setAskBusy(false)
    }
  }

  async function chooseVaultFolder() {
    try {
      const chosen = await api.brainChooseVaultFolder()
      if (chosen) setKnowledgeVaultRoot(chosen)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function importVault() {
    if (!scope || !knowledgeVaultRoot || selectedScopeId.current !== scope.id) return
    const request = ++importRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === importRequest.current
    setKnowledgeImporting(true)
    try {
      const report = await api.brainKnowledgeImportVault({ scopeId: scope.id, vaultRoot: knowledgeVaultRoot })
      if (isCurrent()) setKnowledgeImportReport(report)
      await refresh(scope)
    } finally {
      if (isCurrent()) setKnowledgeImporting(false)
    }
  }

  async function loadManifest() {
    if (!scope) return
    const request = ++manifestRequest.current
    const manifest = await api.brainKnowledgeManifest({ scopeId: scope.id })
    if (selectedScopeId.current === scope.id && request === manifestRequest.current) setKnowledgeManifest(manifest)
  }

  async function runCompaction() {
    if (!scope || selectedScopeId.current !== scope.id) return
    const request = ++compactRequest.current
    const isCurrent = () => selectedScopeId.current === scope.id && request === compactRequest.current
    setKnowledgeCompacting(true)
    try {
      const report = await api.brainKnowledgeCompact({ scopeId: scope.id })
      if (isCurrent()) setKnowledgeCompactReport(report)
      await refresh(scope)
    } finally {
      if (isCurrent()) setKnowledgeCompacting(false)
    }
  }

  async function runMigration(dryRun: boolean) {
    const request = ++migrateRequest.current
    setMigrating(true)
    try {
      const report = await api.brainKnowledgeMigrateMemories({ dryRun })
      if (request === migrateRequest.current) setMigrateReport(report)
      if (!dryRun && scope) await refresh(scope)
    } finally {
      if (request === migrateRequest.current) setMigrating(false)
    }
  }

  const reviewCount = candidates.length + knowledgeCandidates.length
  const recentDocuments = [...knowledgeList].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10)

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
          {BRAIN_TABS.map(item => <button key={item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${tab === item ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}>{item}{item === 'Review' && reviewCount > 0 ? ` (${reviewCount})` : ''}</button>)}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {(scopeError || error) && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{scopeError || error}</div>}

        {tab === 'Today' && <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <Card><p className="text-xs text-stone-500">Documents</p><p className="mt-2 text-3xl font-bold">{knowledgeList.length}</p></Card>
            <Card><p className="text-xs text-stone-500">Review inbox</p><p className="mt-2 text-3xl font-bold">{reviewCount}</p></Card>
            <Card><p className="text-xs text-stone-500">Unresolved links</p><p className="mt-2 text-3xl font-bold">{unresolvedLinks.length}</p></Card>
          </div>
          {reviewCount > 0 && <Card>
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-semibold">{reviewCount} item{reviewCount === 1 ? '' : 's'} need{reviewCount === 1 ? 's' : ''} your review</p><p className="mt-1 text-xs text-stone-500">Explicit facts save directly; everything else waits here until you accept or reject it.</p></div>
              <button onClick={() => setTab('Review')} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white">Open Review</button>
            </div>
          </Card>}
          <Card>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><Clock size={17} /> Aaj</h2>
              {dailyNotePath && <button
                onClick={() => { void readDocument(dailyNotePath); setTab('Library') }}
                className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-200"
              >Open daily note</button>}
            </div>
            <div className="mt-3 space-y-2">
              {events.length === 0 && <p className="text-sm text-stone-500">Aaj abhi kuch nahi hua — Agent se baat karein ya vault import karein.</p>}
              {events.map(event => <div key={event.id} className="flex gap-3 rounded-lg bg-stone-50 p-3">
                <span className="shrink-0 font-mono text-xs text-stone-400">{eventTime(event.createdAt)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{describeEvent(event)}</p>
                  {event.action === 'agent.turn' && Array.isArray(event.metadata.documentsRead) && (event.metadata.documentsRead as string[]).length > 0 && <p className="mt-1 text-xs text-stone-500">
                    read {(event.metadata.documentsRead as string[]).join(', ')}
                  </p>}
                </div>
              </div>)}
            </div>
          </Card>
          <Card>
            <h2 className="flex items-center gap-2 font-semibold"><Clock size={17} /> Recently updated</h2>
            <div className="mt-3 space-y-2">
              {recentDocuments.length === 0 && <p className="text-sm text-stone-500">Abhi koi document nahi — Health tab se vault import karein.</p>}
              {recentDocuments.map(document => <DocumentHit key={document.id} path={document.path} type={document.type} title={document.title} snippet={document.summary} onOpen={() => { void readDocument(document.path); setTab('Library') }} />)}
            </div>
          </Card>
        </div>}

        {tab === 'Review' && <div className="space-y-3">
          {candidates.length === 0 && knowledgeCandidates.length === 0 && unresolvedLinks.length === 0 && <Card><p className="text-sm text-stone-500">Review Inbox empty hai.</p></Card>}
          {candidates.map(candidate => <Card key={candidate.id}><div className="flex items-start gap-3"><div className="flex-1"><p className="text-xs text-stone-500"><span className="mr-2 rounded-full bg-stone-100 px-2 py-0.5 font-semibold text-stone-600">Memory</span>{candidate.origin} · {candidate.kind}</p><p className="mt-1 text-sm">{candidate.text}</p></div><button onClick={() => void review(candidate.id, 'accept')} className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Check size={16} /></button><button onClick={() => void review(candidate.id, 'reject')} className="rounded-lg bg-red-100 p-2 text-red-700"><X size={16} /></button></div></Card>)}
          {knowledgeCandidates.map(candidate => <Card key={candidate.id}><div className="flex items-start gap-3"><div className="flex-1"><p className="text-xs text-stone-500"><span className="mr-2 rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">Knowledge</span>{candidate.origin} · {candidate.type}</p><p className="mt-1 text-sm font-medium">{candidate.title}</p><p className="mt-1 text-sm text-stone-600">{candidate.body}</p></div><button onClick={() => void reviewKnowledge(candidate.id, 'accept')} className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Check size={16} /></button><button onClick={() => void reviewKnowledge(candidate.id, 'reject')} className="rounded-lg bg-red-100 p-2 text-red-700"><X size={16} /></button></div></Card>)}
          {unresolvedLinks.length > 0 && <Card>
            <h2 className="flex items-center gap-2 font-semibold"><Link2 size={17} /> Unresolved links</h2>
            <p className="mt-1 text-xs text-stone-500">Ye documents ek doosre ko mention karte hain jo abhi exist nahi karta. Koi maintenance nahi chahiye — sirf jankari.</p>
            <div className="mt-3 space-y-2">
              {unresolvedLinks.map(link => <button key={`${link.documentPath}→${link.targetPath}`} onClick={() => void readDocument(link.documentPath)} className="block w-full rounded-lg bg-stone-50 p-3 text-left text-xs hover:bg-stone-100">
                <span className="font-medium">{link.documentTitle}</span> <span className="text-stone-400">({link.documentPath})</span> → <span className="text-amber-700">{link.targetPath}</span>
              </button>)}
            </div>
          </Card>}
        </div>}

        {tab === 'Library' && <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap gap-2">
              <input value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchLibrary()} placeholder="Search documents…" className="min-w-0 flex-1 rounded-xl border border-stone-300 px-4 py-2 text-sm outline-none focus:border-amber-500" />
              <select value={libraryTypeFilter} onChange={event => setLibraryTypeFilter(event.target.value as KnowledgeDocType | '')} className="rounded-xl border border-stone-300 px-3 py-2 text-sm">
                <option value="">All types</option>
                {KNOWLEDGE_DOC_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
              <button onClick={() => void searchLibrary()} disabled={libraryBusy} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white"><Search size={16} /></button>
            </div>
            <div className="mt-3 space-y-2">
              {(libraryHits ?? knowledgeList.filter(document => !libraryTypeFilter || document.type === libraryTypeFilter)).length === 0 && <p className="text-sm text-stone-500">{libraryBusy ? 'Load ho raha hai…' : 'Koi document nahi mila.'}</p>}
              {libraryHits?.map(hit => <DocumentHit key={hit.path} path={hit.path} type={hit.type} title={hit.title} snippet={hit.snippet} onOpen={() => void readDocument(hit.path)} />)}
              {!libraryHits && knowledgeList.filter(document => !libraryTypeFilter || document.type === libraryTypeFilter).map(document => <DocumentHit key={document.id} path={document.path} type={document.type} title={document.title} snippet={document.summary} onOpen={() => void readDocument(document.path)} />)}
            </div>
          </Card>
          {selectedDocument && <Card>
            <div className="flex items-center justify-between"><h2 className="font-semibold">{selectedDocument.title}</h2><button onClick={() => setSelectedDocument(null)}><X size={16} /></button></div>
            <p className="mt-1 text-xs text-stone-500">{selectedDocument.type} · {selectedDocument.path} · updated {selectedDocument.updatedAt}</p>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-stone-700">{selectedDocument.text}</pre>
          </Card>}
          {selectedDocument && neighborhood && <Card>
            <h2 className="flex items-center gap-2 font-semibold"><Link2 size={17} /> Connected documents</h2>
            <p className="mt-1 text-xs text-stone-500">Do hop tak. Kisi bhi circle par click karke wo document kholein.</p>
            <div className="mt-3"><NeighborhoodGraph neighborhood={neighborhood} onOpen={path => void readDocument(path)} /></div>
          </Card>}
        </div>}

        {tab === 'Ask' && <div className="mx-auto max-w-3xl space-y-4">
          <Card><label className="text-sm font-semibold">Ask the library</label><div className="mt-3 flex gap-2"><input value={askQuery} onChange={event => setAskQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void askBrain()} placeholder="Client, decision ya research ke bare mein poochein…" className="min-w-0 flex-1 rounded-xl border border-stone-300 px-4 py-2 text-sm outline-none focus:border-amber-500" /><button onClick={() => void askBrain()} disabled={askBusy} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white"><Search size={16} /></button></div></Card>
          {askHits && <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{askHits.length} cited passage{askHits.length === 1 ? '' : 's'}</p>
            <div className="mt-3 space-y-2">
              {askHits.length === 0 ? <p className="text-sm text-stone-500">Koi matching document nahi mila.</p> : askHits.map(hit => <DocumentHit key={hit.path} path={hit.path} type={hit.type} title={hit.title} snippet={hit.snippet} onOpen={() => void readDocument(hit.path)} />)}
            </div>
          </Card>}
          {selectedDocument && <Card>
            <div className="flex items-center justify-between"><h2 className="font-semibold">{selectedDocument.title}</h2><button onClick={() => setSelectedDocument(null)}><X size={16} /></button></div>
            <p className="mt-1 text-xs text-stone-500">{selectedDocument.type} · {selectedDocument.path} · updated {selectedDocument.updatedAt}</p>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-stone-700">{selectedDocument.text}</pre>
          </Card>}
        </div>}

        {tab === 'Health' && <div className="space-y-4">
          <Card>
            <h2 className="flex items-center gap-2 font-semibold"><FolderOpen size={17} /> Vault import</h2>
            <p className="mt-2 break-all text-sm text-stone-500">{knowledgeVaultRoot ?? 'Koi vault folder select nahi hua'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => void chooseVaultFolder()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Choose folder…</button>
              <button onClick={() => void importVault()} disabled={!knowledgeVaultRoot || knowledgeImporting} className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Upload size={14} /> {knowledgeImporting ? 'Importing…' : 'Import now'}</button>
            </div>
            {knowledgeImportReport && <p className="mt-3 text-xs text-stone-600">Scanned {knowledgeImportReport.scanned} · Imported {knowledgeImportReport.imported} · Updated {knowledgeImportReport.updated} · Unchanged {knowledgeImportReport.unchanged} · Skipped {knowledgeImportReport.skipped}{knowledgeImportReport.failures.length > 0 && ` · ${knowledgeImportReport.failures.length} failures`}</p>}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Manifest — agent ko yeh dikhta hai</h2>
              <button onClick={() => void loadManifest()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Load manifest</button>
            </div>
            {knowledgeManifest && <>
              <p className="mt-2 text-xs text-stone-500">{knowledgeManifest.entryCount} entries · ~{knowledgeManifest.estimatedTokens} tokens{knowledgeManifest.truncated ? ' · truncated' : ''}</p>
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-stone-600">{knowledgeManifest.text}</pre>
            </>}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={17} /> Compaction</h2>
              <button onClick={() => void runCompaction()} disabled={knowledgeCompacting} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{knowledgeCompacting ? 'Running…' : 'Run cleanup now'}</button>
            </div>
            {knowledgeCompactReport && <>
              <p className="mt-2 text-xs text-stone-500">Scanned {knowledgeCompactReport.scanned} · Merged {knowledgeCompactReport.merged} · Left standalone {knowledgeCompactReport.leftStandalone}</p>
              <div className="mt-3 space-y-2">
                {knowledgeCompactReport.decisions.map(decision => <div key={decision.capturePath} className="rounded-lg bg-stone-50 p-3 text-xs">
                  <p className="font-medium">{decision.capturePath}</p>
                  <p className="mt-1 text-stone-500">{decision.outcome === 'merged' ? `→ merged into ${decision.targetPath}` : 'left standalone'} · top {decision.topScore?.toFixed(6) ?? '—'} · second {decision.secondScore?.toFixed(6) ?? '—'}</p>
                </div>)}
              </div>
            </>}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><RotateCcw size={17} /> Old memories → Library</h2>
              <div className="flex gap-2">
                <button onClick={() => void runMigration(true)} disabled={migrating} className="rounded-lg bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50">Check (dry run)</button>
                <button onClick={() => void runMigration(false)} disabled={migrating} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{migrating ? 'Migrating…' : 'Migrate now'}</button>
              </div>
            </div>
            <p className="mt-2 text-xs text-stone-500">Purane "Remember something" se saved memories ko is Library mein copy karta hai. Idempotent — dubara chalana safe hai.</p>
            {migrateReport && <p className="mt-3 text-xs text-stone-600">Scanned {migrateReport.scanned} · Migrated {migrateReport.migrated} · Unchanged {migrateReport.unchanged}{migrateReport.dryRun ? ' · (dry run — kuch likha nahi gaya)' : ''}</p>}
          </Card>

          <Card>
            <h2 className="font-semibold">Backup & portability</h2>
            <p className="mt-2 text-sm text-stone-500">Export mein consistent SQLite snapshot hota hai. Credentials, cookies aur raw artifacts include nahi hote.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void api.brainExportBackup()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Export backup</button>
              <button onClick={() => void api.brainImportBackup()} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">Import backup</button>
            </div>
          </Card>
        </div>}
      </div>
    </div>
  )
}
