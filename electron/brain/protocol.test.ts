import { describe, expect, it } from 'vitest'
import { brainRequestSchema } from './protocol'

describe('brain utility protocol', () => {
  it('accepts only narrow scoped opportunity list, evidence and review requests', () => {
    expect(brainRequestSchema.parse({ id: '1', method: 'listOpportunities', payload: { scopeId: 'client-a', status: 'qualified', limit: 25 } })).toMatchObject({ method: 'listOpportunities' })
    expect(brainRequestSchema.parse({ id: '2', method: 'getOpportunityEvidence', payload: { id: 'opportunity-a', scopeId: 'client-a' } })).toMatchObject({ method: 'getOpportunityEvidence' })
    expect(brainRequestSchema.parse({ id: '3', method: 'reviewOpportunity', payload: { id: 'opportunity-a', scopeId: 'client-a', decision: 'qualify' } })).toMatchObject({ method: 'reviewOpportunity' })
    expect(() => brainRequestSchema.parse({ id: '4', method: 'createOpportunity', payload: { scopeId: 'client-a' } })).toThrow()
    expect(() => brainRequestSchema.parse({ id: '5', method: 'listOpportunities', payload: { scopeId: 'client-a', limit: 501 } })).toThrow()
    expect(brainRequestSchema.parse({ id: '5b', method: 'countOpportunities', payload: { scopeId: 'client-a', status: 'qualified' } })).toMatchObject({ method: 'countOpportunities' })
    expect(() => brainRequestSchema.parse({ id: '6', method: 'reviewOpportunity', payload: { id: 'opportunity-a', scopeId: 'client-a', decision: 'delete' } })).toThrow()
    expect(brainRequestSchema.parse({ id: '7', method: 'buildDecisionBrief', payload: { scopeId: 'client-a', question: 'Should we pursue this?', tokenBudget: 1200 } })).toMatchObject({ method: 'buildDecisionBrief' })
    expect(brainRequestSchema.parse({ id: '8', method: 'listSourceMetrics', payload: { scopeId: 'client-a' } })).toMatchObject({ method: 'listSourceMetrics' })
    expect(() => brainRequestSchema.parse({ id: '9', method: 'buildDecisionBrief', payload: { scopeId: 'client-a', question: 'x', tokenBudget: 1201 } })).toThrow()
  })

  it.each(['listVaultConflicts', 'resolveVaultConflict'])('requires a selected scope for %s', method => {
    const payload = method === 'listVaultConflicts' ? {} : { id: 'conflict', resolution: 'file' }
    expect(brainRequestSchema.safeParse({ id: '1', method, payload: { ...payload, scopeId: 'client-a' } }).success).toBe(true)
    for (const invalid of [payload, { ...payload, scopeId: '' }, { ...payload, scopeId: 3 }, { ...payload, scopeId: 'a', arbitrary: true }]) {
      expect(brainRequestSchema.safeParse({ id: '1', method, payload: invalid }).success).toBe(false)
    }
  })

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
