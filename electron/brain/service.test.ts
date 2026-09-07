import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from './service'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('BrainService', () => {
  it('builds a scope-safe cited decision brief and ignores superseded claim evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'client', externalRef: 'brief-a', name: 'Brief A' })
      const other = service.database.ensureScope({ type: 'client', externalRef: 'brief-b', name: 'Brief B' })
      const opportunity = service.database.upsertOpportunity({
        scopeId: scope.id, fingerprint: 'support-backlog', category: 'direct_lead', title: 'Support backlog',
        summary: 'A support team needs help.', score: 84, confidence: 0.82, freshness: '2026-09-05T00:00:00.000Z',
      })
      service.database.recordOpportunityEvidence({
        opportunityId: opportunity.id, scopeId: scope.id, evidenceId: 'brief-evidence', sourceId: null,
        excerpt: 'Our support backlog blocks releases.', confidence: 0.9, sourceRef: 'https://example.test/brief', platform: 'linkedin',
      })
      const brief = service.handle({ id: '1', method: 'buildDecisionBrief', payload: { scopeId: scope.id, question: 'Should we pursue support backlog work?', tokenBudget: 1200 } }) as { supportingSignals: Array<{ citation: { scopeId: string; sourceRef: string } }> }
      expect(brief.supportingSignals).toMatchObject([{ citation: { scopeId: scope.id, sourceRef: 'https://example.test/brief' } }])
      expect(service.handle({ id: '2', method: 'buildDecisionBrief', payload: { scopeId: other.id, question: 'Should we pursue support backlog work?', tokenBudget: 1200 } })).toMatchObject({ supportingSignals: [], counterSignals: [] })
    } finally { service.close() }
  })

  it('exposes scoped opportunity list, evidence and review without public creation', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const a = service.database.ensureScope({ type: 'client', externalRef: 'service-a', name: 'A' })
      const b = service.database.ensureScope({ type: 'client', externalRef: 'service-b', name: 'B' })
      const opportunity = service.database.upsertOpportunity({
        scopeId: a.id, fingerprint: 'service-lead', category: 'warm_opportunity', title: 'Workflow pain',
        summary: 'A repeated workflow problem.', score: 74, confidence: 0.7, freshness: '2026-09-05T00:00:00.000Z',
      })
      service.database.recordOpportunityEvidence({
        opportunityId: opportunity.id, scopeId: a.id, evidenceId: 'service-evidence', sourceId: null,
        excerpt: 'Our workflow is slow', confidence: 0.7, sourceRef: 'https://example.test/service', platform: 'linkedin',
      })

      expect(service.handle({ id: '1', method: 'listOpportunities', payload: { scopeId: b.id } })).toEqual([])
      expect(() => service.handle({ id: '2', method: 'getOpportunityEvidence', payload: { id: opportunity.id, scopeId: b.id } })).toThrow('Opportunity not found')
      expect(service.handle({ id: '3', method: 'getOpportunityEvidence', payload: { id: opportunity.id, scopeId: a.id } })).toHaveLength(1)
      expect(service.handle({ id: '4', method: 'reviewOpportunity', payload: { id: opportunity.id, scopeId: a.id, decision: 'dismiss' } })).toMatchObject({ status: 'dismissed' })
      expect(() => service.handle({ id: '5', method: 'upsertOpportunity', payload: {} })).toThrow()
    } finally { service.close() }
  })

  it('reserves social capture and lifecycle mutations for the utility runner', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
      const social = service.database.enqueueJob({
        recipeId: 'linkedin.opportunity_scan', recipeVersion: 1, scopeId: scope.id, parameters: {},
      })
      expect(() => service.handle({ id: '1', method: 'completeJob', payload: { id: social.id, result: { raw: 'private' } } })).toThrow('runner-owned')
      expect(() => service.handle({ id: '2', method: 'failJob', payload: { id: social.id, error: 'external failure' } })).toThrow('runner-owned')
      expect(() => service.handle({ id: '3', method: 'ingestCaptureBatch', payload: {
        source: 'linkedin', jobId: social.id, stepId: 'capture', scopeId: scope.id,
        connectorVersion: 'external', records: [{ text: 'private' }],
      } })).toThrow('runner-owned')
      expect(service.database.getJob(social.id)?.status).toBe('queued')

      const notebook = service.database.enqueueJob({
        recipeId: 'notebooklm.research', recipeVersion: 1, scopeId: scope.id, parameters: {},
      })
      expect(service.handle({ id: '4', method: 'completeJob', payload: { id: notebook.id, result: { recordCount: 1 } } })).toMatchObject({ status: 'completed' })
    } finally { service.close() }
  })

  it('enforces the selected scope through vault conflict dispatch', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const a = service.database.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
      const b = service.database.ensureScope({ type: 'client', externalRef: 'b', name: 'B' })
      const memory = service.database.remember({ scopeId: a.id, kind: 'fact', text: 'Private A' })
      const id = service.database.addVaultConflict({ memoryId: memory.id, filePath: 'A.md', baseRevision: 1, databaseText: 'Private A', fileText: 'Changed A' })
      expect(service.handle({ id: '1', method: 'listVaultConflicts', payload: { scopeId: b.id } })).toEqual([])
      expect(service.handle({ id: '2', method: 'resolveVaultConflict', payload: { id, scopeId: b.id, resolution: 'file' } })).toBeNull()
      expect(service.database.getMemory(memory.id)?.text).toBe('Private A')
      expect(service.handle({ id: '3', method: 'listVaultConflicts', payload: { scopeId: a.id } })).toHaveLength(1)
      expect(service.handle({ id: '4', method: 'resolveVaultConflict', payload: { id, scopeId: a.id, resolution: 'file' } })).toMatchObject({ text: 'Changed A' })
    } finally { service.close() }
  })

  it('validates and dispatches requests without exposing SQL', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    const scope = service.handle({ id: '1', method: 'ensureScope', payload: { type: 'workspace', externalRef: 'default', name: 'Default' } }) as { id: string }
    service.handle({ id: '2', method: 'remember', payload: { scopeId: scope.id, kind: 'fact', text: 'FlowDesk is local first' } })
    expect(service.handle({ id: '3', method: 'overview', payload: { scopeId: scope.id } })).toMatchObject({ memories: 1, candidates: 0, jobs: 0 })
    expect(() => service.handle({ id: '4', method: 'rawSql', payload: {} })).toThrow()
    service.close()
  })
})
