import { useState, useEffect } from 'react'
import { Mail, Plus, X, ChevronLeft, ChevronRight, RotateCcw, Trash2, Loader2 } from 'lucide-react'
import { getCompactTabTitle, getFaviconUrl, getInjectTool, getTabColor, isToolTab } from '@/types/browser'
import type { BrowserTab, CustomTool } from '@/types/browser'
import type { GmailSession } from '@/types/electron'
import ToolDock from '@/components/browser/ToolDock'
import AccountContextMenu from '@/components/browser/AccountContextMenu'
import NewSessionDialog from '@/components/browser/NewSessionDialog'
import CaptureDebugPanel from '@/components/browser/CaptureDebugPanel'
import { applyAccentForTool, resetAccent } from '@/lib/accentTheme'

interface AIBrowserProps {
  isActive: boolean
}

interface ContextMenuState {
  tab: BrowserTab
  x: number
  y: number
}

export default function AIBrowser({ isActive }: AIBrowserProps) {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [customTools, setCustomTools] = useState<CustomTool[]>([])
  const [gmailSessions, setGmailSessions] = useState<GmailSession[]>([])

  const [showAddSession, setShowAddSession] = useState(false)
  const [selectedToolId, setSelectedToolId] = useState<string>('')
  const [selectedGmailEmail, setSelectedGmailEmail] = useState<string>('')

  const [showManageTools, setShowManageTools] = useState(false)
  const [addToolName, setAddToolName] = useState('')
  const [addToolUrl, setAddToolUrl] = useState('')
  const [addToolError, setAddToolError] = useState('')

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [isReloading, setIsReloading] = useState(false)

  const activeTab = tabs.find(t => t.id === activeId) ?? null
  const activeTabDisplayTitle = activeTab ? getCompactTabTitle(activeTab, tabs) : null
  const anyOverlayOpen = showAddSession || showManageTools

  useEffect(() => {
    loadTools()
    loadSessions()
  }, [])

  async function loadTools() {
    const tools = await window.electronAPI.toolsList()
    setCustomTools(tools)
  }

  async function loadSessions() {
    const sessions = await window.electronAPI.gmailList()
    setGmailSessions(sessions)
  }

  useEffect(() => {
    if (!isActive || !activeTab || anyOverlayOpen) {
      window.electronAPI.hideView()
      return
    }
    window.electronAPI.switchView(activeTab.id, activeTab.gmail.partition, activeTab.url)
  }, [activeId, isActive, anyOverlayOpen])

  useEffect(() => {
    if (!isActive || !activeTab || !isToolTab(activeTab)) {
      resetAccent()
      return
    }
    const tool = getInjectTool(activeTab.url)
    applyAccentForTool(tool)
  }, [activeTab?.url, isActive])

  async function openAddSession(prefillToolId?: string) {
    const [tools, sessions] = await Promise.all([
      window.electronAPI.toolsList(),
      window.electronAPI.gmailList(),
    ])
    setCustomTools(tools)
    setGmailSessions(sessions)
    setSelectedToolId(prefillToolId ?? tools[0]?.id ?? '')
    setSelectedGmailEmail(activeTab?.gmail.email ?? sessions[0]?.email ?? '')
    setShowAddSession(true)
  }

  function closeAddSession() {
    setShowAddSession(false)
  }

  function handleAddSession() {
    const tool = customTools.find(t => t.id === selectedToolId)
    const gmail = gmailSessions.find(s => s.email === selectedGmailEmail)
    if (!tool || !gmail) return

    const existing = tabs.find(t => isToolTab(t) && t.tool.id === tool.id && t.gmail.email === gmail.email)
    if (existing) {
      setActiveId(existing.id)
      closeAddSession()
      return
    }

    const tab: BrowserTab = {
      id: `${tool.id}-${gmail.email}-${Date.now()}`,
      type: 'tool',
      tool,
      gmail,
      url: tool.url,
      title: tool.name,
    }
    setTabs(prev => [...prev, tab])
    setActiveId(tab.id)
    closeAddSession()
  }

  function handleOpenGmail(gmail: GmailSession) {
    const existing = tabs.find(t => t.type === 'gmail' && t.gmail.email === gmail.email)
    if (existing) {
      setActiveId(existing.id)
      return
    }
    const tab: BrowserTab = {
      id: `gmail-${gmail.email}`,
      type: 'gmail',
      gmail,
      url: 'https://mail.google.com',
      title: 'Gmail',
    }
    setTabs(prev => [...prev, tab])
    setActiveId(tab.id)
  }

  function handleCloseTab(tabId: string) {
    window.electronAPI.closeView(tabId)
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId)
      if (activeId === tabId) {
        const newActive = next[next.length - 1]?.id ?? null
        setActiveId(newActive)
        if (!newActive) window.electronAPI.hideView()
      }
      return next
    })
  }

  function handleSelectTab(tabId: string) {
    setActiveId(tabId)
  }

  function handleContextMenu(e: React.MouseEvent, tab: BrowserTab) {
    e.preventDefault()
    setCtxMenu({ tab, x: e.clientX, y: e.clientY })
  }

  function handleReloadTab(_tab?: BrowserTab) {
    if (isReloading) return
    setIsReloading(true)
    window.electronAPI.viewReload()
    setTimeout(() => setIsReloading(false), 1000)
  }

  async function handleClearSession(tab: BrowserTab) {
    window.electronAPI.closeView(tab.id)
    await window.electronAPI.clearPartitionStorage(tab.gmail.partition).catch(() => {})
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tab.id)
      if (activeId === tab.id) {
        const nextActive = next[next.length - 1]?.id ?? null
        setActiveId(nextActive)
        if (!nextActive) window.electronAPI.hideView()
      }
      return next
    })
  }

  function openManageTools() {
    setAddToolName('')
    setAddToolUrl('')
    setAddToolError('')
    setShowManageTools(true)
  }

  function closeManageTools() {
    setShowManageTools(false)
  }

  async function handleAddTool() {
    setAddToolError('')
    const name = addToolName.trim()
    let url = addToolUrl.trim()
    if (!name || !url) {
      setAddToolError('Name and URL are required')
      return
    }
    if (!url.startsWith('http')) url = 'https://' + url
    try {
      new URL(url)
    } catch {
      setAddToolError('Invalid URL')
      return
    }
    await window.electronAPI.toolsAdd(name, url)
    await loadTools()
    setAddToolName('')
    setAddToolUrl('')
  }

  async function handleRemoveTool(id: string) {
    const affectedTabs = tabs.filter(t => isToolTab(t) && t.tool.id === id)
    for (const t of affectedTabs) window.electronAPI.closeView(t.id)
    setTabs(prev => prev.filter(t => !isToolTab(t) || t.tool.id !== id))
    if (activeId && affectedTabs.some(t => t.id === activeId)) {
      setActiveId(null)
      window.electronAPI.hideView()
    }
    await window.electronAPI.toolsRemove(id)
    await loadTools()
  }

  return (
    <div className="flex h-full bg-[#FAF7F0] bg-dot-matrix">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Session Tabs Bar */}
        <div
          className="flex items-center gap-1 shrink-0 overflow-x-auto select-none"
          style={{
            height: '40px',
            padding: '0 10px',
            background: '#EBE5D5',
            borderBottom: '1px solid #D6CFC0',
          }}
        >
          {tabs.length === 0 ? (
            <span className="font-retro-mono text-xs font-semibold text-stone-500 px-2">
              // Open sessions appear here
            </span>
          ) : (
            tabs.map(tab => {
              const isActive = tab.id === activeId
              const colors = getTabColor(tab.gmail)
              const label = getCompactTabTitle(tab, tabs)
              return (
                <div
                  key={tab.id}
                  title={`${label} · ${tab.gmail.email}`}
                  className={`flex items-center gap-0 min-w-0 max-w-[160px] h-7 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-white border-[#D8D1C3] text-stone-900 shadow-2xs font-retro-mono font-bold'
                      : 'bg-[#FAF7F0]/80 border-transparent hover:border-[#D6CFC0] text-stone-700 font-retro-sans'
                  }`}
                >
                  <button
                    onClick={() => handleSelectTab(tab.id)}
                    className="flex items-center gap-2 min-w-0 flex-1 h-full px-2.5 bg-transparent border-none cursor-pointer"
                    aria-label={`${label} tab`}
                  >
                    {isToolTab(tab) ? (
                      <img
                        src={getFaviconUrl(tab.url)}
                        alt=""
                        className="w-3.5 h-3.5 object-contain shrink-0 rounded"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <Mail size={12} className="text-stone-500 shrink-0" />
                    )}
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: colors.dot,
                        boxShadow: isActive ? `0 0 6px ${colors.dot}` : 'none',
                      }}
                    />
                    <span className="text-xs truncate text-left">
                      {label}
                    </span>
                  </button>
                  <button
                    onClick={() => handleCloseTab(tab.id)}
                    aria-label={`Close ${label}`}
                    className="w-6 h-full flex items-center justify-center rounded-r-xl text-stone-400 hover:text-[#DC2626] hover:bg-[#FEE2E2] transition-colors"
                  >
                    <X size={11} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Retro Browser Address & Toolbar */}
        <div
          className="flex items-center shrink-0 font-retro-sans select-none"
          style={{
            height: '46px',
            background: '#EBE5D5',
            borderBottom: '1px solid #D6CFC0',
            padding: '0 14px',
            gap: '8px',
          }}
        >
          {/* Retro Window Dots */}
          <div className="flex items-center gap-1.5 mr-2 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
          </div>

          {/* Navigation Controls */}
          <button
            onClick={() => window.electronAPI.viewGoBack()}
            title="Go Back"
            disabled={!activeTab}
            className="retro-btn w-7 h-7 rounded-lg flex items-center justify-center bg-white border border-[#D8D1C3] text-stone-700 hover:bg-[#FAF7F0] disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-2xs"
          >
            <ChevronLeft size={13} strokeWidth={2.2} />
          </button>

          <button
            onClick={() => window.electronAPI.viewGoForward()}
            title="Go Forward"
            disabled={!activeTab}
            className="retro-btn w-7 h-7 rounded-lg flex items-center justify-center bg-white border border-[#D8D1C3] text-stone-700 hover:bg-[#FAF7F0] disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-2xs"
          >
            <ChevronRight size={13} strokeWidth={2.2} />
          </button>

          <button
            onClick={() => handleReloadTab(activeTab!)}
            title="Reload Page"
            disabled={!activeTab}
            className="retro-btn w-7 h-7 rounded-lg flex items-center justify-center bg-white border border-[#D8D1C3] hover:border-[#D97706] hover:bg-[#FEF3C7]/40 text-stone-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer shadow-2xs transition-all"
          >
            <RotateCcw
              size={13}
              strokeWidth={2.2}
              className={`transition-all ${isReloading ? 'animate-spin text-[#D97706]' : 'text-stone-700'}`}
            />
          </button>

          <div className="w-[1px] h-4 bg-[#C8C1B0] mx-1 shrink-0" />

          {/* Address Bar */}
          <div className="flex-1 flex items-center gap-2 bg-white border-2 border-[#D8D1C3] px-3 py-1 rounded-xl min-w-0 font-retro-mono text-xs text-stone-900 shadow-2xs">
            {activeTab ? (
              <>
                {isToolTab(activeTab) ? (
                  <img
                    src={getFaviconUrl(activeTab.url)}
                    alt=""
                    className="w-3.5 h-3.5 object-contain shrink-0 rounded"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <Mail size={13} className="text-stone-500 shrink-0" />
                )}
                <span className="truncate font-medium text-stone-900">
                  {activeTabDisplayTitle}
                </span>

                {isReloading ? (
                  <span className="font-retro-mono text-[10px] font-bold text-[#B45309] flex items-center gap-1.5 bg-[#FEF3C7] px-2 py-0.5 rounded-full border border-[#F59E0B]/50 animate-pulse ml-auto shrink-0">
                    <Loader2 size={10} className="animate-spin text-[#D97706]" />
                    <span>RELOADING…</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-stone-500 ml-auto shrink-0 font-mono">
                    [{activeTab.gmail.email}]
                  </span>
                )}
              </>
            ) : (
              <span className="text-stone-500 text-[11px] truncate">
                retro://ai-studio-launchpad
              </span>
            )}
          </div>
        </div>

        {/* Start Screen Launchpad */}
        {!activeTab ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden bg-dot-matrix">
            <div className="relative z-10 max-w-2xl w-full text-center space-y-7">
              {/* Retro Hero Header */}
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-400 font-retro-mono text-[10px] uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  [v1.0.0 :: LOCAL RETRO WORKSTATION]
                </div>
                <h1 className="font-retro-serif text-5xl font-normal text-tx leading-tight tracking-tight">
                  The Retro-AI Studio.
                </h1>
                <p className="font-retro-sans text-xs text-t2 max-w-md mx-auto">
                  Launch isolated AI model partitions with local session storage and instant memory handoffs.
                </p>
              </div>

              {/* Tool Cards Grid */}
              {customTools.length === 0 ? (
                <div className="p-8 rounded-2xl text-center space-y-3 bg-white border-2 border-[#281E14] shadow-[4px_4px_0px_0px_#281E14]">
                  <p className="font-retro-mono text-xs text-stone-700 font-semibold">No tools registered in your local library.</p>
                  <button
                    onClick={openManageTools}
                    className="retro-btn px-4 py-2 rounded-xl text-xs font-bold bg-[#D97706] hover:bg-[#B45309] text-white border-2 border-[#281E14] shadow-[2px_2px_0px_0px_#281E14] hover:shadow-[3px_3px_0px_0px_#281E14] transition-all inline-flex items-center gap-2 cursor-pointer font-retro-mono uppercase tracking-wider"
                  >
                    <Plus size={14} />
                    Setup Tools Library
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 text-left">
                  {customTools.map(tool => (
                    <button
                      key={tool.id}
                      onClick={() => openAddSession(tool.id)}
                      className="p-5 rounded-2xl flex flex-col justify-between h-36 group cursor-pointer relative bg-white border-2 border-[#281E14] shadow-[4px_4px_0px_0px_#281E14] hover:shadow-[7px_7px_0px_0px_#281E14] hover:-translate-y-1 transition-all duration-200 overflow-hidden select-none"
                    >
                      {/* Subtle Retro Texture Overlay */}
                      <div className="absolute inset-0 bg-dot-matrix opacity-40 pointer-events-none" />

                      {/* User's Creative Idea: 20% Opacity Background Watermark Logo */}
                      <div className="absolute -bottom-3 -right-3 w-28 h-28 pointer-events-none opacity-20 group-hover:opacity-30 group-hover:scale-110 transition-all duration-300 transform -rotate-12">
                        <img
                          src={getFaviconUrl(tool.url)}
                          alt=""
                          className="w-full h-full object-contain filter grayscale group-hover:grayscale-0 transition-all"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      </div>

                      {/* Card Header: 3D Favicon Icon + Retro Tag */}
                      <div className="flex items-center justify-between relative z-10">
                        <div className="w-10 h-10 rounded-xl bg-[#FAF7F0] border-2 border-[#281E14] shadow-[2px_2px_0px_0px_#281E14] flex items-center justify-center group-hover:bg-[#FEF3C7] group-hover:scale-105 transition-all">
                          <img
                            src={getFaviconUrl(tool.url)}
                            alt={tool.name}
                            className="w-5 h-5 object-contain rounded"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                        </div>

                        <span className="font-retro-mono text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-[#FEF3C7] border border-[#F59E0B]/50 text-[#B45309] shadow-2xs">
                          [{tool.name.toLowerCase()}]
                        </span>
                      </div>

                      {/* Card Body & Action Directive */}
                      <div className="relative z-10 mt-2">
                        <h3 className="font-retro-tech text-base font-extrabold text-[#281E14] group-hover:text-[#D97706] transition-colors uppercase tracking-tight flex items-center gap-1.5">
                          <span>{tool.name}</span>
                          <span className="text-xs text-[#D97706] opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                            &rarr;
                          </span>
                        </h3>
                        <p className="font-retro-mono text-[11px] text-stone-600 truncate mt-0.5">
                          {tool.url.replace(/^https?:\/\//, '')}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1" style={{ background: 'var(--surface)' }} />
        )}
      </div>

      {isActive && activeTab && isToolTab(activeTab) && (
        ['chatgpt', 'claude', 'gemini', 'grok'].includes(getInjectTool(activeTab.url) ?? '') ||
        activeTab.url.includes('perplexity.ai')
      ) && (
        <CaptureDebugPanel />
      )}

      <ToolDock
        tabs={tabs}
        activeId={activeId}
        customTools={customTools}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onAddSession={openAddSession}
        onOpenGmail={handleOpenGmail}
        onManageTools={openManageTools}
        onContextMenu={handleContextMenu}
      />

      {ctxMenu && (
        <AccountContextMenu
          tab={ctxMenu.tab}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onReload={handleReloadTab}
          onClearSession={handleClearSession}
          onRemove={t => handleCloseTab(t.id)}
        />
      )}

      <NewSessionDialog
        open={showAddSession}
        tools={customTools}
        gmailSessions={gmailSessions}
        tabs={tabs}
        selectedToolId={selectedToolId}
        selectedGmailEmail={selectedGmailEmail}
        onSelectTool={setSelectedToolId}
        onSelectGmail={setSelectedGmailEmail}
        onConfirm={handleAddSession}
        onClose={closeAddSession}
      />

      {showManageTools && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-stone-900/40 backdrop-blur-xs select-none"
          onClick={closeManageTools}
        >
          <div
            className="w-full max-w-[520px] rounded-3xl overflow-hidden shadow-[0_20px_60px_rgba(40,30,20,0.22)] bg-[#FAF7F0] border-2 border-[#D8D1C3] bg-dot-matrix animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#D6CFC0] bg-[#EBE5D5]">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
                </div>
                <div className="h-4 w-[1px] bg-[#C8C1B0]" />
                <h3 className="font-retro-mono text-xs font-bold text-stone-900 uppercase tracking-widest">
                  Tools &amp; Model Registry
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-retro-mono text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#FEF3C7] border border-[#F59E0B]/50 text-[#B45309]">
                  {customTools.length} Tools
                </span>
                <button
                  onClick={closeManageTools}
                  className="retro-btn font-retro-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-[#FEE2E2] border border-[#FCA5A5] text-[#DC2626] hover:bg-[#DC2626] hover:text-white transition-colors"
                >
                  [ ESC ]
                </button>
              </div>
            </div>

            <div className="p-6 flex flex-col gap-5">
              {/* Add New Tool Form */}
              <div className="flex flex-col gap-3 bg-white p-4 rounded-2xl border-2 border-[#D8D1C3] shadow-2xs">
                <div className="flex items-center justify-between">
                  <p className="font-retro-mono text-[10px] font-bold uppercase tracking-widest text-[#B45309]">
                    // Register Custom AI Service
                  </p>
                  <span className="font-retro-mono text-[9px] text-stone-500">
                    Auto-Favicon Enabled
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    className="sm:col-span-4 font-retro-mono text-xs rounded-xl px-3 py-2 bg-[#FAF7F0] border-2 border-[#D8D1C3] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#D97706] transition-colors"
                    placeholder="Tool Name"
                    value={addToolName}
                    onChange={e => setAddToolName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTool()}
                  />
                  <input
                    className="sm:col-span-8 font-retro-mono text-xs rounded-xl px-3 py-2 bg-[#FAF7F0] border-2 border-[#D8D1C3] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#D97706] transition-colors"
                    placeholder="URL (e.g. elevenlabs.io)"
                    value={addToolUrl}
                    onChange={e => setAddToolUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTool()}
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  {addToolError ? (
                    <p className="font-retro-mono text-xs text-[#DC2626] font-semibold">{addToolError}</p>
                  ) : (
                    <p className="font-retro-mono text-[10px] text-stone-500 italic">
                      Supports web apps, custom LLMs, or internal tools.
                    </p>
                  )}

                  <button
                    onClick={handleAddTool}
                    className="retro-btn px-4 py-2 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] font-retro-mono text-xs font-bold shadow-[1px_1px_0px_0px_rgba(180,83,9,0.3)] transition-all flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <Plus size={13} />
                    <span>Register Tool</span>
                  </button>
                </div>
              </div>

              {/* Custom Tools List */}
              <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-0.5">
                <p className="font-retro-mono text-[10px] font-bold uppercase tracking-widest text-stone-600 px-1">
                  Installed AI Tools Library ({customTools.length})
                </p>

                {customTools.length === 0 && (
                  <div className="p-8 text-center bg-white rounded-2xl border-2 border-dashed border-[#D8D1C3]">
                    <p className="font-retro-mono text-xs text-stone-500">
                      No custom tools registered yet — add your first tool above
                    </p>
                  </div>
                )}

                {customTools.map(tool => (
                  <div
                    key={tool.id}
                    className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-white border-2 border-[#D8D1C3] hover:border-[#D97706]/70 transition-all shadow-2xs group"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#FAF7F0] border border-[#D8D1C3] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <img
                        src={getFaviconUrl(tool.url)}
                        alt=""
                        className="w-4 h-4 object-contain"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-retro-sans text-xs font-bold text-stone-900 truncate">
                          {tool.name}
                        </p>
                        <span className="font-retro-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FAF7F0] border border-[#D8D1C3] text-stone-600 uppercase">
                          [{tool.name.toLowerCase()}]
                        </span>
                      </div>
                      <p className="font-retro-mono text-[10px] text-stone-500 truncate mt-0.5">
                        {tool.url}
                      </p>
                    </div>

                    <button
                      onClick={() => handleRemoveTool(tool.id)}
                      title="Remove Tool"
                      className="shrink-0 p-1.5 rounded-lg opacity-60 group-hover:opacity-100 transition-all text-stone-400 hover:text-[#DC2626] hover:bg-[#FEE2E2]"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
