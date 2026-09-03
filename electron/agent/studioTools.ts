import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'crypto'
import type { RequestApproval } from './approval'
import { listDocuments, createDocument, readDocumentHtml, writeDocumentHtml } from '../studio/documentStore'
import { parseArtboards, replaceArtboardHtml, appendArtboard } from '../studio/artboards'
import { STUDIO_PRESETS, findPreset } from '../studio/presets'
import { renderArtboardPng } from '../studio/render'
import { exportArtboardPng, exportDocumentPdf } from '../studio/export'
import { addImageToDocument } from '../studio/assetStore'
import { getDesignGuide } from '../studio/designGuide'
import { recordAgentProposal } from '../studio/designMemory'
import { readElement, patchStyle, patchAttr, applyLayerCommand } from '../studio/nodeOps'
import { effectToCss, type EffectParams } from '../../src/lib/textEffects'
import { FONT_CATALOGUE, findFont, searchFonts, type FontFamily } from '../../src/lib/fontCatalogue'
import { isLayerCommand, type LayerCommand } from '../../src/lib/layerOps'
import { EFFECT_ATTR, isTextTag } from '../../src/lib/studioNode'

/**
 * Studio's agent surface.
 *
 * Split into read and write, which is also the approval boundary: reads only
 * look and run freely, writes change a real file and are gated. The split
 * mirrors the one paper.design arrived at for the same job.
 */

const MAX_TOOL_TEXT = 12_000

