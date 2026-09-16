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

/**
 * The write gate. `explicit-user` proposals bypass this table entirely (the
 * user said it themselves, so it supersedes straight into `knowledge_documents`);
 * `machine-inferred` ones sit here as `pending` until a human decides.
 */
export type CandidateOrigin = 'explicit-user' | 'machine-inferred'
export type CandidateStatus = 'pending' | 'accepted' | 'rejected'

export interface KnowledgeCandidate {
  id: string
  scopeId: string
  /** Null means "new document" — a path is assigned on accept. */
  targetPath: string | null
  type: KnowledgeDocType
  title: string
  summary: string
  body: string
  origin: CandidateOrigin
  sessionRef: string
  status: CandidateStatus
  createdAt: string
  decidedAt: string | null
}

export interface ProposeCandidateInput {
  scopeId: string
  targetPath?: string | null
  type: KnowledgeDocType
  title: string
  summary: string
  body: string
  origin: CandidateOrigin
  sessionRef: string
}

export interface DecideCandidateInput {
  id: string
  decision: 'accept' | 'reject'
  editedBody?: string
}

/**
 * The compactor (Phase 3). Deterministic housekeeping only: fold an orphan
 * `captures/*.md` note into the real document it's about when the match is
 * clear, retire the orphan, and leave it alone otherwise. Never guesses at
 * patterns or generates insight — see docs/superpowers/plans for why.
 */
export interface CompactionDecision {
  capturePath: string
  outcome: 'merged' | 'left-standalone'
  /** The document the capture was folded into, when `outcome` is 'merged'. */
  targetPath: string | null
  /** Best search match's score, or null if the capture had no search hits at all. */
  topScore: number | null
  /** Second-best match's score — the margin over this is what the confidence bar checks. */
  secondScore: number | null
}

export interface CompactionReport {
  scanned: number
  merged: number
  leftStandalone: number
  decisions: CompactionDecision[]
}

/**
 * A wiki-link whose target didn't resolve to a real document at write time
 * (Obsidian calls this an "unlinked mention" from the target's point of
 * view — a candidate connection with no maintenance cost until you act on
 * it). Read-only for now: promoting one into a real link means editing the
 * source document's body, which is future work, not this.
 */
export interface UnresolvedLink {
  documentPath: string
  documentTitle: string
  targetPath: string
}

/**
 * One thing that happened, for the activity timeline and the daily note.
 *
 * Stored verbatim rather than summarised: a raw row is reproducible and
 * auditable, and measured better than LLM-extracted artifacts in the memory
 * literature. `metadata` shape depends on `action` and is deliberately loose —
 * the daily-note renderer decides what is worth showing.
 */
export type BrainEventAction =
  | 'agent.turn'
  | 'tool.action'
  | 'knowledge.accepted'
  | 'knowledge.imported'
  | 'knowledge.compacted'
  | 'job.completed'

export interface BrainEvent {
  id: string
  scopeId: string | null
  action: BrainEventAction
  targetId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

/** What a finished agent turn actually cost, straight from the SDK result message. */
export interface AgentTurnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalCostUsd: number
  numTurns: number
  durationMs: number
}

/**
 * The link neighbourhood around one document — a *local* graph, never a global
 * one. `depth` is hops from the origin, so a renderer can lay it out in rings
 * without running a physics simulation.
 */
export interface DocumentNeighborhoodNode {
  path: string
  title: string
  type: KnowledgeDocType
  depth: number
}

export interface DocumentNeighborhood {
  origin: string
  nodes: DocumentNeighborhoodNode[]
  edges: { from: string; to: string }[]
}

/** Progress of the embedding index. `available: false` means the model never loaded. */
export interface VectorIndexReport {
  indexed: number
  skipped: number
  total: number
  available: boolean
}

export interface VectorSearchHit {
  id: string
  path: string
  title: string
  score: number
}

/** One verbatim passage the retrieval ladder chose, with where it came from. */
export interface AnswerPackSection {
  path: string
  title: string
  headingPath: string
  text: string
  score: number
}

/**
 * What the retrieval ladder returns for one question: assembled evidence plus
 * enough provenance to see how it was found. `strategy` and `pointerFollowed`
 * are what make the answer checkable rather than merely plausible.
 */
export interface AnswerPack {
  question: string
  /** The text to hand the model. Never empty. */
  evidence: string
  sections: AnswerPackSection[]
  pointerFollowed: { from: string; to: string } | null
  strategy: 'strong-signal' | 'ranked' | 'fuzzy' | 'none'
  estimatedTokens: number
  candidatesConsidered: number
}

/** A person, organisation, project or opportunity the Brain knows about. */
export interface BrainEntity {
  id: string
  scopeId: string
  type: 'person' | 'org' | 'project' | 'opportunity' | 'topic'
  name: string
  createdAt: string
  updatedAt: string
}

/** One thing that talks about an entity -- a document, an opportunity, a capture. */
export interface EntityMention {
  entityId: string
  targetKind: 'document' | 'opportunity' | 'episode'
  targetId: string
  sourceRef: string
  createdAt: string
}

/**
 * Two entities that might be the same, waiting on a human.
 *
 * Only softer-than-identifier matches land here; an exact verified identifier
 * merges on its own.
 */
export interface EntityMergeProposal {
  id: string
  scopeId: string
  keepEntityId: string
  keepName: string
  mergeEntityId: string
  mergeName: string
  reason: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}
