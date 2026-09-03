import { AlertTriangle, AlertOctagon, Sparkles } from 'lucide-react'
import type { LintFinding } from '@/lib/designLint'

interface Props {
  findings: LintFinding[]
  /**
   * Called with the offending finding when the user clicks "Fix with
   * agent". Wiring this to an actual agent message is a later integration
   * point (Task 12+) — this component's job stops at calling the prop.
   */
  onFixWithAgent: (finding: LintFinding) => void
}

const SEVERITY_STYLES: Record<LintFinding['severity'], { icon: typeof AlertTriangle; text: string; bg: string; border: string }> = {
  error: { icon: AlertOctagon, text: 'text-danger', bg: 'bg-danger-m', border: 'border-danger/30' },
  warning: { icon: AlertTriangle, text: 'text-warning', bg: 'bg-warning-m', border: 'border-warning/30' },
}

export default function LintPanel({ findings, onFixWithAgent }: Props) {
  if (findings.length === 0) {
    return (
      <div className="px-3 py-4 text-[length:var(--panel-label)] text-t3">
        No design-lint violations on this artboard.
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-1.5 px-2 py-2">
      {findings.map((finding, i) => {
        const style = SEVERITY_STYLES[finding.severity]
        const Icon = style.icon
        return (
          <li
            key={`${finding.rule}-${finding.elementId ?? 'artboard'}-${i}`}
            className={`rounded-[var(--panel-radius)] border ${style.border} ${style.bg} px-2.5 py-2 flex flex-col gap-1.5`}
          >
            <div className="flex items-start gap-1.5">
              <Icon size={13} className={`shrink-0 mt-[1px] ${style.text}`} />
              <div className="min-w-0 flex-1">
                <div className={`text-[length:var(--panel-label)] font-medium ${style.text}`}>
                  {finding.rule}
                </div>
                <p className="text-[length:var(--panel-input)] text-t2 mt-0.5">{finding.message}</p>
                <p className="text-[length:var(--panel-input)] text-t3 mt-1 italic">{finding.fixHint}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onFixWithAgent(finding)}
              className="self-start flex items-center gap-1 rounded-[var(--panel-radius)] bg-s2 hover:bg-s3
                         px-2 h-[var(--panel-control-h)] text-[length:var(--panel-label)] text-tx transition-colors"
            >
              <Sparkles size={12} />
              Fix with agent
            </button>
          </li>
        )
      })}
    </ul>
  )
}
