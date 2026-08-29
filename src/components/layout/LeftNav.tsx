import { useRef, useEffect, useState, useCallback } from 'react'
import {
  Globe, Users,
  Settings, Zap, Youtube, Calendar,
  ChevronLeft, ChevronRight, MessagesSquare, Bot, BookOpen, Share2, Sparkles, Clapperboard,
} from 'lucide-react'
import type { Page } from '@/types/pages'

const MIN_WIDTH      = 120
const MAX_WIDTH      = 320   // Task 2: expanded from 280 → 320
const COLLAPSED_WIDTH = 48
const DEFAULT_WIDTH  = 172

interface NavItem {
  icon: React.ElementType
  page: Page
  label: string
}

const items: NavItem[] = [
  { icon: Sparkles,        page: 'jarvis',    label: 'Jarvis Voice' },
  { icon: Globe,           page: 'browser',   label: 'AI Browser' },
  { icon: MessagesSquare,  page: 'universalChat', label: 'Universal Chat' },
  { icon: Bot,             page: 'agent',     label: 'Agent'       },
  { icon: BookOpen,        page: 'notebooklm', label: 'NotebookLM' },
  { icon: Users,           page: 'accounts',  label: 'Accounts'   },
  { icon: Youtube,         page: 'youtube',   label: 'YT Studio'  },
  { icon: Calendar,        page: 'workspace', label: 'Workspace'  },
  { icon: Share2,          page: 'social',    label: 'Social'     },
  { icon: Clapperboard,    page: 'studio',    label: 'Studio'     },
]

interface Props {
  current: Page
  onChange: (page: Page) => void
  onWidthChange?: (w: number) => void
}

// ── NavButton ─────────────────────────────────────────────────────────────────

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
  collapsed,
  danger = false,
}: {
  icon: React.ElementType
  label: string
  active: boolean
  onClick: () => void
  collapsed: boolean
  danger?: boolean
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`group relative flex items-center w-full transition-all duration-200 select-none ${
        collapsed ? 'justify-center py-2 px-0' : 'justify-start gap-2.5 px-3 py-2'
      } ${
        active
          ? danger
            ? 'bg-[#FEE2E2] border-2 border-[#EF4444] text-[#DC2626] font-retro-mono font-bold text-xs rounded-xl shadow-[2px_2px_0px_0px_rgba(220,38,38,0.3)] -translate-y-0.5'
            : 'bg-[#FEF3C7] border-2 border-[#F59E0B] text-[#B45309] font-retro-mono font-bold text-xs rounded-xl shadow-[2px_2px_0px_0px_rgba(180,83,9,0.3)] -translate-y-0.5'
          : danger
          ? 'bg-transparent hover:bg-[#FEE2E2]/60 text-[#DC2626] font-retro-sans font-medium text-xs rounded-xl border border-transparent'
          : 'bg-transparent hover:bg-[#FAF7F0] text-stone-700 font-retro-sans font-medium text-xs rounded-xl border border-transparent hover:-translate-y-0.5'
      }`}
    >
      <Icon
        size={16}
        className={`shrink-0 transition-colors ${
          active
            ? danger ? 'text-[#DC2626]' : 'text-[#D97706]'
            : 'text-stone-500 group-hover:text-[#D97706]'
        }`}
      />
      {!collapsed && (
        <span className="flex-1 truncate text-left tracking-tight">
          {label}
        </span>
      )}
    </button>
  )
}

// ── LeftNav ───────────────────────────────────────────────────────────────────

