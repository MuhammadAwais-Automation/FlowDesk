import { useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import type { AgentSessionMeta } from '@/types/electron'

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface Props {
  sessions: AgentSessionMeta[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

export default function SessionList({ sessions, activeId, onSelect, onCreate, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(session: AgentSessionMeta) {
    setEditingId(session.id)
    setDraft(session.title)
  }

  function commitEdit() {
    if (editingId && draft.trim()) onRename(editingId, draft.trim())
    setEditingId(null)
  }

  return (
    <div className="w-[220px] flex-shrink-0 flex flex-col bg-[#FAF7F0] border-r border-[#D8D1C3]">
      <div className="p-3 flex items-center justify-between border-b border-[#D8D1C3] bg-[#EBE5D5]">
        <span className="font-retro-mono text-[11px] font-bold uppercase tracking-wider text-stone-800">
          Sessions
        </span>
        <button
          onClick={onCreate}
          title="New session"
          className="retro-btn flex items-center gap-1 px-2 py-1 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] font-retro-mono text-[11px] font-bold"
        >
          <Plus size={11} /> New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {sessions.length === 0 ? (
          <p className="font-retro-mono text-[11px] text-stone-500 p-3 text-center">
            No sessions yet
          </p>
        ) : (
          sessions.map(session => {
            const isActive = session.id === activeId
            return (
              <div
                key={session.id}
                onClick={() => editingId !== session.id && onSelect(session.id)}
                className={`group p-2.5 rounded-xl cursor-pointer transition-all ${
                  isActive
                    ? 'border-2 border-[#D97706] bg-[#FEF3C7]'
                    : 'border border-[#E2DBD0] bg-white hover:border-[#D97706]/40'
                }`}
              >
                {editingId === session.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 min-w-0 font-retro-sans text-[11px] font-bold bg-white border border-[#D97706] rounded px-1.5 py-0.5 outline-none"
                    />
                    <button onClick={commitEdit} title="Save"><Check size={12} className="text-[#059669]" /></button>
                    <button onClick={() => setEditingId(null)} title="Cancel"><X size={12} className="text-stone-400" /></button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <p className={`flex-1 min-w-0 truncate font-retro-sans text-[11px] font-bold ${
                        isActive ? 'text-[#92400E]' : 'text-stone-900'
                      }`}>
                        {session.title}
                      </p>
                      <button
                        onClick={e => { e.stopPropagation(); startEdit(session) }}
                        title="Rename"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil size={11} className="text-stone-400 hover:text-[#D97706]" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); onDelete(session.id) }}
                        title="Delete"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={11} className="text-stone-400 hover:text-[#DC2626]" />
                      </button>
                    </div>
                    <p className="font-retro-mono text-[10px] text-stone-500 mt-0.5">
                      {session.turnCount} turns · {relativeTime(session.updatedAt)}
                    </p>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
