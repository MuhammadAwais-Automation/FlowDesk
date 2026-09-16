import { Search } from 'lucide-react'
import { Card } from '../Card'
import type { Selection } from '@/lib/brainSelection'
import type { AnswerPack } from '@/types/brainKnowledge'

/**
 * The question box, and the passages the ladder came back with.
 *
 * The list names the sources; the detail pane holds the evidence itself. A
 * passage is picked here and read there, the same shape as every other list on
 * this page.
 */
export function AskList({ query, setQuery, busy, onAsk, pack, selection, onSelect }: {
  query: string
  setQuery: (value: string) => void
  busy: boolean
  onAsk: () => void
  pack: AnswerPack | null
  selection: Selection | null
  onSelect: (next: Selection) => void
}) {
  const selectedPath = selection?.kind === 'document' ? selection.path : null

  return (
    <div className="space-y-4">
      <Card>
        <label className="text-sm font-semibold" htmlFor="brain-ask">Ask the library</label>
        <div className="mt-3 flex gap-2">
          <input
            id="brain-ask"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && onAsk()}
            placeholder="Client, decision ya research ke bare mein poochein…"
            className="min-w-0 flex-1 rounded-xl border border-stone-300 px-4 py-2 text-sm outline-none focus:border-amber-500"
          />
          <button onClick={onAsk} disabled={busy} aria-label="Ask" className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white"><Search size={16} /></button>
        </div>
      </Card>
      {pack && <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {pack.sections.length} cited passage{pack.sections.length === 1 ? '' : 's'}
        </p>
        <div className="mt-3 space-y-2">
          {pack.sections.length === 0
            ? <p className="text-sm text-stone-500">Koi matching document nahi mila.</p>
            : pack.sections.map(section => <button
              key={`${section.path}#${section.headingPath}`}
              onClick={() => onSelect({ kind: 'document', path: section.path })}
              aria-current={selectedPath === section.path ? 'true' : undefined}
              className={`block w-full rounded-lg border-l-2 p-3 text-left transition ${
                selectedPath === section.path ? 'border-amber-500 bg-amber-50' : 'border-transparent bg-stone-50 hover:bg-stone-100'
              }`}
            >
              <p className="truncate text-xs font-mono text-stone-400">{section.path}#{section.headingPath}</p>
              <p className="mt-1 line-clamp-3 text-xs text-stone-600">{section.text}</p>
            </button>)}
        </div>
      </Card>}
    </div>
  )
}
