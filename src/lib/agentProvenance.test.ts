import { describe, expect, it } from 'vitest'
import { extractReadDocumentPaths } from './agentProvenance'

function readCall(path: string, overrides: Partial<{ tool: string; result: string; isError: boolean }> = {}) {
  return {
    tool: 'mcp__workers__brain_read_document',
    result: `Yasir Bhai (client)\nPath: ${path}\n\nBody text.`,
    isError: false,
    ...overrides,
  }
}

describe('extractReadDocumentPaths', () => {
  it('extracts the path from a successful brain_read_document call', () => {
    expect(extractReadDocumentPaths([readCall('wiki/clients/yasir-bhai.md')])).toEqual(['wiki/clients/yasir-bhai.md'])
  })

  it('dedupes when the same document is read more than once in a turn', () => {
    expect(extractReadDocumentPaths([readCall('wiki/clients/yasir-bhai.md'), readCall('wiki/clients/yasir-bhai.md')]))
      .toEqual(['wiki/clients/yasir-bhai.md'])
  })

  it('preserves read order across multiple different documents', () => {
    expect(extractReadDocumentPaths([readCall('wiki/clients/a.md'), readCall('wiki/projects/b.md')]))
      .toEqual(['wiki/clients/a.md', 'wiki/projects/b.md'])
  })

  it('ignores other tool calls, including brain_search_documents', () => {
    const calls = [
      { tool: 'mcp__workers__brain_search_documents', result: 'wiki/clients/a.md | client | A\n  snippet', isError: false },
      { tool: 'mcp__workers__whatsapp_scan', result: 'Path: not-a-real-document.md', isError: false },
    ]
    expect(extractReadDocumentPaths(calls)).toEqual([])
  })

  it('ignores a failed read', () => {
    expect(extractReadDocumentPaths([readCall('wiki/clients/a.md', { isError: true, result: 'Document path "wiki/clients/a.md" does not exist.' })]))
      .toEqual([])
  })

  it('ignores a result with no Path: line, e.g. the not-found/unavailable messages', () => {
    expect(extractReadDocumentPaths([readCall('irrelevant', { result: 'Brain is unavailable right now.' })])).toEqual([])
  })

  it('returns an empty list for no tool calls', () => {
    expect(extractReadDocumentPaths([])).toEqual([])
  })
})
