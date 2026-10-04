import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrainCircuit, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { ScopePicker, useBrainScope } from '@/components/brain/ScopePicker'
import { ActivityPulse } from '@/components/brain/atlas/ActivityPulse'
import { CommandBar } from '@/components/brain/atlas/CommandBar'
import { DetailDrawer } from '@/components/brain/atlas/DetailDrawer'
import { StatusStrip, type AtlasPanel } from '@/components/brain/atlas/StatusStrip'
import { Health } from '@/components/brain/atlas/panels/Health'
import { Review } from '@/components/brain/atlas/panels/Review'
import { Timeline } from '@/components/brain/atlas/panels/Timeline'
import { overlayPaths, type AtlasOverlay } from '@/lib/atlasOverlays'
import { searchAtlas } from '@/lib/atlasSearch'
import { OBSERVATORY } from '@/lib/atlasTheme'
import { EMPTY_SELECTION, popSelection, pushSelection, type Selection } from '@/lib/brainSelection'
import type { BrainCandidate, BrainScope, BrainStatus } from '@/types/brain'
import type {
  AnswerPack, BrainEntity, BrainEvent, CompactionReport, DocumentNeighborhood, DocumentReadResult,
  KnowledgeCandidate, KnowledgeGraph, ManifestRender, UnresolvedLink, VaultImportReport, VectorIndexReport,
} from '@/types/brainKnowledge'

const api = window.electronAPI

/** Where the last visit's moment is kept, for the "new" overlay. */
const LAST_VISIT_KEY = 'brain.lastVisit'

/** A week, because a day is too short to show what the agent has been reading. */
function weekBounds(): { from: string; to: string } {
  const now = new Date()
  return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() }
}

