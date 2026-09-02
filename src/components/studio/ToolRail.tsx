import { MousePointer2, Hand, Frame, Square } from 'lucide-react'

export type StudioTool = 'select' | 'pan' | 'frame' | 'rect'

const TOOLS: { id: StudioTool; icon: typeof Hand; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'pan', icon: Hand, label: 'Pan', key: 'H' },
  { id: 'frame', icon: Frame, label: 'Artboard', key: 'A' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
]

export default function ToolRail({ tool, onChange }: { tool: StudioTool; onChange: (t: StudioTool) => void }) {
  return (
    <div className="w-11 shrink-0 border-r border-border bg-surface flex flex-col items-center gap-1 py-3">
      {TOOLS.map(t => {
        const Icon = t.icon
        const active = tool === t.id
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            title={`${t.label} (${t.key})`}
            aria-pressed={active}
            className={`w-8 h-8 rounded-sm flex items-center justify-center transition-colors
                        ${active ? 'bg-accent-m text-accent ring-1 ring-accent-border' : 'text-t3 hover:text-t2 hover:bg-s2'}`}
          >
            <Icon size={15} />
          </button>
        )
      })}
    </div>
  )
}
