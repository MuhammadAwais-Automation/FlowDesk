import React, { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ImageLightbox } from './ImageLightbox'
import { CitationBadge } from './CitationBadge'
import type { NotebookLMCitation } from '@/types/notebooklm'

export interface RetroMarkdownProps {
  content: string
  pending?: boolean
  citations?: NotebookLMCitation[]
  onOpenSource?: (sourceTitle: string) => void
}

function renderWithCitations(
  children: React.ReactNode,
  citations?: NotebookLMCitation[],
  onOpenSource?: (sourceTitle: string) => void,
): React.ReactNode {
  if (typeof children === 'string') {
    if (!/\[\d+\]/.test(children)) return children
    const parts = children.split(/(\[\d+\])/g)
    return parts.map((part, index) => {
      const match = part.match(/\[(\d+)\]/)
      if (match) {
        const citationIdx = parseInt(match[1], 10)
        const citation = citations?.find(c => c.index === citationIdx) || {
          index: citationIdx,
          sourceTitle: `Source [${citationIdx}]`,
          quoteSnippet: '',
        }
        return <CitationBadge key={index} citation={citation} onOpenSource={onOpenSource} />
      }
      return part
    })
  }

  if (Array.isArray(children)) {
    return React.Children.map(children, child => renderWithCitations(child, citations, onOpenSource))
  }

  return children
}

/**
 * Renders assistant Markdown (GFM: tables, strikethrough, task lists, etc.)
 * in FlowDesk's neo-brutalist retro chat chrome. User bubbles stay plain text.
 */
export function RetroMarkdown({
  content,
  pending,
  citations,
  onOpenSource,
}: RetroMarkdownProps) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

  const components: Components = {
    h1: ({ children }) => (
      <h1 className="font-retro-tech text-base sm:text-lg font-extrabold text-[#281E14] uppercase tracking-tight mt-3 mb-1.5 first:mt-0">
        {renderWithCitations(children, citations, onOpenSource)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="font-retro-tech text-sm sm:text-[15px] font-bold text-[#281E14] uppercase tracking-tight mt-3 mb-1.5 first:mt-0 border-b border-[#281E14]/20 pb-1">
        {renderWithCitations(children, citations, onOpenSource)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="font-retro-tech text-xs sm:text-sm font-bold text-[#B45309] uppercase tracking-wide mt-2.5 mb-1 first:mt-0">
        {renderWithCitations(children, citations, onOpenSource)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="font-retro-mono text-xs font-bold text-[#281E14] mt-2 mb-1 first:mt-0">
        {renderWithCitations(children, citations, onOpenSource)}
      </h4>
    ),
    p: ({ children }) => (
      <p className="font-retro-mono text-xs sm:text-[13px] text-stone-900 leading-relaxed my-1.5 first:mt-0 last:mb-0">
        {renderWithCitations(children, citations, onOpenSource)}
      </p>
    ),
    strong: ({ children }) => (
      <strong className="font-bold text-[#281E14]">{renderWithCitations(children, citations, onOpenSource)}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-stone-800">{renderWithCitations(children, citations, onOpenSource)}</em>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-[#B45309] underline decoration-[#F59E0B]/60 underline-offset-2 hover:text-[#D97706] break-words"
      >
        {children}
      </a>
    ),
    ul: ({ children }) => (
      <ul className="retro-md__list my-1.5 space-y-1 list-none [&>li]:relative [&>li]:pl-4 [&>li]:before:absolute [&>li]:before:left-0.5 [&>li]:before:top-0 [&>li]:before:text-[#D97706] [&>li]:before:font-bold">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-1.5 ml-4 space-y-1 list-decimal marker:text-[#D97706] marker:font-retro-mono marker:font-bold">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="font-retro-mono text-xs sm:text-[13px] text-stone-900 leading-relaxed [&>p]:my-0 [&>ul]:mt-1 [&>ol]:mt-1">
        {renderWithCitations(children, citations, onOpenSource)}
      </li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 pl-3 border-l-4 border-[#D97706] bg-[#FEF3C7]/50 py-1.5 pr-2 rounded-r-md">
        <div className="font-retro-mono text-xs text-stone-800 [&>p]:my-0.5">{renderWithCitations(children, citations, onOpenSource)}</div>
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock = typeof className === 'string' && /language-/.test(className)
      if (isBlock) {
        return (
          <code className="font-retro-mono text-[11px] sm:text-xs text-stone-900 block whitespace-pre">
            {children}
          </code>
        )
      }
      return (
        <code className="font-retro-mono text-[11px] px-1 py-0.5 rounded bg-[#EBE5D5] border border-[#281E14]/20 text-[#B45309]">
          {children}
        </code>
      )
    },
    pre: ({ children }) => (
      <pre className="my-2 p-3 rounded-lg bg-[#EBE5D5] border-2 border-[#281E14]/30 overflow-x-auto shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.15)]">
        {children}
      </pre>
    ),
    hr: () => <hr className="my-3 border-0 border-t-2 border-[#281E14]/20" />,
    table: ({ children }) => (
      <div className="my-2.5 w-full overflow-x-auto rounded-lg border-2 border-[#281E14] shadow-[2px_2px_0px_0px_rgba(40,30,20,0.18)]">
        <table className="w-full border-collapse text-left min-w-[280px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-[#EBE5D5] border-b-2 border-[#281E14]">{children}</thead>
    ),
    tbody: ({ children }) => <tbody className="bg-white">{children}</tbody>,
    tr: ({ children }) => (
      <tr className="border-b border-[#281E14]/15 last:border-b-0 even:bg-[#FAF7F0]/80">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="font-retro-tech text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#281E14] px-2.5 py-2 whitespace-nowrap">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="font-retro-mono text-[11px] sm:text-xs text-stone-900 px-2.5 py-2 align-top leading-snug">
        {renderWithCitations(children, citations, onOpenSource)}
      </td>
    ),
    img: ({ src, alt }) => {
      if (!src) return null
      return (
        <img
          src={src}
          alt={alt || 'generated image'}
          onClick={() => setLightbox({ src, alt: alt || 'generated image' })}
          className="mt-2 max-w-full rounded-lg border-2 border-[#281E14]/30 cursor-zoom-in hover:opacity-90 transition-opacity"
        />
      )
    },
  }

  return (
    <>
      <div className="retro-md min-w-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
        {pending && (
          <span className="inline-block w-1.5 h-3.5 bg-[#D97706] animate-pulse ml-1 align-middle" />
        )}
      </div>
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </>
  )
}
