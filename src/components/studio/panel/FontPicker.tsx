import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { FONT_CATALOGUE, findFont, searchFonts, type FontFamily } from '@/lib/fontCatalogue'
import { loadFontInDocument } from '@/lib/fontLoader'

interface Props {
  /** Currently selected font's catalogue id. */
  value: string
  onChange: (font: { id: string; family: string }) => void
}

interface CategoryChip {
  value: FontFamily['category'] | 'all'
  label: string
}

/**
 * Fontsource has no `script` category — every script/swash face (Playfair
 * Display, Dancing Script, Caveat, Great Vibes…) is classified `handwriting`.
 * A separate "Script" chip would therefore always be empty, so both are
 * covered by one chip that filters on `handwriting`.
 */
const CATEGORY_CHIPS: CategoryChip[] = [
  { value: 'all', label: 'All' },
  { value: 'display', label: 'Display' },
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'handwriting', label: 'Script & Handwriting' },
]

/**
 * Searchable dropdown over the 129-family FONT_CATALOGUE.
 *
 * Every row renders its own family name in its own face — a wall of rows all
 * set in the UI font would make it impossible to actually pick a typeface.
 * Loading all 129 faces up front would stall the panel, so each row's
 * @font-face is only injected (via loadFontInDocument) the moment the row
 * scrolls into view, through an IntersectionObserver scoped to the list.
 */
export default function FontPicker({ value, onChange }: Props) {
  const current = findFont(value) ?? FONT_CATALOGUE[0]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryChip['value']>('all')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // The closed control shows the current family set in its own face.
  useEffect(() => {
    loadFontInDocument(current, document)
  }, [current])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocPointerDown)
    return () => document.removeEventListener('mousedown', onDocPointerDown)
  }, [open])

  const results = useMemo(
    () => searchFonts(query, category === 'all' ? undefined : category),
    [query, category]
  )

  function closeWithoutChange() {
    setOpen(false)
    setQuery('')
    setCategory('all')
  }

  function select(font: FontFamily) {
    onChange({ id: font.id, family: font.family })
    setOpen(false)
    setQuery('')
    setCategory('all')
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ fontFamily: `'${current.family}', sans-serif` }}
        className="flex w-full items-center justify-between gap-2 h-[var(--panel-control-h)]
                   rounded-[var(--panel-radius)] bg-s2 border border-border-soft px-2
                   text-[length:var(--panel-input)] text-tx transition-colors
                   focus:outline-none focus:border-accent-border focus:ring-1 focus:ring-accent-border"
      >
        <span className="truncate">{current.family}</span>
        <ChevronDown size={13} className={`shrink-0 text-t3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              closeWithoutChange()
            }
          }}
          className="absolute left-0 right-0 z-[var(--z-overlay)] mt-1 flex flex-col overflow-hidden
                     rounded-[var(--panel-radius)] border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center gap-1.5 border-b border-border-soft px-2 py-1.5">
            <Search size={12} className="shrink-0 text-t3" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search fonts…"
              className="min-w-0 flex-1 bg-transparent text-[length:var(--panel-input)] text-tx
                         placeholder:text-t3 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1 border-b border-border-soft px-2 py-1.5">
            {CATEGORY_CHIPS.map(chip => (
              <button
                key={chip.value}
                type="button"
                onClick={() => setCategory(chip.value)}
                aria-pressed={category === chip.value}
                className={`h-[calc(var(--panel-control-h)-6px)] rounded-[var(--panel-radius)] px-2
                            text-[length:var(--panel-label)] transition-colors
                            ${category === chip.value ? 'bg-accent-m text-tx' : 'bg-s2 text-t3 hover:text-t2'}`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <FontRows fonts={results} selectedId={current.id} onSelect={select} />
        </div>
      )}
    </div>
  )
}

function FontRows({
  fonts,
  selectedId,
  onSelect,
}: {
  fonts: FontFamily[]
  selectedId: string
  onSelect: (font: FontFamily) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // One observer for the whole list, scoped to the scrollable list element as
  // `root` so intersection is computed against the visible slice of rows
  // rather than the full (off-screen) document. A row's face loads the first
  // time it becomes visible and is then unobserved — loadFontInDocument is
  // idempotent, but there's no reason to keep watching a loaded row.
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = (entry.target as HTMLElement).dataset.fontId
          const font = id ? findFont(id) : undefined
          if (font) loadFontInDocument(font, document)
          observer.unobserve(entry.target)
        }
      },
      { root, rootMargin: '200px 0px' }
    )
    observerRef.current = observer
    return () => observer.disconnect()
  }, [])

  // Re-run the visibility check against whatever rows exist right now
  // whenever the filtered list changes shape (new query/category), since
  // narrowing the list can put previously off-screen rows in view.
  useEffect(() => {
    const root = listRef.current
    const observer = observerRef.current
    if (!root || !observer) return
    root.querySelectorAll<HTMLElement>('[data-font-id]').forEach(el => observer.observe(el))
  }, [fonts])

  return (
    <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
      {fonts.length === 0 && (
        <div className="px-3 py-4 text-center text-[length:var(--panel-label)] text-t3">No fonts found</div>
      )}
      {fonts.map(font => {
        const selected = font.id === selectedId
        return (
          <button
            key={font.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-font-id={font.id}
            onClick={() => onSelect(font)}
            style={{ fontFamily: `'${font.family}', sans-serif` }}
            className={`flex h-[var(--panel-control-h)] w-full items-center justify-between gap-2 px-3
                        text-[length:var(--panel-input)] transition-colors
                        ${selected ? 'bg-accent-m text-tx' : 'text-tx hover:bg-s2'}`}
          >
            <span className="truncate">{font.family}</span>
            <span className="shrink-0 text-[length:var(--panel-label)] capitalize text-t3">{font.category}</span>
          </button>
        )
      })}
    </div>
  )
}
