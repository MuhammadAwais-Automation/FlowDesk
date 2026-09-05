import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { RequestApproval } from './approval'

type BrainMethod = 'search' | 'remember' | 'getMemory' | 'forget' | 'listCandidates' | 'decideCandidate' | 'enqueueJob' | 'listJobs'

interface BrainToolRuntime {
  request(method: BrainMethod, payload: unknown): Promise<unknown>
  getScopeId(): string | null
  allowWrites(): boolean
}

let runtime: BrainToolRuntime | null = null

export function configureBrainTools(next: BrainToolRuntime) {
  runtime = next
}

function activeRuntime() {
  if (!runtime) throw new Error('FlowDesk Brain is unavailable')
  const scopeId = runtime.getScopeId()
  if (!scopeId) throw new Error('No active Brain scope')
  return { runtime, scopeId }
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

function requireWrites(runtime: BrainToolRuntime) {
  if (!runtime.allowWrites()) throw new Error('Brain learning is disabled for this Agent turn')
}

export const BRAIN_TOOL_NAMES = [
  'mcp__workers__brain_search',
  'mcp__workers__brain_remember',
  'mcp__workers__brain_forget',
  'mcp__workers__brain_explain_source',
  'mcp__workers__brain_list_candidates',
  'mcp__workers__brain_review_candidate',
  'mcp__workers__brain_run_recipe',
  'mcp__workers__brain_job',
  'mcp__workers__brain_open_artifact',
  'mcp__workers__brain_build_decision_brief',
] as const

const memoryKinds = ['fact', 'preference', 'decision', 'goal', 'person', 'organization', 'opportunity', 'procedure', 'note'] as const

export function createBrainTools(requestApproval: RequestApproval) {
  return [
    tool('brain_search', 'Search trusted, scope-safe FlowDesk Brain memory and return compact citations.', {
      text: z.string().min(1), tokenBudget: z.number().int().min(1).max(2000).optional(),
    }, async ({ text, tokenBudget }) => {
      const { runtime, scopeId } = activeRuntime()
      return result(await runtime.request('search', { text, scopeId, includeParents: true, tokenBudget: tokenBudget ?? 1200, limit: 12 }))
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_remember', 'Save an explicit user fact, preference, decision, goal or note in the active scope.', {
      kind: z.enum(memoryKinds), text: z.string().min(1), shareable: z.boolean().optional(),
      subject: z.string().min(1).optional(), predicate: z.string().min(1).optional(),
    }, async input => {
      const { runtime, scopeId } = activeRuntime()
      requireWrites(runtime)
      return result(await runtime.request('remember', { ...input, scopeId }))
    }),
    tool('brain_forget', 'Soft-delete a Brain memory after user approval.', { id: z.string().min(1) }, async ({ id }) => {
      const approved = await requestApproval({ tool: 'brain_forget', title: 'Forget Brain memory?', detail: id })
      if (!approved) return result({ cancelled: true })
      const { runtime } = activeRuntime()
      requireWrites(runtime)
      return result(await runtime.request('forget', { id }))
    }),
    tool('brain_explain_source', 'Open the stored provenance for one Brain memory.', { id: z.string().min(1) }, async ({ id }) => {
      const { runtime } = activeRuntime()
      return result(await runtime.request('getMemory', { id }))
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_list_candidates', 'List inferred or external memory candidates waiting for human review.', {}, async () => {
      const { runtime, scopeId } = activeRuntime()
      return result(await runtime.request('listCandidates', { scopeId }))
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_review_candidate', 'Accept or reject one Brain Review Inbox candidate.', {
      id: z.string().min(1), decision: z.enum(['accept', 'reject']), editedText: z.string().min(1).optional(),
    }, async input => {
      const approved = await requestApproval({ tool: 'brain_review_candidate', title: `${input.decision === 'accept' ? 'Accept' : 'Reject'} Brain candidate?`, detail: input.id })
      if (!approved) return result({ cancelled: true })
      const { runtime } = activeRuntime()
      requireWrites(runtime)
      return result(await runtime.request('decideCandidate', input))
    }),
    tool('brain_run_recipe', 'Queue a versioned durable Brain research or ingestion recipe.', {
      recipeId: z.string().min(1), recipeVersion: z.number().int().positive().default(1), accountId: z.string().min(1).optional(),
      parameters: z.record(z.string(), z.unknown()).default({}), mode: z.enum(['interactive', 'background', 'actionable_only']).default('interactive'),
      sessionId: z.string().min(1),
    }, async input => {
      const approved = await requestApproval({ tool: 'brain_run_recipe', title: 'Run Brain recipe?', detail: input.recipeId })
      if (!approved) return result({ cancelled: true })
      const { runtime, scopeId } = activeRuntime()
      requireWrites(runtime)
      return result(await runtime.request('enqueueJob', {
        recipeId: input.recipeId, recipeVersion: input.recipeVersion, scopeId, accountId: input.accountId,
        parameters: input.parameters, continuation: { sessionId: input.sessionId, mode: input.mode, contextBudget: 1200 },
      }))
    }),
    tool('brain_job', 'List durable Brain job state and results.', { id: z.string().optional() }, async ({ id }) => {
      const { runtime } = activeRuntime()
      const jobs = await runtime.request('listJobs', {}) as Array<{ id: string }>
      return result(id ? jobs.find(job => job.id === id) ?? null : jobs)
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_open_artifact', 'Return the compact artifact handles stored on a completed Brain job.', { jobId: z.string().min(1) }, async ({ jobId }) => {
      const { runtime } = activeRuntime()
      const jobs = await runtime.request('listJobs', {}) as Array<{ id: string; result?: unknown }>
      return result(jobs.find(job => job.id === jobId)?.result ?? null)
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_build_decision_brief', 'Build a cited compact decision brief from Brain evidence.', { question: z.string().min(1) }, async ({ question }) => {
      const { runtime, scopeId } = activeRuntime()
      return result(await runtime.request('search', { text: question, scopeId, includeParents: true, tokenBudget: 1200, limit: 12 }))
    }, { annotations: { readOnlyHint: true } }),
  ]
}
