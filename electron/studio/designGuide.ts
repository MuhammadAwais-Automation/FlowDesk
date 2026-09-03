import { getLearnedPreferences, type AggregatedOverride } from './designMemory'

/**
 * The design-intelligence layer, as a tool the agent queries rather than
 * prompt text it is told once and may forget past a context compaction.
 *
 * The rules below are not general design theory — they were extracted by
 * reading the actual reference posters the user supplied (see
 * docs/superpowers/specs/2026-09-02-reference-system.md), and are the
 * ALWAYS/NEVER form written specifically for this purpose. Before this
 * existed, nothing in the agent's toolset carried them: it had to invent a
 * composition from a freeform prompt alone, and the concrete failure this
 * fixes is real — a generated poster used a random font-size, no fixed
 * palette, and a texture at opacity 0.14 that was effectively invisible.
 *
 * `getDesignGuide` appends one further section, generated fresh on every
 * call from `designMemory.getLearnedPreferences()` — this is the only part
 * of the guide that changes over a session, and it is absent entirely
 * until the user has actually corrected the agent's output on the same
 * property three or more times (see designMemory.ts). It is phrased as
 * guidance for next time, not as a dump of the raw override data.
 */

export const DESIGN_GUIDE = `# Poster and carousel design rules

Read this before composing any poster, cover, or carousel slide. These are
constraints, not suggestions — a design missing any ALWAYS item, or
containing any NEVER item, is not following the reference system.

## ALWAYS

- Three colours with fixed roles: ground, ink, one accent. The accent
  appears in at most three places on the canvas.
- Two typefaces: one heavy condensed display face for the hero word, one
  script or italic serif for a small qualifier line above or near it.
- The hero word spans 70-85% of the canvas width — it is the loudest
  element on the page, not a modest headline.
- Texture (grain, halftone, paper) is global: one screen over the entire
  finished composition, not applied to a single layer.
- A photographic subject is monochrome except for the one accent hue —
  desaturate it, then restore only the accent colour.
- At least one element bleeds off the canvas edge. Nothing sits fully
  contained inside the frame.
- Small tracked-out uppercase type frames the canvas: a header row, a short
  body block, and a footer index or credit line.

## NEVER

- A third typeface. Two faces only.
- A second saturated hue beyond the one accent.
- Texture at low opacity applied per-element. Opacity 0.14 on one layer is
  indistinguishable from no texture at all — this exact mistake already
  produced an invisible-looking halftone once.
- \`transform: scaleX()\` to fake a condensed face. It distorts stroke
  weights and reads as cheap. Use a genuinely condensed typeface instead.
- Every element sitting politely inside the frame.
- A subject placed flatly in front of or behind the hero type when the
  reference composition calls for interleaving (the subject in front of
  some letterforms, behind others).

## Tooling — use these instead of improvising

- **Fonts.** 129 families ship with the app and render offline. Call
  \`studio_list_fonts\` (searchable by name and category) to pick one instead
  of reaching for a Google Fonts \`<link>\` or any other CDN font — a past
  generation did exactly that, and it broke offline rendering and PDF/PNG
  export. Every font this system uses must come from the bundled catalogue.
- **Text effects.** Seven effects — shadow, lift, hollow, splice, echo, neon,
  glitch — are available as one call each via \`studio_set_effect\`. They
  compute \`text-shadow\`/\`-webkit-text-stroke\` correctly and keep the effect
  editable afterwards (by the panel too); do not hand-write those CSS
  properties yourself through \`studio_set_text_style\` or
  \`studio_update_styles\`.
- **Per-element style reading.** \`studio_get_computed_styles\` reads one
  element's tag, inline style, and applied effect. Read before you write —
  \`studio_set_text_style\`, \`studio_set_effect\`, \`studio_set_fill\` and
  \`studio_set_stroke\` only touch the fields you pass, so a read-modify-write
  is more reliable than guessing the current value.
`

/** One human-readable guidance line for a stated preference, not a raw data dump. */
function describePreference(pref: AggregatedOverride): string {
  const { property, agentValue, userValue } = pref
  const asNumber = (v: string) => {
    const n = parseFloat(v)
    return Number.isNaN(n) ? null : n
  }
  const a = asNumber(agentValue)
  const u = asNumber(userValue)
  if (a !== null && u !== null && a !== u) {
    const direction = u > a ? 'increases' : 'decreases'
    return `- This user consistently ${direction} the suggested \`${property}\` (from around \`${agentValue}\` toward \`${userValue}\`) — start closer to \`${userValue}\` instead of the usual default.`
  }
  return `- This user consistently replaces the suggested \`${property}\` (\`${agentValue}\`) with \`${userValue}\` — use \`${userValue}\` for \`${property}\` unless the brief says otherwise.`
}

function learnedPreferencesSection(): string {
  const preferences = getLearnedPreferences()
  if (preferences.length === 0) return ''
  const lines = preferences.map(describePreference).join('\n')
  return `\n## Learned preferences\n\nPatterns folded in from what this user has actually corrected after the\nagent produced it — each below reflects three or more consistent\noverrides of the same property, not a one-off edit.\n\n${lines}\n`
}

export function getDesignGuide(): string {
  return DESIGN_GUIDE + learnedPreferencesSection()
}
