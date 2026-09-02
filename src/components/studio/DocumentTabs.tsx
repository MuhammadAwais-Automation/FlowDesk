import { X, Plus, FileText } from 'lucide-react'
import type { StudioDocumentMeta } from '@/types/electron'

interface Props {
  documents: StudioDocumentMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export default function DocumentTabs({ documents, activeId, onSelect, onClose, onNew }: Props) {
  return (
    <div className="h-10 shrink-0 flex items-center gap-0.5 px-2 border-b border-border bg-surface overflow-x-auto">
      {documents.map(d => {
        const active = d.id === activeId
        return (
          <div
            key={d.id}
            className={`group flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-sm text-xs cursor-pointer shrink-0 transition-colors
                        ${active ? 'bg-s2 text-tx' : 'text-t3 hover:text-t2 hover:bg-s2/50'}`}
            onClick={() => onSelect(d.id)}
          >
            <FileText size={12} className={active ? 'text-accent' : ''} />
            <span className="max-w-[140px] truncate">{d.title}</span>
            <button
              onClick={e => { e.stopPropagation(); onClose(d.id) }}
              aria-label={`Close ${d.title}`}
              className="w-4 h-4 rounded-xs flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-s3 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        )
      })}
      <button
        onClick={onNew}
        aria-label="New document"
        className="w-7 h-7 shrink-0 rounded-sm flex items-center justify-center text-t3 hover:text-tx hover:bg-s2 transition-colors"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
