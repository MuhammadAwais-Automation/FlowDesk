/**
 * Design Lint checks the current artboard against the same ALWAYS/NEVER
 * rules `getDesignGuide()` (electron/studio/designGuide.ts) hands the agent
 * as prose. The guide is advice the model can read and still ignore — this
 * is the same rules turned into a check it cannot argue past. Every rule
 * here traces to a specific line in that guide; if a rule changes here, the
 * guide text must change too, or the tool starts contradicting itself.
 *
 * Pure and DOM-free: it works off a computed-style snapshot the bridge
 * already reports, never the iframe DOM itself.
 */

export interface LintNode {
  elementId: string
  tag: string
  computedStyles: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
}

export interface LintFinding {
  rule: string
  severity: 'error' | 'warning'
  message: string
  elementId?: string
  fixHint: string
}

const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'span', 'a', 'li', 'blockquote', 'figcaption', 'label',
  'strong', 'em', 'b', 'i', 'small', 'caption', 'q', 'cite', 'mark',
])

const TEXTURE_BLEND_MODES = new Set(['overlay', 'multiply', 'soft-light', 'screen'])

/** Strips quotes/whitespace and takes the first family in a font-family stack. */
function firstFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0] ?? ''
  return first.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

function parseOpacity(value: string | undefined): number {
  if (!value) return 1
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 1
}

/**
 * Parses `rgb()`/`rgba()`/`#hex` into RGB. Named colours (e.g. "red") and
 * anything else unrecognized return null and are skipped by the hue rule —
 * this is a heuristic, not a full CSS colour parser, and skipping unknowns
 * is safer than guessing.
 */
function parseRgb(value: string | undefined): { r: number; g: number; b: number } | null {
  if (!value) return null
  const v = value.trim()
  const rgbMatch = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgbMatch) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) }
  }
  const hexMatch = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hexMatch) {
    const hex = hexMatch[1]
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      return { r, g, b }
    }
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return { r, g, b }
  }
  return null
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60; break
    case gn: h = ((bn - rn) / d + 2) * 60; break
    default: h = ((rn - gn) / d + 4) * 60; break
  }
  return { h, s, l }
}

/**
 * "Saturated accent hue" threshold, per the guide's "one accent" /
 * "second saturated hue" rules. There is no way to detect which colour is
 * *the* accent purely from computed styles, so this is deliberately a
 * heuristic over the whole artboard: any colour with HSL saturation above
 * 40% and lightness strictly between 15% and 85% (i.e. not near-black,
 * near-white, or the flat greys a ground/ink pair uses) counts as "a
 * saturated hue in use". More than one distinct such hue (binned to the
 * nearest 15 degrees, so near-identical accents don't double-count) is
 * flagged. 40% saturation is chosen because muted/neutral UI tones (the
 * kind a ground or ink colour legitimately uses) typically sit below it,
 * while brand/accent colours sit above it — it will occasionally
 * mis-classify a deliberately muted accent as "not saturated" or a vivid
 * neutral as "saturated", which is why the fix-hint below says to confirm
 * by eye rather than treating this as gospel.
 */
const SATURATION_THRESHOLD = 0.4
const HUE_BIN_DEGREES = 15

function collectSaturatedHueBins(nodes: LintNode[]): Set<number> {
  const bins = new Set<number>()
  for (const node of nodes) {
    for (const prop of ['color', 'background-color'] as const) {
      const rgb = parseRgb(node.computedStyles[prop])
      if (!rgb) continue
      const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
      if (s > SATURATION_THRESHOLD && l > 0.15 && l < 0.85) {
        bins.add(Math.round(h / HUE_BIN_DEGREES) * HUE_BIN_DEGREES)
      }
    }
  }
  return bins
}

