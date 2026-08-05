import { cn } from '@/lib/utils'

const RADIUS_CLASS = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
} as const

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: keyof typeof RADIUS_CLASS
  className?: string
}

export function Skeleton({ width, height = 14, radius = 'md', className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'bg-[linear-gradient(90deg,var(--surface-2)_0%,var(--surface-3)_50%,var(--surface-2)_100%)] bg-[length:200%_100%] animate-shimmer',
        RADIUS_CLASS[radius],
        className
      )}
      style={{ width, height }}
    />
  )
}
