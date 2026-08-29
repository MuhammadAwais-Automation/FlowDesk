import React, { useState } from 'react'
import type { NotebookLMCitation } from '@/types/notebooklm'

export interface CitationBadgeProps {
  citation: NotebookLMCitation
  onOpenSource?: (sourceTitle: string) => void
}

export function CitationBadge({ citation, onOpenSource }: CitationBadgeProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <span className="relative inline-block mx-0.5 align-super select-none">
      <button
        type="button"
        onClick={() => onOpenSource?.(citation.sourceTitle)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 text-[10px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#D97706]/40 rounded hover:bg-[#FDE68A] hover:border-[#D97706] transition-colors cursor-pointer"
        aria-label={`Citation ${citation.index}: ${citation.sourceTitle}`}
      >
        {citation.index}
      </button>

      {isHovered && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 p-2.5 bg-white dark:bg-stone-900 border-2 border-[#281E14] rounded-lg shadow-[3px_3px_0px_0px_rgba(40,30,20,0.2)] text-left text-xs pointer-events-none transition-opacity duration-150">
          <div className="flex items-center gap-1.5 font-bold font-retro-tech text-stone-900 dark:text-stone-100 mb-1 truncate">
            <span className="text-[#D97706]">📄</span>
            <span className="truncate">{citation.sourceTitle}</span>
            {citation.pageNumber && (
              <span className="text-stone-400 font-normal text-[10px]">p.{citation.pageNumber}</span>
            )}
          </div>
          {citation.quoteSnippet ? (
            <p className="font-retro-mono text-stone-700 dark:text-stone-300 line-clamp-3 italic text-[11px] bg-[#FAF7F0] dark:bg-stone-800/80 p-1.5 rounded border border-[#281E14]/15">
              "{citation.quoteSnippet}"
            </p>
          ) : (
            <p className="font-retro-mono text-stone-500 text-[10px] italic">
              Click to view source in NotebookLM
            </p>
          )}
        </div>
      )}
    </span>
  )
}
