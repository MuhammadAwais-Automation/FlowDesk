import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Mail, Plus, Settings, X } from 'lucide-react'
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
    <div style={{
      width: '220px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {customTools.length === 0 && (
          <div style={{
            padding: '20px 12px', textAlign: 'center',
            color: 'var(--text-3)', fontSize: '11px',
          }}>
            No tools yet — click <strong>Manage Tools</strong> below.
          </div>
        )}

        {customTools.map(tool => {
          const toolTabs = tabsByTool.get(tool.id) ?? []
          const expanded = isExpanded(tool.id, toolTabs.length > 0)
          const Chevron = expanded ? ChevronDown : ChevronRight

          return (
            <div key={tool.id} style={{ marginBottom: '4px' }}>
              <button
                onClick={() => toggle(tool.id)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: '7px',
                  padding: '7px 8px', borderRadius: '8px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-2)',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <Chevron size={11} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
                <img
                  src={getFaviconUrl(tool.url)}
                  alt=""
                  style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, objectFit: 'contain' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
                <span style={{
                  flex: 1, textAlign: 'left',
                  fontSize: '12px', fontWeight: 600,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {tool.name}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: 600,
                  background: 'var(--surface-2)',
                  color: 'var(--text-3)',
                  borderRadius: '8px',
                  padding: '1px 7px',
                  flexShrink: 0,
                }}>
                  {toolTabs.length}
                </span>
              </button>

              {expanded && (
                <div style={{ paddingLeft: '14px' }}>
                  {toolTabs.map(tab => {
                    const isActive = tab.id === activeId
                    const color    = tab.gmail.color ?? '#6B7280'
                    const isHover  = hoverTabId === tab.id

                    return (
                      <div
                        key={tab.id}
                        onClick={() => onSelectTab(tab.id)}
                        onContextMenu={e => onContextMenu?.(e, tab)}
                        onMouseEnter={() => setHoverTabId(tab.id)}
                        onMouseLeave={() => setHoverTabId(null)}
                        title={tab.gmail.email}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '7px',
                          padding: '5px 8px', borderRadius: '7px',
                          margin: '2px 0',
                          cursor: 'pointer',
                          background:
                            isActive ? `${color}1F` :
                            isHover  ? 'var(--surface-2)' : 'transparent',
                          border: `1px solid ${isActive ? color + '55' : 'transparent'}`,
                          transition: 'all 0.1s',
                        }}
                      >
                        <div style={{
                          width: '6px', height: '6px',
                          borderRadius: '50%',
                          background: color,
                          flexShrink: 0,
                          boxShadow: isActive ? `0 0 6px ${color}` : 'none',
                        }} />
                        <span style={{
                          flex: 1,
                          fontSize: '11px',
                          color: isActive ? 'var(--text)' : 'var(--text-2)',
                          fontWeight: isActive ? 600 : 400,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {tab.gmail.email}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); onOpenGmail(tab.gmail) }}
                          aria-label="Open Gmail tab"
                          title="Open Gmail in new tab"
                          style={{
                            width: '18px', height: '18px',
                            borderRadius: '5px', flexShrink: 0,
                            display: isHover || isActive ? 'flex' : 'none',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--text-3)',
                            transition: 'all 0.1s',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
                            ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent'
                            ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
                          }}
                        >
                          <Mail size={11} strokeWidth={2.2} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onCloseTab(tab.id) }}
                          aria-label="Close session"
                          style={{
                            width: '18px', height: '18px',
                            borderRadius: '5px', flexShrink: 0,
                            display: isHover || isActive ? 'flex' : 'none',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--text-3)',
                            transition: 'all 0.1s',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLElement).style.background = 'var(--danger-muted)'
                            ;(e.currentTarget as HTMLElement).style.color = 'var(--danger)'
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent'
                            ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
                          }}
                        >
                          <X size={11} strokeWidth={2.5} />
                        </button>
                      </div>
                    )
                  })}

                  <button
                    onClick={() => onAddSession(tool.id)}
                    style={{
                      width: '100%',
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '5px 8px', borderRadius: '7px',
                      margin: '2px 0',
                      background: 'transparent', border: '1px dashed var(--border)',
                      cursor: 'pointer',
                      color: 'var(--text-3)',
                      fontSize: '10.5px',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
                    }}
                  >
                    <Plus size={10} strokeWidth={2.5} />
                    Add account
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border)',
        padding: '8px',
        display: 'flex', flexDirection: 'column', gap: '4px',
      }}>
        <button
          onClick={() => onAddSession()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '7px 10px', borderRadius: '8px', cursor: 'pointer',
            background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
            color: 'var(--accent)', fontSize: '11.5px', fontWeight: 600,
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--accent)'
            ;(e.currentTarget as HTMLElement).style.color = 'white'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
          }}
        >
          <Plus size={12} strokeWidth={2.5} />
          New Session
        </button>

        <button
          onClick={onManageTools}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-2)', fontSize: '11px', fontWeight: 500,
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          <Settings size={11} />
          Manage Tools
        </button>
      </div>
    </div>
  )
}
