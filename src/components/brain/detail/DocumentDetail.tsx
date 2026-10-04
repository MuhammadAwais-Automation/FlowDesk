import { useMemo, useRef } from 'react'
import { Link2, List } from 'lucide-react'
import { NeighborhoodGraph } from './NeighborhoodGraph'
import { RetroMarkdown } from '@/components/chat/RetroMarkdown'
import { describeEvent, documentsRead, eventTime } from '@/lib/brainFormat'
import { markdownOutline } from '@/lib/markdownOutline'
import type { Selection } from '@/lib/brainSelection'
import type { BrainEvent, DocumentNeighborhood, DocumentReadResult } from '@/types/brainKnowledge'

const INDENT: Record<number, string> = { 1: 'pl-0', 2: 'pl-3', 3: 'pl-6' }

/**
 * A document, with the context that makes it checkable: its own shape, what it
 * links to, and which turns actually read it.
 *
 * "Sab ek jagah nahi dikhta" was the complaint. Opening a document used to show
 * the text alone -- its links lived in another card, and the fact that an agent
 * turn had read it was recorded but never shown anywhere.
 */
export function DocumentDetail({ document, neighborhood, events, onSelect }: {
  document: DocumentReadResult
  neighborhood: DocumentNeighborhood | null
  events: BrainEvent[]
  onSelect: (next: Selection) => void
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const outline = useMemo(() => markdownOutline(document.text), [document.text])
  const readers = events.filter(event => event.action === 'agent.turn' && documentsRead(event).includes(document.path))

  /**
   * Scrolls to a heading by its text.
   *
   * The markdown renderer is shared with the chat surfaces and does not put ids
   * on headings; matching on text keeps this component from reaching into it.
   * Two identical headings in one document would scroll to the first -- an
   * acceptable cost for not forking the renderer.
   */
  function scrollToHeading(text: string) {
    const headings = bodyRef.current?.querySelectorAll('h1, h2, h3, h4')
    for (const heading of headings ?? []) {
      if (heading.textContent?.trim() === text) {
        heading.scrollIntoView({ block: 'start' })
        return
      }
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{document.title}</h2>
        <p className="mt-1 text-xs text-[#94a3b8]">{document.type} · {document.path} · updated {document.updatedAt}</p>
      </div>

      {outline.length > 0 && <nav aria-label="Outline" className="rounded-xl border border-[#2a3142] bg-[#1a2030] p-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#94a3b8]"><List size={13} /> Outline</p>
        <div className="mt-2 space-y-0.5">
          {outline.map(entry => <button
            key={`${entry.line}-${entry.text}`}
            onClick={() => scrollToHeading(entry.text)}
            className={`block w-full truncate rounded px-1 py-0.5 text-left text-xs text-slate-300 hover:bg-white/10 hover:text-white ${INDENT[entry.level] ?? 'pl-6'}`}
          >{entry.text}</button>)}
        </div>
      </nav>}

      <div
        ref={bodyRef}
        className="text-sm text-[#cbd5e1] [&_h1]:text-[#cbd5e1] [&_h2]:text-[#cbd5e1] [&_h2]:border-[#2a3142] [&_h3]:text-amber-500 [&_h4]:text-[#cbd5e1] [&_p]:text-[#cbd5e1] [&_strong]:text-slate-100 [&_em]:text-[#94a3b8] [&_li]:text-[#cbd5e1] [&_blockquote]:border-amber-500 [&_blockquote]:bg-[#1a2030] [&_blockquote_div]:text-[#cbd5e1] [&_code]:!border-[#2a3142] [&_code]:!bg-[#1a2030] [&_code]:!text-amber-400 [&_pre]:!border-[#2a3142] [&_pre]:!bg-[#1a2030] [&_table]:!border-[#2a3142] [&_thead]:!bg-[#1a2030] [&_th]:!border-[#2a3142] [&_th]:!text-slate-200 [&_tbody]:!bg-transparent [&_td]:!text-[#cbd5e1] [&_tr]:!border-[#2a3142] [&_tr]:!bg-transparent"
      >
        <RetroMarkdown content={document.text} />
      </div>

      {document.truncated && <p className="text-xs text-amber-500">Ye document token budget par kata gaya hai.</p>}

      {neighborhood && <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Link2 size={15} /> Connected documents</h3>
        <p className="mt-1 text-xs text-[#94a3b8]">Do hop tak. Kisi bhi circle par click karke wo document kholein.</p>
        <div className="mt-2"><NeighborhoodGraph neighborhood={neighborhood} onOpen={path => onSelect({ kind: 'document', path })} /></div>
      </div>}

      {readers.length > 0 && <div>
        <h3 className="text-sm font-semibold text-slate-200">Aaj ke kin turns ne ye padha</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {readers.map(event => <button
            key={event.id}
            onClick={() => onSelect({ kind: 'turn', eventId: event.id })}
            className="max-w-full truncate rounded-full border border-[#2a3142] bg-[#1a2030] px-3 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
          >{eventTime(event.createdAt)} · {describeEvent(event)}</button>)}
        </div>
      </div>}
    </div>
  )
}
