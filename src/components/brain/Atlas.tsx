import { useEffect, useMemo, useRef, useState } from 'react'
import Sigma from 'sigma'
import { Search } from 'lucide-react'
import { buildAtlasGraph, neighborhoodPaths } from '@/lib/atlasGraph'
import { OBSERVATORY, TYPE_COLOR } from '@/lib/atlasTheme'
import { KNOWLEDGE_DOC_TYPES, type KnowledgeDocType, type KnowledgeGraph } from '@/types/brainKnowledge'

/**
 * The store as a map: every document a point, every link a line.
 *
 * Opens local — two hops around one document — and never global by default.
 * A whole-vault graph is legible under about fifty notes and a hairball past a
 * couple of hundred; this store passed that a while ago, and the local view is
 * the variant people actually navigate with.
 */
export function Atlas({ graph, selectedPath, onSelect }: {
  graph: KnowledgeGraph | null
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const [scopeMode, setScopeMode] = useState<'local' | 'global'>('local')
  const [minDegree, setMinDegree] = useState(1)
  const [types, setTypes] = useState<KnowledgeDocType[]>([])
  const [query, setQuery] = useState('')
  const [hovered, setHovered] = useState<string | null>(null)

  const container = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  // Read inside sigma's reducers, which are called per frame and must not
  // re-run the whole layout just because a hover changed.
  const highlight = useRef<{ hovered: string | null; matches: Set<string> | null }>({ hovered: null, matches: null })

  const restrictTo = useMemo(() => {
    if (scopeMode === 'global' || !graph || !selectedPath) return undefined
    return neighborhoodPaths(graph, selectedPath, 2)
  }, [graph, scopeMode, selectedPath])

  const built = useMemo(() => {
    if (!graph) return null
    // The local view is already small, so a degree floor there would only hide
    // the leaves that make it worth looking at.
    return buildAtlasGraph(graph, { minDegree: restrictTo ? 0 : minDegree, types, restrictTo })
  }, [graph, minDegree, types, restrictTo])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle || !built) return null
    return new Set(built.nodes().filter(path => (
      String(built.getNodeAttribute(path, 'label')).toLowerCase().includes(needle) || path.toLowerCase().includes(needle)
    )))
  }, [query, built])

  highlight.current = { hovered, matches }

  useEffect(() => {
    if (!container.current || !built) return
    const instance = new Sigma(built, container.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: OBSERVATORY.edgeDim,
      labelFont: 'Inter, system-ui, sans-serif',
      labelSize: 11,
      labelColor: { color: '#57534e' },
      // Sigma picks which labels to draw from a grid, so raising the density
      // and shrinking the cell shows more of them without letting them pile up.
      labelDensity: 1.4,
      labelGridCellSize: 60,
      labelRenderedSizeThreshold: 4,
      nodeReducer: (path, data) => {
        const { hovered: over, matches: found } = highlight.current
        const dimmed = (found !== null && !found.has(path))
          || (over !== null && over !== path && !built.areNeighbors(over, path))
        if (path === selectedPath) return { ...data, highlighted: true, zIndex: 2 }
        return dimmed ? { ...data, color: OBSERVATORY.nodeDim, label: '', zIndex: 0 } : { ...data, zIndex: 1 }
      },
      edgeReducer: (edge, data) => {
        const { hovered: over, matches: found } = highlight.current
        const [from, to] = built.extremities(edge)
        const touchesHover = over === null || over === from || over === to
        const touchesMatch = found === null || found.has(from) || found.has(to)
        return touchesHover && touchesMatch ? data : { ...data, color: OBSERVATORY.edgeDim, hidden: found !== null }
      },
    })
    instance.on('clickNode', ({ node }) => onSelect(node))
    instance.on('enterNode', ({ node }) => setHovered(node))
    instance.on('leaveNode', () => setHovered(null))
    sigmaRef.current = instance
    return () => {
      instance.kill()
      sigmaRef.current = null
    }
  }, [built, onSelect, selectedPath])

  // A hover or a search changes only what the reducers return, so the graph is
  // repainted rather than rebuilt and relaid out.
  useEffect(() => { sigmaRef.current?.refresh() }, [hovered, matches, selectedPath])

  if (!graph) {
    return <div className="flex h-full items-center justify-center text-sm text-stone-500">Atlas load ho raha hai…</div>
  }

  const localUnavailable = scopeMode === 'local' && !selectedPath
  const shown = built?.order ?? 0

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
        <div className="flex overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
          {(['local', 'global'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setScopeMode(mode)}
              aria-pressed={scopeMode === mode}
              className={`px-3 py-1.5 capitalize transition ${scopeMode === mode ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'}`}
            >{mode}</button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-stone-300 px-2 py-1">
          <Search size={14} className="text-stone-400" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Graph mein dhoondein…"
            aria-label="Search the graph"
            className="w-44 bg-transparent text-xs outline-none"
          />
        </div>

        {scopeMode === 'global' && (
          <label className="flex items-center gap-2 text-xs text-stone-500">
            Kam se kam {minDegree} link
            <input
              type="range" min={0} max={8} value={minDegree}
              onChange={event => setMinDegree(Number(event.target.value))}
              aria-label="Minimum links"
              className="w-24"
            />
          </label>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-stone-500">
          <span>{shown} / {graph.nodes.length} documents · {graph.edges.length} links</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-stone-200 bg-stone-50 px-4 py-2">
        {KNOWLEDGE_DOC_TYPES.map(type => {
          const active = types.includes(type)
          return (
            <button
              key={type}
              onClick={() => setTypes(current => active ? current.filter(item => item !== type) : [...current, type])}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${
                active ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 hover:bg-stone-200'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[type] }} />
              {type}
            </button>
          )
        })}
        {types.length > 0 && (
          <button onClick={() => setTypes([])} className="px-2 py-1 text-xs text-stone-500 underline">clear</button>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-white">
        <div ref={container} className="absolute inset-0" />
        {localUnavailable && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 px-8 text-center text-sm text-stone-500">
            Local view ek document ke aas-paas dikhata hai. Library se koi document kholein, ya Global pe jayein.
          </div>
        )}
        {!localUnavailable && shown === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 text-sm text-stone-500">
            In filters pe koi document nahi.
          </div>
        )}
      </div>
    </div>
  )
}
