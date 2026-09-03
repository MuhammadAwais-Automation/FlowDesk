import PanelSection from './PanelSection'
import NumberField from './NumberField'
import ColorInput from './ColorInput'
import { toHex, hexToRgb } from './color'
import type { NodeStyles } from '@/lib/studioNode'

interface Props { styles: NodeStyles; onUpdate: (next: NodeStyles) => void }

/**
 * A text node's stroke is `-webkit-text-stroke`; a box's is `border`. Which
 * one applies depends on the selected node's tag — but PropertiesPanel's
 * props today are just `{ styles, onUpdate, hasSelection }`. `useStudioNode`
 * only tracks `selected` as an element id (see src/hooks/useStudioNode.ts);
 * the `tag` field lives on `NodeSummary` in the `tree` array, which
 * PropertiesPanel never receives for the current selection. So the tag isn't
 * reachable here today, and rather than guess which one is "right" and hide
 * the other, this section offers both controls. Task 9 threading the
 * selected node's tag down to the panel is what would let this collapse to
 * one control per node type.
 */
export default function StrokeSection({ styles, onUpdate }: Props) {
  const textStroke = parseWidthColor(styles['-webkit-text-stroke'])
  const textStrokeColor = toHex(textStroke.color || styles.color || '#000000')

  const border = parseBorder(styles.border)
  const borderColor = toHex(border.color)

  function setTextStroke(width: number, colorHex: string) {
    onUpdate({
      ...styles,
      '-webkit-text-stroke': width > 0 ? `${width}px ${hexToRgb(colorHex)}` : '',
    })
  }

  function setBorder(width: number, colorHex: string) {
    onUpdate({
      ...styles,
      border: width > 0 ? `${width}px solid ${hexToRgb(colorHex)}` : '',
    })
  }

  return (
    <PanelSection title="Stroke" defaultOpen={false}>
      <div className="flex flex-col gap-1">
        <span className="text-t3 text-[length:var(--panel-label)]">Text stroke</span>
        <div className="flex items-center gap-1.5">
          <NumberField
            label="W"
            value={String(textStroke.width)}
            onCommit={raw => {
              const n = Number(raw)
              if (Number.isFinite(n) && n >= 0) setTextStroke(n, textStrokeColor)
            }}
          />
          <ColorInput
            value={textStrokeColor}
            onCommit={hex => setTextStroke(textStroke.width, hex)}
            className="h-[var(--panel-control-h)] w-8 shrink-0 rounded-[var(--panel-radius)] bg-s2 border border-border-soft cursor-pointer"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-t3 text-[length:var(--panel-label)]">Border</span>
        <div className="flex items-center gap-1.5">
          <NumberField
            label="W"
            value={String(border.width)}
            onCommit={raw => {
              const n = Number(raw)
              if (Number.isFinite(n) && n >= 0) setBorder(n, borderColor)
            }}
          />
          <ColorInput
            value={borderColor}
            onCommit={hex => setBorder(border.width, hex)}
            className="h-[var(--panel-control-h)] w-8 shrink-0 rounded-[var(--panel-radius)] bg-s2 border border-border-soft cursor-pointer"
          />
        </div>
      </div>
    </PanelSection>
  )
}

/** Parses `-webkit-text-stroke`'s computed form, `"<width>px <color>"`. */
function parseWidthColor(value: string | undefined): { width: number; color: string } {
  const m = (value ?? '').trim().match(/^([\d.]+)px\s+(.+)$/)
  if (!m) return { width: 0, color: '' }
  return { width: Number(m[1]), color: m[2] }
}

/** Parses `border`'s computed form, `"<width>px <style> <color>"`. */
function parseBorder(value: string | undefined): { width: number; color: string } {
  const m = (value ?? '').trim().match(/^([\d.]+)px\s+\S+\s+(.+)$/)
  if (!m) return { width: 0, color: '#000000' }
  return { width: Number(m[1]), color: m[2] }
}
