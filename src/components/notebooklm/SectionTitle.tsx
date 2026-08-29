import type { LucideIcon } from 'lucide-react'
import type React from 'react'

export function SectionTitle({ icon: Icon, title, detail, action }: {
  icon: LucideIcon
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent"><Icon size={14} /></div>
        <div>
          <h2 className="text-[13px] font-bold text-tx">{title}</h2>
          {detail && <p className="mt-0.5 text-[11px] leading-relaxed text-t3">{detail}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
