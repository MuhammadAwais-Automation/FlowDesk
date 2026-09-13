/**
 * Document store — the one real implementation of `DocumentStorePort`.
 *
 * STUB. Implemented by work package W2 — see docs/brain-v2/w2-documents.md.
 * Owns its own SQL against the shared handle so that W1 and W4 can add
 * behaviour without editing a shared file.
 */

import type { DatabaseSync } from 'node:sqlite'
import type { DocumentSearchHit, KnowledgeDocument } from '../../../src/types/brainKnowledge'
import type {
  DocumentStorePort,
  ListDocumentsInput,
  SearchDocumentsInput,
  UpsertDocumentInput,
} from './ports'

const NOT_IMPLEMENTED = 'DocumentStore is not implemented yet — see docs/brain-v2/w2-documents.md'

export class DocumentStore implements DocumentStorePort {
  constructor(private readonly db: DatabaseSync) {}

  /** Touches `db` so the held dependency survives typecheck until W2 uses it. */
  private unimplemented(): never {
    void this.db
    throw new Error(NOT_IMPLEMENTED)
  }

  upsert(_input: UpsertDocumentInput): KnowledgeDocument {
    return this.unimplemented()
  }

  list(_input: ListDocumentsInput): KnowledgeDocument[] {
    return this.unimplemented()
  }

  read(_scopeId: string, _path: string): { document: KnowledgeDocument; body: string } | null {
    return this.unimplemented()
  }

  search(_input: SearchDocumentsInput): DocumentSearchHit[] {
    return this.unimplemented()
  }
}
