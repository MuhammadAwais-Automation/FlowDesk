import { Clock } from 'lucide-react'
import { Card } from '../Card'
import { DocumentRow } from '../DocumentRow'
import { describeEvent, documentsRead, eventTime, isOpenableEvent } from '@/lib/brainFormat'
import type { Selection } from '@/lib/brainSelection'
import type { BrainEvent, KnowledgeDocument } from '@/types/brainKnowledge'

/**
 * The day's timeline, and what changed recently.
 *
 * Every agent turn is a button: the conversation behind it is still on disk and
 * the event carries the sessionId that finds it. Rows with nothing behind them
 * -- an import, a compaction -- stay plain text rather than becoming buttons
 * that do nothing when pressed.
 */
export function TodayList({ events, recentDocuments, dailyNotePath, selection, onSelect }: {
  events: BrainEvent[]
  recentDocuments: KnowledgeDocument[]
  dailyNotePath: string | null
  selection: Selection | null
  onSelect: (next: Selection) => void
}) {
  const selectedEventId = selection?.kind === 'turn' ? selection.eventId : null
  const selectedPath = selection?.kind === 'document' ? selection.path : null

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><Clock size={17} /> Aaj</h2>
          {dailyNotePath && <button
            onClick={() => onSelect({ kind: 'document', path: dailyNotePath })}
            className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-200"
          >Daily note</button>}
        </div>
        <div className="mt-3 space-y-2">
          {events.length === 0 && <p className="text-sm text-stone-500">Aaj abhi kuch nahi hua — Agent se baat karein ya vault import karein.</p>}
          {events.map(event => {
            const read = documentsRead(event)
            const body = (
              <>
                <p className="truncate text-sm">{describeEvent(event)}</p>
                {read.length > 0 && <p className="mt-1 truncate text-xs text-stone-500">read {read.join(', ')}</p>}
              </>
            )
            return isOpenableEvent(event) ? (
              <button
                key={event.id}
                onClick={() => onSelect({ kind: 'turn', eventId: event.id })}
                aria-current={selectedEventId === event.id ? 'true' : undefined}
                className={`flex w-full gap-3 rounded-lg border-l-2 p-3 text-left transition ${
                  selectedEventId === event.id ? 'border-amber-500 bg-amber-50' : 'border-transparent bg-stone-50 hover:bg-stone-100'
                }`}
              >
                <span className="shrink-0 font-mono text-xs text-stone-400">{eventTime(event.createdAt)}</span>
                <span className="min-w-0 flex-1">{body}</span>
              </button>
            ) : (
              <div key={event.id} className="flex gap-3 rounded-lg border-l-2 border-transparent bg-stone-50 p-3">
                <span className="shrink-0 font-mono text-xs text-stone-400">{eventTime(event.createdAt)}</span>
                <div className="min-w-0 flex-1">{body}</div>
              </div>
            )
          })}
        </div>
      </Card>
      <Card>
        <h2 className="flex items-center gap-2 font-semibold"><Clock size={17} /> Recently updated</h2>
        <div className="mt-3 space-y-2">
          {recentDocuments.length === 0 && <p className="text-sm text-stone-500">Abhi koi document nahi — Health se vault import karein.</p>}
          {recentDocuments.map(document => <DocumentRow
            key={document.id}
            path={document.path}
            type={document.type}
            title={document.title}
            snippet={document.summary}
            selected={selectedPath === document.path}
            onSelect={() => onSelect({ kind: 'document', path: document.path })}
          />)}
        </div>
      </Card>
    </div>
  )
}
