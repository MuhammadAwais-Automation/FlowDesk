import { useMemo, useState, useEffect } from 'react'
import {
  ChevronDown, ChevronRight, Mail, Plus, Settings, X,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react'
import { getFaviconUrl, isToolTab } from '@/types/browser'
import type { BrowserTab, CustomTool } from '@/types/browser'
import type { GmailSession } from '@/types/electron'
import { useDockExpanded } from '@/hooks/useDockExpanded'

interface Props {
  tabs:          BrowserTab[]
  activeId:      string | null
  customTools:   CustomTool[]
  onSelectTab:   (tabId: string) => void
  onCloseTab:    (tabId: string) => void
  onAddSession:  (toolId?: string) => void
  onOpenGmail:   (gmail: GmailSession) => void
  onManageTools: () => void
  onContextMenu?: (e: React.MouseEvent, tab: BrowserTab) => void
}

export default function ToolDock({
  tabs, activeId, customTools,
  onSelectTab, onCloseTab, onAddSession, onOpenGmail, onManageTools, onContextMenu,
}: Props) {
  const { isExpanded, toggle } = useDockExpanded()
  const [hoverTabId, setHoverTabId] = useState<string | null>(null)
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('aiToolDockCollapsed') === 'true'
  })

  useEffect(() => {
    window.electronAPI?.viewSetDockWidth?.(dockCollapsed ? 52 : 230)
  }, [dockCollapsed])

  function toggleDockCollapse() {
    setDockCollapsed(prev => {
      const next = !prev
      localStorage.setItem('aiToolDockCollapsed', String(next))
      return next
    })
  }

  const tabsByTool = useMemo(() => {
    const m = new Map<string, BrowserTab[]>()
    for (const t of tabs) {
      if (!isToolTab(t)) continue
      const list = m.get(t.tool.id) ?? []
      list.push(t)
      m.set(t.tool.id, list)
    }
    return m
  }, [tabs])

  return (
    <div
      className="flex flex-col shrink-0 bg-[#EBE5D5] border-l border-[#D6CFC0] relative transition-all duration-200 select-none overflow-hidden"
      style={{ width: dockCollapsed ? '52px' : '230px' }}
    >
      {/* Dock Panel Header */}
      <div className={`flex items-center h-11 border-b border-[#D6CFC0] bg-[#EBE5D5] shrink-0 ${
        dockCollapsed ? 'justify-center px-1' : 'justify-between px-3'
      }`}>
        {!dockCollapsed ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 mr-1">
                <span className="w-2 h-2 rounded-full bg-[#FF5F56]" />
                <span className="w-2 h-2 rounded-full bg-[#FFBD2E]" />
                <span className="w-2 h-2 rounded-full bg-[#27C93F]" />
              </div>
              <span className="font-retro-mono text-xs font-bold text-stone-800 uppercase tracking-wider">
                AI Accounts
              </span>
            </div>

            <button
              onClick={toggleDockCollapse}
              title="Collapse Dock Panel"
              className="p-1.5 rounded-lg hover:bg-[#FAF7F0] text-stone-600 hover:text-stone-900 transition-colors border border-transparent hover:border-[#D6CFC0] cursor-pointer"
            >
              <PanelLeftClose size={14} />
            </button>
          </>
        ) : (
          <button
            onClick={toggleDockCollapse}
            title="Expand Dock Panel"
            className="w-8 h-8 rounded-xl bg-white border border-[#D8D1C3] hover:border-[#D97706] hover:bg-[#FEF3C7] text-stone-700 hover:text-[#B45309] flex items-center justify-center transition-all shadow-2xs cursor-pointer"
          >
            <PanelLeftOpen size={14} />
          </button>
        )}
      </div>

      {/* Main Tool Content List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-[#FAF7F0] bg-dot-matrix">
        {customTools.length === 0 && (
          <div className="p-4 text-center text-stone-500 font-retro-mono text-xs">
            No tools yet — click <strong className="text-stone-800">Manage Tools</strong> below.
          </div>
        )}

        {customTools.map(tool => {
          const toolTabs = tabsByTool.get(tool.id) ?? []
          const expanded = isExpanded(tool.id, toolTabs.length > 0)
          const Chevron = expanded ? ChevronDown : ChevronRight

          if (dockCollapsed) {
            // ── Collapsed Slim Icon View ──
            return (
              <div key={tool.id} className="relative group flex justify-center py-1">
                <button
                  onClick={() => {
                    if (toolTabs.length > 0) {
                      onSelectTab(toolTabs[0].id)
                    } else {
                      onAddSession(tool.id)
                    }
                  }}
                  title={`${tool.name} (${toolTabs.length} sessions)`}
                  className="relative p-2 rounded-xl bg-white border border-[#D8D1C3] hover:border-[#D97706] hover:bg-[#FEF3C7]/40 transition-all shadow-2xs cursor-pointer"
                >
                  <img
                    src={getFaviconUrl(tool.url)}
                    alt={tool.name}
                    className="w-5 h-5 object-contain rounded"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />

                  {toolTabs.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#D97706] text-white font-retro-mono text-[9px] font-bold flex items-center justify-center shadow-xs border border-white">
                      {toolTabs.length}
                    </span>
                  )}
                </button>
              </div>
            )
          }

          // ── Expanded Full Accordion View ──
          return (
            <div key={tool.id} className="rounded-xl border border-[#D8D1C3] bg-white overflow-hidden shadow-2xs">
              <button
                onClick={() => toggle(tool.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left bg-white hover:bg-[#FAF7F0] transition-colors"
              >
                <Chevron size={12} className="text-stone-500 shrink-0" />
                <img
                  src={getFaviconUrl(tool.url)}
                  alt=""
                  className="w-4 h-4 rounded object-contain shrink-0"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
                <span className="flex-1 font-retro-mono text-xs font-bold text-stone-800 truncate">
                  {tool.name}
                </span>
                <span className="font-retro-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBE5D5] border border-[#D6CFC0] text-stone-700 shrink-0">
                  {toolTabs.length}
                </span>
              </button>

              {expanded && (
                <div className="p-2.5 pt-2.5 space-y-2 border-t border-[#D6CFC0] bg-[#FAF7F0]">
                  {toolTabs.map(tab => {
                    const isActive = tab.id === activeId
                    const color    = tab.gmail.color ?? '#D97706'
                    const isHover  = hoverTabId === tab.id

                    return (
                      <div
                        key={tab.id}
                        onClick={() => onSelectTab(tab.id)}
                        onContextMenu={e => onContextMenu?.(e, tab)}
                        onMouseEnter={() => setHoverTabId(tab.id)}
                        onMouseLeave={() => setHoverTabId(null)}
                        title={tab.gmail.email}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer border transition-all ${
                          isActive
                            ? 'bg-[#FEF3C7] border-[#F59E0B] text-[#B45309] font-retro-mono font-bold shadow-2xs'
                            : 'bg-white border-[#E2DBD0] hover:border-[#D97706]/40 text-stone-700 font-retro-sans text-xs'
                        }`}
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: color,
                            boxShadow: isActive ? `0 0 6px ${color}` : 'none',
                          }}
                        />
                        <span className="flex-1 truncate text-xs">
                          {tab.gmail.email}
                        </span>

                        <button
                          onClick={e => { e.stopPropagation(); onOpenGmail(tab.gmail) }}
                          aria-label="Open Gmail tab"
                          title="Open Gmail in new tab"
                          className={`p-1 rounded hover:bg-[#D97706]/20 text-stone-500 hover:text-[#D97706] transition-colors ${
                            isHover || isActive ? 'flex' : 'hidden'
                          }`}
                        >
                          <Mail size={12} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onCloseTab(tab.id) }}
                          aria-label="Close session"
                          className={`p-1 rounded hover:bg-[#FEE2E2] text-stone-500 hover:text-[#DC2626] transition-colors ${
                            isHover || isActive ? 'flex' : 'hidden'
                          }`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}

                  <button
                    onClick={() => onAddSession(tool.id)}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border-2 border-dashed border-[#D8D1C3] hover:border-[#D97706] bg-white hover:bg-[#FEF3C7]/50 text-stone-700 hover:text-[#B45309] font-retro-mono text-[11px] font-bold transition-all shadow-2xs my-0.5"
                  >
                    <Plus size={12} />
                    <span>Add account</span>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Dock Footer Controls */}
      <div className="shrink-0 p-2 border-t border-[#D6CFC0] bg-[#EBE5D5] flex flex-col gap-1.5">
        {!dockCollapsed ? (
          <>
            <button
              onClick={() => onAddSession()}
              className="retro-btn flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] font-retro-mono text-xs font-bold shadow-[1px_1px_0px_0px_rgba(180,83,9,0.3)] transition-all"
            >
              <Plus size={13} />
              <span>New Session</span>
            </button>

            <button
              onClick={onManageTools}
              className="flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-xl bg-white hover:bg-[#FAF7F0] border border-[#D8D1C3] text-stone-700 font-retro-mono text-xs font-bold transition-all"
            >
              <Settings size={12} />
              <span>Manage Tools</span>
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => onAddSession()}
              title="New Session"
              className="retro-btn p-2 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] shadow-2xs transition-all"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={onManageTools}
              title="Manage Tools"
              className="p-2 rounded-xl bg-white hover:bg-[#FAF7F0] border border-[#D8D1C3] text-stone-700 transition-all"
            >
              <Settings size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
