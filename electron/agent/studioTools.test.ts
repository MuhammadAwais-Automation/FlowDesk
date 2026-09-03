import { describe, expect, it, vi } from 'vitest'
import { blankDocument, appendArtboard, parseArtboards } from '../studio/artboards'

const diskWriteSpy = vi.fn()

vi.mock('../studio/documentStore', () => ({
  listDocuments: vi.fn(async () => []),
  createDocument: vi.fn(async () => ({ id: 'd1', title: 'T', createdAt: '', updatedAt: '', artboards: [] })),
  readDocumentHtml: vi.fn(async () => '<html><head></head><body></body></html>'),
  writeDocumentHtml: vi.fn(async () => ({ id: 'd1', title: 'T', createdAt: '', updatedAt: '', artboards: [] })),
}))
vi.mock('../studio/render', () => ({ renderArtboardPng: vi.fn(async () => Buffer.from('png')) }))
vi.mock('../studio/export', () => ({
  exportArtboardPng: vi.fn(async () => { diskWriteSpy(); return '/tmp/x.png' }),
  exportDocumentPdf: vi.fn(async () => { diskWriteSpy(); return '/tmp/x.pdf' }),
}))
vi.mock('../studio/assetStore', () => ({
  addImageToDocument: vi.fn(async () => { diskWriteSpy(); return { url: 'studio-asset://d1/x.png', fileName: 'x.png', bytes: 3, mimeType: 'image/png' } }),
}))

const { createStudioTools, STUDIO_TOOL_NAMES } = await import('./studioTools')

const READ_TOOLS = [
  'studio_list_documents', 'studio_get_html', 'studio_screenshot', 'studio_list_presets', 'studio_get_guide',
  'studio_list_fonts', 'studio_get_computed_styles',
]
const WRITE_TOOLS = [
  'studio_create_document', 'studio_create_artboard', 'studio_create_variants', 'studio_write_html', 'studio_update_styles', 'studio_add_image', 'studio_export',
  'studio_set_text_style', 'studio_set_effect', 'studio_set_fill', 'studio_set_stroke', 'studio_layer_op',
]

interface AnyTool {
  name: string
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>
}

// Calling through the exact union type would require every tool's params at
// once (TS intersects parameter types across a union of functions); the
// tests genuinely call one tool at a time with just that tool's args, so a
// loosened local shape is correct here, not a workaround for a real bug.
function get(tools: ReturnType<typeof createStudioTools>, name: string): AnyTool {
  const found = tools.find(t => t.name === name)
  if (!found) throw new Error(`tool ${name} missing`)
  return found as unknown as AnyTool
}

