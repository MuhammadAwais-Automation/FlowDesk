import { useMemo, useState } from 'react'
import { Maximize2, Minimize2, Radar } from 'lucide-react'
import { buildAtlasGraph } from '@/lib/atlasGraph'
import { OBSERVATORY, TYPE_COLOR } from '@/lib/atlasTheme'
import type { KnowledgeDocType, KnowledgeGraph } from '@/types/brainKnowledge'

export interface MiniMapNode {
  id?: string
  path?: string
  title?: string
  x: number
  y: number
  type?: KnowledgeDocType | string
  color?: string
  cluster?: string | number
  degree?: number
}

export interface MiniMapViewport {
  x: number
  y: number
  width: number
  height: number
}

export interface MiniMapProps {
  /** The whole-vault knowledge graph */
  graph?: KnowledgeGraph | null
  /** Optional pre-computed node coordinates */
  nodes?: MiniMapNode[]
  /** Active viewport in graph coordinates */
  viewport?: MiniMapViewport | null
  /** Viewport bounding box (alias for viewport) */
  viewportBox?: MiniMapViewport | null
  /** Currently selected document path to highlight */
  selectedPath?: string | null
  /** Click anywhere on mini-map to navigate camera */
  onNavigate?: (coords: { x: number; y: number }) => void
  /** Click a specific node dot */
  onSelectNode?: (path: string) => void
  /** Controlled collapse state */
  isCollapsed?: boolean
  /** Initial collapse state when uncontrolled */
  defaultCollapsed?: boolean
  /** Callback on collapse/expand */
  onToggleCollapse?: (collapsed: boolean) => void
  /** CSS class names for positioning or overrides */
  className?: string
  /** Test identifier */
  'data-testid'?: string
}

export const CLUSTER_COLORS = [
  '#38bdf8',
  '#a855f7',
  '#f43f5e',
  '#34d399',
  '#fbbf24',
  '#f97316',
  '#818cf8',
  '#e879f9',
  '#2dd4bf',
  '#ec4899',
]

export function getClusterColor(cluster: string | number): string {
  if (typeof cluster === 'number') {
    return CLUSTER_COLORS[Math.abs(cluster) % CLUSTER_COLORS.length]
  }
  let hash = 0
  for (let i = 0; i < cluster.length; i++) {
    hash = (hash << 5) - hash + cluster.charCodeAt(i)
    hash |= 0
  }
  return CLUSTER_COLORS[Math.abs(hash) % CLUSTER_COLORS.length]
}

