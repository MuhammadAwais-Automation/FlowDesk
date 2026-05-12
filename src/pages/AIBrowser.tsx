import { useState, useEffect } from 'react'
import { Mail, Plus, X, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { getCompactTabTitle, getFaviconUrl, getInjectTool, getTabColor, isToolTab } from '@/types/browser'
import type { BrowserTab, CustomTool } from '@/types/browser'
import type { GmailSession } from '@/types/electron'
import PromptBar from '@/components/browser/PromptBar'
import ToolDock from '@/components/browser/ToolDock'
import AccountContextMenu from '@/components/browser/AccountContextMenu'
import NewSessionDialog from '@/components/browser/NewSessionDialog'
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

  function handleReloadTab(_tab: BrowserTab) {
    window.electronAPI.viewReload()
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
    <div className="flex h-full" style={{ background: 'var(--bg)' }}>
      <div className="flex flex-col flex-1 min-w-0">
        <div
          className="flex items-center gap-1 shrink-0 overflow-x-auto"
          style={{
            height: '40px',
            padding: '0 8px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {tabs.length === 0 ? (
            <span style={{ fontSize: '11px', color: 'var(--text-3)', paddingLeft: '4px' }}>
              Open sessions appear here
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
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0',
                    minWidth: '0',
                    maxWidth: '156px',
                    height: '28px',
                    borderRadius: '8px',
                    border: `1px solid ${isActive ? colors.border : 'var(--border)'}`,
                    background: isActive ? colors.bg : 'var(--surface-2)',
                    flexShrink: 0,
                  }}
                >
                  <button
                    onClick={() => handleSelectTab(tab.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      minWidth: 0,
                      flex: 1,
                      height: '100%',
                      padding: '0 8px 0 9px',
                      border: 'none',
                      background: 'transparent',
                      color: isActive ? 'var(--text)' : 'var(--text-2)',
                      cursor: 'pointer',
                      borderTopLeftRadius: '8px',
                      borderBottomLeftRadius: '8px',
                    }}
                    aria-label={`${label} tab`}
                  >
                    {isToolTab(tab) ? (
                      <img
                        src={getFaviconUrl(tab.url)}
                        alt=""
                        style={{ width: '13px', height: '13px', borderRadius: '3px', flexShrink: 0, objectFit: 'contain' }}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <Mail size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                    )}
                    <div
                      style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: colors.dot,
                        boxShadow: isActive ? `0 0 6px ${colors.dot}` : 'none',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                    }}>
                      {label}
                    </span>
                  </button>
                  <button
                    onClick={() => handleCloseTab(tab.id)}
                    aria-label={`Close ${label}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '100%',
                      borderRadius: '5px',
                      color: 'var(--text-3)',
                      flexShrink: 0,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div
          className="flex items-center shrink-0"
          style={{
            height: '44px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            padding: '0 12px',
            gap: '6px',
          }}
        >
          {[
            { icon: ChevronLeft, title: 'Back', onClick: () => window.electronAPI.viewGoBack() },
            { icon: ChevronRight, title: 'Forward', onClick: () => window.electronAPI.viewGoForward() },
            { icon: RotateCcw, title: 'Reload', onClick: () => window.electronAPI.viewReload() },
          ].map(({ icon: Icon, title, onClick }) => (
            <button
              key={title}
              onClick={onClick}
              title={title}
              disabled={!activeTab}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', borderRadius: '7px',
                background: 'transparent', border: 'none',
                cursor: activeTab ? 'pointer' : 'not-allowed',
                color: 'var(--text-3)',
                opacity: activeTab ? 1 : 0.4,
                transition: 'all 0.12s',
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                if (!activeTab) return
                ;(e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
              }}
            >
              <Icon size={14} strokeWidth={2} />
            </button>
          ))}

          <div style={{ width: '1px', height: '18px', background: 'var(--border)', margin: '0 4px' }} />

          {activeTab ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              {isToolTab(activeTab) ? (
                <img
                  src={getFaviconUrl(activeTab.url)}
                  alt=""
                  style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, objectFit: 'contain' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <Mail size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
              )}
              <span style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
              }}>
                {activeTabDisplayTitle}
              </span>
              <div style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                background: activeTab.gmail.color ?? '#6B7280',
                flexShrink: 0,
              }} />
            </div>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>
              Select a session from the right or open a new one
            </span>
          )}
        </div>

        <PromptBar activeTab={activeTab} isActive={isActive} />

        {!activeTab ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', fontFamily: 'Outfit, sans-serif', marginBottom: '4px' }}>
                AI Browser
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                {customTools.length === 0
                  ? 'Pehle tools library mein koi tool add karo'
                  : 'Right panel se naya session ya Gmail tab khol kar shuru karo'}
              </p>
            </div>

            {customTools.length === 0 ? (
              <button
                onClick={openManageTools}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '11px 18px', borderRadius: '11px', cursor: 'pointer',
                  background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
                  color: 'var(--accent)', fontSize: '12px', fontWeight: 600,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--accent)'
                  ;(e.currentTarget as HTMLElement).style.color = 'white'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
                }}
              >
                <Plus size={14} />
                Tools Library Setup Karo
              </button>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
                gap: '8px', width: '100%', maxWidth: '320px',
              }}>
                {customTools.slice(0, 6).map(tool => (
                  <button
                    key={tool.id}
                    onClick={() => openAddSession(tool.id)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px',
                      padding: '13px 10px', borderRadius: '11px', cursor: 'pointer',
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      ;(e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
                    }}
                    onMouseLeave={e => {
                      ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                      ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                    }}
                  >
                    <img
                      src={getFaviconUrl(tool.url)}
                      alt=""
                      style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                    <span style={{ fontSize: '10px', fontWeight: 500, color: 'var(--text-2)', textAlign: 'center', lineHeight: 1.2 }}>
                      {tool.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1" style={{ background: 'var(--surface)' }} />
        )}
      </div>

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
          className="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black/40 backdrop-blur-sm"
          onClick={closeManageTools}
        >
          <div
            className="w-full max-w-[400px] rounded-2xl overflow-hidden shadow-2xl bg-surface border border-border"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-semibold text-base font-display text-tx">Tools Library</h3>
              <button onClick={closeManageTools} className="p-1.5 rounded-lg transition-colors text-t3 hover:text-tx hover:bg-s2">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-t3">Add New Tool</p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 text-xs rounded-lg px-3 py-2 bg-s2 border border-border text-tx focus:outline-none focus:border-accent transition-colors"
                    placeholder="Name"
                    value={addToolName}
                    onChange={e => setAddToolName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTool()}
                  />
                  <input
                    className="flex-[2] text-xs rounded-lg px-3 py-2 bg-s2 border border-border text-tx focus:outline-none focus:border-accent transition-colors"
                    placeholder="URL (e.g. elevenlabs.io)"
                    value={addToolUrl}
                    onChange={e => setAddToolUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTool()}
                  />
                  <button
                    onClick={handleAddTool}
                    className="flex-shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-h transition-colors flex items-center justify-center"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {addToolError && <p className="text-[11px] text-red-500">{addToolError}</p>}
              </div>

              <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
                {customTools.length === 0 && (
                  <p className="text-xs text-center py-6 text-t3">No tools yet - add your first one above</p>
                )}
                {customTools.map(tool => (
                  <div
                    key={tool.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-s2 border border-border group"
                  >
                    <img
                      src={getFaviconUrl(tool.url)}
                      alt=""
                      style={{ width: '15px', height: '15px', objectFit: 'contain', flexShrink: 0 }}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-tx truncate">{tool.name}</p>
                      <p className="text-[10px] text-t3 truncate">{tool.url}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveTool(tool.id)}
                      className="flex-shrink-0 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all text-t3 hover:text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 size={12} />
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
