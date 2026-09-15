import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from '../database'
import { DocumentStore } from './documents'
import { EvidenceRetriever } from './evidence'
import type { UpsertDocumentInput } from './ports'

const brains: BrainDatabase[] = []
const roots: string[] = []

function createRetriever() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-evidence-'))
  roots.push(root)
  const brain = new BrainDatabase(join(root, 'brain.sqlite'))
  brains.push(brain)
  const global = brain.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
  const project = brain.ensureScope({ type: 'project', externalRef: 'p1', name: 'Project', parentId: global.id })
  const store = new DocumentStore(brain.handle)
  return {
    brain,
    global,
    project,
    store,
    retriever: new EvidenceRetriever(brain.handle, store),
    // Nearest-first, the same order service.ts resolves.
    chain: [project.id, global.id],
  }
}

function put(store: DocumentStore, scopeId: string, overrides: Partial<UpsertDocumentInput> & { path: string; body: string }) {
  return store.upsert({
    scopeId,
    type: 'note',
    title: 'Untitled',
    summary: '',
    origin: 'curated',
    contentHash: `hash-${overrides.path}-${overrides.body.length}`,
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  })
}

afterEach(() => {
  for (const brain of brains.splice(0)) brain.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('EvidenceRetriever', () => {
  it('returns the section that answers, not the whole document', async () => {
    const { store, retriever, global, chain } = createRetriever()
    put(store, global.id, {
      path: 'wiki/clients/yasir-bhai.md',
      type: 'person',
      title: 'Yasir Bhai',
      body: [
        '# Yasir Bhai',
        'Long unrelated background about how we met at a conference in Lahore.',
        '',
        '## Rates',
        'Monthly retainer is PKR 40,000 for the cobalt dashboard.',
        '',
        '## History',
        'More unrelated prose that should not be returned for a rates question.',
      ].join('\n'),
    })

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'Yasir ka retainer kitna hai?' })

    expect(pack.evidence).toContain('PKR 40,000')
    expect(pack.evidence).not.toContain('conference in Lahore')
    expect(pack.sections[0].headingPath).toBe('Yasir Bhai > Rates')
  })

  it('matches any question term, not all of them', async () => {
    const { store, retriever, global, chain } = createRetriever()
    put(store, global.id, {
      path: 'wiki/projects/powernet.md',
      type: 'project',
      title: 'PowerNet Manager',
      body: '# PowerNet Manager\nISP dashboard serving 4,491 customers.',
    })

    // "supabase" appears nowhere; an AND query would return nothing at all.
    const pack = await retriever.answerPack({ scopeIds: chain, question: 'powernet supabase customers' })

    expect(pack.sections).toHaveLength(1)
    expect(pack.evidence).toContain('4,491 customers')
  })

  it('takes one document when the top hit clearly wins', async () => {
    const { store, retriever, global, chain } = createRetriever()
    put(store, global.id, {
      path: 'wiki/projects/flowdesk.md',
      type: 'project',
      title: 'FlowDesk',
      body: '# FlowDesk\nLocal-first Electron AI workstation.',
    })
    put(store, global.id, {
      path: 'wiki/notes/misc.md',
      body: '# Misc\nA passing mention of flowdesk buried in unrelated notes.',
    })

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'flowdesk kya hai' })

    expect(pack.strategy).toBe('strong-signal')
    expect(pack.sections.every(section => section.path === 'wiki/projects/flowdesk.md')).toBe(true)
  })

  it('ranks across several documents when no single one stands out', async () => {
    const { store, retriever, global, chain } = createRetriever()
    for (const name of ['alpha', 'beta', 'gamma']) {
      put(store, global.id, {
        path: `wiki/projects/${name}.md`,
        type: 'project',
        title: name,
        body: `# ${name}\nThis project uses supabase for storage.`,
      })
    }

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'supabase' })

    expect(pack.strategy).toBe('ranked')
    expect(new Set(pack.sections.map(section => section.path)).size).toBeGreaterThan(1)
  })

  it('follows one pointer when the winning section only redirects', async () => {
    const { store, retriever, global, chain } = createRetriever()
    put(store, global.id, {
      path: 'wiki/clients/yasir-bhai.md',
      type: 'person',
      title: 'Yasir Bhai',
      body: '# Yasir Bhai\nRetainer is PKR 40,000 monthly.',
    })
    // An index page wins the question but holds no answer -- the shape a
    // map-of-contents note actually has.
    put(store, global.id, {
      path: 'wiki/index/clients.md',
      title: 'Clients',
      body: '# Clients\nSee [[yasir-bhai]].',
    })

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'clients' })

    expect(pack.pointerFollowed).toEqual({ from: 'wiki/index/clients.md', to: 'wiki/clients/yasir-bhai.md' })
    expect(pack.evidence).toContain('PKR 40,000')
  })

  it('does not follow a pointer when the winning section already answers', async () => {
    const { store, retriever, global, chain } = createRetriever()
    put(store, global.id, {
      path: 'wiki/clients/yasir-bhai.md',
      type: 'person',
      title: 'Yasir Bhai',
      body: '# Yasir Bhai\nRetainer is PKR 40,000 monthly for the cobalt dashboard work.',
    })
    put(store, global.id, { path: 'wiki/index/clients.md', title: 'Clients', body: '# Clients\nSee [[yasir-bhai]].' })

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'yasir retainer' })

    expect(pack.pointerFollowed).toBeNull()
    expect(pack.evidence).toContain('PKR 40,000')
  })

  it('reads through the scope chain, with the nearest scope winning a shared path', async () => {
    const { store, retriever, global, project, chain } = createRetriever()
    put(store, global.id, { path: 'wiki/rates.md', title: 'Rates', body: '# Rates\nDefault rate is 20 dollars.' })
    put(store, project.id, { path: 'wiki/rates.md', title: 'Rates', body: '# Rates\nProject rate is 45 dollars.' })

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'rates' })

    expect(pack.evidence).toContain('45 dollars')
    expect(pack.evidence).not.toContain('20 dollars')
  })

  it('stays inside its token budget', async () => {
    const { store, retriever, global, chain } = createRetriever()
    const filler = 'supabase storage detail. '.repeat(200)
    for (const name of ['one', 'two', 'three', 'four']) {
      put(store, global.id, { path: `wiki/${name}.md`, title: name, body: `# ${name}\n${filler}` })
    }

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'supabase', tokenBudget: 200 })

    // One oversized section is always kept -- returning nothing would be worse
    // than returning one thing over budget.
    expect(pack.sections.length).toBe(1)
  })

  it('says so plainly when nothing matches, rather than returning an empty string', async () => {
    const { store, retriever, global, chain } = createRetriever()
    put(store, global.id, { path: 'wiki/a.md', title: 'A', body: '# A\nSomething entirely unrelated.' })

    const pack = await retriever.answerPack({ scopeIds: chain, question: 'quantum cryptography patents' })

    expect(pack.strategy).toBe('none')
    expect(pack.sections).toEqual([])
    expect(pack.evidence).toMatch(/no local knowledge/i)
  })

  it('treats a question made only of filler words as no question', async () => {
    const { store, retriever, global, chain } = createRetriever()
    put(store, global.id, { path: 'wiki/a.md', title: 'A', body: '# A\nContent.' })

    // Every word here is a Roman Urdu stopword.
    expect((await retriever.answerPack({ scopeIds: chain, question: 'tum mere baray mein kya jaante ho' })).strategy).toBe('none')
  })
})
