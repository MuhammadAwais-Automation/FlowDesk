import PanelSection from './PanelSection'
import Segmented from './Segmented'
import NumberField from './NumberField'
import ColorInput from './ColorInput'
import { toHex, hexToRgb, parseGradient, buildGradient, type GradientKind, type GradientStop } from './color'
import type { NodeStyles } from '@/lib/studioNode'
import { Plus, Trash2 } from 'lucide-react'

interface Props { styles: NodeStyles; onUpdate: (next: NodeStyles) => void }

type FillMode = 'solid' | GradientKind

const MODE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
]

/**
 * `background` (the gradient shorthand) and `background-color` (the solid
 * fill) are two different properties this panel writes to; whichever one the
 * document actually has determines which UI shows. `background` wins when
 * both are present because the shorthand paints over `background-color` in
 * the cascade — same reason `setMode('solid')` below clears it rather than
 * leaving a stale gradient sitting underneath.
 */
function detectMode(styles: NodeStyles): FillMode {
  const parsed = parseGradient(styles.background)
  return parsed?.kind ?? 'solid'
}

export default function FillSection({ styles, onUpdate }: Props) {
  const mode = detectMode(styles)
  const solidHex = toHex(styles['background-color'] ?? '')
  const gradient = parseGradient(styles.background)

  function setMode(next: FillMode) {
    if (next === 'solid') {
      // Clear the gradient shorthand so background-color shows through again
      // — leaving it would keep painting over the solid colour.
      onUpdate({ ...styles, background: '' })
      return
    }
    const seed = gradient ?? { angle: 90, stops: [{ color: solidHex, pos: 0 }, { color: '#ffffff', pos: 100 }] }
    onUpdate({ ...styles, background: buildGradient(next, seed.angle, seed.stops) })
  }

  function writeStops(angle: number, stops: GradientStop[]) {
    if (mode === 'solid') return
    onUpdate({ ...styles, background: buildGradient(mode, angle, stops) })
  }

  function updateStop(i: number, patch: Partial<GradientStop>) {
    if (!gradient) return
    const stops = gradient.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    writeStops(gradient.angle, stops)
  }

  function addStop() {
    if (!gradient) return
    const last = gradient.stops[gradient.stops.length - 1]
    const stops = [...gradient.stops, { color: last?.color ?? '#ffffff', pos: 100 }]
    writeStops(gradient.angle, stops)
  }

  function removeStop(i: number) {
    if (!gradient || gradient.stops.length <= 2) return
    writeStops(gradient.angle, gradient.stops.filter((_, idx) => idx !== i))
  }

  return (
    <PanelSection title="Fill">
      <Segmented options={MODE_OPTIONS} value={mode} onChange={v => setMode(v as FillMode)} />

      {mode === 'solid' && (
        <ColorInput
          value={solidHex}
          onCommit={hex => onUpdate({ ...styles, 'background-color': hexToRgb(hex) })}
        />
      )}

      {mode !== 'solid' && gradient && (
        <>
          {mode === 'linear' && (
            <NumberField
              label="°"
              value={String(gradient.angle)}
              onCommit={raw => {
                const n = Number(raw)
                if (Number.isFinite(n)) writeStops(n, gradient.stops)
              }}
            />
          )}

          <div className="flex flex-col gap-1.5">
            {gradient.stops.map((stop, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <ColorInput
                  value={stop.color}
                  onCommit={hex => updateStop(i, { color: hex })}
                  className="h-[var(--panel-control-h)] w-8 shrink-0 rounded-[var(--panel-radius)] bg-s2 border border-border-soft cursor-pointer"
                />
                <NumberField
                  label="%"
                  value={String(stop.pos)}
                  onCommit={raw => {
                    const n = Number(raw)
                    if (Number.isFinite(n)) updateStop(i, { pos: n })
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove stop"
                  disabled={gradient.stops.length <= 2}
                  onClick={() => removeStop(i)}
                  className="flex h-[var(--panel-control-h)] w-6 shrink-0 items-center justify-center rounded-[var(--panel-radius)]
                             text-t3 transition-colors hover:text-tx disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addStop}
            className="flex h-[var(--panel-control-h)] items-center justify-center gap-1 rounded-[var(--panel-radius)]
                       bg-s2 text-t3 text-[length:var(--panel-label)] transition-colors hover:text-tx"
          >
            <Plus size={12} /> Add stop
          </button>
        </>
      )}
    </PanelSection>
  )
}
