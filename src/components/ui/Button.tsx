import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-inverse hover:bg-accent-h',
        secondary: 'bg-transparent text-t2 border border-border hover:bg-s2 hover:text-tx',
        ghost: 'bg-transparent text-t2 hover:bg-s2 hover:text-tx',
        danger: 'bg-danger-m text-danger border border-danger hover:bg-danger hover:text-inverse',
      },
      size: {
        sm: 'h-7 px-2.5 text-[11px] rounded-md',
        md: 'h-8 px-3 text-[12.5px] rounded-md',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
)

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>,
    VariantProps<typeof buttonStyles> {
  icon?: React.ReactNode
  iconRight?: React.ReactNode
  loading?: boolean
  className?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, fullWidth, icon, iconRight, loading, disabled, children, className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonStyles({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  )
)
Button.displayName = 'Button'
