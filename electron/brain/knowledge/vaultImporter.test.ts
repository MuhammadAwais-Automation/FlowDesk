import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  DocumentSearchHit,
  KnowledgeDocument,
} from '../../../src/types/brainKnowledge'
import type {
  DocumentStorePort,
  ListDocumentsInput,
  SearchDocumentsInput,
  UpsertDocumentInput,
} from './ports'
import { VaultImporter } from './vaultImporter'

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'vault')

class FakeDocumentStore implements DocumentStorePort {
  readonly documents = new Map<string, { document: KnowledgeDocument; body: string; links: string[] }>()
  readonly upsertCalls: UpsertDocumentInput[] = []

  upsert(input: UpsertDocumentInput): KnowledgeDocument {
    this.upsertCalls.push(structuredClone(input))
    const key = `${input.scopeId}\0${input.path}`
    const existing = this.documents.get(key)
    if (existing?.document.contentHash === input.contentHash) return existing.document

    const timestamp = '2026-01-01T00:00:00.000Z'
    const document: KnowledgeDocument = {
      id: existing?.document.id ?? `document-${this.documents.size + 1}`,
      path: input.path,
      scopeId: input.scopeId,
      type: input.type,
      title: input.title,
      summary: input.summary,
      contentHash: input.contentHash,
      byteSize: Buffer.byteLength(input.body),
      origin: input.origin,
      validFrom: existing?.document.validFrom ?? input.updatedAt,
      validTo: null,
      createdAt: existing?.document.createdAt ?? timestamp,
      updatedAt: input.updatedAt,
    }
    this.documents.set(key, { document, body: input.body, links: input.links ?? [] })
    return document
  }

  list(input: ListDocumentsInput): KnowledgeDocument[] {
    return [...this.documents.values()]
      .map(({ document }) => document)
      .filter((document) => document.scopeId === input.scopeId)
  }

  read(scopeId: string, path: string): { document: KnowledgeDocument; body: string } | null {
    const stored = this.documents.get(`${scopeId}\0${path}`)
    return stored ? { document: stored.document, body: stored.body } : null
  }

  search(_input: SearchDocumentsInput): DocumentSearchHit[] {
    return []
  }

  supersede(_input: UpsertDocumentInput): { previous: KnowledgeDocument | null; next: KnowledgeDocument } {
    throw new Error('Not used by vault importer tests')
  }

  retire(_scopeId: string, _path: string): KnowledgeDocument | null {
    throw new Error('Not used by vault importer tests')
  }

  get(path: string) {
    return this.documents.get(`scope-1\0${path}`)
  }
}

