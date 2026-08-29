import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Maximize2, Sparkles, Wrench, X } from 'lucide-react'
import type { AgentToolCallEntry } from '@/lib/agentSession'
import { getPayloadPreviewSummary, parsePayload } from '@/lib/workerPayload'
import { WorkerPayloadViewer } from './WorkerPayloadViewer'

const PROVIDER_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  perplexity: 'Perplexity',
  notebooklm: 'NotebookLM',
}

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id
}

function StatusBadge({ call }: { call: AgentToolCallEntry }) {
  const isPending = !call.result && !call.isError
  if (isPending) {
    return (
      <span className="font-retro-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#FEF3C7] border border-[#281E14] text-[#B45309] flex items-center gap-1 shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-ping" />
        Executing&hellip;
      </span>
    )
  }
  if (call.isError) {
    return (
      <span className="font-retro-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#FEE2E2] border border-[#281E14] text-[#DC2626] shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]">
        Failed
      </span>
    )
  }
  return (
    <span className="font-retro-mono text-[9px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#ECFDF5] border border-[#281E14] text-[#047857] shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]">
      Done
    </span>
  )
}

function TrafficLights() {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className="w-2 h-2 rounded-full bg-[#FF5F56] border border-[#281E14]/50" />
      <span className="w-2 h-2 rounded-full bg-[#FFBD2E] border border-[#281E14]/50" />
      <span className="w-2 h-2 rounded-full bg-[#27C93F] border border-[#281E14]/50" />
    </div>
  )
}

/** Fixed-size preview tile — click opens a centered retro reader modal. */
export function WorkerToolCard({ call }: { call: AgentToolCallEntry }) {
  const [open, setOpen] = useState(false)
  const isPending = !call.result && !call.isError
  const provider = providerLabel(call.tool)
  const canExpand = Boolean(call.result || call.prompt)

  const parsed = useMemo(() => parsePayload(call.result), [call.result])
  const summary = useMemo(() => getPayloadPreviewSummary(call.result), [call.result])

  return (
    <>
      <button
        type="button"
        onClick={() => canExpand && setOpen(true)}
        disabled={!canExpand}
        className="group relative flex flex-col w-full h-[175px] text-left rounded-xl border-2 border-[#281E14] bg-white overflow-hidden shadow-[2px_2px_0px_0px_rgba(40,30,20,0.2)] hover:shadow-[3.5px_3.5px_0px_0px_rgba(40,30,20,0.28)] hover:-translate-y-0.5 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 cursor-pointer disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0px_0px_rgba(40,30,20,0.2)] outline-none focus-visible:ring-2 focus-visible:ring-[#D97706] focus-visible:ring-offset-2"
      >
        <div className="flex items-center justify-between px-3 py-2 bg-[#EBE5D5] border-b-2 border-[#281E14] select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <TrafficLights />
            <div className="h-3 w-[1.5px] bg-[#281E14]/30 mx-0.5 shrink-0" />
            {call.isError ? (
              <AlertTriangle size={13} className="text-[#DC2626] shrink-0" />
            ) : (
              <Wrench size={13} className="text-[#D97706] shrink-0" />
            )}
            <span className="font-retro-tech text-xs font-bold text-[#281E14] truncate">
              {provider}
            </span>
          </div>
          <StatusBadge call={call} />
        </div>

        <div className="flex-1 flex flex-col min-h-0 p-2.5 gap-1.5 font-retro-mono">
          <div className="shrink-0">
            <div className="text-[#D97706] font-bold text-[9px] uppercase tracking-wider mb-0.5">
              &gt; Prompt
            </div>
            <p className="text-[11px] text-stone-800 leading-snug line-clamp-2">
              {call.prompt || '\u2014'}
            </p>
          </div>

          <div className="flex-1 min-h-0 rounded-lg border border-[#281E14]/25 bg-[#FAF7F0] px-2 py-1.5 overflow-hidden flex flex-col justify-between">
            <div className="flex items-center justify-between font-bold text-[9px] text-stone-500 uppercase tracking-wider mb-0.5">
              <span>Output</span>
              {summary.badge && (
                <span className="px-1.5 py-0.2 rounded bg-white border border-[#281E14]/20 text-[8px] font-retro-tech text-[#D97706]">
                  {summary.badge}
                </span>
              )}
            </div>
            {isPending ? (
              <p className="text-[11px] text-stone-400 italic">Waiting for worker&hellip;</p>
            ) : parsed.isJson ? (
              <div className="flex items-center gap-1.5 py-0.5">
                <Sparkles size={12} className="text-[#D97706] shrink-0" />
                <span className="text-[11px] font-retro-tech font-bold text-stone-900 truncate">
                  {summary.title}
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-stone-900 leading-snug line-clamp-3 whitespace-pre-wrap break-words">
                {call.result}
              </p>
            )}
          </div>
        </div>

        {canExpand && (
          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#D97706] text-white border border-[#281E14] font-retro-mono text-[9px] font-bold uppercase shadow-[1px_1px_0px_0px_rgba(40,30,20,0.3)]">
              <Maximize2 size={10} />
              Expand
            </span>
          </div>
        )}
      </button>

      {open && <WorkerPayloadModal call={call} provider={provider} onClose={() => setOpen(false)} />}
    </>
  )
}