export function lintArtboard(nodes: LintNode[], canvas: { width: number; height: number }): LintFinding[] {
  const findings: LintFinding[] = []

  // Rule 1: more than two font families in use (guide: "Two typefaces...
  // NEVER a third typeface").
  const families = new Set<string>()
  for (const node of nodes) {
    const raw = node.computedStyles['font-family']
    if (raw) families.add(firstFamily(raw))
  }
  if (families.size > 2) {
    findings.push({
      rule: 'font-family-count',
      severity: 'error',
      message: `${families.size} font families in use ("${[...families].join('", "')}") — the guide allows two.`,
      fixHint: 'Pick the two families that carry the hero word and the qualifier line, then reassign every other text node to one of those two via studio_set_text_style.',
    })
  }

  // Rule 2: more than one saturated accent hue (guide: "one accent" /
  // "NEVER a second saturated hue beyond the one accent"). See
  // collectSaturatedHueBins for the threshold and its rationale.
  const hueBins = collectSaturatedHueBins(nodes)
  if (hueBins.size > 1) {
    findings.push({
      rule: 'accent-hue-count',
      severity: 'warning',
      message: `${hueBins.size} distinct saturated hues detected across the artboard — the guide allows one accent colour. This is a heuristic (saturation > ${Math.round(SATURATION_THRESHOLD * 100)}%, excluding near-black/near-white/grey); confirm by eye before treating it as certain.`,
      fixHint: 'Pick one accent hue and recolour the other saturated elements to ground, ink, or a desaturated variant of the chosen accent via studio_set_fill.',
    })
  }

  // Rule 3: a texture layer under 0.25 opacity (guide: "Opacity 0.14 on one
  // layer is indistinguishable from no texture at all" — the regression
  // this rule exists to catch). Bare low opacity is not itself a violation
  // (ordinary fades use it); only opacity below 0.25 combined with a blend
  // mode texture layers actually use is flagged.
  for (const node of nodes) {
    const blendMode = node.computedStyles['mix-blend-mode']
    if (!blendMode || !TEXTURE_BLEND_MODES.has(blendMode)) continue
    const opacity = parseOpacity(node.computedStyles.opacity)
    if (opacity < 0.25) {
      findings.push({
        rule: 'texture-opacity-too-low',
        severity: 'error',
        message: `Texture layer (${blendMode}) at opacity ${opacity} reads as no texture at all — the guide names exactly this failure.`,
        elementId: node.elementId,
        fixHint: `Raise this layer's opacity to at least 0.25-0.4 via studio_update_styles, or remove it if the texture was meant to be global rather than per-element.`,
      })
    }
  }

  // Rule 4: nothing bleeds off the canvas edge (guide: "At least one element
  // bleeds off the canvas edge. Nothing sits fully contained inside the
  // frame.").
  const anyBleeds = nodes.some(node => {
    const { x, y, width, height } = node.rect
    return x < 0 || y < 0 || x + width > canvas.width || y + height > canvas.height
  })
  if (nodes.length > 0 && !anyBleeds) {
    findings.push({
      rule: 'nothing-bleeds',
      severity: 'warning',
      message: 'Every element sits fully inside the canvas — the guide requires at least one element to bleed off an edge.',
      fixHint: 'Extend the hero word, a texture layer, or a background shape past one canvas edge (negative left/top, or width/height beyond the canvas bounds).',
    })
  }

  // Rule 5: hero word under 60% of canvas width (guide: "The hero word spans
  // 70-85% of the canvas width"; 60% is the lint floor below the ideal
  // range). The largest font-size text node is treated as the hero.
  const textNodes = nodes.filter(n => TEXT_TAGS.has(n.tag.toLowerCase()))
  if (textNodes.length > 0) {
    let hero = textNodes[0]
    let heroSize = Number.parseFloat(hero.computedStyles['font-size'] || '0') || 0
    for (const node of textNodes) {
      const size = Number.parseFloat(node.computedStyles['font-size'] || '0') || 0
      if (size > heroSize) {
        hero = node
        heroSize = size
      }
    }
    if (canvas.width > 0 && hero.rect.width < canvas.width * 0.6) {
      findings.push({
        rule: 'hero-word-too-narrow',
        severity: 'warning',
        message: `The largest text element spans ${Math.round((hero.rect.width / canvas.width) * 100)}% of canvas width — the guide wants the hero word at 70-85%.`,
        elementId: hero.elementId,
        fixHint: 'Increase this element\'s font-size (or reduce its wrapping width) until it spans roughly 70-85% of the canvas width via studio_set_text_style.',
      })
    }
  }

  return findings
}
