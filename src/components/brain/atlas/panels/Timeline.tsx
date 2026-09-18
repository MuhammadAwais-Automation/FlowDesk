import { describeEvent, documentsRead, eventTime, isOpenableEvent } from '@/lib/brainFormat'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { Selection } from '@/lib/brainSelection'
import type { BrainEvent } from '@/types/brainKnowledge'

/**
 * What happened, most recent first.
 *
 * An agent turn with no prompt is the interesting case. `main.ts` stores the
 * prompt only when brain writes are allowed, because temporary mode promises
 * not to keep what was said — so an empty row is the promise being kept, not
 * data going missing. The row says which it is.
 */
export function Timeline({ events, onSelect, onHighlight }: {
  events: BrainEvent[]
  onSelect: (next: Selection) => void
  onHighlight: (paths: string[]) => void
}) {
  if (events.length === 0) {
    return (
      <p className="font-retro-sans text-sm" style={{ color: OBSERVATORY.dim }}>
        Aaj abhi kuch nahi hua — Agent se baat karein ya Health se vault import karein.
      </p>
    )
  }

  return (
    <ol className="space-y-1">
      {[...events].reverse().map(event => {
        const described = describeEvent(event)
        const untitled = event.action === 'agent.turn' && typeof event.metadata.prompt !== 'string'
        const read = documentsRead(event)
        const body = (
          <span className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-retro-mono shrink-0 text-[11px]" style={{ color: OBSERVATORY.dim }}>{eventTime(event.createdAt)}</span>
            <span className="font-retro-sans min-w-0 flex-1 truncate text-sm" style={{ color: untitled ? OBSERVATORY.muted : OBSERVATORY.text }}>
              {untitled ? 'Agent turn · temporary mode — prompt save nahi hua' : described}
            </span>
          </span>
        )
        return (
          <li key={event.id} className="rounded-lg px-2 py-1.5 transition hover:bg-white/5">
            {isOpenableEvent(event)
              ? <button onClick={() => onSelect({ kind: 'turn', eventId: event.id })} className="w-full text-left">{body}</button>
              : body}
            {read.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1 pl-[54px]">
                {read.map(path => (
                  <button
                    key={path}
                    onClick={() => onHighlight([path])}
                    className="font-retro-mono rounded border px-1.5 py-0.5 text-[10px] transition hover:bg-white/5"
                    style={{ borderColor: OBSERVATORY.border, color: OBSERVATORY.muted }}
                  >
                    {path}
                  </button>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
