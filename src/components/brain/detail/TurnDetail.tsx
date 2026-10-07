import { describeEvent, documentsRead, eventTime } from '@/lib/brainFormat'
import type { Selection } from '@/lib/brainSelection'
import type { BrainEvent } from '@/types/brainKnowledge'

function numberField(event: BrainEvent, key: string): number | null {
  const value = event.metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * One agent turn: what was asked, what came back, what it cost, what it read
 * and what it changed in the world.
 *
 * Everything here was already being recorded and none of it was shown. The
 * conversation is not stored in the Brain -- only its sessionId is, on the
 * event (main.ts) -- so the text comes from the agent session store, which the
 * renderer could already reach. That is why this closes the owner's complaint
 * without a single new backend call.
 */
export function TurnDetail({ event, events, onSelect }: {
  event: BrainEvent
  events: BrainEvent[]
  onSelect: (next: Selection) => void
}) {
  // Temporary mode records what a turn cost but never what was said.
  const temporary = event.metadata.prompt === undefined

  const cost = numberField(event, 'totalCostUsd')
  const duration = numberField(event, 'durationMs')
  const input = numberField(event, 'inputTokens')
  const output = numberField(event, 'outputTokens')

  const read = documentsRead(event)
  const actions = events.filter(other => other.action === 'tool.action' && other.targetId === event.targetId)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{eventTime(event.createdAt)} · Agent turn</h2>
        <p className="mt-1 truncate text-xs text-[#94a3b8]">{describeEvent(event)}</p>
      </div>

      {temporary
        ? <p className="rounded-xl border border-[#2a3142] bg-[#1a2030] p-3 text-sm text-slate-200">
            Temporary mode — baat mehfooz nahi ki gayi, sirf kharcha.
          </p>
        : <p className="text-sm text-[#94a3b8]">Is turn ki baat ab dikhayi nahi ja sakti — app ke andar wala Agent (aur us ki sessions) hata diya gaya hai.</p>}

      {(cost !== null || duration !== null || input !== null) && <div>
        <h3 className="text-sm font-semibold text-slate-200">Kharcha</h3>
        <p className="mt-1 text-xs text-slate-300">
          {[
            cost !== null ? `$${cost.toFixed(4)}` : null,
            duration !== null ? `${(duration / 1000).toFixed(1)}s` : null,
            input !== null && output !== null ? `${input} in / ${output} out tokens` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>}

      {read.length > 0 && <div>
        <h3 className="text-sm font-semibold text-slate-200">Kya padha</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {read.map(path => <button
            key={path}
            onClick={() => onSelect({ kind: 'document', path })}
            className="max-w-full truncate rounded-full border border-[#2a3142] bg-[#1a2030] px-3 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
          >{path}</button>)}
        </div>
      </div>}

      {actions.length > 0 && <div>
        <h3 className="text-sm font-semibold text-slate-200">Duniya mein kya kiya</h3>
        <ul className="mt-2 space-y-1">
          {actions.map(action => <li key={action.id} className={`text-xs ${action.metadata.failed === true ? 'text-red-400' : 'text-slate-300'}`}>
            {describeEvent(action)}
          </li>)}
        </ul>
      </div>}
    </div>
  )
}
