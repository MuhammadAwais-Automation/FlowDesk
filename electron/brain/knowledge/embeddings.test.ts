import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from '../database'
import { DocumentStore } from './documents'
import { EvidenceRetriever } from './evidence'
import { __setExtractorForTests, blobToVector, cosineSimilarity, vectorToBlob } from './embeddings'

const brains: BrainDatabase[] = []
const roots: string[] = []

/**
 * A stand-in for the real model: one dimension per keyword, set when the text
 * mentions it. Enough to prove the wiring — that vectors are stored, compared,
 * invalidated and ranked — without a 118MB download in the test suite.
 */
const KEYWORDS = ['rates', 'server', 'client', 'flutter']
function fakeExtractor(text: string) {
  const lowered = text.toLocaleLowerCase()
  const raw = KEYWORDS.map(word => (lowered.includes(word) ? 1 : 0))
  const length = Math.hypot(...raw) || 1
  return Promise.resolve({ data: raw.map(value => value / length) })
}

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-embeddings-'))
  roots.push(root)
  const brain = new BrainDatabase(join(root, 'brain.sqlite'))
  brains.push(brain)
  const scope = brain.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
  const store = new DocumentStore(brain.handle)
  return { brain, scope, store, retriever: new EvidenceRetriever(brain.handle, store) }
}

function put(store: DocumentStore, scopeId: string, path: string, title: string, body: string, hash = path) {
  return store.upsert({
    scopeId, path, type: 'note', title, summary: '', body,
    origin: 'curated', contentHash: hash, updatedAt: '2026-09-01T00:00:00.000Z',
  })
}

afterEach(() => {
  __setExtractorForTests(null)
  for (const brain of brains.splice(0)) brain.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('embedding storage', () => {
  it('round-trips a vector through the blob encoding', () => {
    const vector = Float32Array.from([0.5, -0.25, 0.125, 1])
    expect([...blobToVector(vectorToBlob(vector))]).toEqual([...vector])
  })

  it('scores identical vectors as 1 and orthogonal ones as 0', () => {
    const a = Float32Array.from([1, 0])
    const b = Float32Array.from([0, 1])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1)
    expect(cosineSimilarity(a, b)).toBeCloseTo(0)
  })

  it('returns 0 rather than throwing when dimensions disagree', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([1]))).toBe(0)
  })
})

describe('vector index', () => {
  it('embeds documents that have no vector yet, and skips those that do', async () => {
    __setExtractorForTests(fakeExtractor)
    const { scope, store } = createStore()
    put(store, scope.id, 'a.md', 'Rates', 'Our rates.')
    put(store, scope.id, 'b.md', 'Server', 'The server.')

    expect(await store.buildVectors([scope.id])).toMatchObject({ indexed: 2, total: 2, available: true })
    // Nothing changed, so the second run has nothing to do.
    expect(await store.buildVectors([scope.id])).toMatchObject({ indexed: 0, total: 0 })
  })

  it('drops a documentvector when its body changes, so the index cannot go stale', async () => {
    __setExtractorForTests(fakeExtractor)
    const { brain, scope, store } = createStore()
    put(store, scope.id, 'a.md', 'Rates', 'Our rates.')
    await store.buildVectors([scope.id])

    put(store, scope.id, 'a.md', 'Rates', 'Completely different text about flutter.', 'hash-2')

    expect(brain.handle.prepare('SELECT COUNT(*) AS n FROM knowledge_vectors').get()).toMatchObject({ n: 0 })
    expect(await store.buildVectors([scope.id])).toMatchObject({ indexed: 1 })
  })

  it('reports coverage so the UI can say how much is indexed', async () => {
    __setExtractorForTests(fakeExtractor)
    const { scope, store } = createStore()
    put(store, scope.id, 'a.md', 'Rates', 'Our rates.')
    put(store, scope.id, 'b.md', 'Server', 'The server.')

    expect(store.vectorCoverage([scope.id])).toEqual({ documents: 2, vectors: 0 })
    await store.buildVectors([scope.id])
    expect(store.vectorCoverage([scope.id])).toEqual({ documents: 2, vectors: 2 })
  })

  it('ranks documents by meaning', async () => {
    __setExtractorForTests(fakeExtractor)
    const { scope, store } = createStore()
    put(store, scope.id, 'a.md', 'Rates', 'Our rates.')
    put(store, scope.id, 'b.md', 'Server', 'The server.')
    await store.buildVectors([scope.id])

    const hits = await store.searchByVector([scope.id], 'what are the rates', 5)
    expect(hits[0].path).toBe('a.md')
  })

  it('never loads the model when nothing is indexed', async () => {
    // No extractor configured at all: if searchByVector tried to embed, this
    // would attempt a real 118MB download instead of returning nothing.
    const { scope, store } = createStore()
    put(store, scope.id, 'a.md', 'Rates', 'Our rates.')

    expect(await store.searchByVector([scope.id], 'rates', 5)).toEqual([])
  })
})

describe('the ladder with vectors', () => {
  it('finds a document whose words the question never uses', async () => {
    __setExtractorForTests(fakeExtractor)
    const { scope, store, retriever } = createStore()
    // The body says "server"; the question will not.
    put(store, scope.id, 'wiki/me/infra.md', 'Infrastructure', '# Infrastructure\nThe server runs on Oracle.')
    put(store, scope.id, 'wiki/other.md', 'Other', '# Other\nUnrelated flutter notes.')
    await store.buildVectors([scope.id])

    // 'server' is in the fake model's vocabulary, so the query vector matches
    // the infra document even though the words differ.
    const pack = await retriever.answerPack({ scopeIds: [scope.id], question: 'server par kya chal raha' })

    expect(pack.sections[0].path).toBe('wiki/me/infra.md')
  })

  it('falls back to lexical ranking when no vectors exist', async () => {
    const { scope, store, retriever } = createStore()
    put(store, scope.id, 'wiki/a.md', 'Flutter', '# Flutter\nDart and widgets.')

    const pack = await retriever.answerPack({ scopeIds: [scope.id], question: 'flutter widgets' })

    expect(pack.sections[0].path).toBe('wiki/a.md')
  })
})
