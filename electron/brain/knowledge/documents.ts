/**
 * Document store — the one real implementation of `DocumentStorePort`.
 *
 * Owns its own SQL against the shared handle so that W1 and W4 can add
 * behaviour without editing a shared file.
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { DocumentSearchHit, KnowledgeDocument, KnowledgeDocType, UnresolvedLink } from '../../../src/types/brainKnowledge'
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
function shadowByNearestScope(rows: SqlRow[], scopeIds: string[]): SqlRow[] {
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
      const existing = this.db.prepare('SELECT * FROM knowledge_documents WHERE scope_id = ? AND path = ?')
        .get(input.scopeId, input.path) as SqlRow | undefined
      if (existing && String(existing.content_hash) === input.contentHash) {
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

      this.db.prepare('DELETE FROM knowledge_links WHERE document_id = ?').run(documentId)
      const targetExists = this.db.prepare(`
        SELECT 1 FROM knowledge_documents
        WHERE scope_id = ? AND path = ? AND valid_to IS NULL
      `)
      const insertLink = this.db.prepare(`
        INSERT INTO knowledge_links(id, document_id, target_path, resolved)
        VALUES (?, ?, ?, ?)
      `)
      for (const targetPath of new Set(input.links ?? [])) {
        const resolved = targetExists.get(input.scopeId, targetPath) ? 1 : 0
        insertLink.run(randomUUID(), documentId, targetPath, resolved)
      }

      const row = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(documentId) as SqlRow
      this.db.exec('COMMIT')
      return mapDocument(row)
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
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

      const targetExists = this.db.prepare(`
        SELECT 1 FROM knowledge_documents WHERE scope_id = ? AND path = ? AND valid_to IS NULL
      `)
      const insertLink = this.db.prepare(`
        INSERT INTO knowledge_links(id, document_id, target_path, resolved)
        VALUES (?, ?, ?, ?)
      `)
      for (const targetPath of new Set(input.links ?? [])) {
        const resolved = targetExists.get(input.scopeId, targetPath) ? 1 : 0
        insertLink.run(randomUUID(), documentId, targetPath, resolved)
      }

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

  listUnresolvedLinks(scopeIds: string[]): UnresolvedLink[] {
    if (scopeIds.length === 0) return []
    const scopePlaceholders = scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT d.path AS document_path, d.title AS document_title, l.target_path
      FROM knowledge_links l
      JOIN knowledge_documents d ON d.id = l.document_id
      WHERE l.resolved = 0 AND d.scope_id IN (${scopePlaceholders}) AND d.valid_to IS NULL
      ORDER BY d.updated_at DESC, d.path, l.target_path
    `).all(...scopeIds) as SqlRow[]
    return rows.map(row => ({
      documentPath: String(row.document_path),
      documentTitle: String(row.document_title),
      targetPath: String(row.target_path),
    }))
  }
}
