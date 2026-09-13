import { describe, expect, it, vi } from 'vitest'
import type { DocumentReadResult, DocumentSearchHit } from '../../src/types/brainKnowledge'
import { readBrainDocument, searchBrainDocuments } from './brainNavigation'

const document: DocumentReadResult = {
  path: 'wiki/projects/flowdesk.md',
  title: 'FlowDesk',
  type: 'project',
  text: 'FlowDesk keeps agent knowledge local and scope-safe.',
  updatedAt: '2026-09-13T00:00:00.000Z',
  estimatedTokens: 12,
  truncated: false,
}

const hit: DocumentSearchHit = {
  path: 'wiki/projects/flowdesk.md',
  title: 'FlowDesk',
  type: 'project',
  snippet: 'Local-first agent knowledge.',
  score: 4.2,
  updatedAt: '2026-09-13T00:00:00.000Z',
}

describe('Brain document navigation', () => {
  it('reads an existing document from the active scope', async () => {
    const request = vi.fn(async () => document)

    const output = await readBrainDocument(request, 'client-a', document.path)

    expect(output).toContain(document.text)
    expect(request).toHaveBeenCalledWith('knowledge.read', {
      scopeId: 'client-a',
      path: document.path,
      tokenBudget: 4000,
    })
  })

  it('suggests document search when a path does not exist', async () => {
    const output = await readBrainDocument(vi.fn(async () => null), 'client-a', 'wiki/missing.md')

    expect(output).toMatch(/does not exist/i)
    expect(output).toContain('brain_search_documents')
  })

  it('labels an oversized document as truncated', async () => {
    const oversized = { ...document, text: 'x'.repeat(16_100), estimatedTokens: 4025 }

    const output = await readBrainDocument(vi.fn(async () => oversized), 'client-a', oversized.path)

    expect(output).toMatch(/truncated/i)
    expect(output).toContain('4,000')
    expect(output).not.toContain('x'.repeat(16_001))
  })

  it('refuses traversal before making a request', async () => {
    const request = vi.fn(async () => document)

    const output = await readBrainDocument(request, 'client-a', '../secrets.md')

    expect(output).toMatch(/refused/i)
    expect(request).not.toHaveBeenCalled()
  })

  it('renders compact search hits without document bodies', async () => {
    const request = vi.fn(async () => [hit])

    const output = await searchBrainDocuments(request, 'client-a', 'local knowledge')

    expect(output).toContain(hit.path)
    expect(output).toContain(hit.title)
    expect(output).toContain(hit.snippet)
    expect(output).not.toContain(document.text)
    expect(request).toHaveBeenCalledWith('knowledge.search', {
      scopeId: 'client-a',
      query: 'local knowledge',
      limit: 10,
    })
  })

  it('states when document search has no matches', async () => {
    const output = await searchBrainDocuments(vi.fn(async () => []), 'client-a', 'absent topic')

    expect(output).toMatch(/no matches/i)
  })

  it('clamps a search limit above twenty', async () => {
    const request = vi.fn(async () => [hit])

    await searchBrainDocuments(request, 'client-a', 'FlowDesk', 99)

    expect(request).toHaveBeenCalledWith('knowledge.search', {
      scopeId: 'client-a',
      query: 'FlowDesk',
      limit: 20,
    })
  })

  it.each([
    ['read', () => readBrainDocument(vi.fn(async () => { throw new Error('offline') }), 'client-a', document.path)],
    ['search', () => searchBrainDocuments(vi.fn(async () => { throw new Error('offline') }), 'client-a', 'FlowDesk')],
  ])('reports Brain unavailable without throwing during %s', async (_operation, navigate) => {
    await expect(navigate()).resolves.toMatch(/brain is unavailable/i)
  })
})
