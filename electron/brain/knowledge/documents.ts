/**
 * Document store — the one real implementation of `DocumentStorePort`.
 *
 * Owns its own SQL against the shared handle so that W1 and W4 can add
 * behaviour without editing a shared file.
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { blobToVector, cosineSimilarity, EMBEDDING_MODEL, embedPassage, embedQuery, vectorToBlob } from './embeddings'
import { splitSections } from './sectioning'
import { buildPathIndex, extractWikiLinkTargets, resolveWikiLink } from './wikilinks'
import type { DocumentNeighborhood, DocumentNeighborhoodNode, DocumentSearchHit, KnowledgeDocument, KnowledgeDocType, KnowledgeGraph, UnresolvedLink, VectorIndexReport, VectorSearchHit } from '../../../src/types/brainKnowledge'
import type {
  DocumentStorePort,
  ListDocumentsInput,
  SearchDocumentsInput,
  UpsertDocumentInput,
} from './ports'

type SqlRow = Record<string, unknown>

function mapDocument(row: SqlRow): KnowledgeDocument {
  return {
    id: String(row.id),
    path: String(row.path),
    scopeId: String(row.scope_id),
    type: String(row.type) as KnowledgeDocType,
    title: String(row.title),
    summary: String(row.summary),
    contentHash: String(row.content_hash),
    byteSize: Number(row.byte_size),
    origin: String(row.origin) as KnowledgeDocument['origin'],
    validFrom: String(row.valid_from),
    validTo: row.valid_to === null ? null : String(row.valid_to),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function boundedLimit(value: number | undefined, defaultValue: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return defaultValue
  return Math.min(maximum, Math.max(0, Math.trunc(value)))
}

function typeFilter(types: KnowledgeDocType[] | undefined, column: string) {
  if (!types?.length) return { sql: '', parameters: [] as string[] }
  return {
    sql: ` AND ${column} IN (${types.map(() => '?').join(', ')})`,
    parameters: types,
  }
}

function safeFtsQuery(query: string): string {
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? []
  return terms.map(term => `"${term}"`).join(' ')
}

/** Below this normalised similarity, a title match is coincidence rather
 *  than "probably what the user meant" — see the Part 4 measurement note
 *  in `search()` for why this threshold isn't a guess: 0.6 catches every
 *  single-edit typo/spelling variant found in that sample without also
 *  matching unrelated short titles. */
const FUZZY_TITLE_THRESHOLD = 0.6

/** Two hops is where a neighbourhood stops being readable and starts being a hairball. */
export const MAX_NEIGHBOR_DEPTH = 2

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previousRow = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const currentRow = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      currentRow.push(Math.min(
        currentRow[j - 1] + 1,
        previousRow[j] + 1,
        previousRow[j - 1] + substitutionCost,
      ))
    }
    previousRow = currentRow
  }
  return previousRow[b.length]
}

function titleSimilarity(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length)
  if (maxLength === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLength
}

/**
 * Nearest-scope-wins shadowing: when the same `path` appears in more than one
 * scope in the chain, keep only the rows from whichever scope is earliest in
 * `scopeIds` (nearest). A project's own version of a document must not be
 * shadowed by an ancestor's, so this runs before any limit/truncation.
 */
export function shadowByNearestScope(rows: SqlRow[], scopeIds: string[]): SqlRow[] {
  const rank = new Map(scopeIds.map((id, index) => [id, index]))
  const winningScopeForPath = new Map<string, string>()
  for (const row of rows) {
    const path = String(row.path)
    const scopeId = String(row.scope_id)
    const current = winningScopeForPath.get(path)
    if (current === undefined || (rank.get(scopeId) ?? Infinity) < (rank.get(current) ?? Infinity)) {
      winningScopeForPath.set(path, scopeId)
    }
  }
  return rows.filter(row => winningScopeForPath.get(String(row.path)) === String(row.scope_id))
}

export class DocumentStore implements DocumentStorePort {
  constructor(private readonly db: DatabaseSync) {}

