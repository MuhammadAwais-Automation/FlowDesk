export type BrainScopeType = 'global' | 'workspace' | 'project' | 'client' | 'session'

export type MemoryKind =
  | 'fact'
  | 'preference'
  | 'decision'
  | 'goal'
  | 'person'
  | 'organization'
  | 'opportunity'
  | 'procedure'
  | 'note'

export type MemoryStatus = 'candidate' | 'accepted' | 'rejected' | 'superseded' | 'deleted'

export type BrainJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_login'
  | 'waiting_for_approval'
  | 'processing'
  | 'ready_for_agent'
  | 'retry_scheduled'
  | 'partially_completed'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface BrainScope {
  id: string
  type: BrainScopeType
  externalRef: string
  name: string
  parentId: string | null
  createdAt: string
}

export interface BrainMemory {
  id: string
  scopeId: string
  kind: MemoryKind
  text: string
  status: MemoryStatus
  shareable: boolean
  importance: number
  subject: string | null
  predicate: string | null
  sourceRef: string
  createdAt: string
  updatedAt: string
}

export interface BrainCandidate {
  id: string
  scopeId: string
  kind: MemoryKind
  text: string
  status: MemoryStatus
  origin: 'inferred_user' | 'external'
  createdAt: string
}

export interface BrainQuery {
  text: string
  scopeId: string
  includeParents: boolean
  kinds?: MemoryKind[]
  sourcePlatforms?: string[]
  timeRange?: { from?: string; to?: string }
  tokenBudget?: number
  limit?: number
}

export interface BrainCitation {
  id: string
  memoryId: string
  text: string
  kind: MemoryKind
  scopeId: string
  sourceRef: string
  score: number
}

export interface BrainConflict {
  subject: string
  memoryIds: string[]
}

export interface BrainContextPack {
  summary: string
  citations: BrainCitation[]
  conflicts: BrainConflict[]
  scopePath: string[]
  estimatedTokens: number
}

export interface CaptureEnvelope {
  envelopeVersion: 1
  source: string
  captureType: string
  connectorId: string
  connectorVersion: string
  jobId: string
  stepId: string
  scopeId: string
  accountId: string | null
  externalId: string | null
  parentExternalId: string | null
  canonicalUrl: string | null
  observedAt: string | null
  capturedAt: string
  cursor: string | null
  contentHash: string
  rawPayloadRef: string
  schemaHint: string | null
}

export interface AgentContinuation {
  id: string
  jobId: string
  sessionId: string
  providerSessionId: string | null
  mode: 'interactive' | 'background' | 'actionable_only'
  contextBudget: number
  status: 'waiting' | 'queued' | 'consumed' | 'cancelled'
}

export interface BrainJob {
  id: string
  recipeId: string
  recipeVersion: number
  scopeId: string
  accountId: string | null
  status: BrainJobStatus
  parameters: Record<string, unknown>
  result: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface BrainStatus {
  ready: boolean
  degraded: boolean
  fts5: boolean
  schemaVersion: number
  error?: string
}
