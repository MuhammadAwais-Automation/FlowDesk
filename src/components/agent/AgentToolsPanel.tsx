import { useEffect, useRef } from 'react'
import { Wrench, Lock, CheckCircle2 } from 'lucide-react'
import { agentToolGroups } from '@/config/agentTools'

interface Props {
  provider: 'claude' | 'codex' | 'antigravity'
  bypassPermissions: boolean
  hasActiveProject: boolean
  onClose: () => void
}

/**
 * "What tools does the ACTIVE provider actually have right now" — Claude, Codex,
 * and Antigravity are shown as clearly separate lists.
 */
export default function AgentToolsPanel({ provider, bypassPermissions, hasActiveProject, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [onClose])

  const groups = agentToolGroups(provider, bypassPermissions, hasActiveProject)
  const providerTitle = provider === 'codex' ? 'Codex' : provider === 'antigravity' ? 'Antigravity (Gemini)' : 'Claude'

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl bg-[#FAF7F0] border-2 border-[#281E14] shadow-[3px_3px_0px_0px_rgba(40,30,20,0.3)] z-40"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-[#281E14] bg-[#EBE5D5] sticky top-0">
        <Wrench size={14} className="text-[#D97706]" />
        <span className="font-retro-tech text-[11px] font-bold uppercase tracking-wider text-[#281E14]">
          {providerTitle} tools
        </span>
      </div>

      <div className="p-3 space-y-3">
        {groups.map(group => (
          <div key={group.label}>
            <p className="font-retro-mono text-[9.5px] font-bold uppercase tracking-widest text-[#B45309] px-1 mb-1">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.tools.map(t => (
                <div key={t.name} className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/60">
                  {t.autoAllowed ? (
                    <CheckCircle2 size={11} className="text-[#059669] shrink-0" />
                  ) : (
                    <Lock size={11} className="text-[#B45309] shrink-0" />
                  )}
                  <span className="font-retro-mono text-[11px] text-stone-700 break-all">{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-[#281E14]/20 bg-white/40">
        <p className="font-retro-mono text-[9px] text-stone-500 leading-relaxed">
          <CheckCircle2 size={9} className="inline text-[#059669] -mt-0.5 mr-1" />
          runs immediately &nbsp;·&nbsp;
          <Lock size={9} className="inline text-[#B45309] -mt-0.5 mr-1" />
          asks for approval
        </p>
      </div>
    </div>
  )
}
