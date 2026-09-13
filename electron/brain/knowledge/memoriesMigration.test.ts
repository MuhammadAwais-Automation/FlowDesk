import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from '../database'
import { DocumentStore } from './documents'
import { migrateMemories } from './memoriesMigration'
import type { BrainMemory } from '../../../src/types/brain'

const brains: BrainDatabase[] = []
const roots: string[] = []

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-memories-migration-'))
  roots.push(root)
  const brain = new BrainDatabase(join(root, 'brain.sqlite'))
  brains.push(brain)
  const scope = brain.ensureScope({ type: 'client', externalRef: `client-${roots.length}`, name: 'Client' })
  return { brain, scope, documents: new DocumentStore(brain.handle) }
}

afterEach(() => {
  for (const brain of brains.splice(0)) brain.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function memory(scopeId: string, overrides: Partial<BrainMemory> = {}): BrainMemory {
  return {
    id: 'memory-1', scopeId, kind: 'fact', text: 'Yasir bhai prefers WhatsApp updates.',
    status: 'accepted', shareable: false, importance: 50, subject: null, predicate: null,
    sourceRef: 'user://agent-session/turn-1', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('migrateMemories', () => {
  it('writes an accepted memory into knowledge_documents, preserving sourceRef', () => {
    const { scope, documents } = createStore()

    const report = migrateMemories(documents, { memories: [memory(scope.id)] })

    expect(report).toEqual({ scanned: 1, migrated: 1, unchanged: 0, dryRun: false })
    const document = documents.read([scope.id], 'memories/fact/memory-1.md')
    expect(document?.body).toContain('Source: user://agent-session/turn-1')
    expect(document?.body).toContain('Yasir bhai prefers WhatsApp updates.')
    expect(document?.document.type).toBe('note')
  })

  it('preserves subject and predicate in the migrated body', () => {
    const { scope, documents } = createStore()

    migrateMemories(documents, { memories: [memory(scope.id, { subject: 'Yasir Bhai', predicate: 'prefers_channel' })] })

    const document = documents.read([scope.id], 'memories/fact/memory-1.md')
    expect(document?.body).toContain('Subject: Yasir Bhai')
    expect(document?.body).toContain('Predicate: prefers_channel')
  })

  it('maps decision and person kinds exactly, and folds everything else into note', () => {
    const { scope, documents } = createStore()

    migrateMemories(documents, {
      memories: [
        memory(scope.id, { id: 'm-decision', kind: 'decision' }),
        memory(scope.id, { id: 'm-person', kind: 'person' }),
        memory(scope.id, { id: 'm-goal', kind: 'goal' }),
        memory(scope.id, { id: 'm-org', kind: 'organization' }),
      ],
    })

    expect(documents.read([scope.id], 'memories/decision/m-decision.md')?.document.type).toBe('decision')
    expect(documents.read([scope.id], 'memories/person/m-person.md')?.document.type).toBe('person')
    expect(documents.read([scope.id], 'memories/goal/m-goal.md')?.document.type).toBe('note')
    expect(documents.read([scope.id], 'memories/organization/m-org.md')?.document.type).toBe('note')
  })

  it('skips candidate, rejected, superseded and deleted memories', () => {
    const { scope, documents } = createStore()

    const report = migrateMemories(documents, {
      memories: [
        memory(scope.id, { id: 'm-candidate', status: 'candidate' }),
        memory(scope.id, { id: 'm-rejected', status: 'rejected' }),
        memory(scope.id, { id: 'm-superseded', status: 'superseded' }),
        memory(scope.id, { id: 'm-deleted', status: 'deleted' }),
      ],
    })

    expect(report).toEqual({ scanned: 0, migrated: 0, unchanged: 0, dryRun: false })
    expect(documents.list({ scopeIds: [scope.id] })).toEqual([])
  })

  it('is idempotent: a second run over the same memories writes nothing new', () => {
    const { scope, documents } = createStore()
    const memories = [memory(scope.id)]

    migrateMemories(documents, { memories })
    const before = documents.read([scope.id], 'memories/fact/memory-1.md')
    const report = migrateMemories(documents, { memories })
    const after = documents.read([scope.id], 'memories/fact/memory-1.md')

    expect(report).toEqual({ scanned: 1, migrated: 0, unchanged: 1, dryRun: false })
    expect(after?.document.id).toBe(before?.document.id)
    expect(after?.document.updatedAt).toBe(before?.document.updatedAt)
  })

  it('dry run reports counts without writing anything', () => {
    const { scope, documents } = createStore()

    const report = migrateMemories(documents, { memories: [memory(scope.id)], dryRun: true })

    expect(report).toEqual({ scanned: 1, migrated: 1, unchanged: 0, dryRun: true })
    expect(documents.list({ scopeIds: [scope.id] })).toEqual([])
  })
})
