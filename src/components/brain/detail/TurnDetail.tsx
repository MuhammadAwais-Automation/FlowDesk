import { useEffect, useState } from 'react'
import { describeEvent, documentsRead, eventTime } from '@/lib/brainFormat'
import type { Selection } from '@/lib/brainSelection'
import type { AgentSessionTurn } from '@/types/electron'
import type { BrainEvent } from '@/types/brainKnowledge'

const api = window.electronAPI

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
  const [turns, setTurns] = useState<AgentSessionTurn[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  const sessionId = typeof event.metadata.sessionId === 'string' ? event.metadata.sessionId : null
  // Temporary mode records what a turn cost but never what was said. An empty
  // conversation block would read as a bug; saying so is the honest version.
  const temporary = event.metadata.prompt === undefined

  useEffect(() => {
    if (sessionId === null || temporary) return
    let live = true
    setTurns(null)
    setUnavailable(false)
    void api.agentSessionTurns(sessionId)
      .then(loaded => { if (live) setTurns(loaded) })
      .catch(() => { if (live) setUnavailable(true) })
    return () => { live = false }
  }, [sessionId, temporary])

  const index = turns?.findIndex(turn => turn.id === event.targetId) ?? -1
  const assistant = index >= 0 ? turns?.[index] : undefined
  const question = index > 0 ? turns?.slice(0, index).reverse().find(turn => turn.role === 'user') : undefined

  const cost = numberField(event, 'totalCostUsd')
  const duration = numberField(event, 'durationMs')
  const input = numberField(event, 'inputTokens')
  const output = numberField(event, 'outputTokens')

  const read = documentsRead(event)
  const actions = events.filter(other => other.action === 'tool.action' && other.targetId === event.targetId)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{eventTime(event.createdAt)} · Agent turn</h2>
        <p className="mt-1 truncate text-xs text-stone-500">{describeEvent(event)}</p>
      </div>

      {temporary
        ? <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-600">
            Temporary mode — baat mehfooz nahi ki gayi, sirf kharcha.
          </p>
        : <div className="space-y-3">
            {question && <Bubble role="Aap" text={question.content} />}
            {assistant && <Bubble role="Agent" text={assistant.content} />}
            {sessionId === null && <p className="text-sm text-stone-500">Is turn par koi session ref nahi hai.</p>}
            {sessionId !== null && (unavailable || (turns !== null && assistant === undefined)) &&
              <p className="text-sm text-stone-500">Is turn ki baat ab mehfooz nahi — session store mein nahi mili.</p>}
            {sessionId !== null && !unavailable && turns === null && <p className="text-sm text-stone-500">Load ho raha hai…</p>}
          </div>}

      {(cost !== null || duration !== null || input !== null) && <div>
        <h3 className="text-sm font-semibold">Kharcha</h3>
        <p className="mt-1 text-xs text-stone-600">
          {[
            cost !== null ? `$${cost.toFixed(4)}` : null,
            duration !== null ? `${(duration / 1000).toFixed(1)}s` : null,
            input !== null && output !== null ? `${input} in / ${output} out tokens` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>}

      {read.length > 0 && <div>
        <h3 className="text-sm font-semibold">Kya padha</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {read.map(path => <button
            key={path}
            onClick={() => onSelect({ kind: 'document', path })}
            className="max-w-full truncate rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600 hover:bg-stone-200"
          >{path}</button>)}
        </div>
      </div>}

      {actions.length > 0 && <div>
        <h3 className="text-sm font-semibold">Duniya mein kya kiya</h3>
        <ul className="mt-2 space-y-1">
          {actions.map(action => <li key={action.id} className={`text-xs ${action.metadata.failed === true ? 'text-red-600' : 'text-stone-600'}`}>
            {describeEvent(action)}
          </li>)}
        </ul>
      </div>}
    </div>
  )
}

function Bubble({ role, text }: { role: string; text: string }) {
  return (
    <div className="rounded-xl bg-stone-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{role}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{text}</p>
    </div>
  )
}
