import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from '../database'
import { DocumentStore } from './documents'
import type { UpsertDocumentInput } from './ports'

const brains: BrainDatabase[] = []
const roots: string[] = []

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-documents-'))
  roots.push(root)
  const brain = new BrainDatabase(join(root, 'brain.sqlite'))
  brains.push(brain)
  const scope = brain.ensureScope({ type: 'client', externalRef: `client-${roots.length}`, name: 'Client' })
  return { brain, scope, store: new DocumentStore(brain.handle) }
}

function documentInput(scopeId: string, overrides: Partial<UpsertDocumentInput> = {}): UpsertDocumentInput {
  return {
    scopeId,
    path: 'people/yasir.md',
    type: 'person',
    title: 'Yasir Bhai',
    summary: 'Client relationship owner',
    body: 'Yasir coordinates the cobalt launch.',
    origin: 'curated',
    contentHash: 'hash-1',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  for (const brain of brains.splice(0)) brain.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('DocumentStore', () => {
  it('inserts a document and reads its body and metadata from the store', () => {
    const { scope, store } = createStore()
    const input = documentInput(scope.id, { body: 'Yasir coordinates the café launch.' })

    const inserted = store.upsert(input)

    expect(inserted).toEqual({
      id: expect.any(String),
      path: input.path,
      scopeId: scope.id,
      type: 'person',
      title: input.title,
      summary: input.summary,
      contentHash: input.contentHash,
      byteSize: Buffer.byteLength(input.body, 'utf8'),
      origin: 'curated',
      validFrom: input.updatedAt,
      validTo: null,
      createdAt: expect.any(String),
      updatedAt: input.updatedAt,
    })
    expect(store.read([scope.id], input.path)).toEqual({ document: inserted, body: input.body })
  })

  it('returns the existing row without changing metadata or duplicating FTS when the hash is unchanged', () => {
    const { brain, scope, store } = createStore()
    const first = store.upsert(documentInput(scope.id))

    const unchanged = store.upsert(documentInput(scope.id, {
      title: 'A title that must be ignored',
      body: 'A body that must be ignored',
      updatedAt: '2026-09-02T10:00:00.000Z',
    }))

    expect(unchanged).toEqual(first)
    expect(store.read([scope.id], first.path)?.body).toBe('Yasir coordinates the cobalt launch.')
    expect((brain.handle.prepare('SELECT count(*) AS total FROM knowledge_fts WHERE document_id = ?').get(first.id) as { total: number }).total).toBe(1)
  })

  it('updates changed content and FTS while preserving document identity', () => {
    const { brain, scope, store } = createStore()
    const first = store.upsert(documentInput(scope.id))

    const updated = store.upsert(documentInput(scope.id, {
      title: 'Yasir Launch Owner',
      summary: 'Owns the amber launch',
      body: 'The revised body contains amber only.',
      contentHash: 'hash-2',
      updatedAt: '2026-09-03T10:00:00.000Z',
    }))

    expect(updated).toMatchObject({ id: first.id, title: 'Yasir Launch Owner', contentHash: 'hash-2', updatedAt: '2026-09-03T10:00:00.000Z' })
    expect(store.read([scope.id], first.path)?.body).toBe('The revised body contains amber only.')
    expect(store.search({ scopeIds: [scope.id], query: 'amber' })).toHaveLength(1)
    expect(store.search({ scopeIds: [scope.id], query: 'cobalt' })).toEqual([])
    expect((brain.handle.prepare('SELECT count(*) AS total FROM knowledge_fts WHERE document_id = ?').get(first.id) as { total: number }).total).toBe(1)
  })

  it('excludes superseded documents by default and includes them when requested', () => {
    const { brain, scope, store } = createStore()
    const document = store.upsert(documentInput(scope.id))
    brain.handle.prepare('UPDATE knowledge_documents SET valid_to = ? WHERE id = ?')
      .run('2026-09-04T10:00:00.000Z', document.id)

    expect(store.list({ scopeIds: [scope.id] })).toEqual([])
    expect(store.list({ scopeIds: [scope.id], includeSuperseded: true })).toMatchObject([{ id: document.id }])
  })

  it('orders by type and then updatedAt descending and supports type and limit filters', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'notes/older.md', type: 'note', title: 'Older', contentHash: 'older', updatedAt: '2026-09-01T00:00:00.000Z' }))
    store.upsert(documentInput(scope.id, { path: 'projects/project.md', type: 'project', title: 'Project', contentHash: 'project', updatedAt: '2026-09-03T00:00:00.000Z' }))
    store.upsert(documentInput(scope.id, { path: 'notes/newer.md', type: 'note', title: 'Newer', contentHash: 'newer', updatedAt: '2026-09-02T00:00:00.000Z' }))

    expect(store.list({ scopeIds: [scope.id] }).map(document => document.path)).toEqual([
      'notes/newer.md', 'notes/older.md', 'projects/project.md',
    ])
    expect(store.list({ scopeIds: [scope.id], types: ['project'] }).map(document => document.path)).toEqual(['projects/project.md'])
    expect(store.list({ scopeIds: [scope.id], limit: 1 })).toHaveLength(1)
  })

  it('keeps list, read and search isolated to the requested scope', () => {
    const { brain, scope, store } = createStore()
    const other = brain.ensureScope({ type: 'client', externalRef: 'other-client', name: 'Other Client' })
    store.upsert(documentInput(scope.id))

    expect(store.list({ scopeIds: [other.id] })).toEqual([])
    expect(store.read([other.id], 'people/yasir.md')).toBeNull()
    expect(store.search({ scopeIds: [other.id], query: 'cobalt' })).toEqual([])
  })

  it.each(['../etc/passwd', '/etc/passwd', 'missing.md'])('returns null for unsafe or unknown path %s', path => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id))
    expect(store.read([scope.id], path)).toBeNull()
  })

  it('finds words in either the body or title and filters search by type', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id))

    expect(store.search({ scopeIds: [scope.id], query: 'cobalt' })).toMatchObject([{ path: 'people/yasir.md' }])
    expect(store.search({ scopeIds: [scope.id], query: 'Yasir' })).toMatchObject([{ title: 'Yasir Bhai' }])
    expect(store.search({ scopeIds: [scope.id], query: 'Yasir', types: ['project'] })).toEqual([])
  })

  it('sanitises FTS operators and returns an empty result for a query without terms', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id))

    expect(() => store.search({ scopeIds: [scope.id], query: 'yasir "bhai* OR' })).not.toThrow()
    expect(store.search({ scopeIds: [scope.id], query: '  " * : - ^  ' })).toEqual([])
  })

  it('returns a bounded snippet containing the matched term', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, {
      body: `${'intro '.repeat(50)}ultraviolet ${'closing '.repeat(50)}`,
    }))

    const [hit] = store.search({ scopeIds: [scope.id], query: 'ultraviolet' })
    expect(hit.snippet.toLowerCase()).toContain('ultraviolet')
    expect(hit.snippet.length).toBeLessThanOrEqual(200)
  })

  it('returns positive scores in best-match-first order', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'notes/strong.md', type: 'note', title: 'Signal signal', body: 'signal signal signal signal signal', contentHash: 'strong' }))
    store.upsert(documentInput(scope.id, { path: 'notes/weak.md', type: 'note', title: 'Weak', body: `signal ${'background '.repeat(80)}`, contentHash: 'weak' }))

    const hits = store.search({ scopeIds: [scope.id], query: 'signal' })
    expect(hits.map(hit => hit.path)).toEqual(['notes/strong.md', 'notes/weak.md'])
    expect(hits.every(hit => hit.score > 0)).toBe(true)
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('replaces links and resolves only targets that exist in the same scope', () => {
    const { brain, scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'people/existing.md', title: 'Existing', contentHash: 'target' }))
    const source = store.upsert(documentInput(scope.id, {
      path: 'projects/source.md',
      type: 'project',
      contentHash: 'source-1',
      links: ['people/existing.md', 'people/missing.md'],
    }))

    const firstLinks = brain.handle.prepare('SELECT target_path, resolved FROM knowledge_links WHERE document_id = ? ORDER BY target_path').all(source.id)
    expect(firstLinks).toEqual([
      { target_path: 'people/existing.md', resolved: 1 },
      { target_path: 'people/missing.md', resolved: 0 },
    ])

    store.upsert(documentInput(scope.id, {
      path: 'projects/source.md',
      type: 'project',
      contentHash: 'source-2',
      links: ['people/existing.md'],
    }))
    expect(brain.handle.prepare('SELECT target_path, resolved FROM knowledge_links WHERE document_id = ?').all(source.id))
      .toEqual([{ target_path: 'people/existing.md', resolved: 1 }])
  })

  it('derives links from the body when the caller supplies none', () => {
    const { brain, scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai', contentHash: 'target' }))
    // A bare name, the way a note actually writes it -- not the full path.
    const source = store.upsert(documentInput(scope.id, {
      path: 'projects/source.md',
      type: 'project',
      contentHash: 'source-1',
      body: 'Owner is [[yasir-bhai]]. See also [[nothing-here]] and ![[embedded.png]].',
    }))

    expect(brain.handle.prepare('SELECT target_path, resolved FROM knowledge_links WHERE document_id = ? ORDER BY target_path').all(source.id))
      .toEqual([
        { target_path: 'nothing-here', resolved: 0 },
        { target_path: 'wiki/clients/yasir-bhai.md', resolved: 1 },
      ])
  })

  it('treats an explicit empty link list as "no links", not as "derive them"', () => {
    const { brain, scope, store } = createStore()
    const source = store.upsert(documentInput(scope.id, {
      path: 'projects/source.md',
      type: 'project',
      body: 'Mentions [[yasir-bhai]] but the caller says there are no links.',
      links: [],
    }))

    expect(brain.handle.prepare('SELECT target_path FROM knowledge_links WHERE document_id = ?').all(source.id)).toEqual([])
  })

  it('derives links on supersede too, so gated and compacted writes are connected', () => {
    const { brain, scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai', contentHash: 'target' }))
    const { next } = store.supersede(documentInput(scope.id, {
      path: 'captures/note.md',
      type: 'note',
      contentHash: 'capture-1',
      body: 'Discussed pricing with [[yasir-bhai]].',
    }))

    expect(brain.handle.prepare('SELECT target_path, resolved FROM knowledge_links WHERE document_id = ?').all(next.id))
      .toEqual([{ target_path: 'wiki/clients/yasir-bhai.md', resolved: 1 }])
  })

  it('supersede creates a brand-new active row when nothing exists at the path yet', () => {
    const { scope, store } = createStore()

    const { previous, next } = store.supersede(documentInput(scope.id))

    expect(previous).toBeNull()
    expect(next).toMatchObject({ path: 'people/yasir.md', validTo: null })
    expect(store.read([scope.id], 'people/yasir.md')?.document.id).toBe(next.id)
  })

  it('supersede retires the previous active row instead of overwriting it', () => {
    const { brain, scope, store } = createStore()
    const first = store.upsert(documentInput(scope.id))

    const { previous, next } = store.supersede(documentInput(scope.id, {
      title: 'Yasir Bhai — updated',
      body: 'New budget confirmed: 3 lakh.',
      contentHash: 'hash-2',
      updatedAt: '2026-09-05T10:00:00.000Z',
    }))

    expect(previous).toMatchObject({ id: first.id })
    expect(next.id).not.toBe(first.id)
    expect(next).toMatchObject({ path: first.path, title: 'Yasir Bhai — updated', validTo: null })

    // The old row survives, marked superseded, not deleted.
    const historical = brain.handle.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(first.id) as { valid_to: string | null }
    expect(historical.valid_to).not.toBeNull()

    // Only the new row is reachable through the normal read paths.
    expect(store.read([scope.id], first.path)?.document.id).toBe(next.id)
    expect(store.list({ scopeIds: [scope.id] })).toHaveLength(1)
    expect(store.list({ scopeIds: [scope.id], includeSuperseded: true })).toHaveLength(2)
  })

  it('supersede lets a superseded row and its replacement coexist at the same path', () => {
    const { brain, scope, store } = createStore()
    store.upsert(documentInput(scope.id))

    expect(() => store.supersede(documentInput(scope.id, { contentHash: 'hash-2', updatedAt: '2026-09-05T10:00:00.000Z' })))
      .not.toThrow()

    const rows = brain.handle.prepare('SELECT id, valid_to FROM knowledge_documents WHERE scope_id = ? AND path = ?')
      .all(scope.id, 'people/yasir.md') as Array<{ id: string; valid_to: string | null }>
    expect(rows).toHaveLength(2)
    expect(rows.filter(row => row.valid_to === null)).toHaveLength(1)
  })

  it('retire sets valid_to on the active row and returns it, changing nothing else', () => {
    const { scope, store } = createStore()
    const document = store.upsert(documentInput(scope.id))

    const retired = store.retire(scope.id, document.path)

    expect(retired).toMatchObject({ id: document.id, validTo: expect.any(String) })
    expect(store.read([scope.id], document.path)).toBeNull()
    expect(store.list({ scopeIds: [scope.id], includeSuperseded: true })).toMatchObject([{ id: document.id }])
  })

  it('retire returns null and changes nothing when no document is active at the path', () => {
    const { scope, store } = createStore()

    expect(store.retire(scope.id, 'people/missing.md')).toBeNull()

    const document = store.upsert(documentInput(scope.id))
    store.retire(scope.id, document.path)
    // Retiring an already-retired path is a no-op, not a second retirement.
    expect(store.retire(scope.id, document.path)).toBeNull()
  })

  it('list/read/search inherit across an ancestor chain, nearest scope winning on a shared path', () => {
    const { brain, scope, store } = createStore()
    const child = brain.ensureScope({ type: 'project', externalRef: 'child', name: 'Child', parentId: scope.id })
    store.upsert(documentInput(scope.id, { path: 'wiki/only-in-parent.md', title: 'Only in parent', contentHash: 'parent-only' }))
    store.upsert(documentInput(scope.id, {
      path: 'wiki/shared.md', title: 'Parent version', contentHash: 'parent-shared',
      body: 'Parent body.',
    }))
    store.upsert(documentInput(child.id, {
      path: 'wiki/shared.md', title: 'Child version', contentHash: 'child-shared',
      body: 'Child body with distinctive wording.',
    }))

    // Nearest-first chain: child before parent.
    const chain = [child.id, scope.id]

    const listed = store.list({ scopeIds: chain })
    expect(listed.map(d => d.path).sort()).toEqual(['wiki/only-in-parent.md', 'wiki/shared.md'])
    expect(listed.find(d => d.path === 'wiki/shared.md')).toMatchObject({ title: 'Child version', scopeId: child.id })

    expect(store.read(chain, 'wiki/shared.md')).toMatchObject({ document: { title: 'Child version' }, body: 'Child body with distinctive wording.' })
    expect(store.read(chain, 'wiki/only-in-parent.md')).toMatchObject({ document: { title: 'Only in parent' } })

    const hits = store.search({ scopeIds: chain, query: 'distinctive' })
    expect(hits).toMatchObject([{ path: 'wiki/shared.md', title: 'Child version' }])

    // Reversed order: parent wins instead, proving this is chain-order-driven, not a fixed rule.
    const reversedHits = store.list({ scopeIds: [scope.id, child.id] }).find(d => d.path === 'wiki/shared.md')
    expect(reversedHits).toMatchObject({ title: 'Parent version', scopeId: scope.id })
  })

  it('list/read/search return nothing for an empty scope chain', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id))

    expect(store.list({ scopeIds: [] })).toEqual([])
    expect(store.read([], 'people/yasir.md')).toBeNull()
    expect(store.search({ scopeIds: [], query: 'cobalt' })).toEqual([])
  })

  it('lists unresolved links across the scope chain, excluding resolved ones', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'people/existing.md', title: 'Existing', contentHash: 'target' }))
    store.upsert(documentInput(scope.id, {
      path: 'projects/source.md', type: 'project', contentHash: 'source-1',
      links: ['people/existing.md', 'people/ghost.md'],
    }))

    const unresolved = store.listUnresolvedLinks([scope.id])

    expect(unresolved).toEqual([{ documentPath: 'projects/source.md', documentTitle: 'Yasir Bhai', targetPath: 'people/ghost.md' }])
  })

  it('listUnresolvedLinks returns nothing for an empty scope chain', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, { links: ['people/ghost.md'] }))

    expect(store.listUnresolvedLinks([])).toEqual([])
  })

  it('falls back to a fuzzy title match when FTS5 finds nothing for a misspelled query', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai', contentHash: 'yasir' }))

    // "yaseer" shares no FTS5 token with "yasir" — the exact-token search
    // returns nothing, so this only passes if the fuzzy fallback ran.
    expect(store.search({ scopeIds: [scope.id], query: 'yaseer' })).toMatchObject([{ path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai' }])
  })

  it('does not fuzzy-match a query that is not actually similar to any title', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai', contentHash: 'yasir' }))

    expect(store.search({ scopeIds: [scope.id], query: 'zebra unicorn spaceship' })).toEqual([])
  })

  it('prefers an exact FTS5 match over the fuzzy fallback when one exists', () => {
    const { scope, store } = createStore()
    store.upsert(documentInput(scope.id, { path: 'wiki/clients/yasir-bhai.md', title: 'Yasir Bhai', body: 'Yasir coordinates the cobalt launch.', contentHash: 'yasir' }))

    const hits = store.search({ scopeIds: [scope.id], query: 'cobalt' })
    expect(hits).toHaveLength(1)
    expect(hits[0].snippet).toContain('cobalt')
  })

  it('rolls back all three tables when an upsert violates the scope foreign key', () => {
    const { brain, store } = createStore()

    expect(() => store.upsert(documentInput('missing-scope', { links: ['people/missing.md'] }))).toThrow(/FOREIGN KEY/)

    for (const table of ['knowledge_documents', 'knowledge_fts', 'knowledge_links']) {
      expect((brain.handle.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number }).total).toBe(0)
    }
  })
})
