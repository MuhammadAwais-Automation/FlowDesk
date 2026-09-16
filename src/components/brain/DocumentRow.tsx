/**
 * One document in the middle column.
 *
 * Selecting is not opening: this tells the shell what the detail pane should
 * show and nothing else. The previous version of this component switched the
 * active tab as a side effect of a click, which is what made the page feel like
 * it kept throwing you somewhere else.
 */
export function DocumentRow({ path, type, title, snippet, selected, onSelect }: {
  path: string
  type: string
  title: string
  snippet: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`block w-full rounded-lg border-l-2 p-3 text-left transition ${
        selected ? 'border-amber-500 bg-amber-50' : 'border-transparent bg-stone-50 hover:bg-stone-100'
      }`}
    >
      <p className="truncate text-sm font-medium">{title}</p>
      <p className="mt-0.5 truncate text-xs text-stone-400">{type} · {path}</p>
      {snippet && <p className="mt-1 line-clamp-2 text-xs text-stone-600">{snippet}</p>}
    </button>
  )
}
