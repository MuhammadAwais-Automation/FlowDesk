import { describe, expect, it } from 'vitest'
import { brainRequestSchema } from './protocol'

describe('brain utility protocol', () => {
  it('accepts a narrow search request', () => {
    expect(brainRequestSchema.parse({
      id: 'request-1',
      method: 'search',
      payload: { text: 'client need', scopeId: 'scope-1', includeParents: true, tokenBudget: 1200 },
    })).toMatchObject({ method: 'search' })
  })

  it('rejects arbitrary methods and malformed payloads', () => {
    expect(() => brainRequestSchema.parse({ id: '1', method: 'rawSql', payload: { sql: 'DROP TABLE memories' } })).toThrow()
    expect(() => brainRequestSchema.parse({ id: '1', method: 'remember', payload: { scopeId: '', kind: 'fact', text: '' } })).toThrow()
  })

  it('caps retrieval budgets at the public boundary', () => {
    expect(() => brainRequestSchema.parse({
      id: '1', method: 'search', payload: { text: 'x', scopeId: 'scope', includeParents: true, tokenBudget: 2001 },
    })).toThrow()
  })

  it('accepts at most five known scope types', () => {
    expect(brainRequestSchema.parse({
      id: '1', method: 'listScopes', payload: { types: ['global', 'workspace', 'project', 'client', 'session'] },
    })).toMatchObject({ method: 'listScopes' })
    expect(() => brainRequestSchema.parse({
      id: '2', method: 'listScopes', payload: { types: ['global', 'workspace', 'project', 'client', 'session', 'global'] },
    })).toThrow()
  })
})
