import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from '../database'
import { Compactor } from './compactor'
import { DocumentStore } from './documents'
import type { UpsertDocumentInput } from './ports'

const brains: BrainDatabase[] = []
const roots: string[] = []

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-compactor-'))
  roots.push(root)
  const brain = new BrainDatabase(join(root, 'brain.sqlite'))
  brains.push(brain)
  const scope = brain.ensureScope({ type: 'client', externalRef: `client-${roots.length}`, name: 'Client' })
  return { brain, scope, store: new DocumentStore(brain.handle), compactor: new Compactor(new DocumentStore(brain.handle)) }
}

function doc(scopeId: string, overrides: Partial<UpsertDocumentInput> = {}): UpsertDocumentInput {
  return {
    scopeId, path: 'wiki/notes/x.md', type: 'note', title: 'X', summary: '',
    body: 'Body text.', origin: 'curated', contentHash: 'hash', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  for (const brain of brains.splice(0)) brain.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Compactor', () => {
  it('merges a capture into the one document it clearly shares distinctive words with, then retires the capture', () => {
    const { store, scope, compactor } = createStore()
    const target = store.upsert(doc(scope.id, {
      path: 'wiki/clients/yasir-bhai.md', type: 'client', title: 'Yasir Bhai',
      body: 'Yasir bhai runs Together We Go trade finance business in Karachi. Client since 2026.',
      contentHash: 'target-1',
    }))
    store.upsert(doc(scope.id, {
      path: 'wiki/clients/other-client.md', type: 'client', title: 'Other Client',
      body: 'Some other client mentioned budget once in passing conversation about Karachi office rent.',
      contentHash: 'decoy-1',
    }))
    store.upsert(doc(scope.id, {
      path: 'captures/capture-1.md', type: 'note', title: 'Yasir Bhai update',
      body: 'Yasir bhai confirmed the Together trade finance budget, 3 lakh.',
      contentHash: 'capture-1', updatedAt: '2026-09-05T00:00:00.000Z',
    }))

    const report = compactor.compact(scope.id)

    expect(report).toMatchObject({ scanned: 1, merged: 1, leftStandalone: 0 })
    expect(report.decisions).toEqual([
      { capturePath: 'captures/capture-1.md', outcome: 'merged', targetPath: target.path, topScore: expect.any(Number), secondScore: null },
    ])

    // The capture is retired, not left active or deleted.
    expect(store.read(scope.id, 'captures/capture-1.md')).toBeNull()
    expect(store.list({ scopeId: scope.id, includeSuperseded: true }).some(d => d.path === 'captures/capture-1.md')).toBe(true)

    // The target's new active body has both the original and the captured text.
    const merged = store.read(scope.id, target.path)
    expect(merged?.body).toContain('Yasir bhai runs Together We Go trade finance business')
    expect(merged?.body).toContain('Yasir bhai confirmed the Together trade finance budget, 3 lakh.')

    // The target's pre-merge version still exists, superseded, not lost.
    const history = store.list({ scopeId: scope.id, includeSuperseded: true })
    expect(history.filter(d => d.path === target.path)).toHaveLength(2)
    expect(history.find(d => d.id === target.id)?.validTo).not.toBeNull()

    // The unrelated decoy document is untouched.
    expect(store.read(scope.id, 'wiki/clients/other-client.md')?.body).toContain('office rent')
  })

  it('leaves a capture standalone when no document shares more than one distinctive word', () => {
    const { store, scope, compactor } = createStore()
    store.upsert(doc(scope.id, { path: 'wiki/projects/alpha.md', type: 'project', title: 'Alpha', body: 'The alpha rollout covers invoicing only.', contentHash: 'alpha' }))
    store.upsert(doc(scope.id, { path: 'wiki/projects/beta.md', type: 'project', title: 'Beta', body: 'The beta rollout covers scheduling only.', contentHash: 'beta' }))
    store.upsert(doc(scope.id, {
      path: 'captures/capture-2.md', type: 'note', title: 'Random unrelated capture',
      body: 'Weather was nice today, nothing important happened.', contentHash: 'capture-2',
    }))

    const report = compactor.compact(scope.id)

    expect(report).toMatchObject({ scanned: 1, merged: 0, leftStandalone: 1 })
    expect(report.decisions[0]).toMatchObject({ capturePath: 'captures/capture-2.md', outcome: 'left-standalone', targetPath: null })
    expect(store.read(scope.id, 'captures/capture-2.md')).not.toBeNull()
  })

  it('never merges a capture into another capture, even when they share many words', () => {
    const { store, scope, compactor } = createStore()
    store.upsert(doc(scope.id, {
      path: 'captures/capture-a.md', type: 'note', title: 'Nimbus rollout notes',
      body: 'Nimbus rollout scheduling and invoicing discussion happened today.', contentHash: 'a',
    }))
    store.upsert(doc(scope.id, {
      path: 'captures/capture-b.md', type: 'note', title: 'Nimbus rollout notes again',
      body: 'Nimbus rollout scheduling and invoicing discussion continued today.', contentHash: 'b',
    }))

    const report = compactor.compact(scope.id)

    expect(report.merged).toBe(0)
    expect(report.decisions.every(decision => decision.outcome === 'left-standalone')).toBe(true)
    expect(store.read(scope.id, 'captures/capture-a.md')).not.toBeNull()
    expect(store.read(scope.id, 'captures/capture-b.md')).not.toBeNull()
  })

  it('reports zero scanned when a scope has no captures', () => {
    const { store, scope, compactor } = createStore()
    store.upsert(doc(scope.id, { path: 'wiki/notes/plain.md' }))

    expect(compactor.compact(scope.id)).toEqual({ scanned: 0, merged: 0, leftStandalone: 0, decisions: [] })
  })

  it('keeps compaction isolated to the requested scope', () => {
    const { brain, store, scope, compactor } = createStore()
    const other = brain.ensureScope({ type: 'client', externalRef: 'other-scope', name: 'Other' })
    store.upsert(doc(other.id, {
      path: 'wiki/clients/foo.md', type: 'client', title: 'Foo', body: 'Foo client details here.', contentHash: 'foo',
    }))
    store.upsert(doc(other.id, {
      path: 'captures/other-capture.md', type: 'note', title: 'Foo update', body: 'Foo client update text.', contentHash: 'foo-capture',
    }))

    expect(compactor.compact(scope.id)).toEqual({ scanned: 0, merged: 0, leftStandalone: 0, decisions: [] })
  })
})
