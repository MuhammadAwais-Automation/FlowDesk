import PanelSection from './PanelSection'
import NumberField from './NumberField'
import Segmented from './Segmented'
import FontPicker from './FontPicker'
import { FONT_CATALOGUE, findFont, type FontFamily } from '@/lib/fontCatalogue'
import { formatLength, parseLength, type NodeStyles } from '@/lib/studioNode'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Italic,
  Underline,
  Strikethrough,
} from 'lucide-react'

interface Props { styles: NodeStyles; onUpdate: (next: NodeStyles) => void }

/**
 * The generic fallback appended after the quoted family name, matched to
 * FontPicker's own category → keyword mapping so a family that hasn't
 * finished loading (or whose file is briefly missing) still falls back to
 * something in the right register rather than the browser's default serif.
 */
const GENERIC_FALLBACK: Record<FontFamily['category'], string> = {
  display: 'sans-serif',
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace',
  script: 'cursive',
  handwriting: 'cursive',
}

/**
 * `styles['font-family']` holds a computed-style CSS value — e.g.
 * `"Anton", sans-serif` — not a catalogue id. FontPicker only speaks ids, so
 * every render we recover the id by stripping quotes off the first
 * comma-separated segment and matching it against the catalogue by family
 * name. Falls back to the first catalogue entry if nothing matches (no
 * selection yet, or a family that predates the catalogue).
 */
