/**
 * Brain v2 knowledge layer.
 *
 * The corpus is documents on disk; SQLite is a derived index over them. An
 * agent receives a flat manifest of what exists and asks for the documents it
 * decides it needs, rather than having retrieved context spliced into its
 * prompt.
 *
 * See docs/brain-v2/ for the work packages that implement this.
 */

export type KnowledgeDocType =
  | 'note'
  | 'project'
  | 'client'
  | 'person'
  | 'decision'
  | 'skill'
  | 'source'
  | 'me'
  | 'research'

export const KNOWLEDGE_DOC_TYPES: readonly KnowledgeDocType[] = [
  'note', 'project', 'client', 'person', 'decision', 'skill', 'source', 'me', 'research',
] as const

/**
 * A document's identity and metadata. The body is not carried here — callers
 * that want content call `read`, so listing a thousand documents stays cheap.
 */
export interface KnowledgeDocument {
  id: string
  /** Vault-relative, forward slashes, no leading `./`. */
  path: string
  scopeId: string
  type: KnowledgeDocType
  title: string
  /** One line, <= 110 characters, no newlines. May be empty — never invented. */
  summary: string
  contentHash: string
  byteSize: number
  origin: 'curated' | 'machine'
  validFrom: string
  /** null = currently valid. Superseding sets this; nothing is deleted. */
  validTo: string | null
  createdAt: string
  updatedAt: string
}

/** One line of the manifest. */
export interface ManifestEntry {
  path: string
  type: KnowledgeDocType
  title: string
  summary: string
  updatedAt: string
}

/** The compact index block injected into an agent prompt. */
export interface ManifestRender {
  text: string
  entryCount: number
  estimatedTokens: number
  /** True when entries were dropped to fit the budget; the text says so too. */
  truncated: boolean
}

export interface DocumentReadResult {
  path: string
  title: string
  type: KnowledgeDocType
  text: string
  updatedAt: string
  estimatedTokens: number
  truncated: boolean
}

export interface DocumentSearchHit {
  path: string
  title: string
  type: KnowledgeDocType
  snippet: string
  /** Positive, higher is a better match (SQLite bm25 is normalised for this). */
  score: number
  updatedAt: string
}

export interface VaultImportReport {
  scanned: number
  imported: number
  updated: number
  unchanged: number
  skipped: number
  failures: Array<{ path: string; reason: string }>
  durationMs: number
}
