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
  'mcp__workers__studio_create_document',
  'mcp__workers__studio_create_artboard',
  'mcp__workers__studio_write_html',
  'mcp__workers__studio_update_styles',
  'mcp__workers__studio_add_image',
  'mcp__workers__studio_export',
]

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
      'studio_write_html',
      "Replace one artboard's inner HTML. Everything outside that artboard is untouched, so this is safe to call repeatedly while iterating on one slide.",
      {
        documentId: z.string(),
        artboardId: z.string(),
        html: z.string().describe('Inner HTML for the artboard. Do not include the artboard wrapper element itself.'),
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
  ]
}
