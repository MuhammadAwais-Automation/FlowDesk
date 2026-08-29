import { useState, useEffect, useRef } from 'react'
import {
  UserPlus, RefreshCw, Trash2, Mail, User,
  ChevronLeft, ChevronRight, RotateCw, Loader2,
  Pencil, CheckCircle2, AlertCircle, X, Bot
} from 'lucide-react'
import type { GmailSession } from '@/types/electron'

// ── Utilities ────────────────────────────────────────────────

function emailToHue(email: string): number {
  let hash = 0
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return Math.abs(hash) % 360
}

function getDisplayName(s: GmailSession): string {
  let label = s.label?.trim() || ''
  if (label.includes('Google Account:')) {
    const match = label.match(/Google Account:\s*([^(]+)/i)
    if (match && match[1]?.trim()) {
      return match[1].trim()
    }
  }
  if (label && label.toLowerCase() !== s.email.toLowerCase()) {
    return label
  }
  const localPart = s.email.split('@')[0] || ''
  return localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : s.email
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
  const [agentEmail, setAgentEmail] = useState<string | null>(null)
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
  const effectiveAgentEmail = agentEmail ?? sessions[0]?.email ?? null

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
    const [list, agent] = await Promise.all([
      window.electronAPI.gmailList(),
      window.electronAPI.gmailGetAgentAccount(),
    ])
    setSessions(list)
    setAgentEmail(agent)
  }

  async function handleSetAgentAccount(email: string) {
    await window.electronAPI.gmailSetAgentAccount(email)
    setAgentEmail(email)
    showToast('AI Agent ab is account ka use karega!')
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
      <div className="w-[260px] flex-shrink-0 flex flex-col bg-[#FAF7F0] border-r border-[#D8D1C3]">
        {/* Sidebar header */}
        <div className="p-4 flex items-center justify-between border-b border-[#D8D1C3] bg-[#EBE5D5]">
          <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
            <span className="text-[#D97706]">[02]</span> Accounts
          </span>
          <button
            onClick={handleAdd}
            disabled={adding}
            title="Add account"
            className="retro-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] font-retro-mono text-xs font-bold shadow-[1px_1px_0px_0px_rgba(180,83,9,0.3)] transition-all"
          >
            {adding ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>

        {/* Account list */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-center p-4">
              <Mail size={24} className="text-stone-400" />
              <p className="font-retro-sans text-xs font-semibold text-stone-800">No accounts yet</p>
              <p className="font-retro-mono text-[11px] text-stone-500">Click + Add to connect session</p>
            </div>
          ) : (
            sessions.map(s => {
              const isSelected = s.email === selectedEmail
              const hue = emailToHue(s.email)
              const displayName = getDisplayName(s)
              return (
                <div
                  key={s.email}
                  onClick={() => handleSelectAccount(s.email)}
                  className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 transition-all duration-150 relative ${
                    isSelected
                      ? 'border-2 border-[#D97706] bg-[#FEF3C7] shadow-[2px_2px_0px_0px_rgba(217,119,6,0.2)]'
                      : 'border border-[#E2DBD0] bg-white hover:border-[#D97706]/40 hover:bg-[#FAF7F0] shadow-[0_2px_6px_rgba(0,0,0,0.03)]'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div
                      className="w-8 h-8 rounded-lg border border-white/40 flex items-center justify-center font-retro-mono font-bold text-white text-xs shadow-xs"
                      style={{ background: `hsl(${hue}, 60%, 45%)` }}
                    >
                      {displayName[0].toUpperCase()}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#10B981] border-2 border-white shadow-xs" />
                  </div>

                  {/* Name + email */}
                  <div className="min-w-0 flex-1">
                    <p className={`font-retro-sans text-xs font-bold truncate flex items-center gap-1.5 ${
                      isSelected ? 'text-[#92400E]' : 'text-stone-900'
                    }`}>
                      {displayName}
                      {s.email === effectiveAgentEmail && (
                        <Bot size={11} className="text-[#7C3AED] flex-shrink-0" />
                      )}
                    </p>
                    <p className="font-retro-mono text-[10px] text-stone-500 truncate mt-0.5">
                      {s.email}
                    </p>
                  </div>

                  {/* Selected Active dot */}
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full bg-[#D97706] flex-shrink-0 animate-pulse" />
                  )}
                </div>
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
          isAgentAccount={selected.email === effectiveAgentEmail}
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
          onUseForAgent={() => handleSetAgentAccount(selected.email)}
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
  isAgentAccount: boolean
  onTabChange: (tab: 'info' | 'gmail') => void
  onStartEditName: () => void
  onNameInput: (v: string) => void
  onSaveName: () => void
  onCancelEdit: () => void
  onLogin: () => void
  onRemove: () => void
  onUseForAgent: () => void
}

function DetailPanel({
  session, activeTab, editingName, nameInput, loggingIn, gmailLoading,
  gmailPanelRef, nameInputRef, isAgentAccount,
  onTabChange, onStartEditName, onNameInput, onSaveName, onCancelEdit, onLogin, onRemove, onUseForAgent,
}: DetailPanelProps) {
  const hue = emailToHue(session.email)
  const displayName = getDisplayName(session)

  return (
    <div className="flex-1 flex flex-col bg-[#FAF7F0] min-w-0">

      {/* ── Header ── */}
      <div className="p-6 border-b border-[#D8D1C3] bg-[#FAF7F0]">
        <div className="flex items-center gap-4 mb-5">
          {/* Large avatar */}
          <div
            className="w-14 h-14 rounded-2xl border-2 border-white flex items-center justify-center font-retro-mono font-bold text-white text-2xl shadow-md flex-shrink-0"
            style={{ background: `hsl(${hue}, 60%, 45%)` }}
          >
            {displayName[0].toUpperCase()}
          </div>

          {/* Name + email */}
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  ref={nameInputRef}
                  value={nameInput}
                  onChange={e => onNameInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') onSaveName()
                    if (e.key === 'Escape') onCancelEdit()
                  }}
                  className="font-retro-sans text-base font-bold text-stone-900 bg-white border border-[#D97706] rounded-lg px-3 py-1 outline-none flex-1 shadow-xs"
                />
                <button
                  onClick={onSaveName}
                  className="retro-btn px-3 py-1 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white font-retro-mono text-xs font-bold shadow-xs"
                >
                  Save
                </button>
                <button
                  onClick={onCancelEdit}
                  className="retro-btn px-3 py-1 rounded-lg bg-[#FAF7F0] border border-[#D6CFC0] text-stone-700 font-retro-mono text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 cursor-pointer group"
                onClick={onStartEditName}
                title="Click to rename"
              >
                <h2 className="font-retro-sans text-lg font-bold text-stone-900 group-hover:text-[#D97706] transition-colors">
                  {displayName}
                </h2>
                <Pencil size={13} className="text-stone-400 group-hover:text-[#D97706] transition-colors" />
              </div>
            )}
            <p className="font-retro-mono text-xs text-stone-500 mt-1 flex items-center gap-2">
              <span>{session.email}</span>
              <span>•</span>
              <span>Added {relativeDate(session.addedAt)}</span>
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2">
          {(['info', 'gmail'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-xl font-retro-mono text-xs font-bold transition-all ${
                activeTab === tab
                  ? 'bg-white text-[#D97706] border-t-2 border-x border-[#D8D1C3] border-b-transparent -mb-[1px]'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-[#EBE5D5]/50'
              }`}
            >
              {tab === 'info' ? <User size={14} /> : <Mail size={14} />}
              {tab === 'info' ? 'Info' : 'Gmail Inbox'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'info' ? (
        <InfoTab
          session={session}
          loggingIn={loggingIn}
          isAgentAccount={isAgentAccount}
          onLogin={onLogin}
          onRemove={onRemove}
          onUseForAgent={onUseForAgent}
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
  isAgentAccount: boolean
  onLogin: () => void
  onRemove: () => void
  onUseForAgent: () => void
}

function InfoTab({ session, loggingIn, isAgentAccount, onLogin, onRemove, onUseForAgent }: InfoTabProps) {
  const isLoggingIn = loggingIn === session.email

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-b from-[#FAF7F0] to-[#F5F1E6]/40">

      {/* AI Agent account */}
      <section className="bg-white border border-[#E2DBD0] rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-retro-sans text-sm font-bold text-stone-900 flex items-center gap-2">
              <Bot size={16} className="text-[#7C3AED]" />
              AI Agent Account
            </h3>
            <p className="font-retro-mono text-xs text-stone-500 mt-1">
              Yeh account AI agent ke browser-worker tools (ChatGPT, Gemini, wagera) use karenge.
            </p>
          </div>
          {isAgentAccount ? (
            <span className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#EDE9FE] border border-[#C4B5FD] text-[#6D28D9] font-retro-mono text-xs font-bold flex-shrink-0">
              <CheckCircle2 size={13} />
              Currently Active
            </span>
          ) : (
            <button
              onClick={onUseForAgent}
              className="retro-btn flex items-center gap-2 px-4 py-2 rounded-xl bg-[#EDE9FE] border border-[#C4B5FD]/70 text-[#6D28D9] hover:bg-[#DDD6FE] font-retro-mono text-xs font-bold shadow-xs transition-all flex-shrink-0"
            >
              <Bot size={13} />
              Use for AI Agent
            </button>
          )}
        </div>
      </section>

      {/* Re-authenticate */}
      <section className="bg-white border border-[#E2DBD0] rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-retro-sans text-sm font-bold text-stone-900 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#10B981]" />
              Google Authentication Session
            </h3>
            <p className="font-retro-mono text-xs text-stone-500 mt-1">
              Session tab sab AI tools ke browser mein automatically share hoti hai.
            </p>
          </div>
          <button
            onClick={onLogin}
            disabled={isLoggingIn}
            className="retro-btn flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FEF3C7] border border-[#F59E0B]/50 text-[#B45309] hover:bg-[#FDE68A] font-retro-mono text-xs font-bold shadow-xs transition-all flex-shrink-0"
          >
            {isLoggingIn ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {isLoggingIn ? 'Opening…' : 'Re-authenticate'}
          </button>
        </div>
      </section>

      {/* Tab Color */}
      <ColorPickerSection email={session.email} currentColor={session.color} />

      {/* Danger zone */}
      <section className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-retro-sans text-sm font-bold text-[#DC2626] flex items-center gap-2">
              <AlertCircle size={16} />
              Remove Account
            </h3>
            <p className="font-retro-mono text-xs text-stone-600 mt-1">
              Saved session tokens aur custom tab preferences delete ho jayenge.
            </p>
          </div>
          <button
            onClick={onRemove}
            className="retro-btn flex items-center gap-2 px-4 py-2 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white border border-[#B91C1C] font-retro-mono text-xs font-bold shadow-xs transition-all flex-shrink-0"
          >
            <Trash2 size={13} />
            Remove Account
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
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-[#EBE5D5] transition-colors flex items-center justify-center"
    >
      {children}
    </button>
  )
}

function GmailTab({ gmailPanelRef, gmailLoading, session }: GmailTabProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Gmail toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#D8D1C3] bg-[#FAF7F0]">
        <GmailNavBtn onClick={() => window.electronAPI.viewGoBack()} title="Back">
          <ChevronLeft size={14} />
        </GmailNavBtn>
        <GmailNavBtn onClick={() => window.electronAPI.viewGoForward()} title="Forward">
          <ChevronRight size={14} />
        </GmailNavBtn>
        <GmailNavBtn onClick={() => window.electronAPI.viewReload()} title="Refresh">
          <RotateCw size={13} />
        </GmailNavBtn>
        <span className="font-retro-mono text-xs text-stone-600 font-medium ml-2">
          {session.email}
        </span>
      </div>

      {/* Gmail content area */}
      <div
        ref={gmailPanelRef}
        className="flex-1 bg-white relative"
      >
        {gmailLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <div className="text-center">
              <Loader2
                size={28}
                className="animate-spin text-[#D97706] mx-auto mb-3"
              />
              <p className="font-retro-mono text-xs text-stone-600">Gmail load ho raha hai…</p>
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

  const presets = ['#4F6EF7', '#059669', '#D97706', '#DC2626', '#7C3AED', '#DB2777']

  async function handleSave(value: string) {
    await window.electronAPI.gmailUpdateColor(email, value)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <section className="bg-white border border-[#E2DBD0] rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
      <h3 className="font-retro-sans text-sm font-bold text-stone-900 mb-1">
        Tab Accent Color
      </h3>
      <p className="font-retro-mono text-xs text-stone-500 mb-4">
        Yeh color AI Browser mein is Gmail ke saare tabs pe apply hoga.
      </p>

      <div className="flex items-center gap-3">
        <button
          onClick={() => colorInputRef.current?.click()}
          title="Pick color"
          className="w-10 h-10 rounded-xl border-2 border-white shadow-md cursor-pointer flex-shrink-0 hover:scale-105 transition-transform"
          style={{ background: hex }}
        />
        <input
          ref={colorInputRef}
          type="color"
          value={hex}
          onChange={e => setHex(e.target.value)}
          className="hidden"
        />
        <input
          type="text"
          value={hex}
          maxLength={7}
          onChange={e => setHex(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(hex) }}
          className="w-32 font-retro-mono text-xs text-stone-900 bg-[#FAF7F0] border border-[#D8D1C3] rounded-xl px-3 py-2 outline-none focus:border-[#D97706] shadow-xs"
        />
        <div className="flex items-center gap-1.5 ml-1">
          {presets.map(c => (
            <button
              key={c}
              onClick={() => { setHex(c); handleSave(c); }}
              className="w-6 h-6 rounded-full border border-white shadow-xs hover:scale-110 transition-transform cursor-pointer"
              style={{ background: c }}
            />
          ))}
        </div>
        <button
          onClick={() => handleSave(hex)}
          className={`retro-btn px-4 py-2 rounded-xl font-retro-mono text-xs font-bold transition-all ml-auto ${
            saved
              ? 'bg-[#D1FAE5] text-[#047857] border border-[#A7F3D0]'
              : 'bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] shadow-xs'
          }`}
        >
          {saved ? '✓ Saved' : 'Save Color'}
        </button>
      </div>
    </section>
  )
}

function EmptyDetail({ onAdd, adding }: { onAdd: () => void; adding: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-[#FAF7F0] to-[#F5F1E6]/50 text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-white border border-[#D8D1C3] shadow-md flex items-center justify-center">
        <User size={32} className="text-[#D97706]" />
      </div>
      <div>
        <h3 className="font-retro-sans text-base font-bold text-stone-900">
          Account Select Karo
        </h3>
        <p className="font-retro-mono text-xs text-stone-500 mt-1">
          Left sidebar se kisi account ko choose karo ya new Gmail add karo.
        </p>
      </div>
      <button
        onClick={onAdd}
        disabled={adding}
        className="retro-btn flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white font-retro-mono text-xs font-bold shadow-[2px_2px_0px_0px_rgba(180,83,9,0.3)] transition-all"
      >
        {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
        {adding ? 'Adding…' : 'Add Account'}
      </button>
    </div>
  )
}
