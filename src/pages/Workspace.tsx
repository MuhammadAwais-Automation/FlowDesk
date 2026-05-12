/**
 * Workspace.tsx — Personal Google Calendar + Tasks
 *
 * Single dedicated Google account with its own isolated session.
 * One-time authentication via popup window, logout option available.
 */

import { useState, useEffect } from 'react'
import { Calendar, CheckSquare, RefreshCw, LogOut, User } from 'lucide-react'

const TOOL_URLS = {
  calendar: 'https://calendar.google.com/calendar/r',
  tasks:    'https://tasks.google.com/',
} as const

type WorkspaceTool = keyof typeof TOOL_URLS

/** Fixed isolated partition — never shared with Gmail accounts */
const PARTITION = 'workspace-personal'
const TAB_ID    = 'workspace-personal'
const TOP_H     = 52

type Status = 'loading' | 'not-connected' | 'connecting' | 'confirming' | 'connected'

interface Props { isActive: boolean }

export default function Workspace({ isActive }: Props) {
  const api = window.electronAPI

  const [status, setStatus]         = useState<Status>('loading')
  const [email, setEmail]           = useState<string | null>(null)
  const [emailInput, setEmailInput] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [activeTool, setActiveTool] = useState<WorkspaceTool>('calendar')
  const [navW, setNavW]             = useState<number>(() => {
    const collapsed = localStorage.getItem('navCollapsed') === 'true'
    const saved     = localStorage.getItem('navWidth')
    return collapsed ? 48 : saved ? Math.max(120, Math.min(280, Number(saved))) : 172
  })

  // ── On mount: check if already authenticated ───────────────────
  useEffect(() => {
    api.workspaceGetEmail().then(e => {
      setEmail(e)
      setStatus(e ? 'connected' : 'not-connected')
    })
  }, [])

  // ── Listen to sidebar resize ────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => setNavW((e as CustomEvent<{ width: number }>).detail.width)
    window.addEventListener('nav-resize', handler)
    return () => window.removeEventListener('nav-resize', handler)
  }, [])

  function applyBounds() {
    api.setCustomBounds(navW, TOP_H, Math.max(window.innerWidth - navW, 100), Math.max(window.innerHeight - TOP_H, 100)).catch(() => {})
  }

  // ── Show/hide WebContentsView ───────────────────────────────────
  useEffect(() => {
    if (!isActive || status !== 'connected') {
      api.hideView().catch(() => {})
      return
    }
    api.switchView(TAB_ID, PARTITION, TOOL_URLS[activeTool]).catch(() => {})
    applyBounds()
  }, [isActive, status, activeTool])

  // ── Re-apply bounds on resize / navW change ─────────────────────
  useEffect(() => {
    if (!isActive || status !== 'connected') return
    applyBounds()
    window.addEventListener('resize', applyBounds)
    return () => window.removeEventListener('resize', applyBounds)
  }, [isActive, status, navW])

  // ── Cleanup on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => { api.hideView().catch(() => {}) }
  }, [])

  // ── Handlers ────────────────────────────────────────────────────

  async function handleConnect() {
    setStatus('connecting')
    await api.workspaceOpenLogin()   // blocks until popup window closes
    setStatus('confirming')
    setEmailInput('')
    setConfirmError('')
  }

  async function handleConfirm() {
    const e = emailInput.trim()
    if (!e || !e.includes('@')) {
      setConfirmError('Valid email address dalo (e.g. you@gmail.com)')
      return
    }
    await api.workspaceSetEmail(e)
    setEmail(e)
    setStatus('connected')
  }

  async function handleLogout() {
    api.hideView().catch(() => {})
    await api.workspaceLogout()
    setEmail(null)
    setStatus('not-connected')
    setEmailInput('')
  }

  function handleRefresh() {
    api.switchView(TAB_ID, PARTITION, TOOL_URLS[activeTool]).catch(() => {})
    applyBounds()
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>

      {/* ── TOOLBAR — only when connected ─────────────────────── */}
      {status === 'connected' && (
        <div
          className="flex items-center gap-2 px-3 shrink-0"
          style={{ height: `${TOP_H}px`, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
        >
          {/* Tool tabs */}
          <div
            className="flex items-center gap-1 p-0.5 rounded-lg"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            {([
              { key: 'calendar' as const, icon: Calendar,    label: 'Calendar' },
              { key: 'tasks'    as const, icon: CheckSquare, label: 'Tasks'    },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveTool(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '4px 10px', borderRadius: '7px', cursor: 'pointer',
                  border: 'none', fontSize: '11.5px', fontWeight: activeTool === key ? 600 : 400,
                  transition: 'all 0.12s',
                  background: activeTool === key ? 'var(--surface)' : 'transparent',
                  color: activeTool === key ? 'var(--accent)' : 'var(--text-3)',
                  boxShadow: activeTool === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Account email pill */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <User size={10} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span className="text-[11px] text-t2 max-w-[160px] truncate">{email}</span>
          </div>

          <button
            onClick={handleRefresh}
            title="Reload"
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-t3 hover:text-tx hover:bg-s2"
          >
            <RefreshCw size={12} />
          </button>

          <button
            onClick={handleLogout}
            title="Sign Out"
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors text-t3 hover:text-red-500 hover:bg-red-500/10"
          >
            <LogOut size={12} />
          </button>
        </div>
      )}

      {/* ── STATE: loading ─────────────────────────────────────── */}
      {status === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Loading...</span>
        </div>
      )}

      {/* ── STATE: not-connected ──────────────────────────────── */}
      {status === 'not-connected' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
          <div style={{
            width: '52px', height: '52px', borderRadius: '16px',
            background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Calendar size={24} style={{ color: 'var(--accent)' }} />
          </div>

          <div style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px', fontFamily: 'Outfit, sans-serif' }}>
              Personal Workspace
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text-3)', lineHeight: 1.7, maxWidth: '240px' }}>
              Apna personal Google account connect karo.<br />
              Google Calendar aur Tasks ek jagah milenge.
            </p>
          </div>

          <button
            onClick={handleConnect}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', borderRadius: '11px', cursor: 'pointer',
              background: 'var(--accent)', border: 'none',
              color: 'white', fontSize: '12px', fontWeight: 600,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.88' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
          >
            <User size={14} />
            Google Account Connect Karo
          </button>
        </div>
      )}

      {/* ── STATE: connecting ─────────────────────────────────── */}
      {status === 'connecting' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="w-8 h-8 rounded-full animate-spin" style={{
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
          }} />
          <div>
            <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-2)', marginBottom: '4px' }}>
              Sign-in window mein apna Google account select karo...
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              Login karne ke baad window band karo — yahan confirm karna hoga
            </p>
          </div>
        </div>
      )}

      {/* ── STATE: confirming ─────────────────────────────────── */}
      {status === 'confirming' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
              Login ho gaya!
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              Ab apna Google email confirm karo
            </p>
          </div>

          <div style={{ width: '100%', maxWidth: '260px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              className="w-full text-xs rounded-xl px-3 py-2.5 bg-s2 border border-border text-tx focus:outline-none focus:border-accent transition-colors"
              placeholder="your@gmail.com"
              type="email"
              value={emailInput}
              onChange={e => { setEmailInput(e.target.value); setConfirmError('') }}
              onKeyDown={e => e.key === 'Enter' && handleConfirm()}
              autoFocus
            />
            {confirmError && (
              <p style={{ fontSize: '10.5px', color: 'var(--danger)' }}>{confirmError}</p>
            )}
            <button
              onClick={handleConfirm}
              style={{
                width: '100%', padding: '9px', borderRadius: '10px',
                background: 'var(--accent)', color: 'white', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                transition: 'opacity 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.88' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
            >
              Done — Workspace Shuru Karo
            </button>
            <button
              onClick={() => setStatus('not-connected')}
              style={{
                width: '100%', padding: '7px', borderRadius: '10px',
                background: 'transparent', color: 'var(--text-3)', border: 'none',
                fontSize: '11px', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* WebContentsView placeholder when connected */}
      {status === 'connected' && <div className="flex-1" style={{ background: 'var(--surface)' }} />}
    </div>
  )
}