  upsert(input: UpsertDocumentInput): KnowledgeDocument {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // `valid_to IS NULL` matters: once a path has both a superseded row and
      // an active one, an unfiltered lookup returns whichever the planner
      // picks, so the update could land on the dead row.
      const existing = this.db.prepare(
        'SELECT * FROM knowledge_documents WHERE scope_id = ? AND path = ? AND valid_to IS NULL',
      ).get(input.scopeId, input.path) as SqlRow | undefined
      if (existing && String(existing.content_hash) === input.contentHash) {
        // Unchanged content still needs sections if it has none — a document
        // written before the v5 backfill, or one whose backfill was skipped,
        // would otherwise stay invisible to section-level retrieval forever.
        this.writeSections(String(existing.id), input.body, { onlyIfMissing: true })
        this.db.exec('COMMIT')
        return mapDocument(existing)
      }

      const documentId = existing ? String(existing.id) : randomUUID()
      if (existing) {
        this.db.prepare(`
          UPDATE knowledge_documents
          SET title = ?, summary = ?, content_hash = ?, byte_size = ?, updated_at = ?
          WHERE id = ?
        `).run(input.title, input.summary, input.contentHash, Buffer.byteLength(input.body, 'utf8'), input.updatedAt, documentId)
      } else {
        this.db.prepare(`
          INSERT INTO knowledge_documents(
            id, path, scope_id, type, title, summary, content_hash, byte_size,
            origin, valid_from, valid_to, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(
          documentId, input.path, input.scopeId, input.type, input.title, input.summary,
          input.contentHash, Buffer.byteLength(input.body, 'utf8'), input.origin,
          input.updatedAt, new Date().toISOString(), input.updatedAt,
        )
      }

      this.db.prepare('DELETE FROM knowledge_fts WHERE document_id = ?').run(documentId)
      this.db.prepare('INSERT INTO knowledge_fts(document_id, title, summary, body) VALUES (?, ?, ?, ?)')
        .run(documentId, input.title, input.summary, input.body)

      this.writeSections(documentId, input.body)
      // The body changed, so the vector no longer describes it. Deleting rather
      // than re-embedding here keeps upsert synchronous; buildVectors refills it.
      this.db.prepare('DELETE FROM knowledge_vectors WHERE document_id = ?').run(documentId)

      this.db.prepare('DELETE FROM knowledge_links WHERE document_id = ?').run(documentId)
      this.writeLinks(documentId, input)
      this.resolveDanglingLinksTo(input.scopeId, input.path)

      const row = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as SqlRow
      this.db.exec('COMMIT')
      return mapDocument(row)
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Replaces this document's heading-bounded sections.
   *
   * Mirrors the delete-then-insert the FTS row already gets: there are no
   * triggers anywhere in this schema, so every derived table is maintained by
   * hand, in the caller's transaction.
   */
  private writeSections(documentId: string, body: string, options: { onlyIfMissing?: boolean } = {}): void {
    if (options.onlyIfMissing) {
      const existing = this.db.prepare('SELECT 1 FROM knowledge_sections WHERE document_id = ? LIMIT 1').get(documentId)
      if (existing) return
    } else {
      this.db.prepare('DELETE FROM knowledge_sections WHERE document_id = ?').run(documentId)
    }
    const insert = this.db.prepare(`
      INSERT INTO knowledge_sections(
        id, document_id, ordinal, level, heading, heading_path, start_line, end_line, text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const section of splitSections(body)) {
      insert.run(
        randomUUID(), documentId, section.ordinal, section.level,
        section.heading, section.headingPath, section.startLine, section.endLine, section.text,
      )
    }
  }

  /**
   * Writes this document's outgoing links, deriving them from the body when the
   * caller supplied none. Only the vault importer knows the real filesystem
   * layout, so it passes an already-resolved list; every other writer (the
   * candidate gate, the compactor, the memories migration) used to produce no
   * links at all, which left the retrieval ladder with nothing to follow.
   *
   * `links: []` still means "explicitly none" — only `undefined` derives.
   *
   * Whether a target *exists* is deliberately not stored. It used to be, as a
   * `resolved` column written once at insert time, which made every forward
   * reference permanently wrong: an import walks files in sorted order, so a
   * link to a document that sorts later was recorded as unresolved and stayed
   * that way after its target arrived. Resolution is a fact about the store
   * right now — a join, not a column.
   */
  private writeLinks(documentId: string, input: UpsertDocumentInput): void {
    const targets = input.links ?? this.deriveLinks(input.scopeId, input.body)
    const insertLink = this.db.prepare(
      'INSERT INTO knowledge_links(id, document_id, target_path) VALUES (?, ?, ?)',
    )
    for (const targetPath of new Set(targets)) {
      insertLink.run(randomUUID(), documentId, targetPath)
    }
  }

  /**
   * Points existing dangling links at a document that has just arrived.
   *
   * A link is resolved when it was written, against whatever existed then — so
   * a note naming `[[projects/zapzone]]` before that page is created stores the
   * raw target and stays a loose end forever, even after the page shows up. The
   * vault importer does not hit this, because it indexes every file before
   * writing any of them; every other writer — the candidate gate, the
   * compactor, the digest step — writes one document at a time and does.
   *
   * Only links that already have no document behind them are considered, so a
   * link that resolved correctly is never repointed, and the work is bounded by
   * the number of loose ends rather than the size of the store.
   */
  private resolveDanglingLinksTo(scopeId: string, path: string): void {
    const dangling = this.db.prepare(`
      SELECT l.id AS id, l.document_id AS document_id, l.target_path AS target_path
      FROM knowledge_links l
      JOIN knowledge_documents d ON d.id = l.document_id AND d.scope_id = ? AND d.valid_to IS NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_documents t
        WHERE t.path = l.target_path AND t.scope_id = ? AND t.valid_to IS NULL
      )
    `).all(scopeId, scopeId) as SqlRow[]
    if (dangling.length === 0) return

    const activePaths = (this.db.prepare(
      'SELECT path FROM knowledge_documents WHERE scope_id = ? AND valid_to IS NULL',
    ).all(scopeId) as SqlRow[]).map(row => String(row.path))
    const pathIndex = buildPathIndex(activePaths)
    // A link resolves relative to the document it sits in, so each loose end
    // needs its own source path.
    const pathById = new Map((this.db.prepare(
      'SELECT id, path FROM knowledge_documents WHERE scope_id = ? AND valid_to IS NULL',
    ).all(scopeId) as SqlRow[]).map(row => [String(row.id), String(row.path)]))
    const update = this.db.prepare('UPDATE knowledge_links SET target_path = ? WHERE id = ?')
    const remove = this.db.prepare('DELETE FROM knowledge_links WHERE id = ?')
    for (const row of dangling) {
      const from = pathById.get(String(row.document_id)) ?? ''
      if (resolveWikiLink(String(row.target_path), from, pathIndex) !== path) continue
      // UNIQUE(document_id, target_path): the document may already link to this
      // path under its resolved name, in which case the loose end is a duplicate.
      try {
        update.run(path, String(row.id))
      } catch {
        remove.run(String(row.id))
      }
    }
  }

  /**
   * Resolves `[[targets]]` against the paths already active in this scope, so a
   * link written as `yasir-bhai` finds `wiki/clients/yasir-bhai.md`. Unresolved
   * targets are still stored — `listUnresolvedLinks` surfaces them in Review as
   * candidate connections, which is the same treatment imported links get.
   */
  private deriveLinks(scopeId: string, body: string): string[] {
    const targets = extractWikiLinkTargets(body)
    if (targets.length === 0) return []
    const activePaths = (this.db.prepare(
      'SELECT path FROM knowledge_documents WHERE scope_id = ? AND valid_to IS NULL',
    ).all(scopeId) as SqlRow[]).map(row => String(row.path))
    const pathIndex = buildPathIndex(activePaths)
    return targets.map(target => resolveWikiLink(target, '', pathIndex))
  }

  supersede(input: UpsertDocumentInput): { previous: KnowledgeDocument | null; next: KnowledgeDocument } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existingRow = this.db.prepare(
        'SELECT * FROM knowledge_documents WHERE scope_id = ? AND path = ? AND valid_to IS NULL',
      ).get(input.scopeId, input.path) as SqlRow | undefined
      const supersededAt = new Date().toISOString()
      if (existingRow) {
        this.db.prepare('UPDATE knowledge_documents SET valid_to = ? WHERE id = ?').run(supersededAt, String(existingRow.id))
      }

      const documentId = randomUUID()
      this.db.prepare(`
        INSERT INTO knowledge_documents(
          id, path, scope_id, type, title, summary, content_hash, byte_size,
          origin, valid_from, valid_to, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        documentId, input.path, input.scopeId, input.type, input.title, input.summary,
        input.contentHash, Buffer.byteLength(input.body, 'utf8'), input.origin,
        supersededAt, supersededAt, input.updatedAt,
      )
      this.db.prepare('INSERT INTO knowledge_fts(document_id, title, summary, body) VALUES (?, ?, ?, ?)')
        .run(documentId, input.title, input.summary, input.body)
      this.writeSections(documentId, input.body)

      this.writeLinks(documentId, input)
      this.resolveDanglingLinksTo(input.scopeId, input.path)

      const nextRow = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as SqlRow
      this.db.exec('COMMIT')
      return { previous: existingRow ? mapDocument(existingRow) : null, next: mapDocument(nextRow) }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  retire(scopeId: string, path: string): KnowledgeDocument | null {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existingRow = this.db.prepare(
        'SELECT * FROM knowledge_documents WHERE scope_id = ? AND path = ? AND valid_to IS NULL',
      ).get(scopeId, path) as SqlRow | undefined
      if (!existingRow) {
        this.db.exec('COMMIT')
        return null
      }
      const retiredAt = new Date().toISOString()
      this.db.prepare('UPDATE knowledge_documents SET valid_to = ? WHERE id = ?').run(retiredAt, String(existingRow.id))
      this.db.exec('COMMIT')
      return mapDocument({ ...existingRow, valid_to: retiredAt })
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  list(input: ListDocumentsInput): KnowledgeDocument[] {
    if (input.scopeIds.length === 0) return []
    const types = typeFilter(input.types, 'type')
    const active = input.includeSuperseded ? '' : ' AND valid_to IS NULL'
    const scopePlaceholders = input.scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_documents
      WHERE scope_id IN (${scopePlaceholders})${active}${types.sql}
      ORDER BY type, updated_at DESC, path
    `).all(...input.scopeIds, ...types.parameters) as SqlRow[]
    return shadowByNearestScope(rows, input.scopeIds)
      .slice(0, boundedLimit(input.limit, 1000, 5000))
      .map(mapDocument)
  }

  read(scopeIds: string[], path: string): { document: KnowledgeDocument; body: string } | null {
    if (path.includes('..') || path.startsWith('/') || isAbsolute(path)) return null
    for (const scopeId of scopeIds) {
      const row = this.db.prepare(`
        SELECT d.*, f.body
        FROM knowledge_documents d
        JOIN knowledge_fts f ON f.document_id = d.id
        WHERE d.scope_id = ? AND d.path = ? AND d.valid_to IS NULL
      `).get(scopeId, path) as SqlRow | undefined
      if (row) return { document: mapDocument(row), body: String(row.body) }
    }
    return null
  }

  search(input: SearchDocumentsInput): DocumentSearchHit[] {
    if (input.scopeIds.length === 0) return []
    const limit = boundedLimit(input.limit, 10, 50)
    const query = safeFtsQuery(input.query)
    if (query) {
      const types = typeFilter(input.types, 'd.type')
      const scopePlaceholders = input.scopeIds.map(() => '?').join(', ')
      const rows = this.db.prepare(`
        SELECT d.path, d.title, d.type, d.updated_at, d.scope_id,
          substr(snippet(knowledge_fts, -1, '[', ']', '…', 32), 1, 200) AS snippet,
          -bm25(knowledge_fts) AS score
        FROM knowledge_fts
        JOIN knowledge_documents d ON d.id = knowledge_fts.document_id
        WHERE knowledge_fts MATCH ? AND d.scope_id IN (${scopePlaceholders}) AND d.valid_to IS NULL${types.sql}
        ORDER BY bm25(knowledge_fts), d.updated_at DESC, d.path
      `).all(query, ...input.scopeIds, ...types.parameters) as SqlRow[]
      const hits = shadowByNearestScope(rows, input.scopeIds).slice(0, limit).map(row => ({
        path: String(row.path),
        title: String(row.title),
        type: String(row.type) as KnowledgeDocType,
        snippet: String(row.snippet),
        score: Number(row.score),
        updatedAt: String(row.updated_at),
      }))
      if (hits.length > 0) return hits
    }
    // FTS5 found nothing (or the query had no indexable terms at all).
    // Measured, not assumed: a 34-query sample of realistic Roman Urdu/
    // Hinglish queries against the real vault came back empty for every
    // misspelled or alternate-spelled query and none of the correctly
    // spelled ones (29% overall zero-result rate; see docs/brain-v2's
    // Part 4 plan). unicode61 has no stemmer, so "zaroori"/"zaruri" or a
    // plain typo are different tokens with no path back to a match. This
    // fallback is deliberately narrow -- title/word similarity only, not
    // body text -- to avoid the cost a trigram index over full bodies would
    // add for a gap this fallback already closes for the common case (a
    // name or project title typed slightly wrong).
    return this.fuzzyTitleSearch(input, limit)
  }

  private fuzzyTitleSearch(input: SearchDocumentsInput, limit: number): DocumentSearchHit[] {
    const rawQuery = input.query.trim().toLowerCase()
    if (!rawQuery) return []
    const types = typeFilter(input.types, 'type')
    const scopePlaceholders = input.scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_documents
      WHERE scope_id IN (${scopePlaceholders}) AND valid_to IS NULL${types.sql}
    `).all(...input.scopeIds, ...types.parameters) as SqlRow[]
    return shadowByNearestScope(rows, input.scopeIds)
      .map(row => {
        const title = String(row.title).toLowerCase()
        const wordSimilarities = title.split(/\s+/).map(word => titleSimilarity(rawQuery, word))
        const score = Math.max(titleSimilarity(rawQuery, title), ...wordSimilarities)
        return { row, score }
      })
      .filter(({ score }) => score >= FUZZY_TITLE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, score }) => ({
        path: String(row.path),
        title: String(row.title),
        type: String(row.type) as KnowledgeDocType,
        snippet: String(row.summary) || '(matched by title similarity — the search term did not appear in the indexed text)',
        score,
        updatedAt: String(row.updated_at),
      }))
  }

  /**
   * Embeds every active document that has no current vector, and returns how
   * many were done.
   *
   * Incremental by content: `upsert` deletes a document's vector whenever its
   * body changes, so a rebuild after an import only touches what actually
   * changed. Rows for a different model are treated as missing, which is how a
   * model change re-indexes instead of silently mixing incompatible vectors.
   */
  async buildVectors(scopeIds: string[], onProgress?: (done: number, total: number) => void): Promise<VectorIndexReport> {
    if (scopeIds.length === 0) return { indexed: 0, skipped: 0, total: 0, available: false }
    const placeholders = scopeIds.map(() => '?').join(', ')
    const pending = this.db.prepare(`
      SELECT d.id AS id, d.title AS title, f.body AS body
      FROM knowledge_documents d
      JOIN knowledge_fts f ON f.document_id = d.id
      LEFT JOIN knowledge_vectors v ON v.document_id = d.id AND v.model = ?
      WHERE d.scope_id IN (${placeholders}) AND d.valid_to IS NULL AND v.document_id IS NULL
    `).all(EMBEDDING_MODEL, ...scopeIds) as SqlRow[]

    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO knowledge_vectors(document_id, model, dims, vector, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    let indexed = 0
    for (const [index, row] of pending.entries()) {
      const vector = await embedPassage(String(row.title), String(row.body ?? ''))
      // A null vector means the model never loaded. Stopping beats writing a
      // half-built index that later looks complete.
      if (!vector) return { indexed, skipped: pending.length - indexed, total: pending.length, available: false }
      insert.run(String(row.id), EMBEDDING_MODEL, vector.length, vectorToBlob(vector), new Date().toISOString())
      indexed += 1
      onProgress?.(index + 1, pending.length)
    }
    return { indexed, skipped: 0, total: pending.length, available: true }
  }

  /** How much of this scope chain is embedded — what the Health tab reports. */
  vectorCoverage(scopeIds: string[]): { documents: number; vectors: number } {
    if (scopeIds.length === 0) return { documents: 0, vectors: 0 }
    const placeholders = scopeIds.map(() => '?').join(', ')
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS documents,
        SUM(CASE WHEN v.document_id IS NULL THEN 0 ELSE 1 END) AS vectors
      FROM knowledge_documents d
      LEFT JOIN knowledge_vectors v ON v.document_id = d.id AND v.model = ?
      WHERE d.scope_id IN (${placeholders}) AND d.valid_to IS NULL
    `).get(EMBEDDING_MODEL, ...scopeIds) as SqlRow
    return { documents: Number(row.documents ?? 0), vectors: Number(row.vectors ?? 0) }
  }