describe('studio tools', () => {
  it('exposes exactly the nineteen tools the spec lists', () => {
    expect(STUDIO_TOOL_NAMES).toHaveLength(19)
    expect(createStudioTools(async () => true)).toHaveLength(19)
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) {
      expect(STUDIO_TOOL_NAMES).toContain(`mcp__workers__${name}`)
    }
  })

  // Regression test for the exact bug this project already hit once: a tool
  // returned by createStudioTools() but missing from STUDIO_TOOL_NAMES is
  // registered yet never enabled, and a name listed in STUDIO_TOOL_NAMES that
  // no tool actually implements is a silent dead entry. Both directions must
  // agree, one-to-one.
  it('agrees with the returned tool array in both directions', () => {
    const returnedNames = createStudioTools(async () => true).map(t => `mcp__workers__${t.name}`).sort()
    const declaredNames = [...STUDIO_TOOL_NAMES].sort()
    expect(returnedNames).toEqual(declaredNames)
  })

  it('never asks approval for a read tool', async () => {
    const approve = vi.fn(async () => true)
    const tools = createStudioTools(approve)
    await get(tools, 'studio_list_documents').handler({}, {} as never)
    await get(tools, 'studio_list_presets').handler({}, {} as never)
    await get(tools, 'studio_get_html').handler({ documentId: 'd1' }, {} as never)
    await get(tools, 'studio_get_guide').handler({}, {} as never)
    await get(tools, 'studio_list_fonts').handler({}, {} as never)
    // No artboard exists in the mocked document, so this errors — but even an
    // erroring read must never prompt for approval.
    await get(tools, 'studio_get_computed_styles').handler({ documentId: 'd1', artboardId: 'a1', elementId: 'e1' }, {} as never)
    expect(approve).not.toHaveBeenCalled()
  })

  it('caps studio_list_fonts results and reports how many matched', async () => {
    const result = await get(createStudioTools(async () => true), 'studio_list_fonts').handler({}, {} as never)
    expect(result.isError).toBeUndefined()
    const parsed = JSON.parse(result.content[0].text!)
    expect(parsed.totalMatched).toBeGreaterThanOrEqual(100)
    expect(parsed.fonts.length).toBeLessThan(parsed.totalMatched)
  })

  it('returns the composition rules from studio_get_guide, including the mistake they exist to prevent', async () => {
    const result = await get(createStudioTools(async () => true), 'studio_get_guide').handler({}, {} as never)
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toMatch(/three colours/i)
    expect(result.content[0].text).toMatch(/0\.14/)
  })

  it('screenshots without writing a file, so looking does not litter Downloads', async () => {
    diskWriteSpy.mockClear()
    const result = await get(createStudioTools(async () => true), 'studio_screenshot')
      .handler({ documentId: 'd1', artboardId: 'a1' }, {} as never)
    expect(diskWriteSpy).not.toHaveBeenCalled()
    expect(result.content.some((c: { type: string }) => c.type === 'image')).toBe(true)
  })

  it('asks approval before every write tool, and refuses when denied', async () => {
    for (const name of WRITE_TOOLS) {
      const approve = vi.fn(async () => false)
      const result = await get(createStudioTools(approve), name).handler(
        {
          documentId: 'd1', artboardId: 'a1', title: 'X', name: 'N', width: 10, height: 10, html: '<p/>', cssTokens: ':root{}',
          source: 'flowdesk-image://x.png', altText: 'X',
          elementId: 'e1', family: 'Anton', kind: 'shadow', type: 'solid', color: '#000000',
          command: { cmd: 'delete', elementId: 'e1' },
          count: 2, brief: 'Try a bolder direction.',
        },
        {} as never,
      )
      expect(approve, name).toHaveBeenCalled()
      expect(result.isError, name).toBe(true)
    }
  })

  it('adds an image once approved, returning the studio-asset:// url', async () => {
    diskWriteSpy.mockClear()
    const result = await get(createStudioTools(async () => true), 'studio_add_image')
      .handler({ documentId: 'd1', source: 'flowdesk-image://x.png', altText: 'Cover' }, {} as never)
    expect(diskWriteSpy).toHaveBeenCalled()
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('studio-asset://')
  })

  it('rejects an unknown preset before creating anything, so no orphan document is left', async () => {
    const approve = vi.fn(async () => true)
    const result = await get(createStudioTools(approve), 'studio_create_document')
      .handler({ title: 'X', preset: 'no such preset' }, {} as never)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Crisp Navy')
    // Refused before the approval prompt, so nothing was created either.
    expect(approve).not.toHaveBeenCalled()
  })

  it('rejects more than 6 variants before asking approval, explaining why rather than truncating', async () => {
    const approve = vi.fn(async () => true)
    const result = await get(createStudioTools(approve), 'studio_create_variants')
      .handler({ documentId: 'd1', artboardId: 'a1', count: 40, brief: 'Explore forty directions' }, {} as never)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('caps at 6')
    expect(approve).not.toHaveBeenCalled()
  })
})