export function MiniMap({
  graph,
  nodes,
  viewport,
  viewportBox,
  selectedPath,
  onNavigate,
  onSelectNode,
  isCollapsed,
  defaultCollapsed = false,
  onToggleCollapse,
  className = 'bottom-14 right-4',
  'data-testid': testId,
}: MiniMapProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isCurrentlyCollapsed = isCollapsed !== undefined ? isCollapsed : internalCollapsed

  const toggleCollapse = () => {
    const next = !isCurrentlyCollapsed
    setInternalCollapsed(next)
    onToggleCollapse?.(next)
  }

  const extractedNodes = useMemo<MiniMapNode[]>(() => {
    if (nodes && nodes.length > 0) return nodes
    if (!graph || !graph.nodes || graph.nodes.length === 0) return []

    // If graph nodes already carry coordinates
    const first = graph.nodes[0] as unknown as { x?: number; y?: number }
    if (typeof first.x === 'number' && typeof first.y === 'number') {
      return graph.nodes.map(n => {
        const anyNode = n as unknown as {
          x: number
          y: number
          cluster?: string | number
          color?: string
          id?: string
        }
        return {
          id: anyNode.id ?? n.path,
          path: n.path,
          title: n.title,
          type: n.type,
          x: anyNode.x,
          y: anyNode.y,
          color: anyNode.color ?? (n.type in TYPE_COLOR ? TYPE_COLOR[n.type] : undefined),
          cluster: anyNode.cluster,
          degree: n.degree,
        }
      })
    }

    // Otherwise layout graph
    try {
      const built = buildAtlasGraph(graph, { minDegree: 0, types: [] })
      return built.nodes().map(nodeId => {
        const attrs = built.getNodeAttributes(nodeId)
        return {
          path: nodeId,
          title: String(attrs.label ?? nodeId),
          type: attrs.docType as KnowledgeDocType,
          x: Number(attrs.x ?? 0),
          y: Number(attrs.y ?? 0),
          color: (attrs.color as string) ?? TYPE_COLOR[attrs.docType as KnowledgeDocType] ?? OBSERVATORY.nodeDim,
          degree: Number(attrs.degree ?? 0),
        }
      })
    } catch {
      return graph.nodes.map((n, index) => {
        const angle = (index / Math.max(1, graph.nodes.length)) * Math.PI * 2
        return {
          path: n.path,
          title: n.title,
          type: n.type,
          x: Math.cos(angle) * 100,
          y: Math.sin(angle) * 100,
          color: n.type in TYPE_COLOR ? TYPE_COLOR[n.type] : OBSERVATORY.nodeDim,
          degree: n.degree,
        }
      })
    }
  }, [nodes, graph])

  const activeViewport = viewport !== undefined ? viewport : viewportBox

  const bounds = useMemo(() => {
    if (extractedNodes.length === 0) {
      return { minX: -100, maxX: 100, minY: -100, maxY: 100 }
    }
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const n of extractedNodes) {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }

    if (activeViewport) {
      minX = Math.min(minX, activeViewport.x)
      maxX = Math.max(maxX, activeViewport.x + activeViewport.width)
      minY = Math.min(minY, activeViewport.y)
      maxY = Math.max(maxY, activeViewport.y + activeViewport.height)
    }

    const spanX = Math.max(maxX - minX, 20)
    const spanY = Math.max(maxY - minY, 20)
    const padX = spanX * 0.15
    const padY = spanY * 0.15

    return {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY,
    }
  }, [extractedNodes, activeViewport])

  const projectX = (x: number) => {
    const span = bounds.maxX - bounds.minX || 1
    return ((x - bounds.minX) / span) * 192
  }

  const projectY = (y: number) => {
    const span = bounds.maxY - bounds.minY || 1
    return ((y - bounds.minY) / span) * 128
  }

  const effectiveVp = useMemo(() => {
    if (activeViewport !== undefined) return activeViewport
    // Default active viewport centered if not explicitly null
    const spanX = bounds.maxX - bounds.minX
    const spanY = bounds.maxY - bounds.minY
    return {
      x: bounds.minX + spanX * 0.3,
      y: bounds.minY + spanY * 0.3,
      width: spanX * 0.4,
      height: spanY * 0.4,
    }
  }, [activeViewport, bounds])

  const vpRect = useMemo(() => {
    if (!effectiveVp) return null
    const x = projectX(effectiveVp.x)
    const y = projectY(effectiveVp.y)
    const spanX = bounds.maxX - bounds.minX || 1
    const spanY = bounds.maxY - bounds.minY || 1
    const w = (effectiveVp.width / spanX) * 192
    const h = (effectiveVp.height / spanY) * 128
    return {
      x: Math.max(0, Math.min(184, x)),
      y: Math.max(0, Math.min(122, y)),
      width: Math.max(12, Math.min(192, w)),
      height: Math.max(10, Math.min(128, h)),
    }
  }, [effectiveVp, bounds])

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect?.()
    let clickSvgX = 96
    let clickSvgY = 64
    if (rect && rect.width > 0 && rect.height > 0) {
      clickSvgX = ((e.clientX - rect.left) / rect.width) * 192
      clickSvgY = ((e.clientY - rect.top) / rect.height) * 128
    } else if (typeof (e.nativeEvent as unknown as { offsetX?: number })?.offsetX === 'number') {
      clickSvgX = (e.nativeEvent as unknown as { offsetX: number }).offsetX
      clickSvgY = (e.nativeEvent as unknown as { offsetY: number }).offsetY
    } else if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      clickSvgX = e.clientX
      clickSvgY = e.clientY
    }

    const spanX = bounds.maxX - bounds.minX || 1
    const spanY = bounds.maxY - bounds.minY || 1
    const graphX = bounds.minX + (clickSvgX / 192) * spanX
    const graphY = bounds.minY + (clickSvgY / 128) * spanY

    onNavigate?.({ x: graphX, y: graphY })
  }

  if (isCurrentlyCollapsed) {
    return (
      <div className={`absolute z-20 ${className}`} data-testid={testId || 'minimap-collapsed'}>
        <button
          type="button"
          aria-label="Expand mini-map"
          title="Expand mini-map"
          onClick={toggleCollapse}
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-[#2a3142] bg-[#10141f]/90 px-2.5 py-1.5 font-retro-mono text-[11px] text-stone-300 shadow-xl backdrop-blur-sm transition-all hover:border-[#3b455b] hover:text-white"
          data-testid="minimap-expand-btn"
        >
          <Radar size={13} className="text-amber-500" />
          <span>Radar</span>
          <Maximize2 size={11} className="ml-0.5 text-stone-400" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={`pointer-events-auto absolute z-20 flex h-32 w-48 select-none flex-col overflow-hidden rounded-lg border border-[#2a3142] bg-[#10141f]/90 shadow-xl backdrop-blur-sm ${className}`}
      data-testid={testId || 'minimap-container'}
    >
      {/* Header bar overlay */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex h-6 items-center justify-between bg-gradient-to-b from-[#10141f]/90 to-transparent px-2 font-retro-mono text-[10px] text-stone-400">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="font-semibold tracking-wider text-stone-300">RADAR</span>
          <span className="text-[9px] text-stone-500">({extractedNodes.length})</span>
        </div>
        <button
          type="button"
          aria-label="Collapse mini-map"
          title="Collapse mini-map"
          onClick={toggleCollapse}
          className="pointer-events-auto rounded p-0.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-200"
          data-testid="minimap-collapse-btn"
        >
          <Minimize2 size={12} />
        </button>
      </div>

      {/* SVG Radar Body */}
      <svg
        viewBox="0 0 192 128"
        className="h-full w-full cursor-crosshair"
        onClick={handleSvgClick}
        data-testid="minimap-svg"
      >
        {/* Radar concentric rings */}
        <circle cx="96" cy="64" r="24" fill="none" stroke="#2a3142" strokeWidth="1" strokeDasharray="2 3" opacity="0.4" />
        <circle cx="96" cy="64" r="48" fill="none" stroke="#2a3142" strokeWidth="1" strokeDasharray="2 3" opacity="0.3" />
        <circle cx="96" cy="64" r="72" fill="none" stroke="#2a3142" strokeWidth="1" strokeDasharray="2 3" opacity="0.2" />

        {/* Crosshairs */}
        <line x1="96" y1="0" x2="96" y2="128" stroke="#2a3142" strokeWidth="1" opacity="0.25" />
        <line x1="0" y1="64" x2="192" y2="64" stroke="#2a3142" strokeWidth="1" opacity="0.25" />

        {/* Miniature node dots */}
        {extractedNodes.map((node, i) => {
          const isSelected = Boolean(selectedPath && (node.path === selectedPath || node.id === selectedPath))
          const svgX = projectX(node.x)
          const svgY = projectY(node.y)
          let color = node.color
          if (!color) {
            if (node.cluster !== undefined) {
              color = getClusterColor(node.cluster)
            } else if (node.type && node.type in TYPE_COLOR) {
              color = TYPE_COLOR[node.type as KnowledgeDocType]
            } else {
              color = OBSERVATORY.nodeDim
            }
          }

          return (
            <circle
              key={node.path || node.id || i}
              cx={svgX}
              cy={svgY}
              r={isSelected ? 3.5 : 2}
              fill={isSelected ? OBSERVATORY.accent : color}
              stroke={isSelected ? '#ffffff' : 'none'}
              strokeWidth={isSelected ? 1 : 0}
              opacity={isSelected ? 1 : 0.85}
              className="cursor-pointer transition-transform hover:scale-150"
              data-testid="minimap-node-dot"
              data-path={node.path}
              data-type={node.type}
              data-cluster={node.cluster}
              onClick={(e) => {
                e.stopPropagation()
                if (node.path && onSelectNode) {
                  onSelectNode(node.path)
                }
                onNavigate?.({ x: node.x, y: node.y })
              }}
            >
              <title>{node.title || node.path || `Node (${node.x}, ${node.y})`}</title>
            </circle>
          )
        })}

        {/* Active viewport indicator box */}
        {vpRect && (
          <rect
            x={vpRect.x}
            y={vpRect.y}
            width={vpRect.width}
            height={vpRect.height}
            fill="rgba(217, 119, 6, 0.12)"
            stroke="#f59e0b"
            strokeWidth="1.2"
            strokeDasharray="3 2"
            rx="2"
            data-testid="minimap-viewport"
            className="pointer-events-none transition-all duration-75"
          />
        )}
      </svg>
    </div>
  )
}
