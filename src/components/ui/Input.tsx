import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const fieldStyles = cva(
  'w-full bg-s2 border border-border rounded-md text-tx placeholder:text-t3 outline-none transition-colors duration-fast focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-m',
  {
    variants: {
      size: {
        sm: 'h-7 px-2 text-[11.5px]',
        md: 'h-8 px-2.5 text-[12.5px]',
      },
      invalid: {
        true: 'border-danger focus-visible:border-danger focus-visible:ring-danger-m',
      },
    },
    defaultVariants: { size: 'md' },
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'size'>,
    VariantProps<typeof fieldStyles> {
  leadingIcon?: React.ReactNode
  className?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size, invalid, leadingIcon, className, ...props }, ref) => {
    if (!leadingIcon) {
      return <input ref={ref} className={cn(fieldStyles({ size, invalid }), className)} {...props} />
    }
    return (
      <div className="relative flex items-center">
        <span className="absolute left-2.5 flex items-center text-t3 pointer-events-none">{leadingIcon}</span>
        <input ref={ref} className={cn(fieldStyles({ size, invalid }), 'pl-8', className)} {...props} />
      </div>
    )
  }
)
Input.displayName = 'Input'

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>,
    VariantProps<typeof fieldStyles> {
  className?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ size, invalid, className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldStyles({ size, invalid }), 'h-auto py-2', className)} {...props} />
  )
)
Textarea.displayName = 'Textarea'