describe('Task 10 per-element tools actually write through to the document', () => {
  // These tools are easy to get wrong in a way that silently no-ops (approval
  // granted, "success" returned, but the document on disk never changes) — so
  // this drives each one against a real artboard fixture (real artboards.ts +
  // nodeOps.ts, only documentStore's disk I/O mocked) and asserts the actual
  // HTML that would be persisted.
  async function withFixture(
    run: (getDoc: () => string) => Promise<void>,
    elementHtml = '<div data-fd-el="e1" style="color: red;">Hi</div>',
  ) {
    let doc = appendArtboard(blankDocument('T'), {
      id: 'ab1', name: 'A', width: 100, height: 100,
      html: elementHtml,
    })
    const documentStore = await import('../studio/documentStore')
    vi.mocked(documentStore.readDocumentHtml).mockImplementation(async () => doc)
    vi.mocked(documentStore.writeDocumentHtml).mockImplementation(async (id: string, html: string) => {
      doc = html
      return { id, title: 'T', createdAt: '', updatedAt: '', artboards: [] }
    })
    await run(() => doc)
  }

  function artboardHtml(doc: string): string {
    return parseArtboards(doc).find(b => b.id === 'ab1')!.html
  }

  it('studio_set_text_style writes only the fields given', async () => {
    await withFixture(async getDoc => {
      const tools = createStudioTools(async () => true)
      const result = await get(tools, 'studio_set_text_style').handler(
        { documentId: 'd1', artboardId: 'ab1', elementId: 'e1', family: 'Anton', weight: 700, align: 'center' },
        {} as never,
      )
      expect(result.isError).toBeUndefined()
      const html = artboardHtml(getDoc())
      expect(html).toContain("font-family: 'Anton', sans-serif")
      expect(html).toContain('font-weight: 700')
      expect(html).toContain('text-align: center')
      expect(html).toContain('color: red') // untouched
    })
  })

  it('studio_set_effect writes both the computed CSS and the round-trippable effect attribute', async () => {
    await withFixture(async getDoc => {
      const tools = createStudioTools(async () => true)
      const result = await get(tools, 'studio_set_effect').handler(
        { documentId: 'd1', artboardId: 'ab1', elementId: 'e1', kind: 'hollow', thickness: 3, color: '#00ff00' },
        {} as never,
      )
      expect(result.isError).toBeUndefined()
      const html = artboardHtml(getDoc())
      expect(html).toContain('-webkit-text-stroke: 3px #00ff00')
      expect(html).toMatch(/data-fd-effect="[^"]*hollow/)
    })
  })

  it('studio_set_fill writes a gradient background', async () => {
    await withFixture(async getDoc => {
      const tools = createStudioTools(async () => true)
      const result = await get(tools, 'studio_set_fill').handler(
        { documentId: 'd1', artboardId: 'ab1', elementId: 'e1', type: 'linear', angle: 45, stops: [{ color: '#000', pos: 0 }, { color: '#fff', pos: 100 }] },
        {} as never,
      )
      expect(result.isError).toBeUndefined()
      expect(artboardHtml(getDoc())).toContain('background: linear-gradient(45deg, #000 0%, #fff 100%)')
    })
  })

  it('studio_set_stroke picks text-stroke for a text element and border for a box', async () => {
    await withFixture(async getDoc => {
      const tools = createStudioTools(async () => true)
      const result = await get(tools, 'studio_set_stroke').handler(
        { documentId: 'd1', artboardId: 'ab1', elementId: 'e1', width: 2, color: '#111111' },
        {} as never,
      )
      expect(result.isError).toBeUndefined()
      expect(artboardHtml(getDoc())).toContain('-webkit-text-stroke: 2px #111111')
    }, '<span data-fd-el="e1">Hi</span>')

    await withFixture(async getDoc => {
      const tools = createStudioTools(async () => true)
      const result = await get(tools, 'studio_set_stroke').handler(
        { documentId: 'd1', artboardId: 'ab1', elementId: 'e1', width: 2, color: '#111111' },
        {} as never,
      )
      expect(result.isError).toBeUndefined()
      expect(artboardHtml(getDoc())).toContain('border: 2px solid #111111')
    }, '<div data-fd-el="e1">Hi</div>')
  })

  it('studio_layer_op deletes the element', async () => {
    await withFixture(async getDoc => {
      const tools = createStudioTools(async () => true)
      const result = await get(tools, 'studio_layer_op').handler(
        { documentId: 'd1', artboardId: 'ab1', command: { cmd: 'delete', elementId: 'e1' } },
        {} as never,
      )
      expect(result.isError).toBeUndefined()
      expect(artboardHtml(getDoc())).not.toContain('data-fd-el="e1"')
    })
  })

  it('studio_get_computed_styles reads back what studio_set_effect wrote', async () => {
    await withFixture(async () => {
      const tools = createStudioTools(async () => true)
      await get(tools, 'studio_set_effect').handler(
        { documentId: 'd1', artboardId: 'ab1', elementId: 'e1', kind: 'neon', color: '#0ff' },
        {} as never,
      )
      const result = await get(tools, 'studio_get_computed_styles').handler({ documentId: 'd1', artboardId: 'ab1', elementId: 'e1' }, {} as never)
      const parsed = JSON.parse(result.content[0].text!)
      expect(parsed.effect.kind).toBe('neon')
      expect(parsed.style['text-shadow']).toBeTruthy()
    })
  })

  it('studio_create_variants duplicates the source into fresh, distinctly-named artboards and hands back its html for the follow-up writes', async () => {
    await withFixture(async getDoc => {
      const tools = createStudioTools(async () => true)
      const result = await get(tools, 'studio_create_variants').handler(
        { documentId: 'd1', artboardId: 'ab1', count: 3, brief: 'Three bold directions' },
        {} as never,
      )
      expect(result.isError).toBeUndefined()
      const parsed = JSON.parse(result.content[0].text!)
      expect(parsed.createdArtboardIds).toHaveLength(3)
      expect(new Set(parsed.createdArtboardIds).size).toBe(3) // fresh, non-colliding ids
      expect(parsed.createdArtboardIds).not.toContain('ab1')
      expect(parsed.source).toMatchObject({ artboardId: 'ab1', name: 'A', width: 100, height: 100 })
      expect(parsed.source.html).toContain('data-fd-el="e1"')

      const boards = parseArtboards(getDoc())
      expect(boards).toHaveLength(4) // source + 3 variants
      const names = boards.map(b => b.name)
      expect(names).toEqual(['A', 'A — variant 2', 'A — variant 3', 'A — variant 4'])
      // Every duplicate starts as an exact copy of the source's html.
      for (const id of parsed.createdArtboardIds) {
        expect(boards.find(b => b.id === id)!.html).toBe('<div data-fd-el="e1" style="color: red;">Hi</div>')
      }
    })
  })
})