function useIsNarrowScreen(breakpoint = 1280) {
  const [isNarrow, setIsNarrow] = useState(() => (
    typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth < breakpoint : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setIsNarrow(window.innerWidth < breakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])

  return isNarrow
}

/**
 * Sigma and graphology are megabytes of WebGL renderer and every other surface
 * here is text, so the canvas loads when it is needed. jsdom has no WebGL2
 * context either, which is what lets the shell be tested at all.
 */
const AtlasCanvas = lazy(() => import('@/components/brain/atlas/AtlasCanvas').then(module => ({ default: module.AtlasCanvas })))

export default function Brain() {
  const scopeState = useBrainScope()
  const [panel, setPanel] = useState<AtlasPanel | null>(null)
  const [lastVisit, setLastVisit] = useState<string | null>(null)

  // Read once on the way in and written on the way out, so the "new" overlay
  // means "since you last looked" rather than "since this render". This lives
  // above the remount below on purpose: the cleanup fires on every unmount, so
  // from inside `BrainScopeView` a single scope switch would write `now()` and
  // then read it straight back, leaving the overlay nothing to compare against
  // for the rest of the session.
  useEffect(() => {
    void api.storeGet(LAST_VISIT_KEY).then(value => setLastVisit(typeof value === 'string' ? value : null))
    return () => { void api.storeSet(LAST_VISIT_KEY, new Date().toISOString()) }
  }, [])

  // Scope-owned state is discarded synchronously, including when the next load fails.
  // `panel` and `lastVisit` are the exceptions, same as `tab` was in the design this
  // replaces: which surface you're looking at, and when you last visited, are not scope
  // data, and switching scope should not silently close what you had open or forget it.
  return (
    <BrainScopeView
      key={scopeState.scope?.id ?? 'loading'}
      {...scopeState}
      panel={panel}
      setPanel={setPanel}
      lastVisit={lastVisit}
    />
  )
}

function BrainScopeView({ scopes, scope, selectScope, loading: scopeLoading, error: scopeError, panel, setPanel, lastVisit }: ReturnType<typeof useBrainScope> & {
  panel: AtlasPanel | null
  setPanel: (panel: AtlasPanel | null) => void
  lastVisit: string | null
}) {
  const [status, setStatus] = useState<BrainStatus | null>(null)
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [candidates, setCandidates] = useState<BrainCandidate[]>([])
  const [knowledgeCandidates, setKnowledgeCandidates] = useState<KnowledgeCandidate[]>([])
  const [unresolvedLinks, setUnresolvedLinks] = useState<UnresolvedLink[]>([])
  const [events, setEvents] = useState<BrainEvent[]>([])
  const [error, setError] = useState('')

  const [overlay, setOverlay] = useState<AtlasOverlay | null>(null)
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState(false)
  const [askPack, setAskPack] = useState<AnswerPack | null>(null)
  const [fitTo, setFitTo] = useState<Set<string> | null>(null)
  // A timeline chip highlights the document it names. That is a different thing
  // from framing it, which `fitTo` does — a chip click asks for both.
  const [chipHighlight, setChipHighlight] = useState<Set<string> | null>(null)

  const [stack, setStack] = useState(EMPTY_SELECTION)
  const [selectedDocument, setSelectedDocument] = useState<DocumentReadResult | null>(null)
  const [neighborhood, setNeighborhood] = useState<DocumentNeighborhood | null>(null)

  // Health panel state, carried across from the Brain.tsx this replaces
  // (git show HEAD~1:src/pages/Brain.tsx) rather than retyped -- each of
  // these carries a stale-response guard that is easy to lose on the way.
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
  const [entities, setEntities] = useState<BrainEntity[]>([])
  const [entityBackfilling, setEntityBackfilling] = useState(false)
  const [entityReport, setEntityReport] = useState<{ scanned: number; created: number; linked: number } | null>(null)

  const selectedScopeId = useRef<string | null>(null)
  selectedScopeId.current = scope?.id ?? null
  const readRequest = useRef(0)
  const askRequest = useRef(0)
  const manifestRequest = useRef(0)
  const importRequest = useRef(0)
  const compactRequest = useRef(0)
  const migrateRequest = useRef(0)

  const refresh = useCallback(async (activeScope: BrainScope) => {
    const [nextStatus, nextGraph, nextCandidates, nextKnowledgeCandidates, nextUnresolved, nextEvents, nextVectorStatus, nextEntities] = await Promise.all([
      api.brainGetStatus(),
      api.brainKnowledgeGraph({ scopeId: activeScope.id }).catch(() => null),
      api.brainListCandidates(activeScope.id),
      api.brainKnowledgeListCandidates({ scopeId: activeScope.id }),
      api.brainKnowledgeListUnresolvedLinks({ scopeId: activeScope.id }),
      api.brainListEvents({ scopeId: activeScope.id, ...weekBounds() }).catch(() => [] as BrainEvent[]),
      api.brainKnowledgeVectorStatus({ scopeId: activeScope.id }).catch(() => null),
      api.brainEntityList({ scopeId: activeScope.id }).catch(() => [] as BrainEntity[]),
    ])
    if (selectedScopeId.current !== activeScope.id) return
    setStatus(nextStatus)
    setGraph(nextGraph)
    setVectorStatus(nextVectorStatus)
    setEntities(nextEntities)
    setCandidates(nextCandidates)
    setKnowledgeCandidates(nextKnowledgeCandidates)
    setUnresolvedLinks(nextUnresolved)
    setEvents(nextEvents)
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
  const isNarrow = useIsNarrowScreen(1280)
  const isDrawerOpen = selection !== null
  const [panelExpandedOnNarrow, setPanelExpandedOnNarrow] = useState(false)

  useEffect(() => {
    if (selection === null) {
      setPanelExpandedOnNarrow(false)
    }
  }, [selection])

  const handlePanelChange = useCallback((nextPanel: AtlasPanel | null) => {
    if (nextPanel !== null && isNarrow && selection !== null) {
      setPanelExpandedOnNarrow(true)
    }
    setPanel(nextPanel)
  }, [isNarrow, selection, setPanel])

  // The spec gives `Esc` to both the drawer and the panels. The drawer owns its
  // own handler, so this one only fires when there is no drawer to close —
  // otherwise one key press would close two things.
  useEffect(() => {
    if (panel === null || selection !== null) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPanel(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, selection])

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

  const select = useCallback((next: Selection) => {
    if (next.kind === 'document') {
      // Clear first: otherwise the previous document lingers under the new
      // title for as long as the read takes.
      setSelectedDocument(null)
      setNeighborhood(null)
    }
    setStack(current => pushSelection(current, next))
  }, [])

  const openPath = useCallback((path: string) => select({ kind: 'document', path }), [select])

  const matches = useMemo(() => (graph ? searchAtlas(graph, query).matches : new Set<string>()), [graph, query])

  // The spec asks for zoom-to-fit on the matches while typing. Doing it per
  // keystroke moves the ground under the typist, so the query settles for a
  // beat first — and a query that matches nothing leaves the camera alone
  // rather than framing an empty box.
  useEffect(() => {
    if (query.trim() === '') return
    const settle = setTimeout(() => { if (matches.size > 0) setFitTo(new Set(matches)) }, 350)
    return () => clearTimeout(settle)
  }, [query, matches])
  // An overlay and a chip are two ways of asking for the same ring, and never
  // meaningfully at once: an active overlay wins, and a chip covers the rest.
  const highlighted = useMemo(() => (
    overlay && graph ? overlayPaths(overlay, { graph, since: lastVisit, events }) : chipHighlight
  ), [overlay, graph, lastVisit, events, chipHighlight])

  const activeNodes = useMemo(() => {
    const paths = new Set<string>()
    if (askPack) {
      for (const section of askPack.sections) paths.add(section.path)
    }
    for (const event of events) {
      if (event.action === 'agent.turn') {
        const read = event.metadata.documentsRead
        if (Array.isArray(read)) {
          for (const path of read) {
            if (typeof path === 'string') paths.add(path)
          }
        }
      }
    }
    return Array.from(paths)
  }, [askPack, events])

  async function ask(question: string) {
    if (!scope) return
    const request = ++askRequest.current
    setAsking(true)
    setError('')
    try {
      const pack = await api.brainKnowledgeAnswerPack({ scopeId: scope.id, question })
      if (selectedScopeId.current !== scope.id || request !== askRequest.current) return
      setAskPack(pack)
      setStack(current => pushSelection(current, { kind: 'answer', question: pack.question }))
      setFitTo(new Set(pack.sections.map(section => section.path)))
    } catch (reason) {
      if (askRequest.current === request) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (askRequest.current === request) setAsking(false)
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

  async function runEntityBackfill() {
    if (!scope) return
    setEntityBackfilling(true)
    try {
      const report = await api.brainEntityBackfill({ scopeId: scope.id })
      if (selectedScopeId.current === scope.id) setEntityReport(report)
      await refresh(scope)
    } finally {
      if (selectedScopeId.current === scope.id) setEntityBackfilling(false)
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

  async function createStub(targetPath: string) {
    if (!scope) return
    const path = targetPath.endsWith('.md') ? targetPath : `${targetPath}.md`
    const title = path.replace(/\.md$/, '').split('/').pop() ?? path
    try {
      await api.brainKnowledgeProposeCandidate({
        scopeId: scope.id, targetPath: path, type: 'note', title,
        summary: '', body: `# ${title}\n`, origin: 'explicit-user', sessionRef: 'brain:review',
      })
      await refresh(scope)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const reviewCount = candidates.length + knowledgeCandidates.length

  return (
    <div className="flex h-full flex-col overflow-hidden p-3" style={{ background: '#FAF7F0' }}>
      <header
        className="flex shrink-0 items-center gap-3 rounded-t-xl border-x-2 border-t-2 px-4 py-3"
        style={{ background: '#EBE5D5', borderColor: '#D6CFC0' }}
      >
        <div className="rounded-xl border-2 p-1.5" style={{ background: '#FEF3C7', borderColor: '#F59E0B', color: '#B45309' }}>
          <BrainCircuit size={18} />
        </div>
        <div>
          <h1 className="font-retro-sans text-base font-bold text-stone-800">FlowDesk Brain</h1>
          <p className="font-retro-mono text-[10px] text-stone-500">Local, persistent, cited knowledge</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ScopePicker scopes={scopes} value={scope?.id ?? null} onChange={selectScope} disabled={scopeLoading} />
          <span
            className="font-retro-mono rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={status?.ready
              ? { background: '#D1FAE5', color: '#047857' }
              : { background: '#FEE2E2', color: '#B91C1C' }}
          >
            {status?.ready ? 'Ready · FTS5' : 'Degraded'}
          </span>
        </div>
      </header>

      {(scopeError || error) && (
        <div className="font-retro-mono shrink-0 border-x-2 px-4 py-1.5 text-[11px]" style={{ background: '#FEE2E2', borderColor: '#D6CFC0', color: '#B91C1C' }}>
          {scopeError || error}
        </div>
      )}

      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl border-x-2 border-b-2"
        style={{ borderColor: '#D6CFC0', background: OBSERVATORY.canvas }}
      >
        <Suspense fallback={<div className="font-retro-mono flex h-full items-center justify-center text-xs" style={{ color: OBSERVATORY.dim }}>Atlas load ho raha hai…</div>}>
          <AtlasCanvas
            graph={graph}
            selectedPath={selection?.kind === 'document' ? selection.path : null}
            matches={query.trim() ? matches : null}
            highlighted={highlighted}
            fitTo={fitTo}
            onSelect={openPath}
          />
        </Suspense>

        <div className="pointer-events-none absolute inset-0 flex flex-col p-3">
          <div className="relative flex items-center justify-center">
            <div className="pointer-events-auto">
              <CommandBar
                graph={graph}
                query={query}
                onQueryChange={setQuery}
                onOpen={openPath}
                onAsk={question => void ask(question)}
                asking={asking}
              />
            </div>
            <div className="pointer-events-auto absolute right-0 top-0 hidden sm:block">
              <ActivityPulse
                events={events}
                asking={asking}
                activeNodes={activeNodes}
                onSelectNode={openPath}
              />
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 gap-3">
            {panel && (() => {
              const panelTitle = panel === 'timeline' ? 'Timeline' : panel === 'review' ? 'Review' : 'Health'
              const isAsideCollapsed = isNarrow && isDrawerOpen && !panelExpandedOnNarrow

              const panelBody = (
                <>
                  {panel === 'timeline' && (
                    <Timeline
                      events={events}
                      onSelect={select}
                      onHighlight={paths => { setChipHighlight(new Set(paths)); setFitTo(new Set(paths)) }}
                    />
                  )}
                  {panel === 'review' && (
                    <Review
                      candidates={candidates}
                      knowledgeCandidates={knowledgeCandidates}
                      unresolvedLinks={unresolvedLinks}
                      onReview={(id, decision) => void api.brainDecideCandidate({ id, decision })
                        .then(() => scope && refresh(scope))
                        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))}
                      onReviewKnowledge={(id, decision) => void api.brainKnowledgeDecideCandidate({ id, decision })
                        .then(() => scope && refresh(scope))
                        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))}
                      onCreateStub={path => void createStub(path)}
                      onSelect={select}
                    />
                  )}
                  {panel === 'health' && (
                    <Health
                      knowledgeVaultRoot={knowledgeVaultRoot}
                      knowledgeImporting={knowledgeImporting}
                      knowledgeImportReport={knowledgeImportReport}
                      knowledgeManifest={knowledgeManifest}
                      knowledgeCompacting={knowledgeCompacting}
                      knowledgeCompactReport={knowledgeCompactReport}
                      migrating={migrating}
                      migrateReport={migrateReport}
                      vectorStatus={vectorStatus}
                      vectorBuilding={vectorBuilding}
                      vectorReport={vectorReport}
                      chooseVaultFolder={() => void chooseVaultFolder()}
                      importVault={() => void importVault()}
                      loadManifest={() => void loadManifest()}
                      runCompaction={() => void runCompaction()}
                      runMigration={dryRun => void runMigration(dryRun)}
                      buildVectors={() => void buildVectors()}
                      entityCount={entities.length}
                      entityBackfilling={entityBackfilling}
                      entityReport={entityReport}
                      runEntityBackfill={() => void runEntityBackfill()}
                    />
                  )}
                </>
              )

              if (isAsideCollapsed) {
                return (
                  <aside
                    aria-label={panelTitle}
                    className="pointer-events-auto flex shrink-0 items-start"
                  >
                    <button
                      type="button"
                      aria-label={`Expand ${panelTitle}`}
                      onClick={() => setPanelExpandedOnNarrow(true)}
                      className="font-retro-mono flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs shadow-md transition hover:bg-white/10"
                      style={{
                        background: OBSERVATORY.raised,
                        borderColor: OBSERVATORY.border,
                        borderLeftColor: OBSERVATORY.accent,
                        borderLeftWidth: 2,
                        color: OBSERVATORY.text,
                      }}
                    >
                      <PanelLeftOpen size={14} style={{ color: OBSERVATORY.accent }} />
                      <span className="capitalize">{panel}</span>
                    </button>
                  </aside>
                )
              }

              if (isNarrow && isDrawerOpen && panelExpandedOnNarrow) {
                return (
                  <aside
                    aria-label={panelTitle}
                    className="pointer-events-auto absolute bottom-14 left-3 top-14 z-20 w-[380px] max-w-[calc(100vw-48px)] shrink-0 overflow-y-auto rounded-xl border p-4 shadow-2xl"
                    style={{
                      background: OBSERVATORY.raised,
                      borderColor: OBSERVATORY.border,
                      borderLeftColor: OBSERVATORY.accent,
                      borderLeftWidth: 2,
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between border-b pb-2" style={{ borderColor: OBSERVATORY.border }}>
                      <span className="font-retro-mono text-xs uppercase tracking-wider" style={{ color: OBSERVATORY.muted }}>{panelTitle}</span>
                      <button
                        type="button"
                        aria-label={`Collapse ${panelTitle}`}
                        onClick={() => setPanelExpandedOnNarrow(false)}
                        className="rounded p-1 transition hover:bg-white/10"
                        style={{ color: OBSERVATORY.muted }}
                      >
                        <PanelLeftClose size={14} />
                      </button>
                    </div>
                    {panelBody}
                  </aside>
                )
              }

              return (
                <aside
                  aria-label={panelTitle}
                  className="pointer-events-auto w-[380px] max-w-[calc(100vw-48px)] shrink-0 overflow-y-auto rounded-xl border p-4"
                  style={{
                    background: OBSERVATORY.raised,
                    borderColor: OBSERVATORY.border,
                    borderLeftColor: OBSERVATORY.accent,
                    borderLeftWidth: 2,
                  }}
                >
                  {panelBody}
                </aside>
              )
            })()}

            <div className="flex-1" />

            <div className="pointer-events-auto">
              <DetailDrawer
                stack={stack}
                onBack={() => setStack(popSelection)}
                onClear={() => setStack(EMPTY_SELECTION)}
                document={selectedDocument}
                neighborhood={neighborhood}
                events={events}
                pack={askPack}
                onSelect={select}
              />
            </div>
          </div>

          <div className="pointer-events-auto mt-3">
            <StatusStrip
              documents={graph?.nodes.length ?? 0}
              links={graph?.edges.length ?? 0}
              review={reviewCount}
              looseEnds={unresolvedLinks.length}
              panel={panel}
              onPanel={handlePanelChange}
              overlay={overlay}
              onOverlay={setOverlay}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
