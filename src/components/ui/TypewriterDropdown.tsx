import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

export interface DropdownOption {
  id: string
  label: string
}

export interface TypewriterDropdownProps {
  options: DropdownOption[] | string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  dropUp?: boolean
}

export function TypewriterDropdown({
  options,
  value,
  onChange,
  placeholder = 'Select option',
  disabled = false,
  className = '',
  dropUp = false,
}: TypewriterDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Normalize options into { id, label }
  const normalizedOptions: DropdownOption[] = options.map(opt =>
    typeof opt === 'string' ? { id: opt, label: opt } : opt
  )

  const selectedOption = normalizedOptions.find(opt => opt.id === value)
  const displayLabel = selectedOption ? selectedOption.label : placeholder

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div ref={ref} className={`relative font-retro-mono text-xs select-none ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-stone-900 bg-[#FAF7F0] border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.25)] hover:shadow-[3px_3px_0px_0px_rgba(40,30,20,0.35)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_rgba(40,30,20,0.2)] transition-all text-xs font-bold uppercase tracking-wider rounded-lg outline-none focus:outline-none ${
          open ? 'bg-[#FEF3C7] border-[#B45309]' : ''
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-[#B45309] transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className={`absolute z-50 w-full min-w-[140px] bg-white border-2 border-[#281E14] shadow-[3px_3px_0px_0px_rgba(40,30,20,0.3)] py-1 rounded-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${
            dropUp ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {normalizedOptions.map(opt => {
            const isSelected = value === opt.id
            return (
              <li key={opt.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.id)
                    setOpen(false)
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 outline-none focus:outline-none ${
                    isSelected
                      ? 'bg-[#D97706] text-white'
                      : 'text-stone-800 hover:bg-[#281E14] hover:text-[#FAF7F0]'
                  }`}
                >
                  <span className={`text-[11px] transition-opacity ${isSelected ? 'opacity-100' : 'opacity-40'}`}>
                    ›
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default TypewriterDropdown
