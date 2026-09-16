import { layoutNeighborhood } from '@/lib/neighborhoodLayout'
import type { DocumentNeighborhood } from '@/types/brainKnowledge'

const NODE_FILL: Record<number, string> = { 0: '#f59e0b', 1: '#a8a29e', 2: '#d6d3d1' }

/**
 * A document's link neighbourhood, two hops at most.
 *
 * Deliberately local. A whole-vault graph is the thing every source warns about
 * — legible under ~50 notes, a hairball past 200 — and nobody reports using one
 * to find anything. Two hops around the document you are already reading is the
 * variant practitioners actually defend.
 */
export function NeighborhoodGraph({ neighborhood, onOpen }: {
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
