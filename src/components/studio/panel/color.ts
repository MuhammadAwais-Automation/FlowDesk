/**
 * Shared colour helpers for the Fill, Stroke and Effects sections. A native
 * `<input type="color">` only speaks `#rrggbb`, but every colour value that
 * comes back through the bridge is `getComputedStyle` output — `rgb(...)`/
 * `rgba(...)` — so every colour control in this panel converts through the
 * same two functions instead of each section growing its own converter
 * (see PropertiesPanel's original `parseColor`/`hexToRgb`, which this
 * generalises so Fill, Stroke and Effects can share one implementation).
 */

const RGBA_RE = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/

/**
 * Best-effort normalisation of any CSS colour — `#hex`, `rgb()`/`rgba()`, or
 * a value this module can't parse (a named colour, `transparent`, `initial`,
 * empty) — to the `#rrggbb` form a colour input needs. Falls back to black
 * for anything unparseable, same fallback PropertiesPanel's swatch used.
 */
export function toHex(value: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return '#000000'
  const rgbMatch = trimmed.match(RGBA_RE)
  if (rgbMatch) {
    const hex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')
    return `#${hex(rgbMatch[1])}${hex(rgbMatch[2])}${hex(rgbMatch[3])}`
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map(c => c + c).join('')}`.toLowerCase()
  }
  return '#000000'
}

/** The model stores computed-style output (`rgb(...)`); writing back
 *  `#rrggbb` straight from a colour input would put a format the rest of
 *  NodeStyles never uses into the document. */
export function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${r}, ${g}, ${b})`
}

export interface GradientStop { color: string; pos: number }
export type GradientKind = 'linear' | 'radial'
export interface ParsedGradient { kind: GradientKind; angle: number; stops: GradientStop[] }

const LINEAR_RE = /^linear-gradient\(\s*(-?[\d.]+)deg\s*,\s*(.+)\)$/i
const RADIAL_RE = /^radial-gradient\(\s*circle\s*,\s*(.+)\)$/i
const STOP_RE = /^(.+?)\s+(-?[\d.]+)%$/

function parseStops(raw: string): GradientStop[] {
  const stops: GradientStop[] = []
  for (const part of raw.split(',')) {
    const m = part.trim().match(STOP_RE)
    if (!m) continue
    stops.push({ color: toHex(m[1].trim()), pos: Number(m[2]) })
  }
  return stops
}

/**
 * Parses a `background` value this panel wrote earlier so switching Linear
 * <-> Radial, or re-opening the section, keeps the stops the user set —
 * rather than resetting to two default stops every time. Returns null for
 * anything this panel didn't produce (a solid colour, or no background at
 * all), which callers treat as "seed fresh defaults".
 */
export function parseGradient(value: string | undefined): ParsedGradient | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return null
  const linear = trimmed.match(LINEAR_RE)
  if (linear) {
    const stops = parseStops(linear[2])
    if (stops.length >= 2) return { kind: 'linear', angle: Number(linear[1]), stops }
  }
  const radial = trimmed.match(RADIAL_RE)
  if (radial) {
    const stops = parseStops(radial[1])
    if (stops.length >= 2) return { kind: 'radial', angle: 0, stops }
  }
  return null
}

export function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

export function buildGradient(kind: GradientKind, angle: number, stops: GradientStop[]): string {
  const body = stops.map(s => `${s.color} ${clampPercent(s.pos)}%`).join(', ')
  return kind === 'linear' ? `linear-gradient(${angle}deg, ${body})` : `radial-gradient(circle, ${body})`
}
