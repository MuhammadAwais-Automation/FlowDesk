/**
 * YTStudio.tsx — YouTube Multi-Account Workspace
 *
 * Simplified layout:
 *   [Account Bar] ← account switcher + action buttons (52px)
 *   [WebContentsView] ← studio.youtube.com fills remaining height
 *
 * Tab bar removed — YouTube Studio has its own navigation.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Plus, RefreshCw, ExternalLink, Loader2, X,
  Youtube, LogIn, Trash2, CheckCircle2, AlertCircle, Pencil
} from 'lucide-react'
import type { YouTubeAccount } from '@/types/electron.d'

// ── Constants ─────────────────────────────────────────────────────────────────

const STUDIO_BASE = 'https://studio.youtube.com/'
const TOP_H = 52   // account bar only

// ── Utilities ─────────────────────────────────────────────────────────────────

function emailToHue(email: string): number {
  let hash = 0
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return Math.abs(hash) % 360
}

function getDisplayName(a: YouTubeAccount): string {
  return a.label ?? a.email
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props { isActive: boolean }

export default function YTStudio({ isActive }: Props) {
  const api = window.electronAPI

  const [navW, setNavW] = useState<number>(() => {
    const collapsed = localStorage.getItem('navCollapsed') === 'true'
    const saved = localStorage.getItem('navWidth')
    return collapsed ? 48 : saved ? Math.max(120, Math.min(280, Number(saved))) : 172
  })
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [adding, setAdding] = useState(false)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [fallbackPartition, setFallbackPartition] = useState<string | null>(null)
  const [fallbackEmail, setFallbackEmail] = useState('')
  const [fallbackError, setFallbackError] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeAccount = accounts.find(a => a.id === activeId) ?? null

  // ── Lifecycle ──────────────────────────────────────────────────
  useEffect(() => { loadAccounts() }, [])

  // Listen to sidebar resize events
  useEffect(() => {
    const handler = (e: Event) => {
      setNavW((e as CustomEvent<{ width: number }>).detail.width)
    }
    window.addEventListener('nav-resize', handler)
    return () => window.removeEventListener('nav-resize', handler)
  }, [])

  useEffect(() => {
    if (!isActive) api.hideView().catch(() => {})
  }, [isActive])

  useEffect(() => {
    return () => { api.hideView().catch(() => {}) }
  }, [])

  useEffect(() => {
    if (accounts.length > 0 && !activeId) {
      handleSwitchAccount(accounts[0].id)
    }
  }, [accounts])

  // Re-show view when page becomes active
  useEffect(() => {
    if (isActive && activeId && activeAccount) {
      api.switchView(`yt-${activeId}`, activeAccount.partition, STUDIO_BASE).catch(() => {})
      applyBounds()
    }
  }, [isActive])

  // Keep bounds correct on window resize or nav width change
  useEffect(() => {
    if (!isActive) return
    applyBounds()
    const onResize = () => applyBounds()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isActive, activeId, navW])

  // ── Helpers ────────────────────────────────────────────────────

  function applyBounds() {
    api.setCustomBounds(navW, TOP_H, window.innerWidth - navW, window.innerHeight - TOP_H).catch(() => {})
  }

  async function loadAccounts() {
    const list = await api.ytList()
    setAccounts(list)
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ msg, type })
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }

  const handleSwitchAccount = useCallback(async (id: string) => {
    const account = accounts.find(a => a.id === id)
    if (!account) return

    setSwitching(true)
    setActiveId(id)

    try {
      await api.switchView(`yt-${id}`, account.partition, STUDIO_BASE)
      applyBounds()
    } catch {
      showToast('View load nahi hua', 'error')
    } finally {
      setSwitching(false)
    }
  }, [accounts, api])

  async function handleAdd() {
    setAdding(true)
    setFallbackPartition(null)
    setFallbackEmail('')
    setFallbackError('')
    try {
      const result = await api.ytAdd()
      if ('error' in result) {
        if (result.error === 'detect_failed' && result.partition) {
          setFallbackPartition(result.partition)
        } else if (result.error === 'already_exists') {
          showToast('Yeh account pehle se add hai', 'error')
        } else {
          showToast('Login cancel ho gaya', 'error')
        }
      } else {
        await loadAccounts()
        handleSwitchAccount(result.id)
        showToast('Account add ho gaya!')
      }
    } catch {
      showToast('Account add nahi hua', 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleFallbackSave() {
    if (!fallbackPartition || !fallbackEmail.trim()) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallbackEmail.trim())) {
      setFallbackError('Valid email address dalo')
      return
    }
    try {
      const result = await api.ytFinalizeAdd(fallbackEmail.trim(), fallbackPartition)
      if ('error' in result) {
        setFallbackError(result.error === 'already_exists' ? 'Account already add hai' : 'Save nahi hua')
        return
      }
      await loadAccounts()
      handleSwitchAccount(result.id)
      setFallbackPartition(null)
      showToast('Account add ho gaya!')
    } catch {
      setFallbackError('Save nahi hua, dobara try karo')
    }
  }

  async function handleRemove(id: string) {
    const account = accounts.find(a => a.id === id)
    if (!account) return
    if (!confirm(`"${getDisplayName(account)}" remove karo? Session delete ho jayega.`)) return
    await api.ytRemove(id)
    await loadAccounts()
    if (activeId === id) {
      setActiveId(null)
      await api.hideView()
    }
    showToast('Account remove ho gaya')
  }

  async function handleRelogin(partition: string) {
    const account = accounts.find(a => a.partition === partition)
    if (!account) return
    setLoggingIn(account.id)
    await api.ytOpenLoginWindow(partition)
    setLoggingIn(null)
    showToast('Re-authentication complete')
  }

  function handleStartRename(account: YouTubeAccount) {
    setRenamingId(account.id)
    setRenameInput(account.label ?? account.email)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }

  async function handleSaveRename() {
    if (!renamingId || !renameInput.trim()) return
    await api.ytUpdateLabel(renamingId, renameInput.trim())
    await loadAccounts()
    setRenamingId(null)
    showToast('Name update ho gaya')
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>

      {/* ── Toast ─────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '9px 16px', borderRadius: '10px', fontSize: '12px',
          fontWeight: 500, display: 'flex', alignItems: 'center', gap: '7px',
          background: toast.type === 'success' ? 'var(--success-muted)' : 'var(--danger-muted)',
          color: toast.type === 'success' ? 'var(--success)' : 'var(--danger)',
          border: `1px solid ${toast.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
          pointerEvents: 'none',
        }}>
          {toast.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {toast.msg}
        </div>
      )}

      {/* ── Fallback Email Modal ──────────────────────────────── */}
      {fallbackPartition && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.40)',
        }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '14px', padding: '22px', width: '340px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>Email confirm karo</p>
              <button onClick={() => setFallbackPartition(null)}
                style={{ color: 'var(--text-3)', cursor: 'pointer', background: 'none', border: 'none' }}>
                <X size={15} />
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '12px', lineHeight: 1.5 }}>
              Email auto-detect nahi ho payi. Login wali Gmail address dalo.
            </p>
            <input
              autoFocus type="email" placeholder="yourname@gmail.com"
              value={fallbackEmail}
              onChange={e => { setFallbackEmail(e.target.value); setFallbackError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleFallbackSave() }}
              style={{
                width: '100%', padding: '9px 11px', fontSize: '13px', borderRadius: '8px',
                background: 'var(--surface-2)',
                border: `1px solid ${fallbackError ? 'var(--danger)' : 'var(--border)'}`,
                color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
              }}
            />
            {fallbackError && (
              <p style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '5px' }}>{fallbackError}</p>
            )}
            <div style={{ display: 'flex', gap: '7px', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button onClick={() => setFallbackPartition(null)} style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)',
              }}>Cancel</button>
              <button onClick={handleFallbackSave} disabled={!fallbackEmail.trim()} style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                background: 'var(--accent)', color: 'white', border: 'none',
                opacity: fallbackEmail.trim() ? 1 : 0.5,
              }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ACCOUNT BAR ──────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '0 10px',
        height: `${TOP_H}px`, flexShrink: 0,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
      }}>

        {/* YouTube logo */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          paddingRight: '10px', marginRight: '2px',
          borderRight: '1px solid var(--border)', flexShrink: 0,
        }}>
          <Youtube size={15} style={{ color: '#FF0000' }} />
          <span style={{
            fontSize: '11.5px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em',
          }}>
            Studio
          </span>
        </div>

        {/* Account pills */}
        {accounts.map(account => {
          const isAct = account.id === activeId
          const hue = emailToHue(account.email)
          const name = getDisplayName(account)
          const isLoggingIn = loggingIn === account.id

          return (
            <button
              key={account.id}
              onClick={() => handleSwitchAccount(account.id)}
              title={account.email}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '4px 10px 4px 5px',
                borderRadius: '20px', flexShrink: 0, cursor: 'pointer',
                background: isAct
                  ? `hsla(${hue}, 58%, 50%, 0.12)`
                  : 'var(--surface-2)',
                border: `1.5px solid ${isAct ? `hsl(${hue}, 55%, 56%)` : 'var(--border)'}`,
                transition: 'all 0.15s ease',
                boxShadow: isAct ? `0 0 0 3px hsla(${hue}, 55%, 50%, 0.08)` : 'none',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                background: `hsl(${hue}, 55%, 52%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 700, fontSize: '9px',
              }}>
                {isLoggingIn
                  ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />
                  : name[0].toUpperCase()
                }
              </div>
              {/* Name */}
              <span style={{
                fontSize: '11px', fontWeight: isAct ? 600 : 500,
                color: isAct ? `hsl(${hue}, 50%, 38%)` : 'var(--text-2)',
                maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {name}
              </span>
              {/* Active dot */}
              {isAct && (
                <div style={{
                  width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
                  background: `hsl(${hue}, 60%, 50%)`,
                  boxShadow: `0 0 5px hsl(${hue}, 60%, 50%)`,
                }} />
              )}
            </button>
          )
        })}

        {/* Add button */}
        <button
          onClick={handleAdd} disabled={adding}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '4px 10px', borderRadius: '20px', flexShrink: 0, cursor: 'pointer',
            background: 'transparent', border: '1.5px dashed var(--border)',
            color: 'var(--text-3)', fontSize: '11px', fontWeight: 500,
            transition: 'all 0.15s', opacity: adding ? 0.6 : 1,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
          }}
        >
          {adding ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={10} />}
          {adding ? 'Adding…' : 'Add'}
        </button>

        <div style={{ flex: 1 }} />

        {/* Right controls for active account */}
        {activeAccount && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1px', flexShrink: 0 }}>
            {renamingId === activeAccount.id ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  ref={renameInputRef}
                  value={renameInput}
                  onChange={e => setRenameInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  style={{
                    fontSize: '12px', padding: '3px 8px', borderRadius: '6px',
                    background: 'var(--surface-2)', border: '1px solid var(--accent-border)',
                    color: 'var(--text)', outline: 'none', width: '130px',
                  }}
                />
                <button onClick={handleSaveRename} style={{
                  padding: '3px 8px', borderRadius: '6px', fontSize: '11px',
                  background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer',
                }}>Save</button>
                <button onClick={() => setRenamingId(null)} style={{
                  padding: '3px 6px', borderRadius: '6px', fontSize: '11px',
                  background: 'var(--surface-2)', color: 'var(--text-2)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                }}>×</button>
              </div>
            ) : (
              <BarBtn title="Rename" onClick={() => handleStartRename(activeAccount)}>
                <Pencil size={12} />
              </BarBtn>
            )}
            <BarBtn title="Re-authenticate" onClick={() => handleRelogin(activeAccount.partition)}>
              <LogIn size={12} />
            </BarBtn>
            <BarBtn title="Reload" onClick={() => api.viewReload()}>
              <RefreshCw size={12} />
            </BarBtn>
            <BarBtn title="Open in browser" onClick={() => api.ytOpenExternal(STUDIO_BASE).catch(() => {})}>
              <ExternalLink size={12} />
            </BarBtn>
            <BarBtn title="Remove account" danger onClick={() => handleRemove(activeAccount.id)}>
              <Trash2 size={12} />
            </BarBtn>
          </div>
        )}
      </div>

      {/* ── MAIN VIEW AREA ────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', background: 'var(--bg)', minHeight: 0 }}>

        {/* Switching overlay */}
        {switching && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)',
          }}>
            <Youtube size={26} style={{ color: '#FF0000', marginBottom: '12px' }} />
            <Loader2 size={18} style={{ color: 'var(--text-3)', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '10px', fontWeight: 500 }}>
              {activeAccount ? getDisplayName(activeAccount) : 'Loading…'}
            </p>
          </div>
        )}

        {/* Empty state */}
        {!switching && accounts.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '14px',
          }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '14px',
              background: 'rgba(255,0,0,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Youtube size={24} style={{ color: '#FF0000' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '5px' }}>
                No YouTube Accounts
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-3)', maxWidth: '240px', lineHeight: 1.5 }}>
                "Add" dabao aur Google account se login karo
              </p>
            </div>
            <button
              onClick={handleAdd} disabled={adding}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 18px', borderRadius: '10px', cursor: 'pointer',
                background: '#FF0000', color: 'white', border: 'none',
                fontSize: '12px', fontWeight: 600,
                opacity: adding ? 0.7 : 1,
                boxShadow: '0 4px 14px rgba(255,0,0,0.22)',
              }}
            >
              {adding ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
              {adding ? 'Adding…' : 'Add First Account'}
            </button>
          </div>
        )}

        {/* WebContentsView renders over this div via Electron sessions.ts */}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function BarBtn({ onClick, title, danger = false, children }: {
  onClick: () => void
  title: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '26px', height: '26px', borderRadius: '6px',
        background: 'none', border: 'none', cursor: 'pointer',
        color: danger ? 'var(--danger)' : 'var(--text-3)',
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = danger ? 'var(--danger-muted)' : 'var(--surface-2)'
        ;(e.currentTarget as HTMLElement).style.color = danger ? 'var(--danger)' : 'var(--text)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'none'
        ;(e.currentTarget as HTMLElement).style.color = danger ? 'var(--danger)' : 'var(--text-3)'
      }}
    >
      {children}
    </button>
  )
}
