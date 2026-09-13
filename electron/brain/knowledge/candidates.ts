/**
 * Candidate store — the write gate (Phase 2).
 *
 * `explicit-user` proposals are as trustworthy as anything hand-written, so
 * they supersede straight into `knowledge_documents` via `DocumentStorePort`
 * and never touch `knowledge_candidates` at all. `machine-inferred` proposals
 * sit in `knowledge_candidates` as `pending` until `decide()` accepts or
 * rejects them — accepting runs the exact same `supersede()` call the
 * explicit-user path uses, just later and only once a human agreed.
 *
 * Owns its own SQL against the shared handle, same pattern as `documents.ts`
 * and `manifest.ts` — no methods added to `database.ts`.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CandidateOrigin,
  DecideCandidateInput,
  KnowledgeCandidate,
  KnowledgeDocument,
  ProposeCandidateInput,
} from '../../../src/types/brainKnowledge'
import type { DocumentStorePort } from './ports'

type SqlRow = Record<string, unknown>

/** Result of `propose()` — tells the caller whether the write already
 * happened (explicit-user) or is waiting on review (machine-inferred). */
export type ProposeCandidateResult =
  | { kind: 'written'; document: KnowledgeDocument }
  | { kind: 'queued'; candidate: KnowledgeCandidate }

export interface DecideCandidateResult {
  candidate: KnowledgeCandidate
  document: KnowledgeDocument | null
}

function mapCandidate(row: SqlRow): KnowledgeCandidate {
  return {
    id: String(row.id),
    scopeId: String(row.scope_id),
    targetPath: row.target_path === null || row.target_path === undefined ? null : String(row.target_path),
    type: String(row.type) as KnowledgeCandidate['type'],
    title: String(row.title),
    summary: String(row.summary),
    body: String(row.body),
    origin: String(row.origin) as CandidateOrigin,
    sessionRef: String(row.session_ref),
    status: String(row.status) as KnowledgeCandidate['status'],
    createdAt: String(row.created_at),
    decidedAt: row.decided_at === null || row.decided_at === undefined ? null : String(row.decided_at),
  }
}

function contentHashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

function capturePath(id: string): string {
  return `captures/${id}.md`
}

export class CandidateStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly documents: DocumentStorePort,
  ) {}

  propose(input: ProposeCandidateInput): ProposeCandidateResult {
    if (input.origin === 'explicit-user') {
      const id = randomUUID()
      const path = input.targetPath ?? capturePath(id)
      const updatedAt = new Date().toISOString()
      const { next } = this.documents.supersede({
        scopeId: input.scopeId,
        path,
        type: input.type,
        title: input.title,
        summary: input.summary,
        body: input.body,
        origin: 'curated',
        contentHash: contentHashOf(input.body),
        updatedAt,
      })
      return { kind: 'written', document: next }
    }

    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO knowledge_candidates(
        id, scope_id, target_path, type, title, summary, body,
        origin, session_ref, status, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
    `).run(
      id, input.scopeId, input.targetPath ?? null, input.type, input.title,
      input.summary, input.body, input.origin, input.sessionRef, createdAt,
    )
    const row = this.db.prepare('SELECT * FROM knowledge_candidates WHERE id = ?').get(id) as SqlRow
    return { kind: 'queued', candidate: mapCandidate(row) }
  }

  list(scopeId: string): KnowledgeCandidate[] {
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_candidates
      WHERE scope_id = ? AND status = 'pending'
      ORDER BY created_at DESC
    `).all(scopeId) as SqlRow[]
    return rows.map(mapCandidate)
  }

  decide(input: DecideCandidateInput): DecideCandidateResult {
    const row = this.db.prepare("SELECT * FROM knowledge_candidates WHERE id = ? AND status = 'pending'")
      .get(input.id) as SqlRow | undefined
    if (!row) throw new Error('Knowledge candidate not found')
    const candidate = mapCandidate(row)
    const decidedAt = new Date().toISOString()

    if (input.decision === 'reject') {
      this.db.prepare("UPDATE knowledge_candidates SET status = 'rejected', decided_at = ? WHERE id = ?")
        .run(decidedAt, candidate.id)
      return { candidate: { ...candidate, status: 'rejected', decidedAt }, document: null }
    }

    const body = input.editedBody ?? candidate.body
    const path = candidate.targetPath ?? capturePath(candidate.id)
    const { next } = this.documents.supersede({
      scopeId: candidate.scopeId,
      path,
      type: candidate.type,
      title: candidate.title,
      summary: candidate.summary,
      body,
      origin: 'machine',
      contentHash: contentHashOf(body),
      updatedAt: decidedAt,
    })
    this.db.prepare("UPDATE knowledge_candidates SET status = 'accepted', decided_at = ? WHERE id = ?")
      .run(decidedAt, candidate.id)
    return { candidate: { ...candidate, status: 'accepted', decidedAt }, document: next }
  }
}
