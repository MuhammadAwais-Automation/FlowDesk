import { useEffect, useState } from 'react'
import { toHex } from './color'

interface Props { value: string; onCommit: (hex: string) => void; className?: string }

/**
 * A native colour input fires `onChange` continuously while the picker is
 * dragged, unlike every other field in this panel (see NumberField's
 * commit-on-blur rationale). A local draft lets the swatch track the drag
 * live without posting a write on every intermediate value — the write only
 * happens on blur, and only if the draft actually changed anything.
 */
export default function ColorInput({ value, onCommit, className }: Props) {
  const hex = toHex(value)
  const [draft, setDraft] = useState(hex)
  useEffect(() => { setDraft(hex) }, [hex])

  return (
    <input
      type="color"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== hex) onCommit(draft) }}
      className={
        className ??
        'h-[var(--panel-control-h)] w-full rounded-[var(--panel-radius)] bg-s2 border border-border-soft cursor-pointer'
      }
    />
  )
}
