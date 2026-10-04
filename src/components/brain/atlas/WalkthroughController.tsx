import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Compass, Pause, Play, X } from 'lucide-react'
import { OBSERVATORY } from '@/lib/atlasTheme'

export interface WalkthroughStep {
  path: string
  title: string
  explanation?: string
  text?: string
  headingPath?: string
}

export interface WalkthroughControllerProps {
  steps?: WalkthroughStep[]
  walkthrough?: {
    title?: string
    steps: WalkthroughStep[]
  } | null
  currentStep?: number
  activeStep?: number
  onStepChange?: (step: number) => void
  onSelect?: (path: string) => void
  onClose?: () => void
  autoPlayIntervalMs?: number
}

export function WalkthroughController({
  steps: directSteps,
  walkthrough,
  currentStep,
  activeStep,
  onStepChange,
  onSelect,
  onClose,
  autoPlayIntervalMs = 4000,
}: WalkthroughControllerProps) {
  const steps = directSteps ?? walkthrough?.steps ?? []
  const controlledIndex = currentStep ?? activeStep

  const [internalIndex, setInternalIndex] = useState(0)
  const [autoPlay, setAutoPlay] = useState(false)

  const currentIndex = controlledIndex !== undefined ? controlledIndex : internalIndex

  const goToStep = useCallback((newIndex: number) => {
    if (newIndex < 0 || newIndex >= steps.length) return
    if (controlledIndex === undefined) {
      setInternalIndex(newIndex)
    }
    onStepChange?.(newIndex)
    const targetStep = steps[newIndex]
    if (targetStep?.path) {
      onSelect?.(targetStep.path)
    }
  }, [steps, controlledIndex, onStepChange, onSelect])

  // Auto-play timer
  useEffect(() => {
    if (!autoPlay || steps.length <= 1) return
    const timer = setInterval(() => {
      const nextIndex = (currentIndex + 1) % steps.length
      goToStep(nextIndex)
    }, autoPlayIntervalMs)
    return () => clearInterval(timer)
  }, [autoPlay, currentIndex, steps.length, autoPlayIntervalMs, goToStep])

  if (steps.length === 0) return null

  const current = steps[currentIndex] ?? steps[0]
  const explanation = current.explanation ?? current.text ?? ''

  return (
    <div
      role="region"
      aria-label="Tour walkthrough"
      className="pointer-events-auto flex w-full max-w-[420px] flex-col rounded-xl border p-3.5 shadow-2xl backdrop-blur-md"
      style={{
        background: OBSERVATORY.raised,
        borderColor: OBSERVATORY.border,
        borderLeftColor: OBSERVATORY.accent,
        borderLeftWidth: 2,
        color: OBSERVATORY.text,
      }}
    >
      {/* Header bar: Badge, Step counter, Auto-play, Close */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Compass size={14} style={{ color: OBSERVATORY.accent }} className="shrink-0" />
          <span className="font-retro-mono text-[11px] font-bold tracking-wider" style={{ color: OBSERVATORY.accent }}>
            Step {currentIndex + 1} of {steps.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={autoPlay ? 'Pause auto-play' : 'Start auto-play'}
            onClick={() => setAutoPlay(prev => !prev)}
            className={`font-retro-mono flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition ${
              autoPlay
                ? 'bg-[#d97706] text-white shadow-[0_0_8px_rgba(217,119,6,0.35)]'
                : 'border border-[#2a3142] bg-[#141824] text-slate-300 hover:border-[#d97706]/60 hover:text-white'
            }`}
          >
            {autoPlay ? <Pause size={10} /> : <Play size={10} />}
            <span>{autoPlay ? 'Pause' : 'Auto-play'}</span>
          </button>

          {onClose && (
            <button
              type="button"
              aria-label="Close walkthrough"
              onClick={onClose}
              className="rounded-md p-1 transition hover:bg-white/10"
              style={{ color: OBSERVATORY.muted }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Body: Title & Explanation */}
      <div className="mt-2.5 min-w-0">
        <div className="font-retro-sans text-sm font-semibold text-slate-200 truncate">
          {current.title}
        </div>
        {current.headingPath && (
          <div className="font-retro-mono mt-0.5 text-[10px]" style={{ color: OBSERVATORY.muted }}>
            #{current.headingPath}
          </div>
        )}
        {explanation && (
          <p className="font-retro-sans mt-1.5 text-xs leading-relaxed text-slate-300 line-clamp-3">
            {explanation}
          </p>
        )}
      </div>

      {/* Footer controls: Step dots and Prev/Next */}
      <div className="mt-3 flex items-center justify-between border-t pt-2.5" style={{ borderColor: OBSERVATORY.border }}>
        {/* Step dots */}
        <div className="flex items-center gap-1">
          {steps.map((_, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Go to step ${idx + 1}`}
              onClick={() => goToStep(idx)}
              className={`h-1.5 rounded-full transition-all ${
                idx === currentIndex
                  ? 'w-4 bg-[#d97706]'
                  : 'w-1.5 bg-[#2a3142] hover:bg-slate-500'
              }`}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous step"
            disabled={currentIndex === 0}
            onClick={() => goToStep(currentIndex - 1)}
            className="flex items-center gap-0.5 rounded-lg border border-[#2a3142] px-2 py-1 font-retro-sans text-xs text-slate-300 transition hover:border-[#d97706]/40 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#2a3142] disabled:hover:bg-transparent disabled:hover:text-slate-300"
          >
            <ChevronLeft size={13} />
            <span>Prev</span>
          </button>

          <button
            type="button"
            aria-label="Next step"
            disabled={currentIndex === steps.length - 1}
            onClick={() => goToStep(currentIndex + 1)}
            className="flex items-center gap-0.5 rounded-lg border border-[#2a3142] px-2 py-1 font-retro-sans text-xs text-slate-300 transition hover:border-[#d97706]/40 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#2a3142] disabled:hover:bg-transparent disabled:hover:text-slate-300"
          >
            <span>Next</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
