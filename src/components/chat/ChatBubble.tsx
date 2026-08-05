import { useState, type ReactNode } from 'react'
import { TypingIndicator } from '@/components/ui/TypingIndicator'
import { ImageLightbox } from './ImageLightbox'

// Matches `![alt](url)` — enough to render generated images (e.g. Gemini's
// image-gen replies) without pulling in a full Markdown renderer for one
// syntax. `url` also accepts flowdesk-image:// (files saved by
// downloadAndSaveGeneratedImage in main.ts) alongside http(s). Text around
// each match renders as plain text, same as before.
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(((?:https?|flowdesk-image):\/\/[^\s)]+)\)/g

function renderContentWithImages(content: string, onImageClick: (src: string, alt: string) => void) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  MARKDOWN_IMAGE.lastIndex = 0
  while ((match = MARKDOWN_IMAGE.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index))
    const [, alt, url] = match
    parts.push(
      <img
        key={match.index}
        src={url}
        alt={alt || 'generated image'}
        onClick={() => onImageClick(url, alt || 'generated image')}
        className="mt-2 max-w-full rounded-lg border border-[#D8D1C3] cursor-zoom-in hover:opacity-90 transition-opacity"
      />
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex))
  return parts
}

export interface ChatBubbleProps {
  role: 'user' | 'assistant'
  content: string
  label?: string
  pending?: boolean
  pendingText?: string
  toolCalls?: React.ReactNode
}

export function ChatBubble({ role, content, label, pending, pendingText, toolCalls }: ChatBubbleProps) {
  const isUser = role === 'user'
  const showTyping = pending && !content.trim()
  const typingLabel = pendingText ?? (label ? `${label} is working…` : 'AI is working…')
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

  return (
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-200`}>
      <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[78%] px-4 py-3 rounded-2xl ${
            isUser
              ? 'bg-[#D97706] text-white shadow-[1px_2px_0px_0px_rgba(180,83,9,0.3)]'
              : 'bg-white border-2 border-[#D8D1C3] text-stone-900 shadow-[0_2px_8px_rgba(40,30,20,0.04)]'
          }`}
        >
          {!isUser && label && (
            <div className="font-retro-tech text-[10px] font-bold uppercase tracking-widest text-[#B45309] mb-1.5 flex items-center gap-1.5 select-none">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D97706] animate-pulse" />
              <span>{label}</span>
            </div>
          )}
          {showTyping ? (
            <div className="flex items-center gap-2 py-0.5">
              <TypingIndicator />
              <span className="font-retro-mono text-xs text-stone-500 italic">{typingLabel}</span>
            </div>
          ) : (
            <div className={`whitespace-pre-wrap text-xs sm:text-[13px] leading-relaxed ${
              isUser
                ? 'font-retro-sans font-medium text-white tracking-wide'
                : 'font-retro-mono font-medium text-stone-900 tracking-tight'
            }`}>
              {renderContentWithImages(content, (src, alt) => setLightbox({ src, alt }))}
              {pending && (
                <span className="inline-block w-1.5 h-3.5 bg-[#D97706] animate-pulse ml-1 align-middle" />
              )}
            </div>
          )}
        </div>
      </div>

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}

      {toolCalls && <div className="w-full">{toolCalls}</div>}
    </div>
  )
}
