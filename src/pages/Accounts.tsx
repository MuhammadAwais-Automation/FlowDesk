import { useState, useEffect, useRef } from 'react'
import {
  UserPlus, RefreshCw, Trash2, Mail, User,
  ChevronLeft, ChevronRight, RotateCw, Loader2,
  Pencil, CheckCircle2, AlertCircle, X
} from 'lucide-react'
import type { GmailSession } from '@/types/electron'

// ── Utilities ────────────────────────────────────────────────

function emailToHue(email: string): number {
  let hash = 0
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return Math.abs(hash) % 360
}

function getDisplayName(s: GmailSession): string {
  return s.label ?? s.email
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const m = Math.floor(days / 30)
  return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`
}

// ── Main Component ───────────────────────────────────────────

export default function Accounts() {
  const [sessions, setSessions] = useState<GmailSession[]>([])
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'info' | 'gmail'>('info')
  const [adding, setAdding] = useState(false)
  const [fallbackPartition, setFallbackPartition] = useState<string | null>(null)
  const [fallbackEmail, setFallbackEmail] = useState('')
  const [fallbackError, setFallbackError] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [gmailLoading, setGmailLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const gmailPanelRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = sessions.find(s => s.email === selectedEmail) ?? null

  useEffect(() => { loadSessions() }, [])

  // Hide Gmail WebContentsView on unmount
  useEffect(() => () => { window.electronAPI.hideView() }, [])

  // ── Task 1: Overlay Detection ──────────────────────────────────────────────
  // When the fallback-email modal opens, the native Gmail WebContentsView
  // (a native layer) would render on top of it.  Hide the view while any
  // overlay is open; restore it if the Gmail tab is still active when closed.
  useEffect(() => {
    if (fallbackPartition !== null) {
      // Overlay is open — hide the native view immediately
      window.electronAPI.hideView()
    } else if (activeTab === 'gmail' && selectedEmail) {
      // Overlay closed — restore Gmail view if that tab is still active
      const session = sessions.find(s => s.email === selectedEmail)
      if (session) {
        window.electronAPI
          .gmailOpenInbox(`gmail-inbox-${selectedEmail}`, session.partition)
          .then(() => requestAnimationFrame(() => updateGmailBounds()))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackPartition])

  // ResizeObserver — keep Gmail bounds in sync with layout changes
  useEffect(() => {
    if (activeTab !== 'gmail' || !gmailPanelRef.current) return
    const obs = new ResizeObserver(() => updateGmailBounds())
    obs.observe(gmailPanelRef.current)
    updateGmailBounds()
    return () => obs.disconnect()
  }, [activeTab, selectedEmail])

  async function loadSessions() {
    const list = await window.electronAPI.gmailList()
    setSessions(list)
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setToast({ msg, type })
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000)
  }

  function updateGmailBounds() {
    if (!gmailPanelRef.current) return
    const rect = gmailPanelRef.current.getBoundingClientRect()
    window.electronAPI.setCustomBounds(
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height)
    )
  }

  async function handleAdd() {
    setAdding(true)
    setFallbackPartition(null)
    setFallbackEmail('')
    setFallbackError('')
    try {
      const result = await window.electronAPI.gmailAdd()
      if ('error' in result) {
        if (result.error === 'detect_failed' && result.partition) {
          setFallbackPartition(result.partition)
        } else if (result.error === 'already_exists') {
          showToast('Account already added', 'error')
        } else {
          showToast('Login cancelled', 'error')
        }
      } else {
        await loadSessions()
        setSelectedEmail(result.email)
        showToast('Account added!')
      }
    } catch {
      showToast('Failed to add account', 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleFallbackSave() {
    if (!fallbackPartition || !fallbackEmail.trim()) return
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(fallbackEmail.trim())) {
      setFallbackError('Valid email address enter karo')
      return
    }
    try {
      const result = await window.electronAPI.gmailFinalizeAdd(
        fallbackEmail.trim(), fallbackPartition
      )
      if ('error' in result) {
        setFallbackError(
          result.error === 'already_exists' ? 'Yeh account already added hai' : 'Save nahi hua'
        )
        return
      }
      await loadSessions()
      setSelectedEmail(result.email)
      setFallbackPartition(null)
      showToast('Account added!')
    } catch {
      setFallbackError('Save nahi hua, dobara try karo')
    }
  }

  function handleSelectAccount(email: string) {
    if (activeTab === 'gmail') window.electronAPI.hideView()
    setSelectedEmail(email)
    setActiveTab('info')
    setEditingName(false)
  }

  async function handleLogin(email: string, partition: string) {
    setLoggingIn(email)
    await window.electronAPI.gmailOpenLogin(email, partition)
    setLoggingIn(null)
  }

  async function handleRemove(email: string) {
    if (!confirm(`"${email}" remove karo? Session delete ho jayega.`)) return
    if (activeTab === 'gmail' && selectedEmail === email) window.electronAPI.hideView()
    await window.electronAPI.gmailRemove(email)
    await loadSessions()
    if (selectedEmail === email) { setSelectedEmail(null); setActiveTab('info') }
  }

  async function handleSaveName() {
    if (!selected || !nameInput.trim()) return
    try {
      await window.electronAPI.gmailUpdateLabel(selected.email, nameInput.trim())
      await loadSessions()
      setEditingName(false)
    } catch {
      showToast('Name save nahi hua', 'error')
      setEditingName(false)
    }
  }

  async function handleOpenGmail() {
    if (!selected) return
    setGmailLoading(true)
    setActiveTab('gmail')
    await window.electronAPI.gmailOpenInbox(`gmail-inbox-${selected.email}`, selected.partition)
    requestAnimationFrame(() => {
      updateGmailBounds()
      setGmailLoading(false)
    })
  }

  function handleTabChange(tab: 'info' | 'gmail') {
    if (tab === 'gmail') {
      handleOpenGmail()
    } else {
      window.electronAPI.hideView()
      setActiveTab('info')
    }
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg)', position: 'relative' }}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '10px 18px', borderRadius: '10px', fontSize: '13px',
          fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px',
          background: toast.type === 'success' ? 'var(--success-muted)' : 'var(--danger-muted)',
          color: toast.type === 'success' ? 'var(--success)' : 'var(--danger)',
          border: `1px solid ${toast.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}>
          {toast.type === 'success'
            ? <CheckCircle2 size={14} />
            : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}

      {/* ── Fallback email input modal ── */}
      {fallbackPartition && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)',
        }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '14px', padding: '24px', width: '360px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <p style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>
                Email confirm karo
              </p>
              <button onClick={() => setFallbackPartition(null)}
                style={{ color: 'var(--text-3)', cursor: 'pointer', background: 'none', border: 'none' }}>
                <X size={16} />
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginBottom: '14px', lineHeight: 1.5 }}>
              Email auto-detect nahi ho payi. Login karne wali Gmail address dalo.
            </p>
            <input
              autoFocus
              type="email"
              placeholder="yourname@gmail.com"
              value={fallbackEmail}
              onChange={e => { setFallbackEmail(e.target.value); setFallbackError('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleFallbackSave() }}
              style={{
                width: '100%', padding: '10px 12px', fontSize: '13px', borderRadius: '8px',
                background: 'var(--surface-2)',
                border: `1px solid ${fallbackError ? 'var(--danger)' : 'var(--border)'}`,
                color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
              }}
            />
            {fallbackError && (
              <p style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '6px' }}>
                {fallbackError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={() => setFallbackPartition(null)}
                style={{
                  padding: '8px 16px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  color: 'var(--text-2)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleFallbackSave}
                disabled={!fallbackEmail.trim()}
                style={{
                  padding: '8px 16px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
                  background: 'var(--accent)', color: 'white', border: 'none',
                  opacity: fallbackEmail.trim() ? 1 : 0.5,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <div style={{
        width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
      }}>
        {/* Sidebar header */}
        <div style={{
          padding: '18px 16px 12px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            Accounts
          </span>
          <button
            onClick={handleAdd}
            disabled={adding}
            title="Add account"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
              background: 'var(--accent)', color: 'white', border: 'none',
              fontSize: '11px', fontWeight: 500,
              opacity: adding ? 0.6 : 1,
            }}
          >
            {adding ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>

        {/* Account list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {sessions.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '200px', gap: '8px',
            }}>
              <Mail size={28} style={{ color: 'var(--text-3)' }} />
              <p style={{ fontSize: '12px', color: 'var(--text-3)', textAlign: 'center' }}>
                No accounts yet
              </p>
            </div>
          ) : (
            sessions.map(s => {
              const isSelected = s.email === selectedEmail
              const hue = emailToHue(s.email)
              const displayName = getDisplayName(s)
              return (
                <button
                  key={s.email}
                  onClick={() => handleSelectAccount(s.email)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '9px 10px', borderRadius: '9px', cursor: 'pointer',
                    marginBottom: '2px', textAlign: 'left',
                    background: isSelected ? 'var(--accent-muted)' : 'transparent',
                    border: 'none',
                    borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                    background: `hsl(${hue}, 60%, 50%)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontWeight: 700, fontSize: '13px',
                  }}>
                    {displayName[0].toUpperCase()}
                  </div>
                  {/* Name + email */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{
                      fontSize: '12px', fontWeight: 600, color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {displayName}
                    </p>
                    {s.label && (
                      <p style={{
                        fontSize: '10px', color: 'var(--text-3)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {s.email}
                      </p>
                    )}
                  </div>
                  {/* Active dot */}
                  {isSelected && (
                    <div style={{
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: 'var(--accent)', flexShrink: 0,
                    }} />
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      {selected ? (
        <DetailPanel
          session={selected}
          activeTab={activeTab}
          editingName={editingName}
          nameInput={nameInput}
          loggingIn={loggingIn}
          gmailLoading={gmailLoading}
          gmailPanelRef={gmailPanelRef}
          nameInputRef={nameInputRef}
          onTabChange={handleTabChange}
          onStartEditName={() => {
            setEditingName(true)
            setNameInput(selected.label ?? selected.email)
            setTimeout(() => nameInputRef.current?.focus(), 50)
          }}
          onNameInput={setNameInput}
          onSaveName={handleSaveName}
          onCancelEdit={() => setEditingName(false)}
          onLogin={() => handleLogin(selected.email, selected.partition)}
          onRemove={() => handleRemove(selected.email)}
        />
      ) : (
        <EmptyDetail onAdd={handleAdd} adding={adding} />
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────

interface DetailPanelProps {
  session: GmailSession
  activeTab: 'info' | 'gmail'
  editingName: boolean
  nameInput: string
  loggingIn: string | null
  gmailLoading: boolean
  gmailPanelRef: React.RefObject<HTMLDivElement>
  nameInputRef: React.RefObject<HTMLInputElement>
  onTabChange: (tab: 'info' | 'gmail') => void
  onStartEditName: () => void
  onNameInput: (v: string) => void
  onSaveName: () => void
  onCancelEdit: () => void
  onLogin: () => void
  onRemove: () => void
}

function DetailPanel({
  session, activeTab, editingName, nameInput, loggingIn, gmailLoading,
  gmailPanelRef, nameInputRef,
  onTabChange, onStartEditName, onNameInput, onSaveName, onCancelEdit, onLogin, onRemove,
}: DetailPanelProps) {
  const hue = emailToHue(session.email)
  const displayName = getDisplayName(session)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minWidth: 0 }}>

      {/* ── Header ── */}
      <div style={{
        padding: '20px 24px 0',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          {/* Large avatar */}
          <div style={{
            width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
            background: `hsl(${hue}, 60%, 50%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 700, fontSize: '22px',
          }}>
            {displayName[0].toUpperCase()}
          </div>

          {/* Name + email */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  ref={nameInputRef}
                  value={nameInput}
                  onChange={e => onNameInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') onSaveName()
                    if (e.key === 'Escape') onCancelEdit()
                  }}
                  style={{
                    fontSize: '16px', fontWeight: 600, color: 'var(--text)',
                    background: 'var(--surface-2)', border: '1px solid var(--accent-border)',
                    borderRadius: '6px', padding: '3px 8px', outline: 'none', flex: 1,
                  }}
                />
                <button
                  onClick={onSaveName}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
                    background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer',
                  }}
                >
                  Save
                </button>
                <button
                  onClick={onCancelEdit}
                  style={{
                    padding: '4px 8px', borderRadius: '6px', fontSize: '11px',
                    background: 'var(--surface-2)', color: 'var(--text-2)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                onClick={onStartEditName}
                title="Click to rename"
              >
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
                  {displayName}
                </span>
                <Pencil size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
              </div>
            )}
            <p style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>
              {session.email}
              {' · '}Added {relativeDate(session.addedAt)}
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['info', 'gmail'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: '8px 8px 0 0',
                fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                background: activeTab === tab ? 'var(--bg)' : 'transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-3)',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {tab === 'info' ? <User size={13} /> : <Mail size={13} />}
              {tab === 'info' ? 'Info' : 'Gmail'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'info' ? (
        <InfoTab
          session={session}
          loggingIn={loggingIn}
          onLogin={onLogin}
          onRemove={onRemove}
        />
      ) : (
        <GmailTab
          gmailPanelRef={gmailPanelRef}
          gmailLoading={gmailLoading}
          session={session}
        />
      )}
    </div>
  )
}

interface InfoTabProps {
  session: GmailSession
  loggingIn: string | null
  onLogin: () => void
  onRemove: () => void
}

function InfoTab({ session, loggingIn, onLogin, onRemove }: InfoTabProps) {
  const isLoggingIn = loggingIn === session.email

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

      {/* Re-authenticate */}
      <section style={{ marginBottom: '28px' }}>
        <p style={{
          fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: '12px',
        }}>
          Authentication
        </p>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '12px', padding: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', marginBottom: '3px' }}>
              Google Session
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              Session sab AI tools ke liye shared hai
            </p>
          </div>
          <button
            onClick={onLogin}
            disabled={isLoggingIn}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
              background: 'var(--accent-muted)', color: 'var(--accent)',
              border: '1px solid var(--accent-border)',
              fontSize: '12px', fontWeight: 500, flexShrink: 0,
              opacity: isLoggingIn ? 0.7 : 1,
            }}
          >
            {isLoggingIn
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />}
            {isLoggingIn ? 'Opening…' : 'Re-authenticate'}
          </button>
        </div>
      </section>

      {/* Tab Color */}
      <ColorPickerSection email={session.email} currentColor={session.color} />

      {/* Danger zone */}
      <section>
        <p style={{
          fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--danger)', marginBottom: '12px',
        }}>
          Danger Zone
        </p>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: '12px', padding: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', marginBottom: '3px' }}>
              Remove Account
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
              Saved session aur data delete ho jayega
            </p>
          </div>
          <button
            onClick={onRemove}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
              background: 'transparent', color: 'var(--danger)',
              border: '1px solid var(--danger)',
              fontSize: '12px', fontWeight: 500, flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--danger-muted)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <Trash2 size={13} />
            Remove
          </button>
        </div>
      </section>
    </div>
  )
}

interface GmailTabProps {
  gmailPanelRef: React.RefObject<HTMLDivElement>
  gmailLoading: boolean
  session: GmailSession
}

function GmailNavBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: '4px 5px', borderRadius: '6px', cursor: 'pointer',
      background: 'none', border: 'none', color: 'var(--text-3)',
      display: 'flex', alignItems: 'center',
    }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}
    >
      {children}
    </button>
  )
}

function GmailTab({ gmailPanelRef, gmailLoading, session }: GmailTabProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Gmail toolbar — back/forward/reload only, URL bar removed */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '2px',
        padding: '5px 10px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <GmailNavBtn onClick={() => window.electronAPI.viewGoBack()} title="Back">
          <ChevronLeft size={14} />
        </GmailNavBtn>
        <GmailNavBtn onClick={() => window.electronAPI.viewGoForward()} title="Forward">
          <ChevronRight size={14} />
        </GmailNavBtn>
        <GmailNavBtn onClick={() => window.electronAPI.viewReload()} title="Refresh">
          <RotateCw size={13} />
        </GmailNavBtn>
        <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-3)' }}>
          {session.email}
        </span>
      </div>

      {/* Gmail content area — WebContentsView renders here */}
      <div
        ref={gmailPanelRef}
        style={{ flex: 1, background: 'var(--bg)', position: 'relative' }}
      >
        {gmailLoading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)',
          }}>
            <div style={{ textAlign: 'center' }}>
              <Loader2
                size={28}
                className="animate-spin"
                style={{ color: 'var(--text-3)', display: 'block', margin: '0 auto 12px' }}
              />
              <p style={{ fontSize: '13px', color: 'var(--text-3)' }}>Gmail load ho raha hai…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Color Picker Section ─────────────────────────────────────────────────────

function ColorPickerSection({ email, currentColor }: { email: string; currentColor?: string | null }) {
  const [hex, setHex] = useState(currentColor ?? '#4F6EF7')
  const [saved, setSaved] = useState(false)
  const colorInputRef = useRef<HTMLInputElement>(null)

  async function handleSave(value: string) {
    await window.electronAPI.gmailUpdateColor(email, value)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <section style={{ marginBottom: '28px' }}>
      <p style={{
        fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: '12px',
      }}>
        Tab Color
      </p>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '16px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        {/* Color swatch — click to open native picker */}
        <button
          onClick={() => colorInputRef.current?.click()}
          title="Pick color"
          style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: hex, border: '2px solid var(--border)',
            cursor: 'pointer', flexShrink: 0, transition: 'transform 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1)'}
        />
        {/* Hidden native color input */}
        <input
          ref={colorInputRef}
          type="color"
          value={hex}
          onChange={e => setHex(e.target.value)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        />
        {/* Hex text input */}
        <input
          type="text"
          value={hex}
          maxLength={7}
          onChange={e => {
            const v = e.target.value
            setHex(v)
          }}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(hex) }}
          style={{
            flex: 1, fontSize: '13px', fontFamily: 'JetBrains Mono, monospace',
            padding: '7px 10px', borderRadius: '8px',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            color: 'var(--text)', outline: 'none',
          }}
          onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'}
          onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}
        />
        {/* Save button */}
        <button
          onClick={() => handleSave(hex)}
          style={{
            padding: '7px 14px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
            background: saved ? 'var(--success-muted)' : 'var(--accent)',
            color: saved ? 'var(--success)' : 'white',
            border: saved ? '1px solid var(--success)' : 'none',
            fontWeight: 500, flexShrink: 0, transition: 'all 0.2s',
          }}
        >
          {saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      <p style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '7px' }}>
        Yeh color AI Browser mein is Gmail ke saare tabs pe apply hoga
      </p>
    </section>
  )
}

function EmptyDetail({ onAdd, adding }: { onAdd: () => void; adding: boolean }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', gap: '16px',
    }}>
      <div style={{
        width: '64px', height: '64px', borderRadius: '20px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <User size={28} style={{ color: 'var(--text-3)' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
          Account select karo
        </p>
        <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>
          Ya pehla account add karo
        </p>
      </div>
      <button
        onClick={onAdd}
        disabled={adding}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '10px 18px', borderRadius: '10px', cursor: 'pointer',
          background: 'var(--accent)', color: 'white', border: 'none',
          fontSize: '13px', fontWeight: 500,
          opacity: adding ? 0.6 : 1,
        }}
      >
        {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
        {adding ? 'Adding…' : 'Add Account'}
      </button>
    </div>
  )
}
