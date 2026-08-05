import { cn } from '@/lib/utils'

type NamedTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'
type CustomTone = { bg: string; text: string }
export type BadgeTone = NamedTone | CustomTone

const TONE_CLASSES: Record<NamedTone, string> = {
  neutral: 'bg-s2 text-t2',
  accent: 'bg-accent-m text-accent',
  success: 'bg-success-m text-success',
  danger: 'bg-danger-m text-danger',
  warning: 'bg-warning-m text-warning',
}

function isCustomTone(tone: BadgeTone): tone is CustomTone {
  return typeof tone === 'object'
}

export interface BadgeProps {
  tone?: BadgeTone
  size?: 'sm' | 'md'
  dot?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', size = 'md', dot, icon, children, className }: BadgeProps) {
  const custom = isCustomTone(tone)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]',
        !custom && TONE_CLASSES[tone],
        className
      )}
      style={custom ? { background: tone.bg, color: tone.text } : undefined}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
      {icon}
      {children}
    </span>
  )
}
