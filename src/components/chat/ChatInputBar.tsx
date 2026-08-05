import { useState, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { ICON_SIZE } from '@/lib/iconSizes'

export interface ChatInputBarProps {
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  sending: boolean
  placeholder?: string
  placeholders?: string[]
  autoFocus?: boolean
  leftSlot?: React.ReactNode
  onStop?: () => void
  className?: string
  retroStyle?: boolean
}

function useTypewriterPlaceholder(placeholders?: string[], fallback = ''): string {
  const [displayText, setDisplayText] = useState('')
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!placeholders || placeholders.length === 0) {
      setDisplayText(fallback)
      return
    }

    const currentPhrase = placeholders[phraseIndex % placeholders.length]
    const typingSpeed = isDeleting ? 25 : 55

    let timer: ReturnType<typeof setTimeout>

    if (!isDeleting && displayText === currentPhrase) {
      timer = setTimeout(() => setIsDeleting(true), 2500)
    } else if (isDeleting && displayText === '') {
      setIsDeleting(false)
      setPhraseIndex(prev => (prev + 1) % placeholders.length)
    } else {
      timer = setTimeout(() => {
        setDisplayText(
          isDeleting
            ? currentPhrase.substring(0, displayText.length - 1)
            : currentPhrase.substring(0, displayText.length + 1)
        )
      }, typingSpeed)
    }

    return () => clearTimeout(timer)
  }, [displayText, isDeleting, phraseIndex, placeholders, fallback])

  return placeholders && placeholders.length > 0 ? displayText : fallback
}

export function ChatInputBar({
  input,
  onInputChange,
  onSend,
  onKeyDown,
  sending,
  placeholder = '',
  placeholders,
  autoFocus,
  leftSlot,
  onStop,
  className = '',
  retroStyle = true,
}: ChatInputBarProps) {
  const animatedPlaceholder = useTypewriterPlaceholder(placeholders, placeholder)
  const activePlaceholder = sending ? placeholder || 'Processing payload...' : animatedPlaceholder

  if (retroStyle) {
    return (
      <div className={`rounded-xl border-2 border-[#281E14] bg-white flex flex-col gap-2.5 p-3 shadow-[3px_3px_0px_0px_rgba(40,30,20,0.25)] transition-all ${className}`}>
        <textarea
          autoFocus={autoFocus}
          value={input}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
          placeholder={activePlaceholder}
          rows={2}
          className="resize-none border-none outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 bg-transparent text-xs sm:text-sm font-retro-mono leading-relaxed text-stone-900 placeholder:text-stone-400"
          style={{ opacity: sending ? 0.6 : 1 }}
        />
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E2DBD0]">
          {leftSlot ? <div className="mr-auto">{leftSlot}</div> : <div />}
          <div className="flex items-center gap-2">
            {onStop && sending && (
              <button
                type="button"
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#DC2626] text-white border-2 border-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.3)] hover:shadow-[2.5px_2.5px_0px_0px_rgba(40,30,20,0.35)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase transition-all"
              >
                <Square size={13} />
                <span>Stop</span>
              </button>
            )}
            <button
              type="button"
              onClick={onSend}
              disabled={sending || !input.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D97706] hover:bg-[#B45309] disabled:bg-stone-300 disabled:text-stone-500 disabled:border-stone-400 disabled:shadow-none text-white border-2 border-[#281E14] shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.3)] hover:shadow-[2.5px_2.5px_0px_0px_rgba(40,30,20,0.35)] active:translate-x-[1px] active:translate-y-[1px] font-retro-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              <span>Send</span>
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-2xl border flex flex-col gap-2 px-3.5 pt-3 pb-2.5 ${className}`}
      style={{ borderColor: 'var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}
    >
      <textarea
        autoFocus={autoFocus}
        value={input}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={sending}
        placeholder={activePlaceholder}
        rows={2}
        className="resize-none border-none outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 bg-transparent text-[13.5px] leading-relaxed"
        style={{ color: 'var(--text)', fontFamily: 'var(--font-sans)', opacity: sending ? 0.6 : 1 }}
      />
      <div className="flex items-center justify-end gap-2">
        {leftSlot && <div className="mr-auto">{leftSlot}</div>}
        {onStop && sending && (
          <Button variant="danger" size="sm" icon={<Square size={ICON_SIZE.xs} />} onClick={onStop}>
            Stop
          </Button>
        )}
        <IconButton
          icon={Send}
          label="Send"
          variant="primary"
          onClick={onSend}
          disabled={sending || !input.trim()}
        />
      </div>
    </div>
  )
}
