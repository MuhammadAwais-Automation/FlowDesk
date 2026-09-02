import { useEffect, useState } from 'react'

interface Props { label: string; value: string; onCommit: (raw: string) => void }

/**
 * Commits on blur and Enter rather than on every keystroke: a keystroke-level
 * write would put every intermediate value into the undo stack, so typing
 * "120" would record 1, 12, then 120.
 */
export default function NumberField({ label, value, onCommit }: Props) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  return (
    <label className="flex items-center gap-1.5 min-w-0">
      <span className="w-3 shrink-0 text-t3 text-[length:var(--panel-label)]">{label}</span>
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={e => {
          if (e.key === 'Enter') { onCommit(draft); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
        }}
        className="min-w-0 flex-1 h-[var(--panel-control-h)] rounded-[var(--panel-radius)] bg-s2 border border-border-soft px-2
                   text-[length:var(--panel-input)] font-mono tabular-nums text-tx
                   focus:outline-none focus:border-accent-border focus:ring-1 focus:ring-accent-border transition-colors"
      />
    </label>
  )
}
