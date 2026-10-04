import { useEffect } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { AnswerDetail } from '../detail/AnswerDetail'
import { DocumentDetail } from '../detail/DocumentDetail'
import { TurnDetail } from '../detail/TurnDetail'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { Selection, SelectionStack } from '@/lib/brainSelection'
import type { AnswerPack, BrainEvent, DocumentNeighborhood, DocumentReadResult } from '@/types/brainKnowledge'

/**
 * The detail pane as a drawer floating over the map.
 *
 * Only the frame changed. The bodies — `DocumentDetail`, `AnswerDetail`,
 * `TurnDetail` — and the selection stack behind them are the ones the previous
 * design settled, and they were not what was wrong with it. What changed is
 * that nothing selected now means no drawer, so the map keeps the whole screen
 * until you ask for something.
 */
export function DetailDrawer({ stack, onBack, onClear, document, neighborhood, events, pack, onSelect }: {
  stack: SelectionStack
  onBack: () => void
  onClear: () => void
  document: DocumentReadResult | null
  neighborhood: DocumentNeighborhood | null
  events: BrainEvent[]
  pack: AnswerPack | null
  onSelect: (next: Selection) => void
}) {
  const selection = stack.current

  useEffect(() => {
    if (selection === null) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClear() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, onClear])

  if (selection === null) return null

  const title = selection.kind === 'document' ? selection.path
    : selection.kind === 'answer' ? selection.question
      : 'Agent turn'

  return (
    <aside
      aria-label="Detail"
      className="flex h-full w-[420px] max-w-[calc(100vw-32px)] shrink-0 flex-col overflow-hidden rounded-xl border"
      style={{ background: OBSERVATORY.raised, borderColor: OBSERVATORY.border, borderLeftColor: OBSERVATORY.accent, borderLeftWidth: 2 }}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: OBSERVATORY.border }}>
        {stack.history.length > 0 && (
          <button onClick={onBack} aria-label="Back" className="rounded-lg p-1 transition hover:bg-white/5" style={{ color: OBSERVATORY.muted }}>
            <ArrowLeft size={15} />
          </button>
        )}
        <span className="font-retro-mono min-w-0 flex-1 truncate text-[11px]" style={{ color: OBSERVATORY.muted }}>{title}</span>
        <button onClick={onClear} aria-label="Close detail" className="rounded-lg p-1 transition hover:bg-white/5" style={{ color: OBSERVATORY.muted }}>
          <X size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" style={{ color: OBSERVATORY.text }}>
        {selection.kind === 'document' && (document
          ? <DocumentDetail document={document} neighborhood={neighborhood} events={events} onSelect={onSelect} />
          : <p className="font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>Khul raha hai…</p>)}
        {selection.kind === 'answer' && (pack
          ? <AnswerDetail pack={pack} onSelect={onSelect} />
          : <p className="font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>Jawab aa raha hai…</p>)}
        {selection.kind === 'turn' && (() => {
          const event = events.find(candidate => candidate.id === selection.eventId)
          return event
            ? <TurnDetail event={event} events={events} onSelect={onSelect} />
            : <p className="font-retro-mono text-xs" style={{ color: OBSERVATORY.dim }}>Ye turn ab is window mein nahi hai.</p>
        })()}
      </div>
    </aside>
  )
}
