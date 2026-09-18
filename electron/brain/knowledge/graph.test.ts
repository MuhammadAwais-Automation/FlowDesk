import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from '../service'
import type { KnowledgeDocType } from '../../../src/types/brainKnowledge'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-graph-'))
  const service = new BrainService(join(root, 'brain.sqlite'))
  cleanups.push(() => { service.close(); rmSync(root, { recursive: true, force: true }) })
  const scope = service.database.ensureScope({ type: 'client', externalRef: 'g', name: 'Graph' })
  return { service, store: service.documents, scope }
}

let bodyCounter = 0
function write(store: ReturnType<typeof createStore>['store'], scopeId: string, path: string, body: string, type: KnowledgeDocType = 'note') {
  bodyCounter += 1
  return store.upsert({
    scopeId, path, type, title: path.replace(/\.md$/, '').split('/').pop() ?? path,
    summary: '', body, origin: 'curated', contentHash: `hash-${bodyCounter}`,
    updatedAt: '2026-09-18T00:00:00.000Z',
  })
}

describe('DocumentStore.graph', () => {
  it('returns every document and the links between them', () => {
    const { store, scope } = createStore()
    write(store, scope.id, 'wiki/me/profile.md', 'I work with [[clients/yasir-bhai]].')
    write(store, scope.id, 'wiki/clients/yasir-bhai.md', 'Runs [[projects/zapzone]].', 'client')
    write(store, scope.id, 'wiki/projects/zapzone.md', 'A marketplace.', 'project')

    const graph = store.graph([scope.id])

    expect(graph.nodes.map(node => node.path).sort()).toEqual([
      'wiki/clients/yasir-bhai.md', 'wiki/me/profile.md', 'wiki/projects/zapzone.md',
    ])
    expect(graph.edges).toHaveLength(2)
    expect(graph.unresolvedCount).toBe(0)
  })

  // Node size is degree, so a hub has to count both directions.
  it('counts links in and out toward a node degree', () => {
    const { store, scope } = createStore()
    write(store, scope.id, 'hub.md', 'nothing')
    write(store, scope.id, 'a.md', 'see [[hub]]')
    write(store, scope.id, 'b.md', 'see [[hub]]')
    write(store, scope.id, 'c.md', 'see [[hub]]')

    const graph = store.graph([scope.id])

    expect(graph.nodes.find(node => node.path === 'hub.md')?.degree).toBe(3)
    expect(graph.nodes.find(node => node.path === 'a.md')?.degree).toBe(1)
  })

  // Two documents naming each other is one line on screen, not two.
  it('draws a mutual link once', () => {
    const { store, scope } = createStore()
    write(store, scope.id, 'a.md', 'see [[b]]')
    write(store, scope.id, 'b.md', 'see [[a]]')

    expect(store.graph([scope.id]).edges).toHaveLength(1)
  })

  it('counts a link with no document behind it instead of drawing it', () => {
    const { store, scope } = createStore()
    write(store, scope.id, 'a.md', 'see [[b]] and [[nowhere]]')
    write(store, scope.id, 'b.md', 'here')

    const graph = store.graph([scope.id])

    expect(graph.edges).toEqual([{ from: 'a.md', to: 'b.md' }])
    expect(graph.unresolvedCount).toBe(1)
    expect(graph.nodes.map(node => node.path).sort()).toEqual(['a.md', 'b.md'])
  })

  it('is empty for an empty scope chain rather than reading every scope', () => {
    const { store } = createStore()
    expect(store.graph([])).toEqual({ nodes: [], edges: [], unresolvedCount: 0 })
  })

  it('carries the type and update time each node is drawn with', () => {
    const { store, scope } = createStore()
    write(store, scope.id, 'wiki/clients/yasir-bhai.md', 'Client.', 'client')

    const [node] = store.graph([scope.id]).nodes

    expect(node).toMatchObject({ path: 'wiki/clients/yasir-bhai.md', title: 'yasir-bhai', type: 'client' })
    expect(node.updatedAt).toBe('2026-09-18T00:00:00.000Z')
  })

  // The nearer scope's version of a path wins, and the shadowed copy must not
  // arrive as a second node at the same path.
  it('shows one node per path when a scope chain shadows a document', () => {
    const { service, store } = createStore()
    const global = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
    const client = service.database.ensureScope({ type: 'client', externalRef: 'near', name: 'Near' })
    write(store, global.id, 'shared.md', 'global copy')
    write(store, client.id, 'shared.md', 'client copy')

    const graph = store.graph([client.id, global.id])

    expect(graph.nodes.map(node => node.path)).toEqual(['shared.md'])
  })
})
