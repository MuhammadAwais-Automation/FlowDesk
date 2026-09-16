import { ArrowLeft, X } from 'lucide-react'
import { DocumentDetail } from './DocumentDetail'
import { TurnDetail } from './TurnDetail'
import type { Selection, SelectionStack } from '@/lib/brainSelection'
import type { AnswerPack, BrainEvent, DocumentNeighborhood, DocumentReadResult } from '@/types/brainKnowledge'

export interface DetailCounters {
  documents: number
  review: number
  unresolvedLinks: number
}

/**
 * The right-hand column: whatever was selected last, whichever list it came
 * from.
 *
 * It is deliberately not cleared when the nav item changes. Selecting a
 * document in the Library and then looking at today's timeline used to mean
 * losing the document; keeping it is the whole point of the three-column
 * layout. It *is* cleared when the scope changes, which the shell owns --
 * a document from one client must never stay on screen under another.
 */
export function DetailPane({ stack, onBack, onClear, counters, document, neighborhood, events, pack, onSelect }: {
  stack: SelectionStack
  onBack: () => void
  onClear: () => void
  counters: DetailCounters
  document: DocumentReadResult | null
  neighborhood: DocumentNeighborhood | null
  events: BrainEvent[]
  pack: AnswerPack | null
  onSelect: (next: Selection) => void
}) {
  const selection = stack.current

  return (
    <aside aria-label="Detail" className="flex h-full min-w-0 flex-1 flex-col overflow-hidden border-l border-stone-200 bg-white">
      {selection !== null && <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-2">
        {stack.history.length > 0 && <button onClick={onBack} aria-label="Back" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"><ArrowLeft size={16} /></button>}
        <button onClick={onClear} aria-label="Close detail" className="ml-auto rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"><X size={16} /></button>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {selection === null && <EmptyDetail counters={counters} />}
        {selection?.kind === 'document' && (document
          ? <DocumentDetail document={document} neighborhood={neighborhood} events={events} onSelect={onSelect} />
          : <p className="text-sm text-stone-500">Khul raha hai…</p>)}
        {selection?.kind === 'turn' && <TurnBody events={events} eventId={selection.eventId} onSelect={onSelect} />}
        {selection?.kind === 'answer' && <AnswerPlaceholder pack={pack} />}
      </div>
    </aside>
  )
}

function EmptyDetail({ counters }: { counters: DetailCounters }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-500">Bayein taraf se kuch chunein — document, aaj ka turn, ya ek jawab.</p>
      <dl className="grid grid-cols-3 gap-3">
        <Counter label="Documents" value={counters.documents} />
        <Counter label="Review inbox" value={counters.review} />
        <Counter label="Unresolved links" value={counters.unresolvedLinks} />
      </dl>
    </div>
  )
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-stone-200 p-3">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-1 text-2xl font-bold">{value}</dd>
    </div>
  )
}

function TurnBody({ events, eventId, onSelect }: {
  events: BrainEvent[]
  eventId: string
  onSelect: (next: Selection) => void
}) {
  const event = events.find(candidate => candidate.id === eventId)
  // The day rolled over, or a refresh dropped it: say so rather than render an
  // empty turn that looks like a loading state which never finishes.
  if (!event) return <p className="text-sm text-stone-500">Ye turn ab is din mein nahi hai.</p>
  return <TurnDetail event={event} events={events} onSelect={onSelect} />
}

function AnswerPlaceholder({ pack }: { pack: AnswerPack | null }) {
  return <p className="text-sm text-stone-500">{pack ? pack.evidence : 'Koi sawal nahi poocha gaya.'}</p>
}
