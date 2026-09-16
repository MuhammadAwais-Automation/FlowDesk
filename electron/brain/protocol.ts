import { z } from 'zod'
import { MONITORABLE_RECIPE_IDS } from '../../src/lib/brainUi'

const id = z.string().min(1).max(200)
const text = z.string().trim().min(1).max(100_000)
const scopeType = z.enum(['global', 'workspace', 'project', 'client', 'session'])
const memoryKind = z.enum(['fact', 'preference', 'decision', 'goal', 'person', 'organization', 'opportunity', 'procedure', 'note'])
const opportunityStatus = z.enum(['new', 'reviewing', 'qualified', 'dismissed', 'converted'])
const knowledgeDocType = z.enum(['note', 'project', 'client', 'person', 'decision', 'skill', 'source', 'me', 'research'])
/**
 * A vault-relative document path. Traversal, absolute paths and drive letters
 * are refused here as well as inside the store: this value can arrive straight
 * from an agent tool call, and one check is one mistake away from a read
 * outside the vault.
 */
const knowledgePath = z.string().trim().min(1).max(512)
  .refine(value => !value.split(/[\\/]/).includes('..'), 'path may not traverse')
  .refine(value => !value.startsWith('/') && !value.startsWith('\\'), 'path must be vault-relative')
  .refine(value => !/^[A-Za-z]:/.test(value), 'path must be vault-relative')

const requestBase = { id }

