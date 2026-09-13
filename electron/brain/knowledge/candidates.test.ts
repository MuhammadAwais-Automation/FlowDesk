import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from '../database'
import { CandidateStore } from './candidates'
import { DocumentStore } from './documents'
import type { ProposeCandidateInput } from '../../../src/types/brainKnowledge'

const brains: BrainDatabase[] = []
const roots: string[] = []

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-candidates-'))
  roots.push(root)
  const brain = new BrainDatabase(join(root, 'brain.sqlite'))
  brains.push(brain)
  const scope = brain.ensureScope({ type: 'client', externalRef: `client-${roots.length}`, name: 'Client' })
  const documents = new DocumentStore(brain.handle)
  return { brain, scope, documents, store: new CandidateStore(brain.handle, documents) }
}

function candidateInput(scopeId: string, overrides: Partial<ProposeCandidateInput> = {}): ProposeCandidateInput {
  return {
    scopeId,
    type: 'note',
    title: 'Yasir prefers async updates',
    summary: 'Preference noted from a chat turn',
    body: 'Yasir prefers async updates over calls.',
    origin: 'machine-inferred',
    sessionRef: 'agent-session://s1/t1',
    ...overrides,
  }
}

afterEach(() => {
  for (const brain of brains.splice(0)) brain.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CandidateStore', () => {
  it('writes an explicit-user proposal straight through without creating a candidate row', () => {
    const { scope, documents, store } = createStore()

    const result = store.propose(candidateInput(scope.id, { origin: 'explicit-user' }))

    expect(result.kind).toBe('written')
    if (result.kind !== 'written') throw new Error('expected written result')
    expect(result.document).toMatchObject({ scopeId: scope.id, origin: 'curated', title: 'Yasir prefers async updates' })
    expect(result.document.path).toMatch(/^captures\/[0-9a-f-]+\.md$/)

    expect(store.list(scope.id)).toEqual([])
    expect(documents.read([scope.id], result.document.path)?.body).toBe('Yasir prefers async updates over calls.')
  })

  it('creates a pending candidate for a machine-inferred proposal and writes no document', () => {
    const { scope, documents, store } = createStore()

    const result = store.propose(candidateInput(scope.id))

    expect(result.kind).toBe('queued')
    if (result.kind !== 'queued') throw new Error('expected queued result')
    expect(result.candidate).toMatchObject({ scopeId: scope.id, status: 'pending', origin: 'machine-inferred' })
    expect(store.list(scope.id)).toHaveLength(1)
    expect(documents.list({ scopeIds: [scope.id] })).toEqual([])
  })

  it('accepting a pending candidate creates the document and marks it accepted', () => {
    const { scope, documents, store } = createStore()
    const queued = store.propose(candidateInput(scope.id))
    if (queued.kind !== 'queued') throw new Error('expected queued result')

    const decided = store.decide({ id: queued.candidate.id, decision: 'accept' })

    expect(decided.candidate.status).toBe('accepted')
    expect(decided.candidate.decidedAt).not.toBeNull()
    expect(decided.document).not.toBeNull()
    expect(decided.document?.origin).toBe('machine')
    expect(decided.document?.path).toBe(`captures/${queued.candidate.id}.md`)
    expect(documents.read([scope.id], decided.document!.path)?.body).toBe('Yasir prefers async updates over calls.')
    expect(store.list(scope.id)).toEqual([])
  })

  it('rejecting a pending candidate leaves no document and marks it rejected', () => {
    const { scope, documents, store } = createStore()
    const queued = store.propose(candidateInput(scope.id))
    if (queued.kind !== 'queued') throw new Error('expected queued result')

    const decided = store.decide({ id: queued.candidate.id, decision: 'reject' })

    expect(decided.candidate.status).toBe('rejected')
    expect(decided.candidate.decidedAt).not.toBeNull()
    expect(decided.document).toBeNull()
    expect(documents.list({ scopeIds: [scope.id] })).toEqual([])
    expect(store.list(scope.id)).toEqual([])
  })

  it('throws when deciding an already-decided candidate', () => {
    const { scope, store } = createStore()
    const queued = store.propose(candidateInput(scope.id))
    if (queued.kind !== 'queued') throw new Error('expected queued result')
    store.decide({ id: queued.candidate.id, decision: 'reject' })

    expect(() => store.decide({ id: queued.candidate.id, decision: 'accept' })).toThrow(/not found/)
  })

  it('accepting with a targetPath that already has an active document supersedes it', () => {
    const { brain, scope, documents, store } = createStore()
    const original = documents.upsert({
      scopeId: scope.id,
      path: 'clients/yasir.md',
      type: 'client',
      title: 'Yasir',
      summary: 'Client record',
      body: 'Original body.',
      origin: 'curated',
      contentHash: 'hash-1',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })

    const queued = store.propose(candidateInput(scope.id, { targetPath: 'clients/yasir.md' }))
    if (queued.kind !== 'queued') throw new Error('expected queued result')

    const decided = store.decide({ id: queued.candidate.id, decision: 'accept' })

    expect(decided.document?.path).toBe('clients/yasir.md')
    expect(decided.document?.id).not.toBe(original.id)
    const historical = brain.handle.prepare('SELECT valid_to FROM knowledge_documents WHERE id = ?')
      .get(original.id) as { valid_to: string | null }
    expect(historical.valid_to).not.toBeNull()
    expect(documents.read([scope.id], 'clients/yasir.md')?.document.id).toBe(decided.document?.id)
  })

  it('editedBody overrides the candidate body when accepting', () => {
    const { scope, documents, store } = createStore()
    const queued = store.propose(candidateInput(scope.id))
    if (queued.kind !== 'queued') throw new Error('expected queued result')

    const decided = store.decide({ id: queued.candidate.id, decision: 'accept', editedBody: 'Edited body wins.' })

    expect(documents.read([scope.id], decided.document!.path)?.body).toBe('Edited body wins.')
  })
})
