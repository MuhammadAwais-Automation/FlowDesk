import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props { title: string; defaultOpen?: boolean; children: ReactNode }

export default function PanelSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-border-soft">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-t2 hover:text-tx transition-colors"
      >
        <span className="text-[length:var(--panel-label)] font-medium">{title}</span>
        <ChevronDown size={13} className={open ? '' : '-rotate-90'} />
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-[var(--panel-gap)]">{children}</div>}
    </section>
  )
}