function ok(value: unknown) {
  const out = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text' as const, text: out.length > MAX_TOOL_TEXT ? out.slice(0, MAX_TOOL_TEXT) + '\n\n[truncated]' : out }] }
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

async function guard<T>(run: () => Promise<T>) {
  try {
    return ok(await run())
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

export const STUDIO_TOOL_NAMES = [
  'mcp__workers__studio_list_documents',
  'mcp__workers__studio_get_html',
  'mcp__workers__studio_screenshot',
  'mcp__workers__studio_list_presets',
  'mcp__workers__studio_get_guide',
  'mcp__workers__studio_create_document',
  'mcp__workers__studio_create_artboard',
  'mcp__workers__studio_create_variants',
  'mcp__workers__studio_write_html',
  'mcp__workers__studio_update_styles',
  'mcp__workers__studio_add_image',
  'mcp__workers__studio_export',
  // Task 10 — per-element parity with the panel.
  'mcp__workers__studio_list_fonts',
  'mcp__workers__studio_get_computed_styles',
  'mcp__workers__studio_set_text_style',
  'mcp__workers__studio_set_effect',
  'mcp__workers__studio_set_fill',
  'mcp__workers__studio_set_stroke',
  'mcp__workers__studio_layer_op',
]

const GENERIC_FALLBACK: Record<FontFamily['category'], string> = {
  display: 'sans-serif',
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace',
  script: 'cursive',
  handwriting: 'cursive',
}

/** Resolves an agent-supplied font id or family name to a catalogue entry. */
function resolveFont(input: string): FontFamily {
  const byId = findFont(input)
  if (byId) return byId
  const lower = input.trim().toLowerCase()
  const byName = FONT_CATALOGUE.find(f => f.family.toLowerCase() === lower)
  if (byName) return byName
  throw new Error(`No font "${input}" in the catalogue. Use studio_list_fonts to search by name or id.`)
}

function formatFeatureTags(tags: string[]): string {
  return tags.length === 0 ? 'normal' : tags.map(t => `"${t}" 1`).join(', ')
}

function buildGradientCss(kind: 'linear' | 'radial', angle: number, stops: Array<{ color: string; pos: number }>): string {
  const body = stops.map(s => `${s.color} ${Math.min(100, Math.max(0, Math.round(s.pos)))}%`).join(', ')
  return kind === 'linear' ? `linear-gradient(${angle}deg, ${body})` : `radial-gradient(circle, ${body})`
}

/** Loads a document and locates one of its artboards, or throws a message naming the real ids. */
async function loadArtboard(documentId: string, artboardId: string) {
  const documentHtml = await readDocumentHtml(documentId)
  if (documentHtml === null) throw new Error(`No Studio document "${documentId}".`)
  const boards = parseArtboards(documentHtml)
  const board = boards.find(b => b.id === artboardId)
  if (!board) throw new Error(`No artboard "${artboardId}". Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
  return { documentHtml, board }
}

/** Applies a per-element edit function to an artboard's HTML and persists the result. Throws if the element or artboard is missing. */
async function editElement(
  documentId: string,
  artboardId: string,
  elementId: string,
  edit: (artboardHtml: string) => string | null,
) {
  const { documentHtml, board } = await loadArtboard(documentId, artboardId)
  const next = edit(board.html)
  if (next === null) throw new Error(`No element "${elementId}" in artboard "${artboardId}".`)
  return await writeDocumentHtml(documentId, replaceArtboardHtml(documentHtml, artboardId, next))
}

export function createStudioTools(requestApproval: RequestApproval) {
  const readOnly = { annotations: { readOnlyHint: true } }

  return [
    tool(
      'studio_list_documents',
      'List every Studio document with its artboards (id, name, width, height). Start here to find what already exists before creating anything.',
      {},
      () => guard(async () => await listDocuments()),
      readOnly,
    ),

    tool(
      'studio_get_html',
      "Read a Studio document's HTML, or one artboard's inner HTML. Read before writing so an edit preserves what is already there.",
      {
        documentId: z.string(),
        artboardId: z.string().optional().describe('Omit for the whole document; give an id for just that artboard.'),
      },
      ({ documentId, artboardId }) => guard(async () => {
        const html = await readDocumentHtml(documentId)
        if (html === null) throw new Error(`No Studio document "${documentId}".`)
        if (!artboardId) return html
        const boards = parseArtboards(html)
        const board = boards.find(b => b.id === artboardId)
        if (!board) throw new Error(`No artboard "${artboardId}". Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
        return board.html
      }),
      readOnly,
    ),

    tool(
      'studio_screenshot',
      'See an artboard as it actually renders. Use this after writing HTML and before telling the user it is done — it is the only way to tell a correct layout from a broken one. Writes nothing to disk.',
      { documentId: z.string(), artboardId: z.string() },
      async ({ documentId, artboardId }) => {
        try {
          const bytes = await renderArtboardPng(documentId, artboardId)
          return {
            content: [
              { type: 'text' as const, text: `${artboardId} rendered (${bytes.length} bytes)` },
              { type: 'image' as const, data: bytes.toString('base64'), mimeType: 'image/png' },
            ],
          }
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error))
        }
      },
      readOnly,
    ),

    tool(
      'studio_list_presets',
      'List the 31 design presets with their vibe and what each is best and worst for. Choose one before generating a design rather than inventing a palette.',
      {},
      () => guard(async () => STUDIO_PRESETS.map(({ id, name, vibe, bestFor, avoidFor }) => ({ id, name, vibe, bestFor, avoidFor }))),
      readOnly,
    ),

    tool(
      'studio_get_guide',
      'Read the composition rules for posters, covers, and carousel slides — palette roles, type pairing, texture, bleed, and the specific mistakes to avoid. Call this before composing any such design, the same way studio_list_presets is checked before inventing a palette: this is the other half, covering layout and typography rather than colour and fonts.',
      {},
      () => guard(async () => getDesignGuide()),
      readOnly,
    ),

    tool(
      'studio_create_document',
      "Create a new Studio document, optionally seeded with a preset's fonts and CSS tokens.",
      {
        title: z.string().describe('What this document is, e.g. "Q3 launch carousel".'),
        preset: z.string().optional().describe('A preset id or name from studio_list_presets.'),
      },
      async ({ title, preset }) => {
        // Validate the preset BEFORE creating anything, or an unknown name
        // leaves an empty document behind.
        const chosen = preset ? findPreset(preset) : null
        if (preset && !chosen) {
          return fail(`No preset "${preset}". Available: ${STUDIO_PRESETS.map(p => p.name).join(', ')}`)
        }
        if (!await requestApproval({
          tool: 'studio_create_document',
          title: `Create Studio document "${title}"`,
          ...(chosen ? { detail: `Preset: ${chosen.name}` } : {}),
        })) {
          return fail('The user declined creating that document.')
        }
        return guard(async () => {
          const meta = await createDocument(title)
          if (!chosen) return meta
          const html = (await readDocumentHtml(meta.id))!
            .replace('</head>', `${chosen.fontsLink}\n<style>${chosen.cssTokens}</style>\n</head>`)
          return await writeDocumentHtml(meta.id, html)
        })
      },
    ),

    tool(
      'studio_create_artboard',
      'Add an artboard of a given pixel size. A carousel is several 1080x1080 artboards; a LinkedIn post one 1080x1350; a YouTube thumbnail 1280x720; an app screen 390x844; a web page one tall artboard such as 1440x3000. Keep every artboard in a document the same size if you want a PDF of it.',
      {
        documentId: z.string(),
        name: z.string().describe('Human label, e.g. "Slide 3".'),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      },
      async ({ documentId, name, width, height }) => {
        if (!await requestApproval({ tool: 'studio_create_artboard', title: `Add ${width}x${height} artboard "${name}"` })) {
          return fail('The user declined adding that artboard.')
        }
        return guard(async () => {
          const html = await readDocumentHtml(documentId)
          if (html === null) throw new Error(`No Studio document "${documentId}".`)
          const id = `ab-${randomUUID().slice(0, 8)}`
          return await writeDocumentHtml(documentId, appendArtboard(html, { id, name, width, height }))
        })
      },
    ),

    tool(
      'studio_create_variants',
      "Fan out one artboard into N empty variant slots for a genuinely different design direction each — the feature a human can't do at this cost: one call producing N parallel directions from the same brief, instead of one design rendered N times. This tool does not design anything: each new artboard starts as an exact copy of the source's current HTML and dimensions. It returns the new artboard ids plus the source's html/width/height so the necessary follow-up is unambiguous — call studio_write_html once per returned id, writing a distinct, brief-informed direction into each rather than leaving them as duplicates. Capped at 6 variants per call; a larger request is almost always a mistake, so ask for fewer or call again for another batch instead of it being silently truncated.",
      {
        documentId: z.string(),
        artboardId: z.string().describe('The source artboard to fan out from.'),
        count: z.number().int().positive().describe('How many new variant artboards to create alongside the source. Max 6.'),
        brief: z.string().describe("The design brief driving the variants. Not written anywhere by this tool — it is echoed back so the follow-up studio_write_html calls stay anchored to what each variant is supposed to explore."),
      },
      async ({ documentId, artboardId, count, brief }) => {
        const MAX_VARIANTS = 6
        if (count > MAX_VARIANTS) {
          return fail(
            `Asked for ${count} variants, but this tool caps at ${MAX_VARIANTS} per call — that many simultaneous directions is almost certainly a mistake. Ask for ${MAX_VARIANTS} or fewer, or call studio_create_variants again for another batch.`,
          )
        }
        if (!await requestApproval({
          tool: 'studio_create_variants',
          title: `Create ${count} variant${count === 1 ? '' : 's'} of artboard "${artboardId}"`,
          detail: brief.slice(0, 300),
        })) {
          return fail('The user declined creating those variants.')
        }
        return guard(async () => {
          const { documentHtml, board } = await loadArtboard(documentId, artboardId)
          let html = documentHtml
          const createdArtboardIds: string[] = []
          for (let i = 0; i < count; i++) {
            const id = `ab-${randomUUID().slice(0, 8)}`
            const name = `${board.name} — variant ${i + 2}`
            html = appendArtboard(html, { id, name, width: board.width, height: board.height, html: board.html })
            createdArtboardIds.push(id)
          }
          await writeDocumentHtml(documentId, html)
          return {
            createdArtboardIds,
            source: { artboardId: board.id, name: board.name, width: board.width, height: board.height, html: board.html },
            brief,
            next: `Each artboard in createdArtboardIds currently holds an exact copy of the source's HTML. Call studio_write_html once per id with a genuinely different design direction for "${brief}" — leaving them as duplicates defeats the point of this tool.`,
          }
        })
      },
    ),

    tool(
      'studio_write_html',
      "Replace one artboard's inner HTML. Everything outside that artboard is untouched, so this is safe to call repeatedly while iterating on one slide. This is a plain HTML document, not XML — write raw HTML directly, never wrapped in <![CDATA[ ... ]]>. A browser does not recognize that as a section marker; it renders as literal, visible text.",
      {
        documentId: z.string(),
        artboardId: z.string(),
        html: z.string().describe('Inner HTML for the artboard, as raw HTML — no <![CDATA[ ... ]]> wrapper. Do not include the artboard wrapper element itself.'),
      },
      async ({ documentId, artboardId, html }) => {
        if (!await requestApproval({ tool: 'studio_write_html', title: `Write ${html.length} characters into artboard ${artboardId}` })) {
          return fail('The user declined that edit.')
        }
        return guard(async () => {
          const documentHtml = await readDocumentHtml(documentId)
          if (documentHtml === null) throw new Error(`No Studio document "${documentId}".`)
          return await writeDocumentHtml(documentId, replaceArtboardHtml(documentHtml, artboardId, html))
        })
      },
    ),

    tool(
      'studio_update_styles',
      'Replace the document-level :root CSS custom properties, changing the whole look at once without rewriting any artboard.',
      {
        documentId: z.string(),
        cssTokens: z.string().describe('A complete `:root { ... }` block.'),
      },
      async ({ documentId, cssTokens }) => {
        if (!await requestApproval({ tool: 'studio_update_styles', title: "Change the document's style tokens", detail: cssTokens.slice(0, 400) })) {
          return fail('The user declined that style change.')
        }
        return guard(async () => {
          const html = await readDocumentHtml(documentId)
          if (html === null) throw new Error(`No Studio document "${documentId}".`)
          const next = /:root\s*\{[\s\S]*?\}/.test(html)
            ? html.replace(/:root\s*\{[\s\S]*?\}/, cssTokens)
            : html.replace('</head>', `<style>${cssTokens}</style>\n</head>`)
          return await writeDocumentHtml(documentId, next)
        })
      },
    ),

    tool(
      'studio_add_image',
      'Copy an already-generated image into this document so it can be used in an <img> tag — accepts a flowdesk-image://... reference (from ask_chatgpt) or a local file path (e.g. one Google Flow already downloaded to disk). Does not generate an image itself; generate one with ask_chatgpt or a studio_flow_* tool first. Returns a studio-asset:// src to embed via studio_write_html.',
      {
        documentId: z.string(),
        source: z.string().describe('A flowdesk-image://... reference, or an absolute local file path to an already-saved image.'),
        altText: z.string().describe('Alt text for the <img> tag; also used to name the saved file.'),
      },
      async ({ documentId, source, altText }) => {
        if (!await requestApproval({ tool: 'studio_add_image', title: 'Add an image to this document', detail: source.slice(0, 300) })) {
          return fail('The user declined adding that image.')
        }
        return guard(async () => addImageToDocument(documentId, source, altText))
      },
    ),

    tool(
      'studio_export',
      'Export to Downloads/FlowDesk Studio. Give an artboardId for a PNG of that artboard, or omit it for a PDF of the whole document. PDF needs every artboard to be the same size.',
      { documentId: z.string(), artboardId: z.string().optional() },
      async ({ documentId, artboardId }) => {
        if (!await requestApproval({ tool: 'studio_export', title: artboardId ? `Export artboard ${artboardId} as PNG` : 'Export the document as PDF' })) {
          return fail('The user declined that export.')
        }
        return guard(async () =>
          artboardId
            ? `Saved to ${await exportArtboardPng(documentId, artboardId)}`
            : `Saved to ${await exportDocumentPdf(documentId)}`)
      },
    ),

    tool(
      'studio_list_fonts',
      'Search the 129-family bundled font catalogue by name and/or category. All families render offline — never add a Google Fonts <link> or any other CDN font; it breaks offline rendering and export. Results are capped; narrow the query if the count you need is not all shown.',
      {
        query: z.string().optional().describe('Case-insensitive substring match against the family name, e.g. "condensed" or "playfair".'),
        category: z.enum(['display', 'sans', 'serif', 'mono', 'script', 'handwriting']).optional(),
      },
      ({ query, category }) => guard(async () => {
        const matches = searchFonts(query ?? '', category)
        const CAP = 40
        const shown = matches.slice(0, CAP)
        return {
          totalMatched: matches.length,
          shown: shown.length,
          fonts: shown.map(f => ({ id: f.id, family: f.family, category: f.category, weights: f.weights, variable: f.variable, italic: f.italic })),
          ...(matches.length > CAP ? { note: `${matches.length - CAP} more matched but were not shown; narrow the query or category to see them.` } : {}),
        }
      }),
      readOnly,
    ),

    tool(
      'studio_get_computed_styles',
      "Read one element's current tag, inline style, and applied text effect (if any). Use this before studio_set_text_style / studio_set_effect / studio_set_fill / studio_set_stroke so an edit modifies what is actually there instead of guessing.",
      { documentId: z.string(), artboardId: z.string(), elementId: z.string() },
      ({ documentId, artboardId, elementId }) => guard(async () => {
        const { board } = await loadArtboard(documentId, artboardId)
        const el = readElement(board.html, elementId)
        if (!el) throw new Error(`No element "${elementId}" in artboard "${artboardId}".`)
        const rawEffect = el.attrs(EFFECT_ATTR)
        let effect: EffectParams | null = null
        if (rawEffect) {
          try { effect = JSON.parse(rawEffect) } catch { effect = null }
        }
        return { tag: el.tag, style: el.style, effect }
      }),
      readOnly,
    ),

    tool(
      'studio_set_text_style',
      'Set typography on one element in a single call: font family/weight, size, letter-spacing, line-height, alignment, case, italic, underline/strikethrough, and OpenType features. Only the fields you pass are written — everything else is left as-is. Read the current styles first with studio_get_computed_styles when modifying rather than replacing.',
      {
        documentId: z.string(),
        artboardId: z.string(),
        elementId: z.string(),
        family: z.string().optional().describe('A font id or family name from studio_list_fonts, e.g. "anton" or "Anton".'),
        weight: z.number().int().optional().describe('e.g. 400, 700, 900 — should be one of the family\'s weights from studio_list_fonts.'),
        size: z.number().positive().optional().describe('Font size in px.'),
        letterSpacing: z.number().optional().describe('Letter spacing in px; may be negative.'),
        lineHeight: z.number().positive().optional().describe('Unitless line-height multiplier, e.g. 1.2.'),
        align: z.enum(['left', 'center', 'right', 'justify']).optional(),
        transform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
        italic: z.boolean().optional(),
        decoration: z.array(z.enum(['underline', 'line-through'])).optional().describe('Pass an empty array to clear all decoration.'),
        fontFeatures: z.array(z.string()).optional().describe('OpenType feature tags to enable, e.g. ["liga", "swsh"]. Pass an empty array to clear all.'),
      },
      async (args) => {
        const { documentId, artboardId, elementId, family, weight, size, letterSpacing, lineHeight, align, transform, italic, decoration, fontFeatures } = args
        const patch: Record<string, string | null> = {}
        if (family !== undefined) {
          let font: FontFamily
          try { font = resolveFont(family) } catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
          patch['font-family'] = `'${font.family}', ${GENERIC_FALLBACK[font.category]}`
        }
        if (weight !== undefined) patch['font-weight'] = String(weight)
        if (size !== undefined) patch['font-size'] = `${size}px`
        if (letterSpacing !== undefined) patch['letter-spacing'] = `${letterSpacing}px`
        if (lineHeight !== undefined) patch['line-height'] = String(lineHeight)
        if (align !== undefined) patch['text-align'] = align
        if (transform !== undefined) patch['text-transform'] = transform
        if (italic !== undefined) patch['font-style'] = italic ? 'italic' : 'normal'
        if (decoration !== undefined) patch['text-decoration-line'] = decoration.length === 0 ? 'none' : decoration.join(' ')
        if (fontFeatures !== undefined) patch['font-feature-settings'] = formatFeatureTags(fontFeatures)

        if (Object.keys(patch).length === 0) return fail('No text-style fields were given; nothing to change.')

        if (!await requestApproval({ tool: 'studio_set_text_style', title: `Set typography on ${elementId}`, detail: JSON.stringify(patch) })) {
          return fail('The user declined that typography change.')
        }
        return guard(async () => {
          const meta = await editElement(documentId, artboardId, elementId, html => patchStyle(html, elementId, patch))
          // Design memory (Task 13): a subsequent panel edit to the same
          // elementId+property within the TTL is an override, not this write
          // itself — see designMemory.ts for why this is the only place an
          // agent-authored value for these fields is knowable.
          for (const [property, value] of Object.entries(patch)) {
            if (value !== null) recordAgentProposal(elementId, property, value)
          }
          return meta
        })
      },
    ),

    tool(
      'studio_set_effect',
      "Apply one of the seven text effects (shadow, lift, hollow, splice, echo, neon, glitch) to an element, or clear it with kind \"none\". Computes the underlying text-shadow / -webkit-text-stroke CSS and also writes the effect's own parameters into the document so it round-trips and stays editable by the panel later — do not hand-write text-shadow yourself via studio_set_text_style or studio_update_styles for this.",
      {
        documentId: z.string(),
        artboardId: z.string(),
        elementId: z.string(),
        kind: z.enum(['none', 'shadow', 'lift', 'hollow', 'splice', 'echo', 'neon', 'glitch']),
        offset: z.number().optional().describe('Distance in px the shadow/copies travel.'),
        direction: z.number().optional().describe('Angle in degrees; 0 = right, increases clockwise.'),
        blur: z.number().optional().describe('Blur radius in px.'),
        intensity: z.number().min(0).max(100).optional().describe('0-100, drives shadow count/blur/opacity for neon and echo.'),
        thickness: z.number().optional().describe('Stroke width in px for hollow/splice.'),
        color: z.string().optional(),
      },
      async ({ documentId, artboardId, elementId, kind, offset, direction, blur, intensity, thickness, color }) => {
        const params: EffectParams = { kind, offset, direction, blur, intensity, thickness, color }
        if (!await requestApproval({ tool: 'studio_set_effect', title: `Set "${kind}" text effect on ${elementId}` })) {
          return fail('The user declined that effect change.')
        }
        return guard(async () => editElement(documentId, artboardId, elementId, html => {
          const el = readElement(html, elementId)
          if (!el) return null
          const css = effectToCss(params)
          const stylePatch: Record<string, string | null> = {
            'text-shadow': css.textShadow ?? null,
            '-webkit-text-stroke': css.webkitTextStroke ?? null,
          }
          if (css.color !== undefined) stylePatch.color = css.color
          const withStyle = patchStyle(html, elementId, stylePatch)
          if (withStyle === null) return null
          return patchAttr(withStyle, elementId, EFFECT_ATTR, kind === 'none' ? null : JSON.stringify(params))
        }))
      },
    ),

    tool(
      'studio_set_fill',
      'Set an element\'s fill: a solid colour, or a linear/radial gradient with two or more stops.',
      {
        documentId: z.string(),
        artboardId: z.string(),
        elementId: z.string(),
        type: z.enum(['solid', 'linear', 'radial']),
        color: z.string().optional().describe('Solid fill colour (any CSS colour). Required when type is "solid".'),
        angle: z.number().optional().describe('Gradient angle in degrees. Used when type is "linear"; defaults to 90.'),
        stops: z.array(z.object({ color: z.string(), pos: z.number().min(0).max(100) })).optional()
          .describe('Gradient stops (at least 2), each a colour and a 0-100 position. Required when type is "linear" or "radial".'),
      },
      async ({ documentId, artboardId, elementId, type, color, angle, stops }) => {
        if (type === 'solid' && !color) return fail('type "solid" needs a color.')
        if (type !== 'solid' && (!stops || stops.length < 2)) return fail(`type "${type}" needs at least 2 stops.`)

        if (!await requestApproval({ tool: 'studio_set_fill', title: `Set ${type} fill on ${elementId}` })) {
          return fail('The user declined that fill change.')
        }
        return guard(async () => {
          const property = type === 'solid' ? 'background-color' : 'background'
          const value = type === 'solid' ? color! : buildGradientCss(type, angle ?? 90, stops!)
          const meta = await editElement(documentId, artboardId, elementId, html => {
            if (type === 'solid') return patchStyle(html, elementId, { 'background-color': color!, background: null })
            return patchStyle(html, elementId, { background: value })
          })
          recordAgentProposal(elementId, property, value)
          return meta
        })
      },
    ),

    tool(
      'studio_set_stroke',
      "Set an element's stroke width and colour. Text elements get -webkit-text-stroke; boxes get a CSS border — this tool picks whichever applies to the element's tag, matching the panel's Stroke section. A width of 0 clears the stroke.",
      {
        documentId: z.string(),
        artboardId: z.string(),
        elementId: z.string(),
        width: z.number().min(0).describe('Stroke width in px. 0 clears it.'),
        color: z.string().describe('Any CSS colour.'),
      },
      async ({ documentId, artboardId, elementId, width, color }) => {
        if (!await requestApproval({ tool: 'studio_set_stroke', title: `Set stroke on ${elementId}`, detail: `${width}px ${color}` })) {
          return fail('The user declined that stroke change.')
        }
        return guard(async () => {
          let property: string | null = null
          let value: string | null = null
          const meta = await editElement(documentId, artboardId, elementId, html => {
            const el = readElement(html, elementId)
            if (!el) return null
            if (isTextTag(el.tag)) {
              property = '-webkit-text-stroke'
              value = width > 0 ? `${width}px ${color}` : null
            } else {
              property = 'border'
              value = width > 0 ? `${width}px solid ${color}` : null
            }
            return patchStyle(html, elementId, { [property]: value })
          })
          if (property && value !== null) recordAgentProposal(elementId, property, value)
          return meta
        })
      },
    ),

    tool(
      'studio_layer_op',
      'Run one layer/z-order operation: reorder, group, ungroup, setHidden, setLocked, rename, delete, or duplicate — the same command union the layers panel sends. One tool for all eight operations rather than eight separate tools.',
      {
        documentId: z.string(),
        artboardId: z.string(),
        command: z.record(z.string(), z.unknown()).describe(
          'A LayerCommand object: {cmd:"reorder",elementId,beforeId} (beforeId:null moves to front) | '
          + '{cmd:"group",elementIds} | {cmd:"ungroup",elementId} | {cmd:"setHidden",elementId,hidden} | '
          + '{cmd:"setLocked",elementId,locked} | {cmd:"rename",elementId,name} | {cmd:"delete",elementId} | '
          + '{cmd:"duplicate",elementId}',
        ),
      },
      async ({ documentId, artboardId, command }) => {
        if (!isLayerCommand(command)) return fail(`Not a valid LayerCommand: ${JSON.stringify(command)}`)
        if (!await requestApproval({ tool: 'studio_layer_op', title: `Run layer op "${command.cmd}" in ${artboardId}` })) {
          return fail('The user declined that layer operation.')
        }
        return guard(async () => {
          const { documentHtml, board } = await loadArtboard(documentId, artboardId)
          const result = applyLayerCommand(board.html, command as LayerCommand)
          if (!result.changed) return result.note
          await writeDocumentHtml(documentId, replaceArtboardHtml(documentHtml, artboardId, result.html))
          return result.note
        })
      },
    ),
  ]
}
