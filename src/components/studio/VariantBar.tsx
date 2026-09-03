import { Layers } from 'lucide-react'
import type { StudioArtboardMeta } from '@/types/electron'

interface Props {
  artboards: StudioArtboardMeta[]
  activeArtboardId: string | null
  /**
   * Fired by both actions with the artboard to keep — "Keep this one" and
   * "Discard others" describe the same intent (this artboard survives, its
   * siblings in the variant group go) from two different mental models, so
   * they share one callback rather than needing two. Wiring this up to
   * actually delete the other artboards is a later integration point; this
   * component only reports the choice.
   */
  onKeepOnly: (keepArtboardId: string) => void
}

const VARIANT_SUFFIX = / — variant \d+$/

/**
 * The signal that a set of artboards are variants of each other: the name
 * `studio_create_variants` gives its duplicates (`"<source name> — variant
 * N"`). Two artboards are in the same group when their names agree once that
 * suffix is stripped — the source itself (no suffix) and every duplicate
 * (suffixed) share the same base name.
 */
function baseName(name: string): string {
  return name.replace(VARIANT_SUFFIX, '')
}

function variantGroup(artboards: StudioArtboardMeta[], activeArtboardId: string | null): StudioArtboardMeta[] | null {
  const active = artboards.find(a => a.id === activeArtboardId)
  if (!active) return null
  const base = baseName(active.name)
  const group = artboards.filter(a => baseName(a.name) === base)
  return group.length > 1 ? group : null
}

export default function VariantBar({ artboards, activeArtboardId, onKeepOnly }: Props) {
  const group = variantGroup(artboards, activeArtboardId)
  if (!group || !activeArtboardId) return null

  const keep = () => onKeepOnly(activeArtboardId)

  return (
    <div
      className="h-[var(--panel-control-h)] shrink-0 flex items-center gap-[var(--panel-gap)] px-3
                 border-b border-border bg-s2 text-[length:var(--panel-label)] text-t2"
    >
      <Layers size={12} className="text-t3" />
      <span className="font-medium text-tx">{group.length} variants</span>
      <span className="text-t3">of "{baseName(group[0].name)}"</span>
      <div className="flex-1" />
      <button
        onClick={keep}
        className="h-[calc(var(--panel-control-h)-6px)] px-2.5 rounded-[var(--panel-radius)] bg-s3 text-tx
                   hover:bg-border-soft transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
      >
        Keep this one
      </button>
      <button
        onClick={keep}
        className="h-[calc(var(--panel-control-h)-6px)] px-2.5 rounded-[var(--panel-radius)] bg-s3 text-tx
                   hover:bg-border-soft transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
      >
        Discard others
      </button>
    </div>
  )
}
