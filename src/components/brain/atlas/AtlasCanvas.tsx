import { useEffect, useMemo, useRef, useState } from 'react'
import Sigma from 'sigma'
import { AreaLabels } from './AreaLabels'
import { MiniMap } from './MiniMap'
import { BAND_RULES, bandForRatio, buildAtlasGraph, regionCentroids, type AtlasRegion, type ZoomBand } from '@/lib/atlasGraph'
import { fitBox } from '@/lib/atlasSearch'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { KnowledgeDocType, KnowledgeGraph } from '@/types/brainKnowledge'

/**
 * The map itself. No chrome — the command bar, status strip and drawer float
 * over it as siblings, so this component's only job is drawing and picking.
 *
 * The layout runs once, inside `buildAtlasGraph`. Everything after that —
 * zoom, hover, search, overlays — changes only what the reducers return, and
 * a repaint is `refresh()`. Re-laying out on a camera move is what makes a
 * graph feel heavy, and nothing here does it.
 */
export function AtlasCanvas({ graph, selectedPath, matches, highlighted, fitTo, onSelect }: {
  graph: KnowledgeGraph | null
  selectedPath: string | null
  /** Search hits. Non-empty means everything else is dimmed. */
  matches: Set<string> | null
  /** An overlay's paths, ringed rather than dimming their neighbours. */
  highlighted: Set<string> | null
  /** Paths the camera should frame, once, when this changes. */
  fitTo: Set<string> | null
  onSelect: (path: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const [band, setBand] = useState<ZoomBand>('mid')
  const [regions, setRegions] = useState<AtlasRegion[]>([])
  const [viewport, setViewport] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [, setProjectionTick] = useState(0)
  const paint = useRef({ band: 'mid' as ZoomBand, hovered: null as string | null, matches, highlighted, selectedPath })

  const built = useMemo(() => (graph ? buildAtlasGraph(graph, { minDegree: 0, types: [] }) : null), [graph])
  paint.current = { ...paint.current, matches, highlighted, selectedPath }

  useEffect(() => {
    if (!container.current || !built) return
    const instance = new Sigma(built, container.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: OBSERVATORY.edge,
      labelFont: 'JetBrains Mono, ui-monospace, monospace',
      labelSize: 11,
      labelWeight: '400',
      labelColor: { color: OBSERVATORY.text },
      labelDensity: 1.2,
      labelGridCellSize: 70,
      labelRenderedSizeThreshold: 0,
      nodeReducer: (path, data) => {
        const state = paint.current
        const rules = BAND_RULES[state.band]
        const degree = Number(data.degree ?? 0)
        if (degree < rules.minDegree && path !== state.selectedPath) return { ...data, hidden: true }

        const named = rules.labelMinDegree !== null && degree >= rules.labelMinDegree
        const dimmed = (state.matches !== null && state.matches.size > 0 && !state.matches.has(path))
          || (state.hovered !== null && state.hovered !== path && !built.areNeighbors(state.hovered, path))
        if (path === state.selectedPath) return { ...data, highlighted: true, zIndex: 3 }
        if (dimmed) return { ...data, color: OBSERVATORY.nodeDim, label: '', zIndex: 0 }
        // Sigma's default node program draws a disc with no border, so an
        // overlay marks a node by growing it and taking the accent colour
        // rather than by ringing it. `borderColor` is silently ignored.
        if (state.highlighted?.has(path)) {
          return { ...data, color: OBSERVATORY.accent, size: Number(data.size ?? 4) * 1.6, zIndex: 2 }
        }
        return { ...data, label: named ? data.label : '', zIndex: 1 }
      },
      edgeReducer: (edge, data) => {
        const state = paint.current
        const [from, to] = built.extremities(edge)
        const rules = BAND_RULES[state.band]
        if (Number(built.getNodeAttribute(from, 'degree') ?? 0) < rules.minDegree) return { ...data, hidden: true }
        if (Number(built.getNodeAttribute(to, 'degree') ?? 0) < rules.minDegree) return { ...data, hidden: true }
        const quiet = (state.matches !== null && state.matches.size > 0 && !state.matches.has(from) && !state.matches.has(to))
          || (state.hovered !== null && state.hovered !== from && state.hovered !== to)
        return quiet ? { ...data, color: OBSERVATORY.edgeDim } : data
      },
    })

    instance.on('clickNode', ({ node }) => onSelect(node))
    instance.on('enterNode', ({ node }) => { paint.current.hovered = node; instance.refresh() })
    instance.on('leaveNode', () => { paint.current.hovered = null; instance.refresh() })

    const camera = instance.getCamera()
    const onCamera = () => {
      const next = bandForRatio(camera.ratio)
      if (next !== paint.current.band) {
        paint.current.band = next
        setBand(next)
        instance.refresh()
      }
      // Region labels are positioned in screen space, so they move with every
      // pan as well as every zoom.
      setProjectionTick(tick => tick + 1)
      try {
        const dim = instance.getDimensions()
        if (dim.width > 0 && dim.height > 0) {
          const tl = instance.viewportToGraph({ x: 0, y: 0 })
          const br = instance.viewportToGraph({ x: dim.width, y: dim.height })
          setViewport({
            x: Math.min(tl.x, br.x),
            y: Math.min(tl.y, br.y),
            width: Math.abs(br.x - tl.x),
            height: Math.abs(br.y - tl.y),
          })
        }
      } catch {
        // Safe if container is unmeasured
      }
    }
    camera.on('updated', onCamera)

    setRegions(regionCentroids(built))
    sigmaRef.current = instance
    return () => {
      camera.removeListener('updated', onCamera)
      instance.kill()
      sigmaRef.current = null
    }
  }, [built, onSelect])

  useEffect(() => { sigmaRef.current?.refresh() }, [matches, highlighted, selectedPath])

  // Framing is a one-shot: the camera is the user's after this, and re-fitting
  // on every repaint would fight their panning.
  useEffect(() => {
    const instance = sigmaRef.current
    if (!instance || !built || !fitTo || fitTo.size === 0) return
    const box = fitBox([...fitTo]
      .filter(path => built.hasNode(path))
      .map(path => ({ x: Number(built.getNodeAttribute(path, 'x')), y: Number(built.getNodeAttribute(path, 'y')) })))
    if (!box) return
    // The camera's own `x`/`y` are in sigma's *framed* graph space — the
    // layout's centroid mapped to (0.5, 0.5) and its extent to a span of 1 —
    // not in the raw ForceAtlas2 coordinates the nodes carry. Feeding raw
    // coordinates straight in sends the camera hundreds of framed units into
    // blank canvas. `graphToViewport` then `viewportToFramedGraph` is that
    // normalisation and nothing else: the viewport hop cancels out, so the pair
    // is independent of where the camera currently sits.
    const toFramed = (point: { x: number; y: number }) =>
      instance.viewportToFramedGraph(instance.graphToViewport(point))
    const centre = toFramed({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
    // The ratio is a fraction of the framed extent, so the box's own framed
    // span is the basis — its raw span would be off by the layout's scale.
    // Clamped so a single match does not slam to maximum zoom.
    const near = toFramed({ x: box.x, y: box.y })
    const far = toFramed({ x: box.x + box.width, y: box.y + box.height })
    const span = Math.max(Math.abs(far.x - near.x), Math.abs(far.y - near.y))
    void instance.getCamera().animate({
      x: centre.x,
      y: centre.y,
      ratio: Math.min(1.2, Math.max(0.25, span)),
    }, { duration: 350 })
  }, [fitTo, built])

  const miniMapNodes = useMemo(() => {
    if (!built) return []
    return built.nodes().map(path => ({
      path,
      title: (built.getNodeAttribute(path, 'label') as string) || path,
      type: built.getNodeAttribute(path, 'docType') as KnowledgeDocType,
      x: Number(built.getNodeAttribute(path, 'x') ?? 0),
      y: Number(built.getNodeAttribute(path, 'y') ?? 0),
      color: built.getNodeAttribute(path, 'color') as string,
      degree: Number(built.getNodeAttribute(path, 'degree') ?? 0),
    }))
  }, [built])

  const handleMiniMapNavigate = (coords: { x: number; y: number }) => {
    const instance = sigmaRef.current
    if (!instance) return
    const toFramed = (point: { x: number; y: number }) =>
      instance.viewportToFramedGraph(instance.graphToViewport(point))
    const framed = toFramed(coords)
    void instance.getCamera().animate({
      x: framed.x,
      y: framed.y,
    }, { duration: 300 })
  }

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center font-retro-mono text-xs" style={{ background: OBSERVATORY.canvas, color: OBSERVATORY.dim }}>
        Atlas load ho raha hai…
      </div>
    )
  }

  return (
    <div className="relative h-full w-full" style={{ background: OBSERVATORY.canvas }}>
      <div ref={container} className="absolute inset-0" />
      {BAND_RULES[band].regionLabels && sigmaRef.current && (
        <AreaLabels regions={regions} project={(x, y) => sigmaRef.current!.graphToViewport({ x, y })} />
      )}
      {graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>
          Is scope mein koi document nahi.
        </div>
      )}
      {graph.nodes.length > 0 && (
        <MiniMap
          graph={graph}
          nodes={miniMapNodes}
          viewport={viewport}
          selectedPath={selectedPath}
          onNavigate={handleMiniMapNavigate}
          onSelectNode={onSelect}
          className="bottom-14 right-4"
        />
      )}
    </div>
  )
}
