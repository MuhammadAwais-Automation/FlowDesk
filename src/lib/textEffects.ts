/**
 * Model behind Canva's seven text effects. All of them decompose into two CSS
 * primitives, `text-shadow` and `-webkit-text-stroke` — this module is the single
 * parameterised vocabulary that produces each, so an applied effect stays editable
 * (a fixed look baked into markup would not be).
 */

export type EffectKind =
  | 'none'
  | 'shadow'
  | 'lift'
  | 'hollow'
  | 'splice'
  | 'echo'
  | 'neon'
  | 'glitch'

export interface EffectParams {
  kind: EffectKind
  /** Distance in px the shadow/copies travel from the text. */
  offset?: number
  /** Angle in degrees; 0 = shadow sits to the right (+x axis), increases clockwise. */
  direction?: number
  /** Blur radius in px. */
  blur?: number
  /** 0-100 scale driving shadow count/blur/opacity for neon and echo. */
  intensity?: number
  /** Stroke width in px for hollow/splice. */
  thickness?: number
  color?: string
}

export interface EffectCss {
  textShadow?: string
  webkitTextStroke?: string
  color?: string
}

const DEFAULT_COLOR = '#000000'

/** Round to a clean integer-ish px value, avoiding float noise like 6.123e-16. */
function px(n: number): string {
  const rounded = Math.round(n * 100) / 100
  // Collapse -0 to 0 and trim floating noise below a hundredth of a px.
  const clean = Object.is(rounded, -0) ? 0 : rounded
  return `${clean}px`
}

/** Resolve an (offset, direction) pair to a `${dx}px ${dy}px` shadow-offset pair. */
function offsetToXY(offset: number, direction: number): { dx: string; dy: string } {
  const rad = (direction * Math.PI) / 180
  const dx = offset * Math.cos(rad)
  const dy = offset * Math.sin(rad)
  return { dx: px(dx), dy: px(dy) }
}

function hexToRgba(color: string, alpha: number): string {
  const hex = color.trim().replace(/^#/, '')
  const clampAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 100) / 100
  if (hex.length === 3 || hex.length === 6) {
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${clampAlpha})`
  }
  // Non-hex color (named color, rgb(), etc.) — fall back to a best-effort rgba wrapper
  // isn't possible without a browser; just return the color unmodified for opacity 1,
  // otherwise use color-mix-free approximation via CSS `rgba` is not viable, so we keep
  // the original color string. Callers should prefer hex colors for echo/glitch/neon.
  return color
}

export function effectToCss(p: EffectParams): EffectCss {
  const kind = p.kind
  if (kind === 'none') return {}

  const color = p.color ?? DEFAULT_COLOR
  const offset = p.offset ?? 6
  const direction = p.direction ?? 0
  const blur = p.blur ?? 0
  const intensity = p.intensity ?? 50
  const thickness = p.thickness ?? 2

  switch (kind) {
    case 'shadow': {
      const { dx, dy } = offsetToXY(offset, direction)
      return { textShadow: `${dx} ${dy} ${px(blur)} ${color}` }
    }

    case 'lift': {
      // Soft shadow directly below (90deg = +y, straight down), suggesting the text
      // is raised off the canvas. Scales with intensity.
      const liftBlur = Math.max(2, (blur || 0) + intensity * 0.2)
      const liftOffset = Math.max(1, offset * 0.4 + intensity * 0.05)
      return {
        textShadow: `${px(0)} ${px(liftOffset)} ${px(liftBlur)} ${hexToRgba(color, 0.35)}`,
      }
    }

    case 'hollow': {
      return {
        color: 'transparent',
        webkitTextStroke: `${px(thickness)} ${color}`,
      }
    }

    case 'splice': {
      const { dx, dy } = offsetToXY(offset, direction)
      return {
        webkitTextStroke: `${px(thickness)} ${color}`,
        textShadow: `${dx} ${dy} ${px(blur)} ${color}`,
      }
    }

    case 'echo': {
      // Two or three offset copies at decreasing opacity, each further along the
      // same direction than the last.
      const copies = intensity >= 60 ? 3 : 2
      const shadows: string[] = []
      for (let i = 1; i <= copies; i++) {
        const { dx, dy } = offsetToXY(offset * i, direction)
        const alpha = Math.max(0.1, 0.6 - (i - 1) * 0.2)
        shadows.push(`${dx} ${dy} ${px(0)} ${hexToRgba(color, alpha)}`)
      }
      return { textShadow: shadows.join(', ') }
    }

    case 'neon': {
      // Stacked shadows at increasing blur in the accent hue — more/wider layers as
      // intensity rises, which is what makes the slider non-decorative.
      const layerCount = 3 + Math.round((intensity / 100) * 3) // 3..6
      const shadows: string[] = []
      for (let i = 1; i <= layerCount; i++) {
        const layerBlur = (blur || 2) * i + intensity * 0.15 * i
        shadows.push(`${px(0)} ${px(0)} ${px(layerBlur)} ${color}`)
      }
      return { textShadow: shadows.join(', ') }
    }

    case 'glitch': {
      // Offset colour copies, typically cyan/magenta either side of the base color.
      const { dx: dx1, dy: dy1 } = offsetToXY(offset, direction)
      const { dx: dx2, dy: dy2 } = offsetToXY(offset, direction + 180)
      const primary = color === DEFAULT_COLOR ? '#00fff9' : color
      const secondary = '#ff00c1'
      const shadows = [
        `${dx1} ${dy1} ${px(0)} ${primary}`,
        `${dx2} ${dy2} ${px(0)} ${secondary}`,
      ]
      return { textShadow: shadows.join(', ') }
    }

    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export const EFFECT_DEFAULTS: Record<EffectKind, EffectParams> = {
  none: { kind: 'none' },
  shadow: { kind: 'shadow', offset: 8, direction: 45, blur: 4, color: '#000000' },
  lift: { kind: 'lift', offset: 6, blur: 12, intensity: 40, color: '#000000' },
  hollow: { kind: 'hollow', thickness: 2, color: '#000000' },
  splice: { kind: 'splice', offset: 6, direction: 45, blur: 0, thickness: 2, color: '#000000' },
  echo: { kind: 'echo', offset: 8, direction: 45, intensity: 60, color: '#000000' },
  neon: { kind: 'neon', blur: 3, intensity: 60, color: '#0ff' },
  glitch: { kind: 'glitch', offset: 4, direction: 0, color: '#00fff9' },
}
