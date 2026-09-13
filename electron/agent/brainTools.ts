import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { toDocType } from '../brain/knowledge/memoriesMigration'
import type { RequestApproval } from './approval'
import { BRAIN_UNAVAILABLE_MESSAGE, readBrainDocument, searchBrainDocuments } from './brainNavigation'

type BrainMethod = 'search' | 'remember' | 'getMemory' | 'forget' | 'listCandidates' | 'decideCandidate' | 'enqueueJob' | 'listJobs' | 'buildDecisionBrief' | 'reviewOpportunity' | 'knowledge.read' | 'knowledge.search' | 'knowledge.proposeCandidate'

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

/**
 * Local copy of the same word-boundary title truncation used by
 * sessionCapture.ts and vaultImporter.ts -- each of those files is owned by
 * a different Brain v2 package and explains in its own comment why it keeps
 * its own copy rather than importing another package's private helper. This
 * one is no different: a few stateless lines, cheaper to duplicate than to
 * couple across ownership boundaries.
 */
function rememberTitle(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const source = firstLine.length > 0 ? firstLine : text.trim()
  const maximumLength = 60
  if (source.length <= maximumLength) return source
  const prefix = source.slice(0, maximumLength + 1)
  const boundary = prefix.search(/\s+\S*$/)
  return (boundary > 0 ? prefix.slice(0, boundary) : source.slice(0, maximumLength)).trimEnd()
}

export const BRAIN_TOOL_NAMES = [
  'mcp__workers__brain_search',
  'mcp__workers__brain_read_document',
  'mcp__workers__brain_search_documents',
  'mcp__workers__brain_remember',
  'mcp__workers__brain_forget',
  'mcp__workers__brain_explain_source',
  'mcp__workers__brain_list_candidates',
  'mcp__workers__brain_review_candidate',
  'mcp__workers__brain_run_recipe',
  'mcp__workers__brain_job',
  'mcp__workers__brain_open_artifact',
  'mcp__workers__brain_build_decision_brief',
  'mcp__workers__brain_review_opportunity',
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
    tool('brain_read_document', 'Read one knowledge document by its manifest or search-result path.', {
      path: z.string().min(1),
    }, async ({ path }) => {
      try {
        const { runtime, scopeId } = activeRuntime()
        return result(await readBrainDocument(runtime.request, scopeId, path))
      } catch {
        return result(BRAIN_UNAVAILABLE_MESSAGE)
      }
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_search_documents', 'Search knowledge documents in the active scope and return compact hits for selective reading.', {
      query: z.string().min(1), limit: z.number().int().optional(),
    }, async ({ query, limit }) => {
      try {
        const { runtime, scopeId } = activeRuntime()
        return result(await searchBrainDocuments(runtime.request, scopeId, query, limit))
      } catch {
        return result(BRAIN_UNAVAILABLE_MESSAGE)
      }
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_remember', 'Save an explicit user fact, preference, decision, goal or note in the active scope.', {
      kind: z.enum(memoryKinds), text: z.string().min(1), shareable: z.boolean().optional(),
      subject: z.string().min(1).optional(), predicate: z.string().min(1).optional(),
    }, async input => {
      const { runtime, scopeId } = activeRuntime()
      requireWrites(runtime)
      // Part 1: memories are folded into the one knowledge store rather than
      // a second, separately-synced one. 'explicit-user' origin writes
      // straight through -- the user said it themselves via this tool call.
      const metadata = [
        input.subject ? `Subject: ${input.subject}` : null,
        input.predicate ? `Predicate: ${input.predicate}` : null,
      ].filter((line): line is string => line !== null)
      return result(await runtime.request('knowledge.proposeCandidate', {
        scopeId,
        type: toDocType(input.kind),
        title: rememberTitle(input.text),
        summary: '',
        body: [...metadata, '', input.text].join('\n'),
        origin: 'explicit-user',
        sessionRef: `agent-tool://brain_remember/${Date.now()}`,
      }))
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
      return result(await runtime.request('buildDecisionBrief', { question, scopeId, tokenBudget: 1200 }))
    }, { annotations: { readOnlyHint: true } }),
    tool('brain_review_opportunity', 'Qualify, dismiss or convert an evidence-backed opportunity after approval.', {
      id: z.string().min(1), decision: z.enum(['qualify', 'dismiss', 'convert']),
    }, async input => {
      const approved = await requestApproval({
        tool: 'brain_review_opportunity',
        title: `${input.decision.charAt(0).toUpperCase()}${input.decision.slice(1)} Brain opportunity?`,
        detail: `${input.id} · ${input.decision}`,
      })
      if (!approved) return result({ cancelled: true })
      const { runtime, scopeId } = activeRuntime()
      requireWrites(runtime)
      return result(await runtime.request('reviewOpportunity', { ...input, scopeId }))
    }),
  ]
}
