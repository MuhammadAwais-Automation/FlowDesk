import PanelSection from './PanelSection'
import NumberField from './NumberField'
import ColorInput from './ColorInput'
import { toHex, hexToRgb } from './color'
import { isTextTag, type NodeStyles } from '@/lib/studioNode'

interface Props { styles: NodeStyles; onUpdate: (next: NodeStyles) => void; tag: string | null }

/**
 * Ruling D1: a text node's stroke is `-webkit-text-stroke`; a box's is
 * `border`. Task 9 threads the selected node's tag down from the bridge's
 * `selected` message through `useStudioNode` to here (see `isTextTag` in
 * studioNode.ts for which tags count as text), so this now shows the one
 * control that actually applies instead of offering both and leaving the
 * agent/user to guess which one does anything.
 */
export default function StrokeSection({ styles, onUpdate, tag }: Props) {
  const isText = isTextTag(tag)

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
      {isText ? (
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
      ) : (
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
      )}
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
