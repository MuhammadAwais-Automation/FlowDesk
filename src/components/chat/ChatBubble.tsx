import { TypingIndicator } from '@/components/ui/TypingIndicator'
import { RetroMarkdown } from './RetroMarkdown'
import type { NotebookLMCitation } from '@/types/notebooklm'

export interface ChatBubbleProps {
  role: 'user' | 'assistant'
  content: string
  label?: string
  pending?: boolean
  pendingText?: string
  toolCalls?: React.ReactNode
  citations?: NotebookLMCitation[]
  onOpenSource?: (sourceTitle: string) => void
}

export function ChatBubble({ role, content, label, pending, pendingText, toolCalls, citations, onOpenSource }: ChatBubbleProps) {
  const isUser = role === 'user'
  const showTyping = pending && !content.trim()
  const typingLabel = pendingText ?? (label ? `${label} is working…` : 'AI is working…')

  // Worker tool cards render ABOVE the assistant bubble so they stay visible
  // when the final synthesis arrives (they used to sit below and felt like they
  // disappeared under the long final reply).
  return (
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-200`}>
      {toolCalls && <div className="w-full">{toolCalls}</div>}

      {(content.trim() || showTyping || pending) && (
        <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`px-4 py-3 rounded-2xl ${
              isUser
                ? 'max-w-[78%] bg-[#D97706] text-white shadow-[1px_2px_0px_0px_rgba(180,83,9,0.3)]'
                : 'max-w-[92%] sm:max-w-[88%] bg-white border-2 border-[#D8D1C3] text-stone-900 shadow-[0_2px_8px_rgba(40,30,20,0.04)]'
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
            ) : isUser ? (
              <div className="whitespace-pre-wrap text-xs sm:text-[13px] leading-relaxed font-retro-sans font-medium text-white tracking-wide">
                {content}
              </div>
            ) : (
              <RetroMarkdown content={content} pending={pending} citations={citations} onOpenSource={onOpenSource} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
