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
  UnresolvedLink,
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
  /**
   * The scope chain to read across, nearest first (e.g. `[project, global]`).
   * When a `path` exists in more than one scope in the chain, the nearest
   * scope wins — a project's own version of a document is never shadowed by
   * an ancestor's. Pass a single-element array to read one exact scope only.
   */
  scopeIds: string[]
  types?: KnowledgeDocType[]
  /** Default false — superseded documents stay out of every read path. */
  includeSuperseded?: boolean
  /** Default 1000, clamped to 5000. */
  limit?: number
}

export interface SearchDocumentsInput {
  /** Same nearest-first chain and shadowing rule as `ListDocumentsInput`. */
  scopeIds: string[]
  query: string
  types?: KnowledgeDocType[]
  /** Default 10, clamped to 50. */
  limit?: number
}

export interface DocumentStorePort {
  /** Insert, or update in place when the content hash changed. Always a
   *  single exact scope — writes never inherit. */
  upsert(input: UpsertDocumentInput): KnowledgeDocument
  /**
   * Insert a new active document, retiring whatever was active at the same
   * path rather than overwriting it. Unlike `upsert`, always creates a new
   * row and a new id — the previous row's `valid_to` is set, not its title
   * or body. Used by the write gate (candidates.ts) so an accepted proposal
   * never destroys the version it's replacing. Always a single exact scope.
   */
  supersede(input: UpsertDocumentInput): { previous: KnowledgeDocument | null; next: KnowledgeDocument }
  /**
   * Retires the active document at `scopeId`+`path` with nothing replacing
   * it — unlike `supersede`, which always inserts a `next` row at the same
   * path. Returns null (and changes nothing) when no active document is
   * there. Used by the compactor once a document's content has been folded
   * into a *different* path and this one should stop existing on its own.
   * Always a single exact scope.
   */
  retire(scopeId: string, path: string): KnowledgeDocument | null
  /** Ordered by type, then updatedAt descending — the manifest relies on this. */
  list(input: ListDocumentsInput): KnowledgeDocument[]
  /** Tries `scopeIds` in order, nearest first; returns the first match. */
  read(scopeIds: string[], path: string): { document: KnowledgeDocument; body: string } | null
  search(input: SearchDocumentsInput): DocumentSearchHit[]
  /** Wiki-links whose target didn't exist at write time — candidate
   *  connections a human can see and act on, at no cost if ignored. */
  listUnresolvedLinks(scopeIds: string[]): UnresolvedLink[]
}
