import { useEffect, useRef } from 'react'
import { RotateCcw, Trash2, Eraser } from 'lucide-react'
import { getTabLabel } from '@/types/browser'
import type { BrowserTab } from '@/types/browser'

interface Props {
  tab: BrowserTab
  x: number
  y: number
  onClose: () => void
  onReload: (tab: BrowserTab) => void
  onClearSession: (tab: BrowserTab) => void
  onRemove: (tab: BrowserTab) => void
}

export default function AccountContextMenu({
  tab, x, y, onClose, onReload, onClearSession, onRemove,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - 140)

  const items = [
    { icon: RotateCcw, label: 'Reload', onClick: () => { onReload(tab); onClose() }, danger: false },
    { icon: Eraser, label: 'Clear Session', onClick: () => { onClearSession(tab); onClose() }, danger: false },
    { icon: Trash2, label: 'Remove Account', onClick: () => { onRemove(tab); onClose() }, danger: true },
  ]

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 100,
        minWidth: '180px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
        padding: '4px',
        animation: 'fadeIn 0.1s ease',
      }}
    >
      <div style={{
        padding: '6px 10px 8px',
        fontSize: '10.5px',
        color: 'var(--text-3)',
        borderBottom: '1px solid var(--border)',
        marginBottom: '4px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {getTabLabel(tab)} - {tab.gmail.email}
      </div>

      {items.map(({ icon: Icon, label, onClick, danger }) => (
        <button
          key={label}
          onClick={onClick}
          style={{
            display: 'flex', alignItems: 'center', gap: '9px',
            width: '100%', textAlign: 'left',
            padding: '7px 10px', borderRadius: '6px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: danger ? 'var(--danger)' : 'var(--text-2)',
            fontSize: '12px',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background =
              danger ? 'var(--danger-muted)' : 'var(--surface-2)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </div>
  )
}
