import PanelSection from './panel/PanelSection'
import NumberField from './panel/NumberField'
import Segmented from './panel/Segmented'
import { formatLength, parseLength, type NodeStyles } from '@/lib/studioNode'

interface Props { styles: NodeStyles; onUpdate: (next: NodeStyles) => void; hasSelection: boolean }

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']

export default function PropertiesPanel({ styles, onUpdate, hasSelection }: Props) {
  // A rejected value must not silently vanish, and must not be written either.
  const setLength = (prop: string) => (raw: string) => {
    const parsed = parseLength(raw)
    if (parsed !== null) onUpdate({ ...styles, [prop]: parsed })
  }

  if (!hasSelection) {
    return (
      <div className="studio-panel w-[260px] shrink-0 border-l border-border bg-surface flex items-center justify-center p-6">
        <p className="text-t3 text-xs text-center leading-relaxed">
          Select a layer to edit it.<br />Click on the canvas, or pick one from the tree.
        </p>
      </div>
    )
  }

  return (
    <div className="studio-panel w-[260px] shrink-0 border-l border-border bg-surface overflow-y-auto">
      <PanelSection title="Layout">
        <div className="grid grid-cols-2 gap-[var(--panel-gap)]">
          <NumberField label="X" value={formatLength(styles.left ?? '')} onCommit={setLength('left')} />
          <NumberField label="Y" value={formatLength(styles.top ?? '')} onCommit={setLength('top')} />
          <NumberField label="W" value={formatLength(styles.width ?? '')} onCommit={setLength('width')} />
          <NumberField label="H" value={formatLength(styles.height ?? '')} onCommit={setLength('height')} />
        </div>
      </PanelSection>

      <PanelSection title="Radius">
        <NumberField label="R" value={formatLength(styles['border-radius'] ?? '')} onCommit={setLength('border-radius')} />
      </PanelSection>

      <PanelSection title="Blending">
        <NumberField
          label="%"
          value={String(Math.round(Number(styles.opacity ?? '1') * 100))}
          onCommit={raw => {
            const n = Number(raw)
            if (Number.isFinite(n) && n >= 0 && n <= 100) onUpdate({ ...styles, opacity: String(n / 100) })
          }}
        />
        <select
          value={styles['mix-blend-mode'] ?? 'normal'}
          onChange={e => onUpdate({ ...styles, 'mix-blend-mode': e.target.value })}
          className="h-[var(--panel-control-h)] rounded-[var(--panel-radius)] bg-s2 border border-border-soft px-2
                     text-[length:var(--panel-input)] text-tx focus:outline-none focus:border-accent-border"
        >
          {BLEND_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </PanelSection>

      <PanelSection title="Fill">
        <Segmented
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient', disabled: true },
            { value: 'image', label: 'Image', disabled: true },
          ]}
          value="solid"
          onChange={() => {}}
        />
        <input
          type="color"
          value={toHex(styles['background-color'] ?? '')}
          onChange={e => onUpdate({ ...styles, 'background-color': e.target.value })}
          className="h-[var(--panel-control-h)] w-full rounded-[var(--panel-radius)] bg-s2 border border-border-soft cursor-pointer"
        />
      </PanelSection>
    </div>
  )
}

/** getComputedStyle returns rgb(); <input type="color"> needs #rrggbb. */
function toHex(value: string): string {
  const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return '#000000'
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
}
