/** Canonical lucide-react icon sizes — one shared scale instead of every
 *  call site hardcoding its own pixel number. */
export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const

export const ICON_STROKE = {
  default: 2,
  thin: 1.75,
} as const
