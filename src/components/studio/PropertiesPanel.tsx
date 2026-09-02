import { useEffect, useState } from 'react'
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

  // A native colour input fires `onChange` continuously while the picker is
  // dragged, unlike every other field in this panel (see NumberField's
  // commit-on-blur rationale). A local draft lets the swatch track the drag
  // live without posting an `applyStyles` write on every intermediate value —
  // the write only happens on blur, same as NumberField.
  const { hex: computedHex } = parseColor(styles['background-color'] ?? '')
  const [colorDraft, setColorDraft] = useState(computedHex)
  useEffect(() => { setColorDraft(computedHex) }, [computedHex])

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
          value={colorDraft}
          onChange={e => setColorDraft(e.target.value)}
          onBlur={() => {
            // Only commit if the draft actually differs from what the
            // document currently has, so opening and closing the picker
            // without changing anything never posts a write.
            if (colorDraft === computedHex) return
            onUpdate({ ...styles, 'background-color': hexToRgb(colorDraft) })
          }}
          className="h-[var(--panel-control-h)] w-full rounded-[var(--panel-radius)] bg-s2 border border-border-soft cursor-pointer"
        />
      </PanelSection>
    </div>
  )
}

const RGBA_RE = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/

/**
 * getComputedStyle returns rgb()/rgba(); <input type="color"> only accepts
 * #rrggbb and has no way to represent alpha. A fully transparent value
 * (alpha 0 — e.g. an element with no fill at all) is a distinct, named case
 * here rather than silently falling through to the same #000000 used for
 * genuinely unparseable input: without this, a transparent element showed an
 * opaque black swatch, and the next interaction with it would commit opaque
 * black over what used to be transparent.
 *
 * Limitation: a native colour input still can't *display* "transparent" —
 * `transparent: true` exists so a caller could special-case it (e.g. skip
 * auto-commit, or show a placeholder), which this panel does by requiring
 * the user to actually change the swatch before a write is posted at all.
 */
function parseColor(value: string): { hex: string; transparent: boolean } {
  const m = value.match(RGBA_RE)
  if (!m) return { hex: '#000000', transparent: false }
  const alpha = m[4] === undefined ? 1 : Number(m[4])
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
  return { hex: `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`, transparent: alpha === 0 }
}

/** The model stores computed-style output (`rgb(...)`); writing back `#rrggbb`
 *  from the colour input would put a format the rest of NodeStyles never
 *  uses into the document. */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${r}, ${g}, ${b})`
}
