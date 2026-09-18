import { OBSERVATORY } from '@/lib/atlasTheme'
import type { AtlasOverlay } from '@/lib/atlasOverlays'

export type AtlasPanel = 'timeline' | 'review' | 'health'

const OVERLAYS: Array<{ id: AtlasOverlay; label: string }> = [
  { id: 'new', label: 'Naya' },
  { id: 'trail', label: 'Agent trail' },
  { id: 'orphans', label: 'Orphans' },
]

/**
 * Pending review reads a shade brighter than the housing's own accent, so
 * "there is work waiting" and "this panel is open" stay distinguishable. The
 * colour is `amber-500`, which this pill used to reach for as a Tailwind class
 * — but a class cannot lose to the open-panel accent, and it needs to.
 */
const PENDING = '#f59e0b'

/**
 * The store's vital signs, and the way into everything that is not the map.
 *
 * Each count is also its own door: documents opens the timeline, and both
 * review and loose ends open the review queue, which is where the unresolved
 * links live and where one click turns a loose end into a document. A number
 * you cannot act on is a number that did not need a pill.
 */
export function StatusStrip({ documents, links, review, looseEnds, panel, onPanel, overlay, onOverlay }: {
  documents: number
  links: number
  review: number
  looseEnds: number
  panel: AtlasPanel | null
  onPanel: (panel: AtlasPanel | null) => void
  overlay: AtlasOverlay | null
  onOverlay: (overlay: AtlasOverlay | null) => void
}) {
  const pill = 'font-retro-mono rounded-lg border px-2.5 py-1.5 text-[11px] transition'
  const surface = { background: OBSERVATORY.raised, borderColor: OBSERVATORY.border }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onPanel(panel === 'timeline' ? null : 'timeline')}
        aria-pressed={panel === 'timeline'}
        className={pill}
        style={{ ...surface, color: panel === 'timeline' ? OBSERVATORY.accent : OBSERVATORY.muted }}
      >
        {documents} documents
      </button>

      <span className={pill} style={{ ...surface, color: OBSERVATORY.dim }}>{links} links</span>

      <button
        onClick={() => onPanel(panel === 'review' ? null : 'review')}
        aria-pressed={panel === 'review'}
        className={pill}
        style={{ ...surface, color: panel === 'review' ? OBSERVATORY.accent : review > 0 ? PENDING : OBSERVATORY.muted }}
      >
        {review} review
      </button>

      <button
        onClick={() => onPanel(panel === 'review' ? null : 'review')}
        aria-pressed={panel === 'review'}
        className={pill}
        style={{ ...surface, color: panel === 'review' ? OBSERVATORY.accent : OBSERVATORY.muted }}
      >
        {looseEnds} loose ends
      </button>

      <span className="mx-1 h-4 w-px" style={{ background: OBSERVATORY.border }} />

      {OVERLAYS.map(item => (
        <button
          key={item.id}
          onClick={() => onOverlay(overlay === item.id ? null : item.id)}
          aria-pressed={overlay === item.id}
          className={pill}
          style={{ ...surface, color: overlay === item.id ? OBSERVATORY.accent : OBSERVATORY.dim }}
        >
          {item.label}
        </button>
      ))}

      <button
        onClick={() => onPanel(panel === 'health' ? null : 'health')}
        aria-pressed={panel === 'health'}
        className={pill}
        style={{ ...surface, color: panel === 'health' ? OBSERVATORY.accent : OBSERVATORY.dim }}
      >
        Health
      </button>
    </div>
  )
}