export const brainRequestSchema = z.discriminatedUnion('method', [
  z.object({ ...requestBase, method: z.literal('status'), payload: z.object({}).strict() }),
  z.object({ ...requestBase, method: z.literal('overview'), payload: z.object({ scopeId: id.optional() }).strict() }),
  z.object({ ...requestBase, method: z.literal('ensureScope'), payload: z.object({ type: scopeType, externalRef: id, name: text, parentId: id.nullish() }).strict() }),
  z.object({ ...requestBase, method: z.literal('listScopes'), payload: z.object({ types: z.array(scopeType).max(5).optional() }).strict() }),
  z.object({ ...requestBase, method: z.literal('search'), payload: z.object({
    text, scopeId: id, includeParents: z.boolean(), kinds: z.array(memoryKind).max(9).optional(),
    sourcePlatforms: z.array(id).max(20).optional(),
    timeRange: z.object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() }).optional(),
    tokenBudget: z.number().int().min(1).max(2000).optional(), limit: z.number().int().min(1).max(12).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('remember'), payload: z.object({
    scopeId: id, kind: memoryKind, text, shareable: z.boolean().optional(), importance: z.number().int().min(0).max(100).optional(),
    subject: text.optional(), predicate: text.optional(), sourceRef: text.optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('ingestMemory'), payload: z.object({
    scopeId: id, kind: memoryKind, text, origin: z.enum(['explicit_user', 'confirmed_user', 'inferred_user', 'external']),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('getMemory'), payload: z.object({ id }).strict() }),
  z.object({ ...requestBase, method: z.literal('forget'), payload: z.object({ id }).strict() }),
  z.object({ ...requestBase, method: z.literal('listMemories'), payload: z.object({ scopeId: id.optional() }).strict() }),
  z.object({ ...requestBase, method: z.literal('listCandidates'), payload: z.object({ scopeId: id.optional() }).strict() }),
  z.object({ ...requestBase, method: z.literal('decideCandidate'), payload: z.object({ id, decision: z.enum(['accept', 'reject']), editedText: text.optional() }).strict() }),
  z.object({ ...requestBase, method: z.literal('listJobs'), payload: z.object({}).strict() }),
  z.object({ ...requestBase, method: z.literal('listOpportunities'), payload: z.object({
    scopeId: id, status: opportunityStatus.optional(), limit: z.number().int().min(1).max(500).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('countOpportunities'), payload: z.object({
    scopeId: id, status: opportunityStatus.optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('getOpportunityEvidence'), payload: z.object({ id, scopeId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('reviewOpportunity'), payload: z.object({
    id, scopeId: id, decision: z.enum(['qualify', 'dismiss', 'convert']),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('buildDecisionBrief'), payload: z.object({
    scopeId: id, question: text, tokenBudget: z.number().int().min(1).max(1200).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('listSourceMetrics'), payload: z.object({
    scopeId: id, platform: id.optional(), since: z.string().datetime().optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('getArtifactManifest'), payload: z.object({ jobId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('registerRecipe'), payload: z.object({ id, version: z.number().int().positive(), title: text, steps: z.array(id).min(1).max(100) }).strict() }),
  z.object({ ...requestBase, method: z.literal('enqueueJob'), payload: z.object({
    recipeId: id, recipeVersion: z.number().int().positive(), scopeId: id, accountId: id.nullish(),
    parameters: z.record(z.string(), z.unknown()), continuation: z.object({
      sessionId: id, providerSessionId: id.nullish(), mode: z.enum(['interactive', 'background', 'actionable_only']), contextBudget: z.number().int().min(1).max(2000),
    }).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('completeJob'), payload: z.object({ id, result: z.record(z.string(), z.unknown()) }).strict() }),
  z.object({ ...requestBase, method: z.literal('controlJob'), payload: z.object({ id, action: z.enum(['cancel', 'retry']) }).strict() }),
  z.object({ ...requestBase, method: z.literal('failJob'), payload: z.object({ id, error: z.string().min(1).max(2000) }).strict() }),
  z.object({ ...requestBase, method: z.literal('vaultStatus'), payload: z.object({}).strict() }),
  z.object({ ...requestBase, method: z.literal('vaultSync'), payload: z.object({}).strict() }),
  z.object({ ...requestBase, method: z.literal('listVaultConflicts'), payload: z.object({ scopeId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('resolveVaultConflict'), payload: z.object({ id, scopeId: id, resolution: z.enum(['database', 'file']) }).strict() }),
  z.object({ ...requestBase, method: z.literal('getConsent'), payload: z.object({ scopeId: id, recipeId: id, provider: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('grantConsent'), payload: z.object({ scopeId: id, recipeId: id, provider: id, fields: z.array(id).min(1).max(100) }).strict() }),
  z.object({ ...requestBase, method: z.literal('revokeConsent'), payload: z.object({ scopeId: id, recipeId: id, provider: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('exportBackup'), payload: z.object({ outputPath: z.string().min(1).max(2000) }).strict() }),
  z.object({ ...requestBase, method: z.literal('importBackup'), payload: z.object({ inputPath: z.string().min(1).max(2000) }).strict() }),
  z.object({ ...requestBase, method: z.literal('recordConversationTurn'), payload: z.object({
    turnId: id, sessionId: id, scopeId: id, role: z.enum(['user', 'assistant']), sourceRef: text,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/), characterCount: z.number().int().nonnegative(), createdAt: z.iso.datetime(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('createMonitor'), payload: z.object({
    scopeId: id, recipeId: z.enum([...MONITORABLE_RECIPE_IDS]), intervalMinutes: z.number().int().min(15).max(10_080),
    minimumScore: z.number().min(0).max(100).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('listMonitors'), payload: z.object({ scopeId: id.optional() }).strict() }),
  // Scope is required, not optional: monitor mutation is scope-keyed exactly
  // like opportunity review, so a wrong-scope id can only be not-found.
  z.object({ ...requestBase, method: z.literal('setMonitorStatus'), payload: z.object({ id, scopeId: id, status: z.enum(['active', 'paused']) }).strict() }),
  z.object({ ...requestBase, method: z.literal('deleteMonitor'), payload: z.object({ id, scopeId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('listQueuedContinuations'), payload: z.object({}).strict() }),
  z.object({ ...requestBase, method: z.literal('consumeContinuation'), payload: z.object({ id }).strict() }),
  z.object({ ...requestBase, method: z.literal('listEntities'), payload: z.object({ scopeId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('getGraph'), payload: z.object({ scopeId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('ingestCaptureBatch'), payload: z.object({
    source: z.enum(['whatsapp', 'linkedin', 'reddit']), jobId: id, stepId: id, scopeId: id,
    accountId: id.nullish(), connectorVersion: id, retentionDays: z.number().int().min(1).max(365).optional(),
    records: z.array(z.record(z.string(), z.unknown())).max(5000),
  }).strict() }),
  // Brain v2 knowledge layer — see docs/brain-v2/. Implemented by the modules
  // in electron/brain/knowledge/, which four work packages build in parallel.
  z.object({ ...requestBase, method: z.literal('knowledge.manifest'), payload: z.object({
    scopeId: id, types: z.array(knowledgeDocType).max(9).optional(),
    tokenBudget: z.number().int().min(1).max(8000).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.read'), payload: z.object({
    scopeId: id, path: knowledgePath, tokenBudget: z.number().int().min(1).max(8000).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.search'), payload: z.object({
    scopeId: id, query: z.string().trim().min(1).max(500),
    types: z.array(knowledgeDocType).max(9).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.answerPack'), payload: z.object({
    scopeId: id,
    question: z.string().trim().min(1).max(2000),
    tokenBudget: z.number().int().min(1).max(8000).optional(),
    maxSections: z.number().int().min(1).max(20).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.buildVectors'), payload: z.object({
    scopeId: id,
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.vectorStatus'), payload: z.object({
    scopeId: id,
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.neighbors'), payload: z.object({
    scopeId: id,
    path: knowledgePath,
    depth: z.number().int().min(1).max(2).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('entity.list'), payload: z.object({
    scopeId: id,
    type: z.enum(['person', 'org', 'project', 'opportunity', 'topic']).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('entity.get'), payload: z.object({
    scopeId: id,
    entityId: id,
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('entity.mentions'), payload: z.object({
    scopeId: id,
    entityId: id,
    targetKind: z.enum(['document', 'opportunity', 'episode']).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('entity.listProposals'), payload: z.object({
    scopeId: id,
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('entity.decideProposal'), payload: z.object({
    id,
    decision: z.enum(['accept', 'reject']),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.dailyNote'), payload: z.object({
    scopeId: id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('recordEvent'), payload: z.object({
    scopeId: id.nullable(),
    action: z.enum(['agent.turn', 'tool.action', 'knowledge.accepted', 'knowledge.imported', 'knowledge.compacted', 'job.completed']),
    targetId: z.string().max(200).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('listEvents'), payload: z.object({
    scopeId: id,
    from: z.string(),
    to: z.string(),
    limit: z.number().int().min(1).max(2000).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.list'), payload: z.object({
    scopeId: id, types: z.array(knowledgeDocType).max(9).optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.importVault'), payload: z.object({
    scopeId: id, vaultRoot: z.string().trim().min(1).max(4096),
    maxFileBytes: z.number().int().min(1).max(50_000_000).optional(),
  }).strict() }),
  // The write gate (Phase 2). `explicit-user` proposals supersede straight
  // into knowledge_documents; `machine-inferred` ones sit as a candidate
  // until decideCandidate accepts or rejects them. Namespaced under
  // `knowledge.` because `listCandidates`/`decideCandidate` above already
  // name the older memory-candidate methods.
  z.object({ ...requestBase, method: z.literal('knowledge.proposeCandidate'), payload: z.object({
    scopeId: id, targetPath: knowledgePath.optional(), type: knowledgeDocType,
    title: z.string().trim().min(1).max(200), summary: z.string().trim().max(500),
    body: text, origin: z.enum(['explicit-user', 'machine-inferred']), sessionRef: text,
  }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.listCandidates'), payload: z.object({ scopeId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.decideCandidate'), payload: z.object({
    id, decision: z.enum(['accept', 'reject']), editedBody: text.optional(),
  }).strict() }),
  // Phase 3: deterministic cleanup for orphan captures/*.md notes the write
  // gate leaves behind. Timer-driven in service.ts; exposed here too so it
  // can be triggered and verified on demand.
  z.object({ ...requestBase, method: z.literal('knowledge.compact'), payload: z.object({ scopeId: id }).strict() }),
  // Part 1: one-time fold of the old `memories` store into knowledge_documents.
  // Idempotent -- safe to call again -- and dry-run first so the count is
  // visible before anything is written.
  z.object({ ...requestBase, method: z.literal('knowledge.migrateMemories'), payload: z.object({ dryRun: z.boolean().optional() }).strict() }),
  z.object({ ...requestBase, method: z.literal('knowledge.listUnresolvedLinks'), payload: z.object({ scopeId: id }).strict() }),
  z.object({ ...requestBase, method: z.literal('shutdown'), payload: z.object({}).strict() }),
])

export type BrainRequest = z.infer<typeof brainRequestSchema>

export interface BrainResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export interface BrainEvent {
  sequence: number
  type: 'ready' | 'changed' | 'degraded'
  createdAt: string
  data?: Record<string, unknown>
}