function fontIdFromCss(value: string | undefined): string {
  const first = (value ?? '').split(',')[0]?.trim().replace(/^["']|["']$/g, '')
  if (!first) return FONT_CATALOGUE[0].id
  const match = FONT_CATALOGUE.find(f => f.family.toLowerCase() === first.toLowerCase())
  return match?.id ?? FONT_CATALOGUE[0].id
}

/**
 * OpenType features Fontsource's metadata never lists per-family (it isn't
 * captured anywhere in the package data), so there is no way to enumerate
 * "the features this family actually has." Rather than fake a per-family
 * list, this offers a fixed set of features that are broadly useful and safe
 * to toggle blindly: a font that lacks a given feature simply ignores the
 * `font-feature-settings` tag for it, which is correct CSS behaviour, not an
 * error. `swsh` matters specifically because a swash is a separate glyph
 * inside the font file — unreachable by any other CSS — and the reference
 * posters this system exists to reproduce depend on it.
 */
const OPENTYPE_FEATURES: Array<{ tag: string; label: string }> = [
  { tag: 'liga', label: 'Ligatures' },
  { tag: 'dlig', label: 'Discretionary ligatures' },
  { tag: 'smcp', label: 'Small caps' },
  { tag: 'onum', label: 'Oldstyle figures' },
  { tag: 'tnum', label: 'Tabular figures' },
  { tag: 'salt', label: 'Stylistic alternates' },
  { tag: 'swsh', label: 'Swash' },
]

/** Parses `font-feature-settings: "liga" 1, "swsh" 1` into the set of enabled tags. */
function parseFeatureTags(value: string | undefined): Set<string> {
  const tags = new Set<string>()
  if (!value || value === 'normal') return tags
  const re = /"([a-zA-Z0-9]{4})"\s*(\d+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    if (m[2] === undefined || m[2] === '1') tags.add(m[1])
  }
  return tags
}

function formatFeatureTags(tags: Set<string>): string {
  if (tags.size === 0) return 'normal'
  return [...tags].map(t => `"${t}" 1`).join(', ')
}

const ALIGN_OPTIONS = [
  { value: 'left', label: 'left' },
  { value: 'center', label: 'center' },
  { value: 'right', label: 'right' },
  { value: 'justify', label: 'justify' },
]

const CASE_OPTIONS = [
  { value: 'none', label: 'Aa' },
  { value: 'uppercase', label: 'AA' },
  { value: 'lowercase', label: 'aa' },
  { value: 'capitalize', label: 'Aa+' },
]

export default function TypographySection({ styles, onUpdate }: Props) {
  const font = findFont(fontIdFromCss(styles['font-family'])) ?? FONT_CATALOGUE[0]
  const setLength = (prop: string) => (raw: string) => {
    const parsed = parseLength(raw)
    if (parsed !== null) onUpdate({ ...styles, [prop]: parsed })
  }

  const align = styles['text-align'] || 'left'
  const textCase = styles['text-transform'] || 'none'
  const italic = (styles['font-style'] || 'normal') === 'italic'
  const decorationLine = styles['text-decoration-line'] || 'none'
  const underline = decorationLine.includes('underline')
  const strikethrough = decorationLine.includes('line-through')
  const featureTags = parseFeatureTags(styles['font-feature-settings'])

  function toggleDecoration(kind: 'underline' | 'line-through') {
    const active = kind === 'underline' ? underline : strikethrough
    const next = new Set(decorationLine.split(' ').filter(t => t && t !== 'none'))
    if (active) next.delete(kind)
    else next.add(kind)
    onUpdate({ ...styles, 'text-decoration-line': next.size === 0 ? 'none' : [...next].join(' ') })
  }

  function toggleFeature(tag: string) {
    const next = new Set(featureTags)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    onUpdate({ ...styles, 'font-feature-settings': formatFeatureTags(next) })
  }

  return (
    <PanelSection title="Typography">
      <FontPicker
        value={font.id}
        onChange={({ family }) => {
          const f = findFont(fontIdFromCss(family)) ?? font
          onUpdate({ ...styles, 'font-family': `'${family}', ${GENERIC_FALLBACK[f.category]}` })
        }}
      />

      <WeightControl font={font} styles={styles} onUpdate={onUpdate} />

      <div className="grid grid-cols-2 gap-[var(--panel-gap)]">
        <NumberField label="Sz" value={formatLength(styles['font-size'] ?? '')} onCommit={setLength('font-size')} />
        <NumberField label="Ls" value={formatLength(styles['letter-spacing'] ?? '')} onCommit={setLength('letter-spacing')} />
        <NumberField label="Lh" value={formatLength(styles['line-height'] ?? '')} onCommit={setLength('line-height')} />
        <NumberField
          label="Ps"
          value={formatLength(styles['margin-bottom'] ?? '')}
          onCommit={setLength('margin-bottom')}
        />
      </div>

      <div className="flex gap-1">
        {ALIGN_OPTIONS.map(o => {
          const Icon = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify }[
            o.value as 'left' | 'center' | 'right' | 'justify'
          ]
          const active = align === o.value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              aria-label={`Align ${o.label}`}
              onClick={() => onUpdate({ ...styles, 'text-align': o.value })}
              className={`flex h-[var(--panel-control-h)] flex-1 items-center justify-center rounded-[var(--panel-radius)]
                          transition-colors ${active ? 'bg-s3 text-tx' : 'bg-s2 text-t3 hover:text-t2'}`}
            >
              <Icon size={13} />
            </button>
          )
        })}
      </div>

      <Segmented options={CASE_OPTIONS} value={textCase} onChange={v => onUpdate({ ...styles, 'text-transform': v })} />

      <div className="flex gap-1">
        <button
          type="button"
          aria-pressed={italic}
          aria-label="Italic"
          onClick={() => onUpdate({ ...styles, 'font-style': italic ? 'normal' : 'italic' })}
          className={`flex h-[var(--panel-control-h)] flex-1 items-center justify-center rounded-[var(--panel-radius)]
                      transition-colors ${italic ? 'bg-s3 text-tx' : 'bg-s2 text-t3 hover:text-t2'}`}
        >
          <Italic size={13} />
        </button>
        <button
          type="button"
          aria-pressed={underline}
          aria-label="Underline"
          onClick={() => toggleDecoration('underline')}
          className={`flex h-[var(--panel-control-h)] flex-1 items-center justify-center rounded-[var(--panel-radius)]
                      transition-colors ${underline ? 'bg-s3 text-tx' : 'bg-s2 text-t3 hover:text-t2'}`}
        >
          <Underline size={13} />
        </button>
        <button
          type="button"
          aria-pressed={strikethrough}
          aria-label="Strikethrough"
          onClick={() => toggleDecoration('line-through')}
          className={`flex h-[var(--panel-control-h)] flex-1 items-center justify-center rounded-[var(--panel-radius)]
                      transition-colors ${strikethrough ? 'bg-s3 text-tx' : 'bg-s2 text-t3 hover:text-t2'}`}
        >
          <Strikethrough size={13} />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-t3 text-[length:var(--panel-label)]">OpenType features</span>
        <div className="flex flex-wrap gap-1">
          {OPENTYPE_FEATURES.map(f => {
            const active = featureTags.has(f.tag)
            return (
              <button
                key={f.tag}
                type="button"
                aria-pressed={active}
                title={f.label}
                onClick={() => toggleFeature(f.tag)}
                className={`h-[calc(var(--panel-control-h)-6px)] rounded-[var(--panel-radius)] px-2
                            text-[length:var(--panel-label)] transition-colors
                            ${active ? 'bg-s3 text-tx' : 'bg-s2 text-t3 hover:text-t2'}`}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </div>
    </PanelSection>
  )
}

/**
 * A variable family's @font-face declares a weight *range* in one block, so
 * any value in that range renders correctly and a slider is the right
 * control. A static family only ships the discrete weight files listed in
 * `weights` — offering anything else has no file behind it and the browser
 * synthesises a faux-bold, which looks like a rendering bug and isn't one.
 * So static families get a `<select>` limited to `font.weights`.
 */
function WeightControl({ font, styles, onUpdate }: { font: FontFamily; styles: NodeStyles; onUpdate: (n: NodeStyles) => void }) {
  const weights = font.weights.length > 0 ? font.weights : [400]
  const current = Number(styles['font-weight']) || weights[0]

  if (font.variable) {
    const min = Math.min(...weights)
    const max = Math.max(...weights)
    return (
      <label className="flex items-center gap-1.5 min-w-0">
        <span className="w-3 shrink-0 text-t3 text-[length:var(--panel-label)]">Wt</span>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={Math.min(max, Math.max(min, current))}
          onChange={e => onUpdate({ ...styles, 'font-weight': e.target.value })}
          className="min-w-0 flex-1"
        />
        <span className="w-8 shrink-0 text-right font-mono tabular-nums text-t3 text-[length:var(--panel-label)]">
          {Math.min(max, Math.max(min, current))}
        </span>
      </label>
    )
  }

  return (
    <label className="flex items-center gap-1.5 min-w-0">
      <span className="w-3 shrink-0 text-t3 text-[length:var(--panel-label)]">Wt</span>
      <select
        value={weights.includes(current) ? current : weights[0]}
        onChange={e => onUpdate({ ...styles, 'font-weight': e.target.value })}
        className="h-[var(--panel-control-h)] min-w-0 flex-1 rounded-[var(--panel-radius)] bg-s2 border border-border-soft px-2
                   text-[length:var(--panel-input)] text-tx focus:outline-none focus:border-accent-border"
      >
        {weights.map(w => <option key={w} value={w}>{w}</option>)}
      </select>
    </label>
  )
}
