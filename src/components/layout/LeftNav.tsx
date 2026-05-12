import { useRef, useEffect, useState, useCallback } from 'react'
import {
  LayoutDashboard, Globe, FileText, Users,
  Settings, Zap, Youtube, Calendar, Smartphone,
  ChevronLeft, ChevronRight,
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
  { icon: LayoutDashboard, page: 'dashboard', label: 'Dashboard' },
  { icon: Globe,           page: 'browser',   label: 'AI Browser' },
  { icon: FileText,        page: 'prompts',   label: 'Prompts'    },
  { icon: Users,           page: 'accounts',  label: 'Accounts'   },
  { icon: Youtube,         page: 'youtube',   label: 'YT Studio'  },
  { icon: Calendar,        page: 'workspace', label: 'Workspace'  },
  { icon: Smartphone,      page: 'social',    label: 'Social Hub' },
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
  const accentColor = danger ? 'var(--danger)' : 'var(--accent)'
  const accentMuted = danger ? 'var(--danger-muted)' : 'var(--accent-muted)'

  return (
    <button
      // Task 2: title always visible (not just when collapsed)
      // — browser shows native tooltip on hover, useful when label is ellipsed
      title={label}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: collapsed ? 0 : '9px',
        width: '100%',
        padding: collapsed ? '7px 0' : '7px 10px',
        borderRadius: '8px',
        fontSize: '12.5px',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        textAlign: 'left',
        border: 'none',
        transition: 'background 0.14s, color 0.14s, box-shadow 0.14s',
        background: active ? accentMuted : 'transparent',
        color: active ? accentColor : 'var(--text-2)',
        // Luxury: subtle inner glow when active
        boxShadow: active && !collapsed
          ? `inset 3px 0 0 ${accentColor}, 0 0 0 0 transparent`
          : 'none',
      }}
      onMouseEnter={e => {
        if (!active) {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = 'var(--text-2)'
        }
      }}
    >
      <Icon
        size={14}
        style={{ flexShrink: 0, color: active ? accentColor : 'inherit', transition: 'color 0.14s' }}
      />
      {!collapsed && (
        <span style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          // Task 2: ensure text clips gracefully at any width
          minWidth: 0,
        }}>
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

  // ── Refs for jank-free resize (Task 2) ─────────────────────────────────────
  const isResizing   = useRef(false)
  const startX       = useRef(0)
  const startW       = useRef(0)
  const liveWidth    = useRef(width)   // tracks width during drag without re-renders
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

  // ── Resize drag (Task 2: jank-free via direct DOM, RAF throttle) ───────────

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (collapsed) return

    isResizing.current = true
    startX.current     = e.clientX
    startW.current     = width
    liveWidth.current  = width

    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'

    // Kill CSS transition so the sidebar tracks the cursor instantly
    if (navRef.current) navRef.current.style.transition = 'none'
  }, [collapsed, width])

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return

      // Throttle to one DOM write per animation frame
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const delta = e.clientX - startX.current
        const newW  = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW.current + delta))
        liveWidth.current = newW

        // Direct DOM write — zero React re-renders during drag
        if (navRef.current) navRef.current.style.width = `${newW}px`

        // Keep WebContentsView bounds in sync as user drags
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

      // Restore smooth transition
      if (navRef.current) navRef.current.style.transition = 'width 0.18s ease'

      // Single React state commit (one re-render total for the whole drag)
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
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        position: 'relative',
        transition: 'width 0.18s ease',
        // Ensure nav content never overflows during resize
        overflow: 'hidden',
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: collapsed ? 0 : '9px',
          padding: collapsed ? '16px 0' : '16px 14px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '26px', height: '26px', borderRadius: '7px', flexShrink: 0,
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            // Luxury: logo block glows with current accent
            boxShadow: '0 0 12px -2px var(--accent)',
            transition: 'background 0.3s ease, box-shadow 0.3s ease',
          }}
        >
          <Zap size={12} color="white" fill="white" />
        </div>
        {!collapsed && (
          <span style={{
            fontSize: '13px', fontWeight: 700, letterSpacing: '-0.02em',
            fontFamily: 'Outfit, sans-serif', color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            FlowDesk
          </span>
        )}
      </div>

      {/* Nav items */}
      <div style={{
        flex: 1,
        padding: collapsed ? '10px 4px' : '10px 6px',
        display: 'flex', flexDirection: 'column', gap: '1px',
        overflow: 'hidden',
      }}>
        {!collapsed && (
          <p style={{
            fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--text-3)',
            padding: '0 8px', marginBottom: '6px',
            whiteSpace: 'nowrap',
          }}>
            Menu
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
      <div style={{
        padding: collapsed ? '6px 4px' : '6px',
        borderTop: '1px solid var(--border)',
        flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px',
      }}>
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
          style={{
            display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: collapsed ? 0 : '9px',
            width: '100%', padding: collapsed ? '7px 0' : '7px 10px',
            borderRadius: '8px', fontSize: '12.5px', fontWeight: 400,
            cursor: 'pointer', border: 'none',
            background: 'transparent', color: 'var(--text-3)',
            transition: 'background 0.14s, color 0.14s',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--text-2)'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!collapsed && <span style={{ whiteSpace: 'nowrap' }}>Collapse</span>}
        </button>
      </div>

      {/* ── Resize drag handle (Task 2: luxury glow on hover) ──────────────── */}
      {!collapsed && (
        <div
          ref={handleRef}
          onMouseDown={handleResizeMouseDown}
          style={{
            position: 'absolute', top: 0, right: 0,
            width: '4px', height: '100%',
            cursor: 'col-resize',
            zIndex: 10,
            // Luxury: the handle itself is a hairline glow strip
            background: 'transparent',
            transition: 'background 0.2s ease',
          }}
          onMouseEnter={e => {
            ;(e.currentTarget as HTMLElement).style.background =
              'linear-gradient(to bottom, transparent 10%, var(--accent) 40%, var(--accent) 60%, transparent 90%)'
            ;(e.currentTarget as HTMLElement).style.opacity = '0.35'
          }}
          onMouseLeave={e => {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
            ;(e.currentTarget as HTMLElement).style.opacity = '1'
          }}
        />
      )}
    </nav>
  )
}
