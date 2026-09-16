import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit, FolderOpen, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { Card } from '@/components/brain/Card'
import { DetailPane } from '@/components/brain/detail/DetailPane'
import { AskList } from '@/components/brain/lists/AskList'
import { LibraryList } from '@/components/brain/lists/LibraryList'
import { ReviewList } from '@/components/brain/lists/ReviewList'
import { TodayList } from '@/components/brain/lists/TodayList'
import { todayBounds } from '@/lib/brainFormat'
import { EMPTY_SELECTION, popSelection, pushSelection, type Selection } from '@/lib/brainSelection'
import { BRAIN_TABS } from '@/lib/brainUi'
import type { BrainCandidate, BrainScope, BrainStatus } from '@/types/brain'
import type {
  AnswerPack,
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
  VectorIndexReport,
  VaultImportReport,
} from '@/types/brainKnowledge'

const api = window.electronAPI

/** Maintenance, not reading — so it sits below a divider and takes the full width. */
const MAINTENANCE_TAB = 'Health'

export default function Brain() {
  const [tab, setTab] = useState<(typeof BRAIN_TABS)[number]>('Today')
  const scopeState = useBrainScope()
  // Scope-owned state is discarded synchronously, including when the next load fails.
  return <BrainScopeView key={scopeState.scope?.id ?? 'loading'} {...scopeState} tab={tab} setTab={setTab} />
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

  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<KnowledgeDocType | ''>('')
  const [libraryHits, setLibraryHits] = useState<DocumentSearchHit[] | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)

  const [askQuery, setAskQuery] = useState('')
  const [askPack, setAskPack] = useState<AnswerPack | null>(null)
  const [askBusy, setAskBusy] = useState(false)

  const [stack, setStack] = useState(EMPTY_SELECTION)
  const [selectedDocument, setSelectedDocument] = useState<DocumentReadResult | null>(null)
  const [neighborhood, setNeighborhood] = useState<DocumentNeighborhood | null>(null)

  const [knowledgeVaultRoot, setKnowledgeVaultRoot] = useState<string | null>(null)
  const [knowledgeImportReport, setKnowledgeImportReport] = useState<VaultImportReport | null>(null)
  const [knowledgeImporting, setKnowledgeImporting] = useState(false)
  const [knowledgeManifest, setKnowledgeManifest] = useState<ManifestRender | null>(null)
  const [knowledgeCompactReport, setKnowledgeCompactReport] = useState<CompactionReport | null>(null)
  const [knowledgeCompacting, setKnowledgeCompacting] = useState(false)
  const [migrateReport, setMigrateReport] = useState<{ scanned: number; migrated: number; unchanged: number; dryRun: boolean } | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [vectorStatus, setVectorStatus] = useState<{ documents: number; vectors: number; model: string; failed: boolean } | null>(null)
  const [vectorBuilding, setVectorBuilding] = useState(false)
  const [vectorReport, setVectorReport] = useState<VectorIndexReport | null>(null)

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
    const [nextStatus, nextCandidates, nextKnowledgeCandidates, nextUnresolvedLinks, nextKnowledgeList, nextEvents, nextVectorStatus] = await Promise.all([
      api.brainGetStatus(), api.brainListCandidates(activeScope.id),
      api.brainKnowledgeListCandidates({ scopeId: activeScope.id }),
      api.brainKnowledgeListUnresolvedLinks({ scopeId: activeScope.id }),
      api.brainKnowledgeList({ scopeId: activeScope.id, limit: 200 }),
      api.brainListEvents({ scopeId: activeScope.id, ...todayBounds() }).catch(() => [] as BrainEvent[]),
      api.brainKnowledgeVectorStatus({ scopeId: activeScope.id }).catch(() => null),
    ])
    if (selectedScopeId.current !== activeScope.id) return
    setStatus(nextStatus)
    setCandidates(nextCandidates)
    setKnowledgeCandidates(nextKnowledgeCandidates)
    setUnresolvedLinks(nextUnresolvedLinks)
    setKnowledgeList(nextKnowledgeList)
    setEvents(nextEvents)
    setDailyNotePath(daily.written ? daily.path : null)
    setVectorStatus(nextVectorStatus)
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

  const selection = stack.current

  // The pane follows the selection rather than the click, so every route into a
  // document -- a list row, a link circle, a cited passage -- loads it the same way.
  useEffect(() => {
    if (!scope || selection?.kind !== 'document') return
    const request = ++readRequest.current
    const path = selection.path
    void Promise.all([
      api.brainKnowledgeRead({ scopeId: scope.id, path }),
      api.brainKnowledgeNeighbors({ scopeId: scope.id, path, depth: 2 }).catch(() => null),
    ]).then(([document, links]) => {
      if (selectedScopeId.current !== scope.id || request !== readRequest.current) return
      setSelectedDocument(document)
      setNeighborhood(links)
    }).catch(reason => {
      if (selectedScopeId.current === scope.id) setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [scope, selection])

  function select(next: Selection) {
    if (next.kind === 'document') {
      // Clear first: otherwise the previous document lingers under the new
      // title for as long as the read takes.
      setSelectedDocument(null)
      setNeighborhood(null)
    }
    setStack(current => pushSelection(current, next))
  }

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
      if (isCurrent()) {
        setAskPack({
          question: askQuery.trim(),
          evidence: hits.length > 0 ? '' : 'No local knowledge matched this question.',
          sections: hits.map(hit => ({ path: hit.path, title: hit.title, headingPath: '', text: hit.snippet, score: hit.score })),
          pointerFollowed: null,
          strategy: 'ranked',
          estimatedTokens: 0,
          candidatesConsidered: hits.length,
        })
      }
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

  async function buildVectors() {
    if (!scope) return
    setVectorBuilding(true)
    try {
      const report = await api.brainKnowledgeBuildVectors({ scopeId: scope.id })
      if (selectedScopeId.current === scope.id) setVectorReport(report)
      await refresh(scope)
    } finally {
      if (selectedScopeId.current === scope.id) setVectorBuilding(false)
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
  const readingTabs = BRAIN_TABS.filter(item => item !== MAINTENANCE_TAB)

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
      </header>

      {(scopeError || error) && <div className="border-b border-red-100 bg-red-50 px-6 py-2 text-sm text-red-700">{scopeError || error}</div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav aria-label="Brain sections" className="flex w-44 shrink-0 flex-col gap-1 border-r border-stone-200 bg-stone-50 p-3">
          {readingTabs.map(item => <NavButton key={item} item={item} active={tab === item} count={item === 'Review' ? reviewCount : 0} onClick={() => setTab(item)} />)}
          <div className="my-2 border-t border-stone-200" />
          <NavButton item={MAINTENANCE_TAB} active={tab === MAINTENANCE_TAB} count={0} onClick={() => setTab(MAINTENANCE_TAB)} />
        </nav>

        {tab === MAINTENANCE_TAB ? (
          <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
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
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold"><Sparkles size={17} /> Meaning search</h2>
                <button
                  onClick={() => void buildVectors()}
                  disabled={vectorBuilding}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >{vectorBuilding ? 'Indexing…' : vectorStatus && vectorStatus.vectors > 0 ? 'Update index' : 'Build index'}</button>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Keyword search sirf wahi dhoondta hai jo lafz aap likhein. Meaning search matlab se dhoondta hai — "mera server kahan chal raha hai" us document tak le jata hai jismein "server" likha hi nahi.
                Pehli baar ~118MB model download hota hai, phir sab kuch offline chalta hai.
              </p>
              {vectorStatus && <p className="mt-3 text-xs text-stone-600">
                {vectorStatus.vectors} / {vectorStatus.documents} documents indexed
                {vectorStatus.vectors === 0 && ' — abhi sirf keyword search chal rahi hai'}
              </p>}
              {vectorReport && !vectorReport.available && <p className="mt-2 text-xs text-red-600">
                Model load nahi hua — Brain keyword search par chal raha hai, kuch toota nahi.
              </p>}
              {vectorReport?.available && <p className="mt-2 text-xs text-stone-600">Indexed {vectorReport.indexed} naye documents.</p>}
            </Card>

            <Card>
              <h2 className="font-semibold">Backup & portability</h2>
              <p className="mt-2 text-sm text-stone-500">Export mein consistent SQLite snapshot hota hai. Credentials, cookies aur raw artifacts include nahi hote.</p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => void api.brainExportBackup()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Export backup</button>
                <button onClick={() => void api.brainImportBackup()} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">Import backup</button>
              </div>
            </Card>
          </div>
        ) : (
          <>
            <section aria-label={tab} className="w-80 shrink-0 overflow-y-auto border-r border-stone-200 p-4">
              {tab === 'Today' && <TodayList
                events={events}
                recentDocuments={recentDocuments}
                dailyNotePath={dailyNotePath}
                selection={selection}
                onSelect={select}
              />}
              {tab === 'Review' && <ReviewList
                candidates={candidates}
                knowledgeCandidates={knowledgeCandidates}
                unresolvedLinks={unresolvedLinks}
                onReview={(id, decision) => void review(id, decision)}
                onReviewKnowledge={(id, decision) => void reviewKnowledge(id, decision)}
                onSelect={select}
              />}
              {tab === 'Library' && <LibraryList
                documents={knowledgeList}
                hits={libraryHits}
                query={libraryQuery}
                setQuery={setLibraryQuery}
                typeFilter={libraryTypeFilter}
                setTypeFilter={setLibraryTypeFilter}
                busy={libraryBusy}
                onSearch={() => void searchLibrary()}
                selection={selection}
                onSelect={select}
              />}
              {tab === 'Ask' && <AskList
                query={askQuery}
                setQuery={setAskQuery}
                busy={askBusy}
                onAsk={() => void askBrain()}
                pack={askPack}
                selection={selection}
                onSelect={select}
              />}
            </section>

            <DetailPane
              stack={stack}
              onBack={() => setStack(popSelection)}
              onClear={() => setStack(EMPTY_SELECTION)}
              counters={{ documents: knowledgeList.length, review: reviewCount, unresolvedLinks: unresolvedLinks.length }}
              document={selectedDocument}
              neighborhood={neighborhood}
              events={events}
              pack={askPack}
              onSelect={select}
            />
          </>
        )}
      </div>
    </div>
  )
}

function NavButton({ item, active, count, onClick }: { item: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-stone-900 font-semibold text-white' : 'text-stone-600 hover:bg-stone-200'}`}
    >
      {item}{count > 0 ? ` (${count})` : ''}
    </button>
  )
}
