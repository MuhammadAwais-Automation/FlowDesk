import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const cardStyles = cva('bg-surface border border-border rounded-lg', {
  variants: {
    padding: {
      none: '',
      sm: 'p-2',
      md: 'p-3.5',
      lg: 'p-5',
    },
    interactive: {
      true: 'hover:border-accent-border hover:shadow-sm transition-shadow duration-base cursor-pointer',
    },
  },
  defaultVariants: { padding: 'md' },
})

export interface CardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'>,
    VariantProps<typeof cardStyles> {
  className?: string
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding, interactive, className, ...props }, ref) => (
    <div ref={ref} className={cn(cardStyles({ padding, interactive }), className)} {...props} />
  )
)
Card.displayName = 'Card'
