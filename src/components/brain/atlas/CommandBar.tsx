import { useEffect, useMemo, useRef } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { searchAtlas } from '@/lib/atlasSearch'
import { OBSERVATORY, TYPE_COLOR } from '@/lib/atlasTheme'
import type { KnowledgeGraph } from '@/types/brainKnowledge'

/**
 * One input for both questions the owner asks of the store.
 *
 * Typing filters the map, which is instant because the graph is already in
 * memory. Enter asks the Brain, which costs a round trip and a model call.
 * They were two surfaces — Library and Ask — over the same documents, and the
 * map is a better result list than a column of rows.
 */
export function CommandBar({ graph, query, onQueryChange, onOpen, onAsk, asking }: {
  graph: KnowledgeGraph | null
  query: string
  onQueryChange: (query: string) => void
  onOpen: (path: string) => void
  onAsk: (question: string) => void
  asking: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => (graph ? searchAtlas(graph, query).top : []), [graph, query])

  // `/` and Ctrl/Cmd-K reach the bar from anywhere on the map, which is the
  // only way to start typing when the canvas has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement
      if ((event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative w-full max-w-[460px]">
      <div
        className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 shadow-md backdrop-blur-sm"
        style={{ background: OBSERVATORY.raised, borderColor: OBSERVATORY.border }}
      >
        <Search size={15} className="shrink-0" style={{ color: OBSERVATORY.dim }} />
        <input
          ref={input}
          type="search"
          role="searchbox"
          aria-label="Search or ask"
          value={query}
          placeholder="Dhoondein, ya poochein…"
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && query.trim()) onAsk(query.trim())
            if (event.key === 'Escape') onQueryChange('')
          }}
          className="font-retro-sans min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60"
          style={{ color: OBSERVATORY.text }}
        />
        {asking
          ? <span className="font-retro-mono shrink-0 text-[11px]" style={{ color: OBSERVATORY.accent }}>Poochh raha hai…</span>
          : <span className="font-retro-mono shrink-0 flex items-center gap-1 text-[11px]" style={{ color: OBSERVATORY.dim }}>
              <CornerDownLeft size={11} /> ask
            </span>}
      </div>

      {results.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-xl border shadow-xl"
          style={{ background: OBSERVATORY.raised, borderColor: OBSERVATORY.border }}
        >
          {results.map(result => (
            <button
              key={result.path}
              onClick={() => onOpen(result.path)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/5"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[result.type] }} />
              <span className="font-retro-sans min-w-0 flex-1 truncate text-sm" style={{ color: OBSERVATORY.text }}>{result.title}</span>
              <span className="font-retro-mono shrink-0 text-[11px]" style={{ color: OBSERVATORY.dim }}>{result.degree}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
