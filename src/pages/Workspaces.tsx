import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Plus, X, Pencil, Trash2, Pause, Play, Bot, ShieldAlert, Check } from 'lucide-react'
import type { AgentActivity, WorkspaceInfo, WsApproval } from '@/types/electron'

/**
 * Workspaces: named browsers, each with its own logins (its own Electron
 * partition), tabs and any website. Agents open and drive their tabs through
 * the FlowDesk MCP tools (workspace_list, browser_open, browser_act…); the
 * panel on the right shows what the agent is doing, lets the user take over
 * (pause), and answers confirm-needed actions with Allow / Deny.
 *
 * The page itself is native: the slot below the address bar is covered by the
 * tab's WebContentsView, so nothing React draws may sit inside that slot.
 */

interface Props { isActive: boolean }

const api = window.electronAPI
const START = [
  { label: 'Gmail', url: 'https://mail.google.com/' },
  { label: 'Google', url: 'https://www.google.com/' },
  { label: 'YouTube', url: 'https://www.youtube.com/' },
  { label: 'TikTok', url: 'https://www.tiktok.com/' },
  { label: 'LinkedIn', url: 'https://www.linkedin.com/' },
  { label: 'Instagram', url: 'https://www.instagram.com/' },
  { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { label: 'WhatsApp', url: 'https://web.whatsapp.com/' },
]
const KIND_ICON: Record<AgentActivity['kind'], string> = { open: '↗', navigate: '→', snapshot: '◎', act: '●', approval: '?', close: '×', blocked: '⏸' }
const WORKING_MS = 8000

const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return url } }
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function Workspaces({ isActive }: Props) {
  const [list, setList] = useState<WorkspaceInfo[]>([])
  const [selected, setSelected] = useState<string>(() => localStorage.getItem('wsSelected') || '')
  const [logs, setLogs] = useState<Record<string, AgentActivity[]>>({})
  const [approval, setApproval] = useState<WsApproval | null>(null)
  const [address, setAddress] = useState('')
  const [editingAddress, setEditingAddress] = useState(false)
  const [newName, setNewName] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<Record<string, number>>({})
  const slotRef = useRef<HTMLDivElement>(null)

  const current = list.find(w => w.id === selected) ?? list[0] ?? null
  const activeTab = current?.tabs.find(t => t.id === current.activeTab) ?? null
  const log = current ? logs[current.id] ?? [] : []

  // ── Data and live events from the main process ───────────────────────
  useEffect(() => {
    void api.wsList().then(setList)
    const offChanged = api.onWsChanged(setList)
    const offActivity = api.onWsActivity(({ ws, entry }) => setLogs(prev => ({ ...prev, [ws]: [...(prev[ws] ?? []), entry].slice(-150) })))
    const offApproval = api.onWsApproval((event, done) => {
      if (done) { setApproval(a => (a?.id === event.id ? null : a)); return }
      setApproval(event)
      if (event.ws) setSelected(event.ws)
    })
    const offBusy = api.onWsBusy(({ ws, on }) => setBusy(prev => ({ ...prev, [ws]: Math.max(0, (prev[ws] ?? 0) + (on ? 1 : -1)) })))
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { offChanged(); offActivity(); offApproval(); offBusy(); clearInterval(tick) }
  }, [])

  useEffect(() => { if (current) localStorage.setItem('wsSelected', current.id) }, [current?.id])

  useEffect(() => {
    if (!current || logs[current.id]) return
    void api.wsActivity(current.id).then(r => { if (r.ok) setLogs(prev => ({ ...prev, [current.id]: r.result })) })
  }, [current?.id])

  useEffect(() => { if (!editingAddress) setAddress(activeTab?.url === 'about:blank' ? '' : activeTab?.url ?? '') }, [activeTab?.url, editingAddress])

  // ── The native tab view: shown in the slot, hidden otherwise ─────────
  const applyBounds = useCallback(() => {
    const el = slotRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    void api.setCustomBounds(Math.round(r.left), Math.round(r.top), Math.max(Math.round(r.width), 100), Math.max(Math.round(r.height), 100))
  }, [])

  useEffect(() => {
    if (!isActive || !current || !activeTab) { void api.hideView(); return }
    void api.wsShow(current.id, activeTab.id).then(r => {
      if (r.ok) applyBounds()
      else setError(r.error)
    })
  }, [isActive, current?.id, activeTab?.id, applyBounds])

  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el || !isActive) return
    const ro = new ResizeObserver(() => applyBounds())
    ro.observe(el)
    window.addEventListener('nav-resize', applyBounds)
    return () => { ro.disconnect(); window.removeEventListener('nav-resize', applyBounds) }
  }, [isActive, applyBounds, !!activeTab])

  useEffect(() => () => { void api.hideView() }, [])

  // ── Actions ───────────────────────────────────────────────────────────
  const run = async <T,>(p: Promise<{ ok: true; result: T } | { ok: false; error: string }>): Promise<T | undefined> => {
    const r = await p
    if (!r.ok) { setError(r.error); return undefined }
    setError('')
    return r.result
  }

  async function createWorkspace() {
    const name = (newName ?? '').trim()
    if (!name) { setNewName(null); return }
    const ws = await run(api.wsCreate(name))
    if (ws) { setSelected(ws.id); setNewName(null) }
  }

  async function removeWorkspace(ws: WorkspaceInfo) {
    if (!window.confirm(`Delete workspace "${ws.name}" and close its ${ws.tabs.length} tab(s)?`)) return
    const wipe = window.confirm(`Also sign "${ws.name}" out everywhere (delete its saved logins and cookies)?\n\nOK = delete logins too · Cancel = keep them on disk`)
    await run(api.wsRemove(ws.id, wipe))
  }

  const openTab = (url: string) => { if (current) void run(api.wsOpenTab(current.id, url)) }

  function submitAddress() {
    setEditingAddress(false)
    if (!current || !address.trim()) return
    if (!activeTab) { openTab(address); return }
    void run(api.wsNavigate(current.id, activeTab.id, address))
  }

  /** Busy now, or did something in the last few seconds — shown on every workspace chip, not only the open one. */
  const isWorking = (id: string) => {
    const l = logs[id]
    const last = l?.length ? Date.parse(l[l.length - 1].at) : 0
    return (busy[id] ?? 0) > 0 || now - last < WORKING_MS
  }
  const working = !!current && !current.paused && isWorking(current.id)
  const pendingHere = approval && (!approval.ws || approval.ws === current?.id) ? approval : null
  const reversedLog = useMemo(() => [...log].reverse(), [log])

  return (
    <div className="flex h-full w-full bg-[#FAF7F0]">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Workspace bar */}
        <div className="flex items-center gap-1.5 h-10 px-2 border-b border-[#D6CFC0] bg-[#EBE5D5] overflow-x-auto shrink-0">
          {list.map(ws => {
            const on = ws.id === current?.id
            if (renaming === ws.id) {
              return (
                <input key={ws.id} autoFocus defaultValue={ws.name} className="font-retro-mono text-xs px-2 py-1 rounded-lg border-2 border-[#F59E0B] bg-white w-36"
                  onBlur={e => { void run(api.wsRename(ws.id, e.currentTarget.value)); setRenaming(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} />
              )
            }
            return (
              <div key={ws.id} className={`group flex items-center gap-1.5 shrink-0 rounded-lg px-2.5 py-1 cursor-pointer select-none font-retro-mono text-xs ${on ? 'bg-[#FEF3C7] border-2 border-[#F59E0B] text-[#B45309] font-bold' : 'border border-transparent text-stone-700 hover:bg-[#FAF7F0]'}`}
                onClick={() => setSelected(ws.id)} onDoubleClick={() => setRenaming(ws.id)} title={`${ws.name} — own logins (${ws.partition})`}>
                <span className="w-2 h-2 rounded-full" style={{ background: ws.color }} />
                <span className="max-w-[140px] truncate">{ws.name}</span>
                {ws.paused && <Pause size={11} className="text-[#DC2626]" />}
                {!ws.paused && isWorking(ws.id) && <span title="Agent is working here" className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />}
                <span className="text-[10px] text-stone-500">{ws.tabs.length}</span>
                {on && (
                  <>
                    <button title="Rename" className="opacity-60 hover:opacity-100" onClick={e => { e.stopPropagation(); setRenaming(ws.id) }}><Pencil size={11} /></button>
                    <button title="Delete workspace" className="opacity-60 hover:opacity-100 hover:text-[#DC2626]" onClick={e => { e.stopPropagation(); void removeWorkspace(ws) }}><Trash2 size={11} /></button>
                  </>
                )}
              </div>
            )
          })}
          {newName != null ? (
            <input autoFocus value={newName} placeholder="Workspace name, e.g. TikTok 2" className="font-retro-mono text-xs px-2 py-1 rounded-lg border-2 border-[#F59E0B] bg-white w-52"
              onChange={e => setNewName(e.target.value)} onBlur={() => void createWorkspace()}
              onKeyDown={e => { if (e.key === 'Enter') void createWorkspace(); if (e.key === 'Escape') setNewName(null) }} />
          ) : (
            <button className="flex items-center gap-1 shrink-0 font-retro-mono text-xs text-stone-700 hover:text-[#B45309] px-2 py-1 rounded-lg hover:bg-[#FAF7F0]" onClick={() => setNewName('')}>
              <Plus size={13} /> New workspace
            </button>
          )}
        </div>

        {current && (
          <>
            {/* Tabs */}
            <div className="flex items-end gap-1 h-[34px] px-2 pt-1 border-b border-[#D6CFC0] bg-[#F3EEE2] overflow-x-auto shrink-0">
              {current.tabs.map(t => {
                const on = t.id === current.activeTab
                return (
                  <div key={t.id} onClick={() => void run(api.wsShow(current.id, t.id))} title={t.url}
                    className={`group flex items-center gap-1.5 shrink-0 max-w-[200px] h-full px-2.5 rounded-t-lg cursor-pointer font-retro-sans text-xs ${on ? 'bg-[#FAF7F0] border border-b-0 border-[#D6CFC0] text-stone-900' : 'text-stone-600 hover:bg-[#FAF7F0]/60'}`}>
                    <span className="truncate">{t.title || hostOf(t.url) || 'New tab'}</span>
                    <button className="opacity-50 hover:opacity-100" title="Close tab" onClick={e => { e.stopPropagation(); void run(api.wsCloseTab(current.id, t.id)) }}><X size={11} /></button>
                  </div>
                )
              })}
              <button className="h-full px-2 text-stone-600 hover:text-[#B45309]" title="New tab" onClick={() => openTab('https://www.google.com/')}><Plus size={14} /></button>
            </div>

            {/* Address bar */}
            <div className="flex items-center gap-1.5 h-10 px-2 border-b border-[#D6CFC0] bg-[#FAF7F0] shrink-0">
              <button className="p-1 rounded hover:bg-[#EBE5D5] text-stone-700 disabled:opacity-30" disabled={!activeTab} title="Back" onClick={() => void api.viewGoBack()}><ArrowLeft size={15} /></button>
              <button className="p-1 rounded hover:bg-[#EBE5D5] text-stone-700 disabled:opacity-30" disabled={!activeTab} title="Forward" onClick={() => void api.viewGoForward()}><ArrowRight size={15} /></button>
              <button className="p-1 rounded hover:bg-[#EBE5D5] text-stone-700 disabled:opacity-30" disabled={!activeTab} title="Reload" onClick={() => void api.viewReload()}><RotateCw size={14} /></button>
              <input value={address} placeholder="Search or type a website (gmail.com)" spellCheck={false}
                className="flex-1 min-w-0 font-retro-mono text-xs px-3 py-1.5 rounded-lg border border-[#D6CFC0] bg-white focus:outline-none focus:border-[#F59E0B]"
                onFocus={e => { setEditingAddress(true); e.currentTarget.select() }} onBlur={() => setEditingAddress(false)}
                onChange={e => setAddress(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitAddress(); if (e.key === 'Escape') e.currentTarget.blur() }} />
            </div>
          </>
        )}

        {error && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#FEE2E2] text-[#B91C1C] font-retro-mono text-[11px] shrink-0">
            <span className="truncate">{error}</span>
            <button onClick={() => setError('')}><X size={12} /></button>
          </div>
        )}

        {/* The tab's native view sits exactly over this slot. */}
        <div ref={slotRef} className="flex-1 min-h-0 relative">
          {!current && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <p className="font-retro-mono text-sm font-bold text-stone-900">No workspace yet</p>
              <p className="font-retro-sans text-xs text-stone-600 max-w-md">A workspace is a browser with its own logins. Make one for each account — "Work", "TikTok 2" — sign in once, it stays signed in.</p>
              <button className="font-retro-mono text-xs font-bold text-white bg-[#D97706] hover:bg-[#B45309] rounded-xl px-4 py-2" onClick={() => setNewName('')}>Create a workspace</button>
            </div>
          )}
          {current && !activeTab && (
            <div className="h-full flex flex-col items-center justify-center gap-4 px-6">
              <p className="font-retro-mono text-sm font-bold text-stone-900">{current.name}</p>
              <p className="font-retro-sans text-xs text-stone-600">Open a site and sign in — the login is saved in this workspace only.</p>
              <div className="grid grid-cols-4 gap-2">
                {START.map(s => (
                  <button key={s.url} className="font-retro-mono text-xs px-4 py-3 rounded-xl border border-[#D6CFC0] bg-white hover:border-[#F59E0B] hover:-translate-y-0.5 transition-all" onClick={() => openTab(s.url)}>{s.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agent panel */}
      <aside className="w-[290px] shrink-0 flex flex-col border-l border-[#D6CFC0] bg-[#F3EEE2]">
        <div className="flex items-center gap-2 px-3 h-10 border-b border-[#D6CFC0] shrink-0">
          <Bot size={15} className="text-[#D97706]" />
          <span className="font-retro-mono text-xs font-bold text-stone-900 uppercase tracking-wider">Agent</span>
          <span className={`ml-auto flex items-center gap-1.5 font-retro-mono text-[10.5px] ${current?.paused ? 'text-[#DC2626]' : pendingHere ? 'text-[#B45309]' : working ? 'text-[#16A34A]' : 'text-stone-500'}`}>
            <span className={`w-2 h-2 rounded-full ${current?.paused ? 'bg-[#DC2626]' : pendingHere ? 'bg-[#F59E0B] animate-pulse' : working ? 'bg-[#16A34A] animate-pulse' : 'bg-stone-400'}`} />
            {current?.paused ? 'you have control' : pendingHere ? 'waiting for you' : working ? 'working' : 'idle'}
          </span>
        </div>

        {current && (
          <div className="px-3 py-2 border-b border-[#D6CFC0] shrink-0">
            <button className={`w-full flex items-center justify-center gap-1.5 font-retro-mono text-xs font-bold rounded-xl px-3 py-2 ${current.paused ? 'bg-[#16A34A] hover:bg-[#15803D] text-white' : 'bg-white border border-[#D6CFC0] hover:border-[#DC2626] text-stone-800'}`}
              onClick={() => void run(api.wsSetPaused(current.id, !current.paused))}>
              {current.paused ? <><Play size={12} /> Give back to agent</> : <><Pause size={12} /> Pause — I'll take over</>}
            </button>
            <p className="mt-1.5 font-retro-sans text-[10.5px] text-stone-500 leading-snug">
              Agents reach this workspace as <span className="font-retro-mono">"{current.name}"</span> (workspace_list, browser_open). The orange box shows where it is about to click.
            </p>
          </div>
        )}

        {pendingHere && (
          <div className="m-3 p-3 rounded-xl border-2 border-[#F59E0B] bg-[#FEF3C7] shrink-0">
            <div className="flex items-center gap-1.5 font-retro-mono text-xs font-bold text-[#B45309]"><ShieldAlert size={14} /> Agent asks to</div>
            <p className="mt-1 font-retro-sans text-sm text-stone-900 break-words">{pendingHere.what}</p>
            <p className="mt-1 font-retro-sans text-[11px] text-stone-600">This can send, post, pay or delete something. Allow only if you meant it. No answer in 2 minutes counts as Deny.</p>
            <div className="mt-2.5 flex gap-2">
              <button className="flex-1 flex items-center justify-center gap-1 font-retro-mono text-xs font-bold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-lg py-1.5"
                onClick={() => { void api.wsAnswerApproval(pendingHere.id, true); setApproval(null) }}><Check size={12} /> Allow</button>
              <button className="flex-1 font-retro-mono text-xs font-bold text-stone-800 bg-white border border-[#D6CFC0] hover:border-[#DC2626] rounded-lg py-1.5"
                onClick={() => { void api.wsAnswerApproval(pendingHere.id, false); setApproval(null) }}>Deny</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {reversedLog.length === 0 && <p className="font-retro-sans text-[11px] text-stone-500 mt-2">Nothing yet. When an agent opens, reads or clicks here, each step shows up in this list.</p>}
          {reversedLog.map((a, i) => (
            <div key={`${a.at}-${i}`} className="flex gap-2 py-1.5 border-b border-[#E5DFD0] last:border-0">
              <span className={`w-4 text-center font-retro-mono text-xs ${a.ok ? 'text-[#D97706]' : 'text-[#DC2626]'}`}>{KIND_ICON[a.kind]}</span>
              <div className="min-w-0 flex-1">
                <p className={`font-retro-sans text-[11.5px] leading-snug break-words ${a.ok ? 'text-stone-800' : 'text-[#B91C1C]'}`}>{a.text}</p>
                <p className="font-retro-mono text-[9.5px] text-stone-500">{timeOf(a.at)} · {a.view.split('-').pop()}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
