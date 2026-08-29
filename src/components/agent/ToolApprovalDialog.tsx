import { ShieldAlert, Check, X } from 'lucide-react'

export interface PendingApproval {
  requestId: string
  tool: string
  title: string
  detail?: string
  input?: Record<string, unknown>
}

interface Props {
  approval: PendingApproval
  queueLength: number
  onRespond: (requestId: string, approved: boolean) => void
}

/**
 * The one real approval surface for the Agent tab — replaces both Claude's
 * built-in tools running with no gate at all (tools: [] previously disabled
 * them outright) and the native OS dialog project actions used to show.
 * Every risky action, from either lead provider, funnels through this same
 * UI: canUseTool for Claude's built-ins, and FlowDesk's own worker tools
 * (project write/run, WhatsApp send/delete) calling requestApproval directly
 * from inside their handlers — the latter is Codex's only point of gating,
 * since its SDK has no per-call approval hook of its own.
 *
 * Rendered as a blocking overlay rather than a toast: the agent turn is
 * genuinely paused server-side awaiting this response (the SDK's
 * canUseTool promise, or the tool handler's own await), so a dismissible
 * toast that could be missed would leave the run silently stuck.
 */
export default function ToolApprovalDialog({ approval, queueLength, onRespond }: Props) {
  const inputEntries = approval.input ? Object.entries(approval.input) : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#281E14]/50 backdrop-blur-[2px] p-6">
      <div className="w-full max-w-md rounded-2xl bg-[#FAF7F0] border-2 border-[#281E14] shadow-[4px_4px_0px_0px_rgba(40,30,20,0.35)] overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3.5 bg-[#FEF3C7] border-b-2 border-[#281E14]">
          <div className="p-1.5 rounded-lg bg-white border-2 border-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.25)]">
            <ShieldAlert size={16} className="text-[#B45309]" />
          </div>
          <span className="font-retro-tech text-xs font-bold uppercase tracking-wider text-[#281E14]">
            Agent wants to act
          </span>
          {queueLength > 1 && (
            <span className="ml-auto font-retro-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-[#281E14]/40 text-stone-600">
              +{queueLength - 1} more waiting
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="font-retro-mono text-[10px] font-bold uppercase tracking-widest text-[#B45309]">
            {approval.tool}
          </p>
          <p className="font-retro-sans text-sm text-[#281E14] leading-snug">
            {approval.title}
          </p>

          {approval.detail && (
            <div className="rounded-lg bg-white border-2 border-[#281E14]/60 px-3 py-2.5 max-h-40 overflow-y-auto">
              <p className="font-retro-mono text-xs text-stone-700 whitespace-pre-wrap break-words">
                {approval.detail}
              </p>
            </div>
          )}

          {inputEntries.length > 0 && (
            <div className="rounded-lg bg-[#EBE5D5] border border-[#281E14]/30 px-3 py-2 space-y-1">
              {inputEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2 font-retro-mono text-[10.5px]">
                  <span className="text-stone-500 shrink-0">{key}:</span>
                  <span className="text-stone-800 break-all">{String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-1">
          <button
            type="button"
            onClick={() => onRespond(approval.requestId, false)}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-[#FEE2E2] text-[#DC2626] border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.25)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase tracking-wider transition-colors"
          >
            <X size={14} />
            Deny
          </button>
          <button
            type="button"
            onClick={() => onRespond(approval.requestId, true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.25)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase tracking-wider transition-colors"
          >
            <Check size={14} />
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
