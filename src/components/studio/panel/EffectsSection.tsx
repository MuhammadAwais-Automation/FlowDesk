import { useEffect, useState } from 'react'
import PanelSection from './PanelSection'
import NumberField from './NumberField'
import ColorInput from './ColorInput'
import { hexToRgb } from './color'
import { EFFECT_DEFAULTS, effectToCss, type EffectKind, type EffectParams } from '@/lib/textEffects'
import type { NodeStyles } from '@/lib/studioNode'

interface Props {
  styles: NodeStyles
  onUpdate: (next: NodeStyles) => void
  /** Ruling D2: the params behind the currently-applied effect, read back from the document's data-fd-effect attribute (null when the node has none). */
  effect: EffectParams | null
  onEffectChange: (params: EffectParams | null, cssPatch: NodeStyles) => void
}

const KIND_OPTIONS: EffectKind[] = ['none', 'shadow', 'lift', 'hollow', 'splice', 'echo', 'neon', 'glitch']

type Field = 'offset' | 'direction' | 'blur' | 'intensity' | 'thickness' | 'color'

/**
 * Which of EffectParams' fields each kind actually reads, traced from
 * `effectToCss` in textEffects.ts (Task 3's review), not guessed — a control
 * for a parameter a kind ignores is worse than showing none. `lift` has no
 * `direction` (fixed downward by design); `echo` has no `blur` (its copies
 * are crisp); `neon` has neither `offset` nor `direction` (its glow is
 * symmetric).
 */
const FIELDS_BY_KIND: Record<EffectKind, Field[]> = {
  none: [],
  shadow: ['offset', 'direction', 'blur', 'color'],
  lift: ['offset', 'blur', 'intensity', 'color'],
  hollow: ['thickness', 'color'],
  splice: ['offset', 'direction', 'blur', 'thickness', 'color'],
  echo: ['offset', 'direction', 'intensity', 'color'],
  neon: ['blur', 'intensity', 'color'],
  glitch: ['offset', 'direction', 'color'],
}

const FIELD_LABEL: Record<Field, string> = {
  offset: 'Of',
  direction: 'Dir',
  blur: 'Bl',
  intensity: 'In',
  thickness: 'Th',
  color: 'Color',
}

/**
 * Ruling D2: `EffectParams` now round-trips through the document's
 * `data-fd-effect` attribute (read/written via `useStudioNode`'s `effect`
 * state and `setEffectParams`), so this section seeds its working state from
 * the prop instead of resetting to "none" on every selection — reopening the
 * panel on a node that already carries an effect repopulates the sliders
 * that produced it, not just the resulting `text-shadow`.
 */
export default function EffectsSection({ styles, effect, onEffectChange }: Props) {
  const [params, setParams] = useState<EffectParams>(effect ?? EFFECT_DEFAULTS.none)

  // Re-seed whenever the selection changes (a new `effect` prop arrives,
  // including `null` for a node with none) rather than only on mount — this
  // section is not remounted when the selected node changes.
  useEffect(() => {
    setParams(effect ?? EFFECT_DEFAULTS.none)
  }, [effect])

  function apply(next: EffectParams) {
    const prevKind = params.kind
    setParams(next)
    const css = effectToCss(next)
    const patch: NodeStyles = {
      ...styles,
      'text-shadow': css.textShadow ?? '',
      '-webkit-text-stroke': css.webkitTextStroke ?? '',
    }
    if (css.color) {
      patch.color = css.color
    } else if (prevKind === 'hollow') {
      // Hollow is the only kind that sets `color: transparent` to punch the
      // fill out; leaving it in place after switching away would make every
      // other effect invisible (transparent text with a shadow is still
      // transparent text).
      patch.color = ''
    }
    // 'none' has nothing worth remembering — clear the stored attribute
    // rather than writing `{ kind: 'none' }` into the document, so a node
    // that was never given an effect and a node whose effect was cleared
    // look identical on disk.
    onEffectChange(next.kind === 'none' ? null : next, patch)
  }

  function setKind(kind: EffectKind) {
    apply({ ...EFFECT_DEFAULTS[kind], kind })
  }

  const fields = FIELDS_BY_KIND[params.kind]
  const defaults = EFFECT_DEFAULTS[params.kind]

  return (
    <PanelSection title="Effects" defaultOpen={false}>
      <select
        value={params.kind}
        onChange={e => setKind(e.target.value as EffectKind)}
        className="h-[var(--panel-control-h)] rounded-[var(--panel-radius)] bg-s2 border border-border-soft px-2
                   text-[length:var(--panel-input)] text-tx focus:outline-none focus:border-accent-border"
      >
        {KIND_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
      </select>

      {fields.includes('offset') && (
        <NumberField
          label={FIELD_LABEL.offset}
          value={String(params.offset ?? defaults.offset ?? 0)}
          onCommit={raw => {
            const n = Number(raw)
            if (Number.isFinite(n)) apply({ ...params, offset: n })
          }}
        />
      )}
      {fields.includes('direction') && (
        <NumberField
          label={FIELD_LABEL.direction}
          value={String(params.direction ?? defaults.direction ?? 0)}
          onCommit={raw => {
            const n = Number(raw)
            if (Number.isFinite(n)) apply({ ...params, direction: n })
          }}
        />
      )}
      {fields.includes('blur') && (
        <NumberField
          label={FIELD_LABEL.blur}
          value={String(params.blur ?? defaults.blur ?? 0)}
          onCommit={raw => {
            const n = Number(raw)
            if (Number.isFinite(n) && n >= 0) apply({ ...params, blur: n })
          }}
        />
      )}
      {fields.includes('intensity') && (
        <NumberField
          label={FIELD_LABEL.intensity}
          value={String(params.intensity ?? defaults.intensity ?? 0)}
          onCommit={raw => {
            const n = Number(raw)
            if (Number.isFinite(n) && n >= 0 && n <= 100) apply({ ...params, intensity: n })
          }}
        />
      )}
      {fields.includes('thickness') && (
        <NumberField
          label={FIELD_LABEL.thickness}
          value={String(params.thickness ?? defaults.thickness ?? 0)}
          onCommit={raw => {
            const n = Number(raw)
            if (Number.isFinite(n) && n >= 0) apply({ ...params, thickness: n })
          }}
        />
      )}
      {fields.includes('color') && (
        <ColorInput
          value={params.color ?? defaults.color ?? '#000000'}
          onCommit={hex => apply({ ...params, color: hexToRgb(hex) })}
        />
      )}
    </PanelSection>
  )
}