describe('VaultImporter', () => {
  let vaultRoot: string
  let store: FakeDocumentStore
  let importer: VaultImporter

  beforeEach(() => {
    vaultRoot = mkdtempSync(join(tmpdir(), 'flowdesk-vault-import-'))
    cpSync(fixtureRoot, vaultRoot, { recursive: true })
    store = new FakeDocumentStore()
    importer = new VaultImporter(store)
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  it('walks nested Markdown files while excluding non-curated directories', () => {
    writeFileSync(join(vaultRoot, 'misc', 'ignored.txt'), 'not markdown')

    const report = importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(report.scanned).toBe(10)
    expect(report.imported).toBe(10)
    expect(store.get('wiki/projects/directory-project.md')).toBeDefined()
    expect(store.get('raw/transcript.md')).toBeUndefined()
    expect(store.get('.obsidian/settings.md')).toBeUndefined()
  })

  it('uses known frontmatter types first, then directory inference, then note fallback', () => {
    importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(store.get('wiki/projects/atlas.md')?.document.type).toBe('client')
    expect(store.get('wiki/projects/directory-project.md')?.document.type).toBe('project')
    expect(store.get('wiki/clients/acme.md')?.document.type).toBe('client')
    expect(store.get('journal/day.md')?.document.type).toBe('note')
    expect(store.get('wiki/people/ada.md')?.document.type).toBe('person')
    expect(store.get('misc/plain_file-name.md')?.document.type).toBe('note')
    expect(store.get('misc/summary.md')?.document.type).toBe('note')
  })

  it('maps every specialised vault directory to its knowledge type', () => {
    const cases = [
      ['wiki/me', 'me'],
      ['wiki/research', 'research'],
      ['wiki/business', 'research'],
      ['wiki/learning', 'skill'],
      ['wiki/skills', 'skill'],
      ['wiki/toolkits', 'skill'],
      ['wiki/ai-tooling', 'skill'],
      ['wiki/partners', 'person'],
    ] as const
    for (const [directory] of cases) {
      mkdirSync(join(vaultRoot, directory), { recursive: true })
      writeFileSync(join(vaultRoot, directory, 'entry.md'), 'Body text.')
    }

    importer.import({ scopeId: 'scope-1', vaultRoot })

    for (const [directory, type] of cases) {
      expect(store.get(`${directory}/entry.md`)?.document.type).toBe(type)
    }
  })

  it('derives titles in heading, frontmatter, then humanised filename order', () => {
    importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(store.get('wiki/projects/atlas.md')?.document.title).toBe('Atlas Project')
    expect(store.get('wiki/clients/acme.md')?.document.title).toBe('Acme Incorporated')
    expect(store.get('misc/plain_file-name.md')?.document.title).toBe('plain file name')
  })

  it('builds summaries from body content without Markdown noise or broken words', () => {
    importer.import({ scopeId: 'scope-1', vaultRoot })

    const summary = store.get('misc/summary.md')?.document.summary ?? ''
    expect(summary).toBe('This bold line has brackets, code, and enough extra words to make the importer truncate it cleanly without')
    expect(summary.length).toBeLessThanOrEqual(110)
    expect(summary).not.toMatch(/[\[\]*_`]/)
    expect(store.get('misc/heading-only.md')?.document.summary).toBe('')
  })

  it.each([
    { label: 'LF', newline: '\n' },
    { label: 'CRLF', newline: '\r\n' },
  ])('strips frontmatter and preserves $label body newlines', ({ newline }) => {
    const source = [
      '---',
      'type: client',
      'title: Frontmatter Loses To Heading',
      '---',
      '# Atlas Project',
      '',
      'Coordinates the [[wiki/clients/acme|Acme account]].',
      '',
    ].join(newline)
    writeFileSync(join(vaultRoot, 'wiki', 'projects', 'atlas.md'), source)

    importer.import({ scopeId: 'scope-1', vaultRoot })

    const stored = store.get('wiki/projects/atlas.md')
    expect(stored?.body).toBe([
      '# Atlas Project',
      '',
      'Coordinates the [[wiki/clients/acme|Acme account]].',
      '',
    ].join(newline))
  })

  it('uses file mtime as updatedAt', () => {
    const expectedMtime = new Date('2024-05-06T07:08:09.000Z')
    utimesSync(join(vaultRoot, 'heading.md'), expectedMtime, expectedMtime)

    importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(store.get('heading.md')?.document.updatedAt).toBe(expectedMtime.toISOString())
  })

  it('extracts resolvable wiki-links, passes unresolved targets through, and ignores embeds and external links', () => {
    importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(store.get('links.md')?.links).toEqual([
      'heading.md',
      'wiki/clients/acme.md',
      'missing',
    ])
  })

  it('is idempotent and sends identical content hashes through upsert', () => {
    const first = importer.import({ scopeId: 'scope-1', vaultRoot })
    const firstHashes = new Map(store.upsertCalls.map((call) => [call.path, call.contentHash]))
    store.upsertCalls.length = 0

    const second = importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(first.imported).toBe(10)
    expect(second).toMatchObject({ imported: 0, updated: 0, unchanged: 10, skipped: 0 })
    expect(store.upsertCalls).toHaveLength(10)
    expect(new Map(store.upsertCalls.map((call) => [call.path, call.contentHash]))).toEqual(firstHashes)
  })

  it('updates exactly one document when one file changes', () => {
    importer.import({ scopeId: 'scope-1', vaultRoot })
    writeFileSync(join(vaultRoot, 'heading.md'), '# Heading Wins\n\nChanged content.\n')

    const report = importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(report).toMatchObject({ imported: 0, updated: 1, unchanged: 9, skipped: 0 })
    expect(store.get('heading.md')?.body).toContain('Changed content.')
  })

  it('skips oversized and invalid UTF-8 files without aborting', () => {
    writeFileSync(join(vaultRoot, 'too-large.md'), 'x'.repeat(32))
    writeFileSync(join(vaultRoot, 'invalid.md'), Buffer.from([0xc3, 0x28]))

    const report = importer.import({ scopeId: 'scope-1', vaultRoot, maxFileBytes: 16 })

    expect(report.scanned).toBe(12)
    expect(report.imported).toBeGreaterThan(0)
    expect(report.skipped).toBeGreaterThanOrEqual(2)
    expect(report.failures).toEqual(expect.arrayContaining([
      { path: 'too-large.md', reason: expect.stringContaining('16') },
      { path: 'invalid.md', reason: expect.stringMatching(/UTF-8/i) },
    ]))
  })

  it('marks every imported document as curated and reports exhaustive counts', () => {
    writeFileSync(join(vaultRoot, 'too-large.md'), 'x'.repeat(32))

    const report = importer.import({ scopeId: 'scope-1', vaultRoot, maxFileBytes: 24 })

    expect([...store.documents.values()].every(({ document }) => document.origin === 'curated')).toBe(true)
    expect(report.scanned).toBe(
      report.imported + report.updated + report.unchanged + report.skipped,
    )
  })

  it('hashes the exact raw file bytes', () => {
    writeFileSync(join(vaultRoot, 'heading.md'), Buffer.from([0x61, 0x62, 0x63]))

    importer.import({ scopeId: 'scope-1', vaultRoot })

    expect(store.get('heading.md')?.document.contentHash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('propagates document-store failures instead of misreporting unreadable files', () => {
    store.upsert = () => {
      throw new Error('store unavailable')
    }

    expect(() => importer.import({ scopeId: 'scope-1', vaultRoot })).toThrow('store unavailable')
  })
})
