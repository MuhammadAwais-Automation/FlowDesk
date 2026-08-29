import React from 'react'
import { CheckCircle, AlertCircle, Loader2, Sparkles, X, Terminal } from 'lucide-react'
import type { JarvisHeavyTaskState } from '@/types/database'

interface JarvisHeavyTaskCardProps {
  task: JarvisHeavyTaskState
  onAbort?: () => void
}

export const JarvisHeavyTaskCard: React.FC<JarvisHeavyTaskCardProps> = ({ task, onAbort }) => {
  const isRunning = task.status === 'running'
  const isCompleted = task.status === 'completed'
  const isFailed = task.status === 'failed'

  return (
    <div className="rounded-xl border border-[#F59E0B]/30 bg-[#FEF3C7]/60 dark:bg-stone-900/80 p-4 shadow-sm backdrop-blur-sm transition-all duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              isRunning
                ? 'bg-[#F59E0B] text-white animate-pulse'
                : isCompleted
                ? 'bg-emerald-500 text-white'
                : 'bg-red-500 text-white'
            }`}
          >
            {isRunning && <Loader2 size={16} className="animate-spin" />}
            {isCompleted && <CheckCircle size={16} />}
            {isFailed && <AlertCircle size={16} />}
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-retro-mono text-xs font-bold uppercase tracking-wider text-[#B45309] dark:text-[#FBBF24]">
              <Sparkles size={12} />
              <span>Heavy Agent Task</span>
              <span className="text-[10px] font-normal opacity-70">
                ({new Date(task.startedAt).toLocaleTimeString()})
              </span>
            </div>
            <p className="mt-0.5 text-xs font-medium text-stone-800 dark:text-stone-200 line-clamp-1">
              {task.prompt}
            </p>
          </div>
        </div>

        {isRunning && onAbort && (
          <button
            onClick={onAbort}
            className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
            title="Cancel background task"
          >
            <X size={12} />
            <span>Cancel</span>
          </button>
        )}
      </div>

      {/* Progress / Result message */}
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/80 dark:bg-stone-950/80 px-3 py-2 text-xs font-retro-mono text-stone-700 dark:text-stone-300 border border-stone-200/50 dark:border-stone-800">
        <Terminal size={14} className="shrink-0 text-[#F59E0B]" />
        <span className="truncate">
          {task.progressMessage || (isRunning ? 'Processing workstation tools...' : isCompleted ? 'Completed.' : 'Failed.')}
        </span>
      </div>
    </div>
  )
}
