import { useCallback, useRef, useState } from 'react'
import { Terminal, Minus, Maximize2, PanelBottom } from 'lucide-react'
import StudioChat from '@/components/studio/StudioChat'
import { clampToViewport, type Point } from '@/lib/windowPosition'

export type AgentWindowMode = 'pill' | 'floating' | 'docked'

const SIZE = { width: 420, height: 360 }

export default function AgentWindow() {
  const [mode, setMode] = useState<AgentWindowMode>('pill')
  const [pos, setPos] = useState<Point>({ x: 120, y: 120 })
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    setPos(clampToViewport(
      { x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy },
      SIZE,
      { width: window.innerWidth, height: window.innerHeight },
    ))
  }, [])

  const onPointerUp = useCallback(() => { drag.current = null }, [])

  if (mode === 'pill') {
    return (
      <button
        onClick={() => setMode('floating')}
        className="fixed bottom-4 right-4 z-[var(--z-overlay)] flex items-center gap-2 h-9 px-3
                   rounded-full bg-surface border border-border shadow-md
                   text-xs text-t2 hover:text-tx transition-colors"
      >
        <Terminal size={13} className="text-accent" />
        Agent
      </button>
    )
  }

  const docked = mode === 'docked'

  return (
    <div
      style={docked ? undefined : { left: pos.x, top: pos.y, width: SIZE.width, height: SIZE.height }}
      className={docked
        ? 'shrink-0 h-64 border-t border-border bg-surface flex flex-col'
        : 'fixed z-[var(--z-overlay)] rounded-md border border-border bg-surface shadow-lg flex flex-col overflow-hidden'}
    >
      <div
        onPointerDown={docked ? undefined : onPointerDown}
        onPointerMove={docked ? undefined : onPointerMove}
        onPointerUp={docked ? undefined : onPointerUp}
        className={`h-8 shrink-0 flex items-center gap-2 px-3 border-b border-border-soft
                    ${docked ? '' : 'cursor-grab active:cursor-grabbing'}`}
      >
        <Terminal size={12} className="text-accent" />
        <span className="text-[11px] font-mono text-t3 flex-1 truncate">agent</span>
        <button onClick={() => setMode(docked ? 'floating' : 'docked')} aria-label={docked ? 'Float' : 'Dock to bottom'}
                className="w-5 h-5 rounded-xs flex items-center justify-center text-t3 hover:text-tx hover:bg-s2">
          {docked ? <Maximize2 size={11} /> : <PanelBottom size={11} />}
        </button>
        <button onClick={() => setMode('pill')} aria-label="Collapse"
                className="w-5 h-5 rounded-xs flex items-center justify-center text-t3 hover:text-tx hover:bg-s2">
          <Minus size={11} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <StudioChat isActive />
      </div>
    </div>
  )
}
