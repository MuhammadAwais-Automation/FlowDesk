export type ProviderStatus = 'idle' | 'thinking' | 'done' | 'error'

const PROVIDERS = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'grok', label: 'Grok' },
  { id: 'perplexity', label: 'Perplexity' },
] as const

export default function ProviderStatusStrip({ status }: { status: Record<string, ProviderStatus> }) {
  return (
    <div className="hidden sm:flex items-center gap-1.5 font-retro-mono">
      {PROVIDERS.map(p => {
        const s = status[p.id] ?? 'idle'

        return (
          <div
            key={p.id}
            title={s === 'thinking' ? `${p.label} is working…` : s === 'error' ? `${p.label} error` : s === 'done' ? `${p.label} complete` : p.label}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 transition-all duration-200 ${
              s === 'thinking'
                ? 'bg-[#FEF3C7] border-[#281E14] text-[#B45309] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.3)] animate-pulse-glow'
                : s === 'done'
                ? 'bg-[#ECFDF5] border-[#281E14] text-[#047857] shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]'
                : s === 'error'
                ? 'bg-[#FEE2E2] border-[#281E14] text-[#DC2626] shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)]'
                : 'bg-white border-[#281E14] text-stone-700 shadow-[1px_1px_0px_0px_rgba(40,30,20,0.18)]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                s === 'thinking'
                  ? 'bg-[#D97706] animate-ping'
                  : s === 'done'
                  ? 'bg-[#059669]'
                  : s === 'error'
                  ? 'bg-[#DC2626]'
                  : 'bg-stone-400'
              }`}
            />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {p.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
