import PanelSection from './panel/PanelSection'
import NumberField from './panel/NumberField'
import TypographySection from './panel/TypographySection'
import FillSection from './panel/FillSection'
import StrokeSection from './panel/StrokeSection'
import EffectsSection from './panel/EffectsSection'
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

      <TypographySection styles={styles} onUpdate={onUpdate} />

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

      <FillSection styles={styles} onUpdate={onUpdate} />
      <StrokeSection styles={styles} onUpdate={onUpdate} />
      <EffectsSection styles={styles} onUpdate={onUpdate} />
    </div>
  )
}