export function WorkerToolCardList({ calls }: { calls: AgentToolCallEntry[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full my-2">
      {calls.map((call, i) => (
        <WorkerToolCard key={`${call.tool}-${i}-${call.prompt.slice(0, 24)}`} call={call} />
      ))}
    </div>
  )
}

/** Centered retro workstation reader — Esc / backdrop / Close to dismiss. */
function WorkerPayloadModal({
  call,
  provider,
  onClose,
}: {
  call: AgentToolCallEntry
  provider: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6 bg-[#281E14]/55 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${provider} worker payload`}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex flex-col w-full max-w-3xl max-h-[88vh] rounded-xl border-2 border-[#281E14] bg-[#FAF7F0] shadow-[6px_6px_0px_0px_rgba(40,30,20,0.45)] overflow-hidden animate-in zoom-in-95 fade-in duration-200"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#EBE5D5] border-b-2 border-[#281E14] shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <TrafficLights />
            <div className="h-4 w-[1.5px] bg-[#281E14]/30" />
            {call.isError ? (
              <AlertTriangle size={15} className="text-[#DC2626] shrink-0" />
            ) : (
              <Wrench size={15} className="text-[#D97706] shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-retro-tech text-sm font-bold text-[#281E14] uppercase tracking-wide truncate">
                Dispatched {provider}
              </div>
              <div className="font-retro-terminal text-[10px] font-bold uppercase tracking-widest text-stone-500">
                Worker payload // smart inspector
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge call={call} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white border-2 border-[#281E14] text-[#281E14] hover:bg-[#FEE2E2] hover:text-[#DC2626] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.25)] active:translate-x-[1px] active:translate-y-[1px] transition-colors cursor-pointer outline-none focus:outline-none"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 font-retro-mono select-text">
          {call.prompt && (
            <section className="rounded-lg border-2 border-[#281E14]/30 bg-white p-3.5">
              <div className="text-[#D97706] font-bold text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <span className="text-[#D97706]">&gt;</span>
                Dispatch Prompt
              </div>
              <p className="text-xs sm:text-[13px] text-stone-900 leading-relaxed whitespace-pre-wrap break-words">
                {call.prompt}
              </p>
            </section>
          )}

          <section
            className={`rounded-lg border-2 p-3.5 ${
              call.isError
                ? 'border-[#DC2626]/40 bg-[#FEF2F2]'
                : 'border-[#281E14]/30 bg-white'
            }`}
          >
            <div className="font-bold text-[10px] text-stone-600 uppercase tracking-wider mb-2">
              Worker Payload Output
            </div>
            {call.result ? (
              call.isError ? (
                <p className="text-xs sm:text-[13px] text-[#DC2626] leading-relaxed whitespace-pre-wrap break-words font-retro-mono">
                  {call.result}
                </p>
              ) : (
                <WorkerPayloadViewer rawText={call.result} provider={provider} />
              )
            ) : (
              <p className="text-xs text-stone-400 italic">Waiting for AI worker response...</p>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#EBE5D5] border-t-2 border-[#281E14] shrink-0">
          <span className="font-retro-terminal text-[10px] font-bold uppercase tracking-widest text-stone-500">
            Esc &middot; Click outside to close
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.25)] hover:shadow-[3px_3px_0px_0px_rgba(40,30,20,0.32)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer outline-none focus:outline-none"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
