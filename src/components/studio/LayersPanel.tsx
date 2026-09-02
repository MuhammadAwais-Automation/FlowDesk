import { Square, Layers } from 'lucide-react'
import type { NodeSummary } from '@/lib/studioNode'

interface Props {
  artboards: { id: string; name: string }[]
  activeArtboard: string | null
  onSelectArtboard: (id: string) => void
  tree: NodeSummary[]
  selected: string | null
  onSelectNode: (id: string) => void
}

export default function LayersPanel({ artboards, activeArtboard, onSelectArtboard, tree, selected, onSelectNode }: Props) {
  return (
    <div className="w-[240px] shrink-0 border-r border-border bg-surface flex flex-col overflow-hidden">
      <Group icon={<Square size={12} />} title="Artboards" />
      <ul className="px-1 pb-2">
        {artboards.map(a => (
          <li key={a.id}>
            <button
              onClick={() => onSelectArtboard(a.id)}
              className={`w-full text-left px-2 py-1 rounded-sm text-xs truncate transition-colors
                          ${activeArtboard === a.id ? 'bg-s2 text-tx' : 'text-t2 hover:bg-s2/60'}`}
            >
              {a.name}
            </button>
          </li>
        ))}
      </ul>

      <Group icon={<Layers size={12} />} title="Layers" />
      <ul className="px-1 pb-2 overflow-y-auto flex-1">
        {tree.map(n => (
          <li key={n.elementId}>
            <button
              onClick={() => onSelectNode(n.elementId)}
              style={{ paddingLeft: 8 + n.depth * 12 }}
              className={`w-full text-left pr-2 py-1 rounded-sm text-xs truncate transition-colors
                          ${selected === n.elementId ? 'bg-accent-m text-tx' : 'text-t2 hover:bg-s2/60'}`}
            >
              <span className="text-t3 mr-1.5 font-mono text-[10px]">{n.tag}</span>
              {n.label}
            </button>
          </li>
        ))}
        {tree.length === 0 && <li className="px-2 py-1 text-t3 text-xs">No layers yet.</li>}
      </ul>
    </div>
  )
}

function Group({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5 text-t3">
      {icon}
      <span className="text-[11px] font-medium uppercase tracking-wider">{title}</span>
    </div>
  )
}
