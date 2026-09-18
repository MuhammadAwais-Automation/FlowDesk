import { OBSERVATORY } from '@/lib/atlasTheme'
import type { AtlasRegion } from '@/lib/atlasGraph'

/** More than a dozen region names is a hairball made of text. */
const MAX_LABELS = 12

/**
 * Region names floating over their part of the map.
 *
 * An HTML layer rather than sigma nodes, because these are annotations on the
 * graph and not members of it: they must not be clickable, must not take part
 * in the layout, and must not be dimmed by a hover. Drawn only at the far band,
 * where node labels are off and this is all that says where you are.
 */
export function AreaLabels({ regions, project }: {
  regions: AtlasRegion[]
  project: (x: number, y: number) => { x: number; y: number }
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {regions.slice(0, MAX_LABELS).map(region => {
        const at = project(region.x, region.y)
        return (
          <span
            key={region.name}
            role="presentation"
            className="font-retro-mono absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] uppercase tracking-[0.18em]"
            style={{ left: `${at.x}px`, top: `${at.y}px`, color: OBSERVATORY.muted }}
          >
            {region.name}
          </span>
        )
      })}
    </div>
  )
}
