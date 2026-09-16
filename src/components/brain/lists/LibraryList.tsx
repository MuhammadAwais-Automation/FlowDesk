import { Search } from 'lucide-react'
import { Card } from '../Card'
import { DocumentRow } from '../DocumentRow'
import type { Selection } from '@/lib/brainSelection'
import { KNOWLEDGE_DOC_TYPES } from '@/types/brainKnowledge'
import type { DocumentSearchHit, KnowledgeDocType, KnowledgeDocument } from '@/types/brainKnowledge'

export function LibraryList({
  documents, hits, query, setQuery, typeFilter, setTypeFilter, busy, onSearch, selection, onSelect,
}: {
  documents: KnowledgeDocument[]
  hits: DocumentSearchHit[] | null
  query: string
  setQuery: (value: string) => void
  typeFilter: KnowledgeDocType | ''
  setTypeFilter: (value: KnowledgeDocType | '') => void
  busy: boolean
  onSearch: () => void
  selection: Selection | null
  onSelect: (next: Selection) => void
}) {
  const selectedPath = selection?.kind === 'document' ? selection.path : null
  const listed = documents.filter(document => !typeFilter || document.type === typeFilter)

  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && onSearch()}
          placeholder="Search documents…"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 px-4 py-2 text-sm outline-none focus:border-amber-500"
        />
        <select
          value={typeFilter}
          onChange={event => setTypeFilter(event.target.value as KnowledgeDocType | '')}
          aria-label="Document type"
          className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          {KNOWLEDGE_DOC_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
        <button onClick={onSearch} disabled={busy} aria-label="Search" className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white"><Search size={16} /></button>
      </div>
      <div className="mt-3 space-y-2">
        {(hits ?? listed).length === 0 && <p className="text-sm text-stone-500">{busy ? 'Load ho raha hai…' : 'Koi document nahi mila.'}</p>}
        {hits?.map(hit => <DocumentRow
          key={hit.path}
          path={hit.path}
          type={hit.type}
          title={hit.title}
          snippet={hit.snippet}
          selected={selectedPath === hit.path}
          onSelect={() => onSelect({ kind: 'document', path: hit.path })}
        />)}
        {!hits && listed.map(document => <DocumentRow
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
  )
}
