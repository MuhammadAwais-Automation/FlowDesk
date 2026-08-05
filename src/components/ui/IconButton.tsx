import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { ICON_SIZE } from '@/lib/iconSizes'

const iconButtonStyles = cva(
  'inline-flex items-center justify-center shrink-0 transition-colors duration-fast outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed rounded-md',
  {
    variants: {
      variant: {
        default: 'bg-transparent text-t2 hover:bg-s2 hover:text-tx',
        primary: 'bg-accent text-inverse hover:bg-accent-h disabled:bg-s3 disabled:text-t3',
        danger: 'bg-transparent text-t2 hover:bg-danger-m hover:text-danger',
      },
      size: {
        sm: 'w-6 h-6',
        md: 'w-[30px] h-[30px]',
      },
      active: {
        true: '',
      },
    },
    compoundVariants: [
      { variant: 'default', active: true, class: 'bg-s2 text-tx' },
    ],
    defaultVariants: { variant: 'default', size: 'md' },
  }
)

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>,
    VariantProps<typeof iconButtonStyles> {
  icon: React.ElementType
  label: string
  className?: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, label, variant, size, active, className, ...props }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(iconButtonStyles({ variant, size, active }), className)}
      {...props}
    >
      <Icon size={size === 'sm' ? ICON_SIZE.xs : ICON_SIZE.md} />
    </button>
  )
)
IconButton.displayName = 'IconButton'
