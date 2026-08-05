import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Globe, Terminal, ArrowRight } from 'lucide-react'
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
  let label = session.label?.trim() || ''
  if (label.includes('Google Account:')) {
    const match = label.match(/Google Account:\s*([^(]+)/i)
    if (match && match[1]?.trim()) {
      return match[1].trim()
    }
  }
  if (label && label.toLowerCase() !== session.email.toLowerCase()) {
    return label
  }
  const localPart = session.email.split('@')[0] || ''
  return localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : session.email
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      {/* Retro Light Workstation Container */}
      <div
        className="w-full max-w-[880px] overflow-hidden rounded-2xl border-2 border-[#D8D1C3] bg-[#FAF7F0] shadow-[0_24px_60px_rgba(40,30,20,0.22)] relative flex flex-col bg-dot-matrix"
        style={{ height: '700px', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Retro Titlebar */}
        <div className="flex items-center justify-between border-b border-[#D6CFC0] bg-[#EBE5D5] px-5 py-2.5 select-none">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/50 cursor-pointer hover:brightness-110 transition-all shadow-xs"
                onClick={onClose}
                title="Close"
              />
              <span className="h-3 w-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/50 shadow-xs" />
              <span className="h-3 w-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/50 shadow-xs" />
            </div>
            <div className="h-3.5 w-[1px] bg-[#C8C1B0] mx-1" />
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-[#D97706]" />
              <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-800">
                Session Launcher
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="retro-btn flex h-7 px-2.5 items-center justify-center rounded-md bg-[#FEE2E2] border border-[#FCA5A5] text-[#DC2626] hover:bg-[#DC2626] hover:text-white font-retro-mono text-xs font-bold transition-all shadow-xs"
            aria-label="Close dialog"
          >
            [ ESC ]
          </button>
        </div>

        {/* Dialog Subtitle Header */}
        <div className="border-b border-[#D8D1C3] bg-[#FAF7F0] px-6 py-2.5 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-retro-sans text-base font-bold text-stone-900">
              Open Web Session
            </h2>
            <p className="font-retro-mono text-xs text-stone-600 font-medium mt-0.5">
              Select tool and account to launch browser session
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-2 font-retro-mono text-[10px] text-stone-700 font-medium">
            <span className="px-2.5 py-0.5 rounded-md bg-[#EBE5D5] border border-[#D6CFC0] font-bold">
              {tools.length} tools
            </span>
            <span className="px-2.5 py-0.5 rounded-md bg-[#EBE5D5] border border-[#D6CFC0] font-bold">
              {gmailSessions.length} accounts
            </span>
          </div>
        </div>

        {/* Search Command Inputs */}
        <div className="border-b border-[#D8D1C3] bg-[#EFEAE0] px-6 py-2.5">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-retro-mono text-xs font-bold text-[#D97706]">
                &gt;
              </span>
              <input
                ref={toolSearchRef}
                value={toolSearch}
                onChange={e => setToolSearch(e.target.value)}
                placeholder="Search tools..."
                className="w-full rounded-xl border border-[#D0C8B8] bg-white pl-8 pr-8 py-2 font-retro-mono text-xs text-stone-900 outline-none placeholder:text-stone-400 focus:border-[#D97706] focus:ring-1 focus:ring-[#D97706]/30 transition-all shadow-xs"
              />
              {toolSearch && (
                <button
                  onClick={() => setToolSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800 text-xs font-retro-mono"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-retro-mono text-xs font-bold text-[#059669]">
                &gt;
              </span>
              <input
                value={accountSearch}
                onChange={e => setAccountSearch(e.target.value)}
                placeholder="Search accounts..."
                className="w-full rounded-xl border border-[#D0C8B8] bg-white pl-8 pr-8 py-2 font-retro-mono text-xs text-stone-900 outline-none placeholder:text-stone-400 focus:border-[#059669] focus:ring-1 focus:ring-[#059669]/30 transition-all shadow-xs"
              />
              {accountSearch && (
                <button
                  onClick={() => setAccountSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800 text-xs font-retro-mono"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 2-Column Grid Area */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#D8D1C3] overflow-hidden">
          {/* Tools Column */}
          <section className="flex flex-col min-h-0 bg-gradient-to-b from-[#F5F1E6]/80 via-[#FAF7F0] to-[#F5F1E6]/80 bg-dot-matrix">
            <div className="flex items-center justify-between px-5 py-2 border-b border-[#D8D1C3] bg-[#EBE5D5]/80">
              <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                <span className="text-[#D97706]">[01]</span> Tools
              </span>
              <span className="font-retro-mono text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-white/80 border border-[#D6CFC0] text-stone-700">
                {filteredTools.length} available
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filteredTools.length === 0 ? (
                <div className="my-6 mx-2 rounded-xl border border-dashed border-[#D6CFC0] bg-white p-6 text-center">
                  <p className="font-retro-sans text-xs font-semibold text-stone-800">No tools found</p>
                  <p className="font-retro-mono text-[11px] text-stone-500 mt-1">Adjust search query</p>
                </div>
              ) : (
                filteredTools.map(tool => {
                  const isSelected = tool.id === selectedToolId
                  const compactName = getCompactToolName(tool)

                  return (
                    <div
                      key={tool.id}
                      onClick={() => onSelectTool(tool.id)}
                      className={`p-3 rounded-xl cursor-pointer flex items-center justify-between gap-3 transition-all duration-150 relative ${
                        isSelected
                          ? 'border-2 border-[#D97706] bg-[#FFFBEB] shadow-[0_4px_14px_rgba(217,119,6,0.14)]'
                          : 'border border-[#E2DBD0] bg-white hover:border-[#D97706]/50 hover:-translate-y-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 transition-transform ${
                          isSelected ? 'border-[#D97706]/40 bg-white' : 'border-[#E5DFD3] bg-[#FAF7F0]'
                        }`}>
                          <img
                            src={getFaviconUrl(tool.url)}
                            alt=""
                            className="w-4 h-4 object-contain"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-retro-sans text-xs font-bold truncate ${
                              isSelected ? 'text-[#92400E]' : 'text-stone-900'
                            }`}>
                              {compactName}
                            </h4>
                            {tool.name !== compactName && (
                              <span className="font-retro-mono text-[9px] uppercase font-medium px-1.5 py-0.5 rounded bg-[#EBE5D5] text-stone-700">
                                {tool.name}
                              </span>
                            )}
                          </div>
                          <p className="font-retro-mono text-[11px] text-stone-500 font-medium truncate mt-0.5">
                            {getHostLabel(tool.url)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isSelected ? (
                          <span className="font-retro-mono text-[10px] font-bold px-2.5 py-1 rounded-md bg-[#D97706] text-white flex items-center gap-1 shadow-xs">
                            <Check size={10} strokeWidth={3} />
                            Selected
                          </span>
                        ) : (
                          <span className="font-retro-mono text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#F5F1E5] hover:bg-[#EBE5D5] border border-[#D8D1C3] text-stone-700 transition-colors">
                            Select
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          {/* Accounts Column */}
          <section className="flex flex-col min-h-0 bg-gradient-to-b from-[#F5F1E6]/80 via-[#FAF7F0] to-[#F5F1E6]/80 bg-dot-matrix">
            <div className="flex items-center justify-between px-5 py-2 border-b border-[#D8D1C3] bg-[#EBE5D5]/80">
              <span className="font-retro-mono text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                <span className="text-[#059669]">[02]</span> Accounts
              </span>
              <span className="font-retro-mono text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-white/80 border border-[#D6CFC0] text-stone-700">
                {selectedTool ? `${openCountForTool} active` : `${filteredAccounts.length} accounts`}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filteredAccounts.length === 0 ? (
                <div className="my-6 mx-2 rounded-xl border border-dashed border-[#D6CFC0] bg-white p-6 text-center">
                  <p className="font-retro-sans text-xs font-semibold text-stone-800">No accounts found</p>
                  <p className="font-retro-mono text-[11px] text-stone-500 mt-1">No matching Gmail session</p>
                </div>
              ) : (
                filteredAccounts.map(session => {
                  const isSelected = session.email === selectedGmailEmail
                  const color = session.color ?? '#059669'
                  const domain = session.email.includes('@') ? `@${session.email.split('@')[1]}` : ''
                  const tabForAccount = selectedTool
                    ? tabs.find(t => isToolTab(t) && t.tool.id === selectedTool.id && t.gmail.email === session.email)
                    : null

                  return (
                    <div
                      key={session.email}
                      onClick={() => onSelectGmail(session.email)}
                      className={`p-3 rounded-xl cursor-pointer flex items-center justify-between gap-3 transition-all duration-150 relative ${
                        isSelected
                          ? 'border-2 border-[#059669] bg-[#ECFDF5] shadow-[0_4px_14px_rgba(5,150,105,0.14)]'
                          : 'border border-[#E2DBD0] bg-white hover:border-[#059669]/50 hover:bg-[#F4FBF7] hover:-translate-y-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Enhanced Avatar with indicator dot */}
                        <div className="relative flex-shrink-0">
                          <div
                            className="w-9 h-9 rounded-xl border-2 border-white flex items-center justify-center text-xs font-retro-mono font-bold text-white shadow-xs"
                            style={{ background: color }}
                          >
                            {session.email[0].toUpperCase()}
                          </div>
                          <span
                            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-[#10B981] shadow-xs"
                            title="Active Session"
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-retro-sans text-xs font-bold truncate ${
                              isSelected ? 'text-[#047857]' : 'text-stone-900'
                            }`}>
                              {getAccountPrimaryLabel(session)}
                            </h4>
                            {domain && (
                              <span className="font-retro-mono text-[9px] font-medium px-1.5 py-0.5 rounded bg-[#FAF7F0] border border-[#D8D1C3] text-stone-600 flex-shrink-0">
                                {domain}
                              </span>
                            )}
                            {tabForAccount && (
                              <span className="font-retro-mono text-[9px] uppercase px-2 py-0.5 rounded-full bg-[#D1FAE5] text-[#047857] border border-[#A7F3D0] flex items-center gap-1 font-bold flex-shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#059669] animate-pulse" />
                                Active Tab
                              </span>
                            )}
                          </div>
                          <p className="font-retro-mono text-[11px] text-stone-500 font-medium truncate mt-0.5">
                            {session.email}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isSelected ? (
                          <span className="font-retro-mono text-[10px] font-bold px-2.5 py-1 rounded-md bg-[#059669] text-white flex items-center gap-1 shadow-xs">
                            <Check size={10} strokeWidth={3} />
                            Selected
                          </span>
                        ) : (
                          <span className="font-retro-mono text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#F5F1E5] hover:bg-[#EBE5D5] border border-[#D8D1C3] text-stone-700 transition-colors">
                            Select
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>

        {/* Minimal Retro Control Console Footer */}
        <div className="border-t border-[#D6CFC0] bg-[#EBE5D5] p-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Minimal selection preview */}
            <div className="min-w-0 flex-1 flex items-center gap-2">
              {canConfirm ? (
                <div className="flex items-center gap-2 font-retro-mono text-xs text-stone-900 font-semibold flex-wrap">
                  <span className="px-2.5 py-1 rounded-lg bg-[#FEF3C7] border border-[#F59E0B]/50 text-[#B45309] font-bold flex items-center gap-1.5 shadow-xs">
                    <Globe size={12} />
                    {getCompactToolName(selectedTool!)}
                  </span>
                  <span className="text-stone-500 font-bold">+</span>
                  <span className="px-2.5 py-1 rounded-lg bg-[#ECFDF5] border border-[#10B981]/50 text-[#047857] font-bold flex items-center gap-1.5 shadow-xs">
                    <div className="h-2 w-2 rounded-full" style={{ background: selectedGmail!.color ?? '#6B7280' }} />
                    {selectedGmail!.email}
                  </span>
                  {existingTab && (
                    <span className="text-[10px] font-bold text-[#047857] flex items-center gap-1 bg-[#D1FAE5] px-2 py-0.5 rounded-lg border border-[#A7F3D0]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#059669] animate-pulse" />
                      Tab Open
                    </span>
                  )}
                </div>
              ) : (
                <span className="font-retro-mono text-xs text-stone-600 font-medium italic">
                  Select a tool and account to proceed
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={onClose}
                className="retro-btn px-4 py-2 rounded-xl bg-[#F5F2E9] border border-[#C8C1B0] text-stone-800 hover:bg-[#E2DBCB] font-retro-mono text-xs font-semibold shadow-[1px_1px_0px_0px_rgba(0,0,0,0.08)] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={!canConfirm}
                className={`retro-btn px-5 py-2 rounded-xl font-retro-mono text-xs font-bold transition-all flex items-center gap-2 ${
                  canConfirm
                    ? 'bg-[#D97706] hover:bg-[#B45309] text-white border border-[#B45309] shadow-[2px_2px_0px_0px_rgba(180,83,9,0.35)]'
                    : 'bg-[#E2DBCB] text-stone-400 border-[#C8C1B0] opacity-60 cursor-not-allowed'
                }`}
              >
                {existingTab ? (
                  <>
                    <span>Switch Tab</span>
                    <ArrowRight size={13} />
                  </>
                ) : (
                  <>
                    <span>Launch</span>
                    <ArrowRight size={13} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
