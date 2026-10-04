import { useMemo, useState } from 'react'
import { Activity, ChevronDown, ChevronUp, Clock, FileText, X } from 'lucide-react'
import { OBSERVATORY } from '@/lib/atlasTheme'
import { describeEvent, documentsRead, eventTime } from '@/lib/brainFormat'
import type { BrainEvent } from '@/types/brainKnowledge'

export interface ActivityPulseProps {
  events?: BrainEvent[]
  asking?: boolean
  activeNodes?: string[]
  onSelectNode?: (path: string) => void
  className?: string
  initialExpanded?: boolean
  simulate?: boolean
}

const DEFAULT_SIMULATED_NODES = [
  'skills/general/research.md',
  'notes/architecture/observatory.md',
  'projects/flowdesk/roadmap.md',
]

/**
 * Observatory-themed HUD pill & overlay displaying live or simulated agent
 * cognition, reading status, glowing pulse indicators, and an expandable activity log.
 */
export function ActivityPulse({
  events = [],
  asking = false,
  activeNodes: explicitActiveNodes,
  onSelectNode,
  className = '',
  initialExpanded = false,
  simulate = false,
}: ActivityPulseProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const [simulatedActive, setSimulatedActive] = useState(simulate)

  // Derive active nodes from recent turns if not explicitly supplied
  const derivedNodes = useMemo(() => {
    if (explicitActiveNodes && explicitActiveNodes.length > 0) {
      return explicitActiveNodes
    }
    const recentTurn = events.find(event => event.action === 'agent.turn' && documentsRead(event).length > 0)
    if (recentTurn) {
      return documentsRead(recentTurn)
    }
    return simulatedActive ? DEFAULT_SIMULATED_NODES : []
  }, [explicitActiveNodes, events, simulatedActive])

  const isCognitionActive = asking || derivedNodes.length > 0 || simulatedActive

  const statusLabel = asking
    ? 'Reasoning & Querying…'
    : derivedNodes.length > 0
      ? `${derivedNodes.length} node${derivedNodes.length === 1 ? '' : 's'} active`
      : 'Cognition quiescent'

  const glowColor = asking
    ? '#06b6d4' // cyan
    : derivedNodes.length > 0
      ? '#f59e0b' // amber
      : '#10b981' // emerald

  return (
    <div className={`relative select-none font-retro-sans ${className}`}>
      {/* HUD Pill */}
      <div
        role="region"
        aria-label="Agent Activity HUD"
        className="flex items-center gap-2 rounded-xl border px-3 py-1.5 shadow-lg backdrop-blur-md transition hover:border-slate-600"
        style={{
          background: OBSERVATORY.raised,
          borderColor: isCognitionActive ? `${glowColor}55` : OBSERVATORY.border,
          boxShadow: isCognitionActive ? `0 0 16px ${glowColor}22` : 'none',
        }}
      >
        {/* Pulsing indicator ring */}
        <div className="relative flex h-2.5 w-2.5 items-center justify-center">
          {isCognitionActive && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: glowColor }}
            />
          )}
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{
              background: glowColor,
              boxShadow: isCognitionActive ? `0 0 8px ${glowColor}` : 'none',
            }}
          />
        </div>

        {/* Status text */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: glowColor }}>
            {asking ? 'Cognition' : 'Atlas'}
          </span>
          <span className="hidden sm:inline" style={{ color: OBSERVATORY.muted }}>·</span>
          <span className="font-medium truncate max-w-[130px] sm:max-w-[180px]" style={{ color: OBSERVATORY.text }}>
            {statusLabel}
          </span>
        </div>

        {/* Node count chip */}
        {derivedNodes.length > 0 && (
          <span
            className="font-retro-mono rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: `${glowColor}20`,
              color: glowColor,
              border: `1px solid ${glowColor}40`,
            }}
          >
            {derivedNodes.length}
          </span>
        )}

        {/* Expand / Collapse Button */}
        <button
          type="button"
          aria-label={expanded ? 'Collapse activity log' : 'Expand activity log'}
          aria-expanded={expanded}
          onClick={() => setExpanded(prev => !prev)}
          className="ml-1 rounded p-0.5 transition hover:bg-white/10"
          style={{ color: OBSERVATORY.muted }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expandable Activity Log Popover */}
      {expanded && (
        <aside
          aria-label="Agent Activity Log"
          className="absolute right-0 top-full mt-2 z-30 w-80 max-w-[calc(100vw-32px)] rounded-xl border p-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150"
          style={{
            background: OBSERVATORY.raised,
            borderColor: OBSERVATORY.border,
            borderTopColor: glowColor,
            borderTopWidth: 2,
          }}
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: OBSERVATORY.border }}>
            <div className="flex items-center gap-2">
              <Activity size={14} style={{ color: glowColor }} />
              <span className="font-retro-mono text-xs font-semibold uppercase tracking-wider" style={{ color: OBSERVATORY.text }}>
                Live Activity & Cognition
              </span>
            </div>
            <button
              type="button"
              aria-label="Close activity log"
              onClick={() => setExpanded(false)}
              className="rounded p-1 transition hover:bg-white/10"
              style={{ color: OBSERVATORY.muted }}
            >
              <X size={13} />
            </button>
          </div>

          {/* Active Nodes section */}
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <span className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.muted }}>
                Active Document Nodes ({derivedNodes.length})
              </span>
              <button
                type="button"
                onClick={() => setSimulatedActive(prev => !prev)}
                className="font-retro-mono text-[9px] hover:underline"
                style={{ color: OBSERVATORY.dim }}
              >
                {simulatedActive ? 'Reset simulation' : 'Simulate pulse'}
              </button>
            </div>

            {derivedNodes.length === 0 ? (
              <p className="mt-1 text-xs" style={{ color: OBSERVATORY.dim }}>
                Abhi koi active nodes nahi hain.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {derivedNodes.map(path => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => onSelectNode?.(path)}
                    className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition hover:bg-white/5"
                    style={{
                      borderColor: OBSERVATORY.border,
                      background: OBSERVATORY.canvas,
                    }}
                  >
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                        style={{ background: glowColor }}
                      />
                      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: glowColor }} />
                    </span>
                    <FileText size={12} className="shrink-0" style={{ color: OBSERVATORY.muted }} />
                    <span className="font-retro-mono truncate flex-1 text-[11px]" style={{ color: OBSERVATORY.text }}>
                      {path}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recent Events feed */}
          <div className="mt-3 border-t pt-2.5" style={{ borderColor: OBSERVATORY.border }}>
            <span className="font-retro-mono text-[10px] uppercase tracking-wider" style={{ color: OBSERVATORY.muted }}>
              Recent Cognition Events
            </span>
            {events.length === 0 ? (
              <p className="mt-1 text-xs" style={{ color: OBSERVATORY.dim }}>
                Koi haliya events record nahi hue.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {events.slice(0, 5).map(event => (
                  <li
                    key={event.id}
                    className="rounded-lg p-2 text-xs"
                    style={{ background: OBSERVATORY.canvas, border: `1px solid ${OBSERVATORY.border}` }}
                  >
                    <div className="flex items-center justify-between text-[10px]" style={{ color: OBSERVATORY.dim }}>
                      <span className="flex items-center gap-1 font-retro-mono">
                        <Clock size={10} />
                        {eventTime(event.createdAt)}
                      </span>
                      <span className="font-retro-mono uppercase tracking-wider">{event.action}</span>
                    </div>
                    <p className="mt-1 truncate text-xs" style={{ color: OBSERVATORY.text }}>
                      {describeEvent(event)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