  /**
   * Documents ranked by meaning, nearest first.
   *
   * Brute force over every vector in the chain. At a few hundred documents this
   * is microseconds, and it keeps the store free of a native vector extension
   * whose Windows builds are reported to load without registering their
   * functions.
   */
  async searchByVector(scopeIds: string[], question: string, limit: number): Promise<VectorSearchHit[]> {
    if (scopeIds.length === 0) return []
    const placeholders = scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT d.id AS id, d.path AS path, d.title AS title, d.scope_id AS scope_id, v.vector AS vector
      FROM knowledge_vectors v
      JOIN knowledge_documents d ON d.id = v.document_id
      WHERE v.model = ? AND d.scope_id IN (${placeholders}) AND d.valid_to IS NULL
    `).all(EMBEDDING_MODEL, ...scopeIds) as SqlRow[]
    // Rows first, deliberately: with no index there is nothing to compare
    // against, and loading a 118MB model to embed a question we cannot use
    // would make every lexical-only install pay for a feature it never enabled.
    if (rows.length === 0) return []

    const queryVector = await embedQuery(question)
    if (!queryVector) return []

    return shadowByNearestScope(rows, scopeIds)
      .map(row => ({
        id: String(row.id),
        path: String(row.path),
        title: String(row.title),
        score: cosineSimilarity(queryVector, blobToVector(row.vector as Uint8Array)),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }

  /**
   * The link neighbourhood around one document, out to `depth` hops, following
   * links in both directions.
   *
   * Local, never global: every source says a whole-vault graph turns into a
   * hairball past a couple of hundred notes, and nobody reports using one to
   * find anything. What does have evidence behind it is an agent walking links
   * to retrieve, which is what `brain_neighbors` uses this for.
   */
  neighbors(scopeIds: string[], path: string, depth: number): DocumentNeighborhood {
    if (scopeIds.length === 0) return { origin: path, nodes: [], edges: [] }
    const scopePlaceholders = scopeIds.map(() => '?').join(', ')
    const activeDocument = this.db.prepare(`
      SELECT id, path, title, type, scope_id FROM knowledge_documents
      WHERE path = ? AND scope_id IN (${scopePlaceholders}) AND valid_to IS NULL
    `)
    const originRow = activeDocument.get(path, ...scopeIds) as SqlRow | undefined
    const origin = originRow === undefined ? undefined : shadowByNearestScope([originRow], scopeIds)[0]
    if (!origin) return { origin: path, nodes: [], edges: [] }

    // Both directions in one statement: an outgoing link and a backlink are the
    // same edge seen from opposite ends, and a neighbourhood that showed only
    // one of them would hide half of what connects to the document.
    const step = this.db.prepare(`
      SELECT target.id AS id, target.path AS path, target.title AS title, target.type AS type,
             target.scope_id AS scope_id, ? AS from_path, target.path AS to_path
      FROM knowledge_links link
      JOIN knowledge_documents source ON source.id = link.document_id AND source.path = ? AND source.valid_to IS NULL
      JOIN knowledge_documents target ON target.path = link.target_path AND target.valid_to IS NULL
      WHERE source.scope_id IN (${scopePlaceholders}) AND target.scope_id IN (${scopePlaceholders})
      UNION
      SELECT source.id, source.path, source.title, source.type, source.scope_id, source.path, ?
      FROM knowledge_links link
      JOIN knowledge_documents source ON source.id = link.document_id AND source.valid_to IS NULL
      JOIN knowledge_documents target ON target.path = link.target_path AND target.path = ? AND target.valid_to IS NULL
      WHERE source.scope_id IN (${scopePlaceholders}) AND target.scope_id IN (${scopePlaceholders})
    `)

    const nodes = new Map<string, DocumentNeighborhoodNode>()
    const edges = new Map<string, { from: string; to: string }>()
    nodes.set(String(origin.path), {
      path: String(origin.path), title: String(origin.title), type: String(origin.type) as KnowledgeDocType, depth: 0,
    })

    let frontier = [String(origin.path)]
    for (let hop = 1; hop <= Math.max(1, Math.min(depth, MAX_NEIGHBOR_DEPTH)); hop += 1) {
      const next: string[] = []
      for (const from of frontier) {
        const rows = step.all(from, from, ...scopeIds, ...scopeIds, from, from, ...scopeIds, ...scopeIds) as SqlRow[]
        for (const row of shadowByNearestScope(rows, scopeIds)) {
          const to = String(row.path)
          const edgeKey = `${String(row.from_path)} ${String(row.to_path)}`
          if (!edges.has(edgeKey)) edges.set(edgeKey, { from: String(row.from_path), to: String(row.to_path) })
          if (nodes.has(to)) continue
          nodes.set(to, { path: to, title: String(row.title), type: String(row.type) as KnowledgeDocType, depth: hop })
          next.push(to)
        }
      }
      frontier = next
      if (frontier.length === 0) break
    }

    return { origin: String(origin.path), nodes: [...nodes.values()], edges: [...edges.values()] }
  }

  /**
   * The whole scope chain as one graph: every active document, and every link
   * whose target is also one.
   *
   * Two statements rather than a join per node, because the renderer wants
   * flat arrays and the whole store is a few hundred rows — the cost is in
   * shipping it to the renderer, not in reading it.
   *
   * Resolution is a join here too, never a stored flag: an edge exists when a
   * document sits at that path right now.
   */
  graph(scopeIds: string[]): KnowledgeGraph {
    if (scopeIds.length === 0) return { nodes: [], edges: [], unresolvedCount: 0 }
    const scopePlaceholders = scopeIds.map(() => '?').join(', ')

    const documentRows = this.db.prepare(`
      SELECT id, path, title, type, scope_id, updated_at
      FROM knowledge_documents
      WHERE scope_id IN (${scopePlaceholders}) AND valid_to IS NULL
    `).all(...scopeIds) as SqlRow[]
    const visible = shadowByNearestScope(documentRows, scopeIds)
    const paths = new Set(visible.map(row => String(row.path)))

    const linkRows = this.db.prepare(`
      SELECT source.path AS from_path, link.target_path AS to_path
      FROM knowledge_links link
      JOIN knowledge_documents source ON source.id = link.document_id AND source.valid_to IS NULL
      WHERE source.scope_id IN (${scopePlaceholders})
    `).all(...scopeIds) as SqlRow[]

    const degree = new Map<string, number>()
    const edges: Array<{ from: string; to: string }> = []
    const seen = new Set<string>()
    let unresolvedCount = 0
    for (const row of linkRows) {
      const from = String(row.from_path)
      const to = String(row.to_path)
      // A link out of a document shadowed by a nearer scope is not on screen,
      // so it is neither an edge nor a loose end.
      if (!paths.has(from)) continue
      if (!paths.has(to)) {
        unresolvedCount += 1
        continue
      }
      // A pair that links both ways is one line, not two.
      const key = from < to ? `${from} ${to}` : `${to} ${from}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from, to })
      degree.set(from, (degree.get(from) ?? 0) + 1)
      degree.set(to, (degree.get(to) ?? 0) + 1)
    }

    return {
      nodes: visible.map(row => ({
        path: String(row.path),
        title: String(row.title),
        type: String(row.type) as KnowledgeDocType,
        degree: degree.get(String(row.path)) ?? 0,
        updatedAt: String(row.updated_at),
      })),
      edges,
      unresolvedCount,
    }
  }

  listUnresolvedLinks(scopeIds: string[]): UnresolvedLink[] {
    if (scopeIds.length === 0) return []
    const scopePlaceholders = scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT d.path AS document_path, d.title AS document_title, l.target_path
      FROM knowledge_links l
      JOIN knowledge_documents d ON d.id = l.document_id
      WHERE d.scope_id IN (${scopePlaceholders}) AND d.valid_to IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM knowledge_documents t
          WHERE t.path = l.target_path AND t.scope_id IN (${scopePlaceholders}) AND t.valid_to IS NULL
        )
      ORDER BY d.updated_at DESC, d.path, l.target_path
    `).all(...scopeIds, ...scopeIds) as SqlRow[]
    return rows.map(row => ({
      documentPath: String(row.document_path),
      documentTitle: String(row.document_title),
      targetPath: String(row.target_path),
    }))
  }
}
