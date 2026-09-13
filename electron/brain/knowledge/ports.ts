/**
 * The interface the knowledge modules talk through.
 *
 * W1 (manifest) and W4 (vault importer) depend on `DocumentStorePort`, never on
 * W2's concrete class and never on the `knowledge_*` tables directly. That is
 * what lets the three packages be built in parallel and tested against fakes.
 */

import type {
  DocumentSearchHit,
  KnowledgeDocType,
  KnowledgeDocument,
} from '../../../src/types/brainKnowledge'

export interface UpsertDocumentInput {
  scopeId: string
  path: string
  type: KnowledgeDocType
  title: string
  summary: string
  body: string
  origin: 'curated' | 'machine'
  contentHash: string
  updatedAt: string
  /** Wiki-link targets. The store decides which resolve to real documents. */
  links?: string[]
}

export interface ListDocumentsInput {
  scopeId: string
  types?: KnowledgeDocType[]
  /** Default false — superseded documents stay out of every read path. */
  includeSuperseded?: boolean
  /** Default 1000, clamped to 5000. */
  limit?: number
}

export interface SearchDocumentsInput {
  scopeId: string
  query: string
  types?: KnowledgeDocType[]
  /** Default 10, clamped to 50. */
  limit?: number
}

export interface DocumentStorePort {
  /** Insert, or update in place when the content hash changed. */
  upsert(input: UpsertDocumentInput): KnowledgeDocument
  /**
   * Insert a new active document, retiring whatever was active at the same
   * path rather than overwriting it. Unlike `upsert`, always creates a new
   * row and a new id — the previous row's `valid_to` is set, not its title
   * or body. Used by the write gate (candidates.ts) so an accepted proposal
   * never destroys the version it's replacing.
   */
  supersede(input: UpsertDocumentInput): { previous: KnowledgeDocument | null; next: KnowledgeDocument }
  /** Ordered by type, then updatedAt descending — the manifest relies on this. */
  list(input: ListDocumentsInput): KnowledgeDocument[]
  read(scopeId: string, path: string): { document: KnowledgeDocument; body: string } | null
  search(input: SearchDocumentsInput): DocumentSearchHit[]
}
