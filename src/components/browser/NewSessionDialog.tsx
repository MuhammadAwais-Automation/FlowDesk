import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Globe, Search, UserCircle2, X } from 'lucide-react'
import { getCompactToolName, getFaviconUrl, isToolTab } from '@/types/browser'
import type { BrowserTab, CustomTool } from '@/types/browser'
import type { GmailSession } from '@/types/electron'

interface Props {
  open: boolean
  tools: CustomTool[]
  gmailSessions: GmailSession[]
  tabs: BrowserTab[]
  selectedToolId: string
  selectedGmailEmail: string
  onSelectTool: (toolId: string) => void
  onSelectGmail: (email: string) => void
  onConfirm: () => void
  onClose: () => void
}

function getHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function getAccountPrimaryLabel(session: GmailSession): string {
  const label = session.label?.trim()
  if (label && label.toLowerCase() !== session.email.toLowerCase()) return label
  return session.email.split('@')[0]
}

export default function NewSessionDialog({
  open,
  tools,
  gmailSessions,
  tabs,
  selectedToolId,
  selectedGmailEmail,
  onSelectTool,
  onSelectGmail,
  onConfirm,
  onClose,
}: Props) {
  const [toolSearch, setToolSearch] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const toolSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setToolSearch('')
    setAccountSearch('')
    window.setTimeout(() => toolSearchRef.current?.focus(), 30)
  }, [open])

  const filteredTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase()
    if (!query) return tools
    return tools.filter(tool =>
      tool.name.toLowerCase().includes(query) ||
      getHostLabel(tool.url).toLowerCase().includes(query)
    )
  }, [toolSearch, tools])

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase()
    if (!query) return gmailSessions
    return gmailSessions.filter(session =>
      session.email.toLowerCase().includes(query) ||
      (session.label ?? '').toLowerCase().includes(query)
    )
  }, [accountSearch, gmailSessions])

  const selectedTool = tools.find(tool => tool.id === selectedToolId) ?? null
  const selectedGmail = gmailSessions.find(session => session.email === selectedGmailEmail) ?? null
  const existingTab = selectedTool && selectedGmail
    ? tabs.find(tab => isToolTab(tab) && tab.tool.id === selectedTool.id && tab.gmail.email === selectedGmail.email) ?? null
    : null
  const canConfirm = !!selectedTool && !!selectedGmail
  const openCountForTool = selectedTool
    ? tabs.filter(tab => isToolTab(tab) && tab.tool.id === selectedTool.id).length
    : 0

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[860px] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        style={{ minHeight: '560px', maxHeight: '84vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h3 className="font-display text-lg font-semibold text-tx">Open Browser Session</h3>
            <p className="mt-1 text-sm text-t3">
              Tool select karo, phir account choose karke naya session kholo ya existing session par jump karo.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-t3 transition-colors hover:bg-s2 hover:text-tx"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-border px-6 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-xl border border-border bg-s2 px-3 py-2.5">
              <Search size={14} className="text-t3" />
              <input
                ref={toolSearchRef}
                value={toolSearch}
                onChange={e => setToolSearch(e.target.value)}
                placeholder="Search tools"
                className="w-full bg-transparent text-sm text-tx outline-none placeholder:text-t3"
              />
            </label>

            <label className="flex items-center gap-3 rounded-xl border border-border bg-s2 px-3 py-2.5">
              <Search size={14} className="text-t3" />
              <input
                value={accountSearch}
                onChange={e => setAccountSearch(e.target.value)}
                placeholder="Search accounts"
                className="w-full bg-transparent text-sm text-tx outline-none placeholder:text-t3"
              />
            </label>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-[320px_minmax(0,1fr)]" style={{ height: '388px' }}>
          <section className="border-r border-border">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-t3">Tools</p>
                <p className="mt-1 text-xs text-t3">{filteredTools.length} available</p>
              </div>
            </div>

            <div className="h-[calc(100%-72px)] overflow-y-auto px-3 pb-3">
              {filteredTools.length === 0 ? (
                <div className="mx-3 rounded-2xl border border-dashed border-border bg-s2 px-5 py-10 text-center">
                  <p className="text-sm font-medium text-t2">No matching tools</p>
                  <p className="mt-1 text-xs text-t3">Search ko clear karo ya pehle naya tool add karo.</p>
                </div>
              ) : (
                filteredTools.map(tool => {
                  const isSelected = tool.id === selectedToolId
                  const compactName = getCompactToolName(tool)

                  return (
                    <button
                      key={tool.id}
                      onClick={() => onSelectTool(tool.id)}
                      className="mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all"
                      style={{
                        borderColor: isSelected ? 'var(--accent-border)' : 'var(--border)',
                        background: isSelected ? 'var(--accent-muted)' : 'var(--surface)',
                      }}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-s2">
                        <img
                          src={getFaviconUrl(tool.url)}
                          alt=""
                          className="h-5 w-5 object-contain"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`truncate text-sm font-semibold ${isSelected ? 'text-accent' : 'text-tx'}`}>
                            {compactName}
                          </span>
                          {tool.name !== compactName && (
                            <span className="rounded-md bg-s2 px-1.5 py-0.5 text-[10px] font-medium text-t3">
                              {tool.name}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-t3">{getHostLabel(tool.url)}</p>
                      </div>

                      {isSelected && (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                          <Check size={12} />
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </section>

          <section className="min-h-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-t3">Accounts</p>
                <p className="mt-1 text-xs text-t3">
                  {selectedTool ? `${openCountForTool} open for ${getCompactToolName(selectedTool)}` : 'Select a tool first'}
                </p>
              </div>

              {selectedTool && (
                <div className="rounded-full border border-border bg-s2 px-3 py-1 text-xs font-medium text-t2">
                  {getCompactToolName(selectedTool)}
                </div>
              )}
            </div>

            <div className="h-[calc(100%-72px)] overflow-y-auto px-3 pb-3">
              {filteredAccounts.length === 0 ? (
                <div className="mx-3 rounded-2xl border border-dashed border-border bg-s2 px-5 py-10 text-center">
                  <p className="text-sm font-medium text-t2">No matching accounts</p>
                  <p className="mt-1 text-xs text-t3">Search ko clear karo ya pehle Gmail account add karo.</p>
                </div>
              ) : (
                filteredAccounts.map(session => {
                  const isSelected = session.email === selectedGmailEmail
                  const color = session.color ?? '#6B7280'

                  return (
                    <button
                      key={session.email}
                      onClick={() => onSelectGmail(session.email)}
                      className="mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all"
                      style={{
                        borderColor: isSelected ? 'var(--accent-border)' : 'var(--border)',
                        background: isSelected ? 'var(--accent-muted)' : 'var(--surface)',
                      }}
                    >
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white"
                        style={{ background: color }}
                      >
                        {session.email[0].toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`truncate text-sm font-semibold ${isSelected ? 'text-accent' : 'text-tx'}`}>
                            {getAccountPrimaryLabel(session)}
                          </span>
                          {session.label && session.label.toLowerCase() !== session.email.toLowerCase() && (
                            <UserCircle2 size={13} className="text-t3" />
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-t3">{session.email}</p>
                      </div>

                      {isSelected && (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                          <Check size={12} />
                        </div>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </section>
        </div>

        <div className="border-t border-border bg-s2/60 px-6 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-t3">Selection</p>
              <div className="mt-2 flex min-h-10 flex-wrap items-center gap-2">
                {selectedTool ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-t2">
                    <Globe size={12} />
                    {getCompactToolName(selectedTool)}
                  </span>
                ) : (
                  <span className="text-sm text-t3">Tool select karo</span>
                )}

                {selectedGmail ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-t2">
                    <div className="h-2 w-2 rounded-full" style={{ background: selectedGmail.color ?? '#6B7280' }} />
                    {selectedGmail.email}
                  </span>
                ) : (
                  <span className="text-sm text-t3">Account select karo</span>
                )}
              </div>

              {existingTab && (
                <p className="mt-2 text-xs text-t3">
                  Yeh session pehle se open hai. Confirm par hum usi tab par switch karenge.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-t2 transition-colors hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={!canConfirm}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-h disabled:cursor-not-allowed disabled:opacity-40"
              >
                {existingTab ? 'Switch to Open Session' : 'Open Session'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