export default function LeftNav({ current, onChange, onWidthChange }: Props) {
  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem('navWidth')
    return saved ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(saved))) : DEFAULT_WIDTH
  })
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('navCollapsed') === 'true'
  })

  // ── Refs for jank-free resize ─────────────────────────────────────────────
  const isResizing   = useRef(false)
  const startX       = useRef(0)
  const startW       = useRef(0)
  const liveWidth    = useRef(width)
  const rafId        = useRef(0)
  const navRef       = useRef<HTMLElement>(null)
  const handleRef    = useRef<HTMLDivElement>(null)

  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : width

  // ── Notify parent + Electron on committed width changes ────────────────────
  useEffect(() => {
    onWidthChange?.(effectiveWidth)
    window.electronAPI.viewSetNavWidth(effectiveWidth)
    window.dispatchEvent(new CustomEvent('nav-resize', { detail: { width: effectiveWidth } }))
  }, [effectiveWidth])

  // ── Resize drag ─────────────────────────────────────────────────────────────

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (collapsed) return

    isResizing.current = true
    startX.current     = e.clientX
    startW.current     = width
    liveWidth.current  = width

    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'

    if (navRef.current) navRef.current.style.transition = 'none'
  }, [collapsed, width])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return

      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const delta = e.clientX - startX.current
        const newW  = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW.current + delta))
        liveWidth.current = newW

        if (navRef.current) navRef.current.style.width = `${newW}px`

        window.electronAPI.viewSetNavWidth(newW)
        window.dispatchEvent(new CustomEvent('nav-resize', { detail: { width: newW } }))
      })
    }

    function onMouseUp() {
      if (!isResizing.current) return
      cancelAnimationFrame(rafId.current)

      isResizing.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''

      if (navRef.current) navRef.current.style.transition = 'width 0.18s ease'

      const finalWidth = liveWidth.current
      setWidth(finalWidth)
      localStorage.setItem('navWidth', String(finalWidth))
      onWidthChange?.(finalWidth)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup',   onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup',   onMouseUp)
    }
  }, [onWidthChange])

  // ── Collapse toggle ────────────────────────────────────────────────────────

  function toggleCollapse() {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('navCollapsed', String(next))
      return next
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <nav
      ref={navRef}
      style={{
        width: effectiveWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#EBE5D5',
        borderRight: '1px solid #D6CFC0',
        position: 'relative',
        transition: 'width 0.18s ease',
        overflow: 'hidden',
      }}
    >
      {/* Logo Section */}
      <div
        className={`flex items-center shrink-0 border-b border-[#D6CFC0] select-none ${
          collapsed ? 'justify-center py-4 px-0' : 'justify-start gap-2.5 px-3.5 py-3.5'
        }`}
      >
        <div className="w-7 h-7 rounded-lg bg-[#D97706] border border-[#B45309] flex items-center justify-center shrink-0 shadow-[1px_1px_0px_0px_rgba(180,83,9,0.3)]">
          <Zap size={14} className="text-white fill-white" />
        </div>
        {!collapsed && (
          <span className="font-retro-mono text-sm font-bold tracking-wider text-stone-900 uppercase truncate">
            FlowDesk
          </span>
        )}
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-hidden flex flex-col gap-1 p-2">
        {!collapsed && (
          <p className="font-retro-mono text-[9.5px] font-bold text-[#B45309] uppercase tracking-widest px-2.5 pt-1 mb-1 select-none">
            // Menu
          </p>
        )}

        {items.map(({ icon, page, label }) => (
          <NavButton
            key={page}
            icon={icon}
            label={label}
            active={current === page}
            onClick={() => onChange(page)}
            collapsed={collapsed}
          />
        ))}
      </div>

      {/* Bottom: Settings + Collapse toggle */}
      <div className="shrink-0 flex flex-col gap-1 p-2 border-t border-[#D6CFC0] bg-[#EBE5D5]">
        <NavButton
          icon={Settings}
          label="Settings"
          active={current === 'settings'}
          onClick={() => onChange('settings')}
          collapsed={collapsed}
        />

        <button
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center w-full font-retro-mono text-xs font-semibold text-stone-600 hover:bg-[#FAF7F0] hover:text-stone-900 rounded-xl transition-all ${
            collapsed ? 'justify-center py-2 px-0' : 'justify-start gap-2.5 px-3 py-2'
          }`}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>

      {/* Resize drag handle */}
      {!collapsed && (
        <div
          ref={handleRef}
          onMouseDown={handleResizeMouseDown}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 bg-transparent hover:bg-[#D97706]/40 transition-colors"
        />
      )}
    </nav>
  )
}
