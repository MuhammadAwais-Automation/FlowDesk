import { describe, expect, it, vi } from 'vitest'

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

const { createStudioTools, STUDIO_TOOL_NAMES } = await import('./studioTools')

const READ_TOOLS = ['studio_list_documents', 'studio_get_html', 'studio_screenshot', 'studio_list_presets']
const WRITE_TOOLS = ['studio_create_document', 'studio_create_artboard', 'studio_write_html', 'studio_update_styles', 'studio_export']

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
  it('exposes exactly the nine tools the spec lists', () => {
    expect(STUDIO_TOOL_NAMES).toHaveLength(9)
    expect(createStudioTools(async () => true)).toHaveLength(9)
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) {
      expect(STUDIO_TOOL_NAMES).toContain(`mcp__workers__${name}`)
    }
  })

  it('never asks approval for a read tool', async () => {
    const approve = vi.fn(async () => true)
    const tools = createStudioTools(approve)
    await get(tools, 'studio_list_documents').handler({}, {} as never)
    await get(tools, 'studio_list_presets').handler({}, {} as never)
    await get(tools, 'studio_get_html').handler({ documentId: 'd1' }, {} as never)
    expect(approve).not.toHaveBeenCalled()
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
        { documentId: 'd1', artboardId: 'a1', title: 'X', name: 'N', width: 10, height: 10, html: '<p/>', cssTokens: ':root{}' },
        {} as never,
      )
      expect(approve, name).toHaveBeenCalled()
      expect(result.isError, name).toBe(true)
    }
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
})
