import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import type { BrainJob } from '../../src/types/brain'
import type { ArtifactStore } from './artifactStore'
import { scoreOpportunity } from './intelligence'
import { socialRecipeRequestSchema } from './socialRecipes'
import { capabilityFailure, type BrainCapabilityErrorCode, type BrainCapabilityRequest, type BrainCapabilityResult } from './capabilityProtocol'

export const socialRecipeDefinitions = [
  { id: 'whatsapp.unread_intelligence', version: 1, title: 'WhatsApp Unread Intelligence', steps: ['capture', 'normalize', 'classify', 'score', 'summarize'] },
  { id: 'linkedin.community_scan', version: 1, title: 'LinkedIn Community Scan', steps: ['capture', 'normalize', 'classify', 'score', 'summarize'] },
  { id: 'linkedin.opportunity_scan', version: 1, title: 'LinkedIn Opportunity Scan', steps: ['capture', 'normalize', 'classify', 'score', 'summarize'] },
]

export class RecipeStepError extends Error {
  constructor(readonly code: BrainCapabilityErrorCode) {
    const result = capabilityFailure('error', code)
    super(result.ok ? 'Recipe step failed' : result.error.message)
  }
}

const itemSchema = z.object({
  id: z.string(), text: z.string().max(4000), sourceRef: z.string(),
  category: z.enum(['direct_lead', 'market_signal']).optional(),
  score: z.number().min(0).max(100).optional(),
})
const itemsSchema = z.array(itemSchema).max(500)
type Item = z.infer<typeof itemSchema>

function field(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === 'string') return String(record[key])
  return ''
}

// Checkpoints contain counts and local references. Text remains in utility-owned
// artifacts; Task 5 can consume these deterministic per-stage artifacts directly.
export class RecipeStepHandlers {
  constructor(private readonly artifacts: ArtifactStore, private readonly brainRoot: string) {}

  private write(job: BrainJob, stage: string, items: unknown) {
    const directory = join(this.brainRoot, 'artifacts', job.id, 'derived')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${stage}.json.gz`)
    writeFileSync(path, gzipSync(JSON.stringify(items)))
    return path
  }

  private read(job: BrainJob, prior: Record<string, unknown> | undefined): unknown {
    if (!prior || typeof prior.dataRef !== 'string') throw new RecipeStepError('permanent')
    const root = resolve(this.brainRoot, 'artifacts', job.id, 'derived')
    const path = resolve(prior.dataRef)
    if (!path.startsWith(`${root}${sep}`)) throw new RecipeStepError('permanent')
    return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as unknown
  }

  captureRequest(job: BrainJob, id: string): BrainCapabilityRequest {
    const parsed = socialRecipeRequestSchema.parse({ recipeId: job.recipeId, scopeId: job.scopeId, accountId: job.accountId, parameters: job.parameters })
    const limit = parsed.parameters.limit ?? 50
    if (job.recipeId === 'whatsapp.unread_intelligence') return { id, capability: 'whatsapp.list_unread', input: { limit } }
    if (job.recipeId === 'linkedin.community_scan') return { id, capability: 'linkedin.feed', input: { limit, sort: 'RECENT' } }
    return { id, capability: 'linkedin.search', input: { query: parsed.parameters.query || 'hiring developer consultant recommendation', limit } }
  }

  capture(job: BrainJob, stepId: string, result: BrainCapabilityResult): Record<string, unknown> {
    if (!result.ok) throw new RecipeStepError(result.error.code)
    const manifest = this.artifacts.ingestBatch({
      source: job.recipeId.startsWith('whatsapp') ? 'whatsapp' : 'linkedin', jobId: job.id, stepId,
      scopeId: job.scopeId, accountId: job.accountId, connectorVersion: 'flowdesk-read-v1',
      records: result.records, retentionDays: Number(job.parameters.retentionDays ?? 30),
    })
    return { stage: 'capture', count: result.records.length, dataRef: this.write(job, 'capture', result.records), manifestJobId: manifest.jobId }
  }

  execute(job: BrainJob, stage: string, prior: Record<string, unknown> | undefined): Record<string, unknown> {
    if (stage === 'normalize') {
      const records = z.array(z.record(z.string(), z.unknown())).max(500).parse(this.read(job, prior))
      const items: Item[] = records.map((record, index) => {
        const last = record.last && typeof record.last === 'object' && !Array.isArray(record.last) ? record.last as Record<string, unknown> : {}
        return {
          id: field(record, ['id', 'urn', 'externalId']) || String(index),
          text: (field(record, ['text', 'body', 'lastMessage', 'title']) || field(last, ['body', 'caption'])).replace(/\s+/g, ' ').trim().slice(0, 4000),
          sourceRef: field(record, ['url', 'canonicalUrl', 'permalink']) || `artifact://${job.id}/derived/normalize.json.gz#${index}`,
        }
      })
      return { stage, count: items.length, dataRef: this.write(job, stage, items) }
    }
    const items = itemsSchema.parse(this.read(job, prior))
    if (stage === 'classify') {
      const classified = items.map(item => ({ ...item, category: /\b(hiring|hire|looking for|need|seeking|recommend)\b/i.test(item.text) ? 'direct_lead' : 'market_signal' }))
      return { stage, count: items.length, dataRef: this.write(job, stage, classified) }
    }
    if (stage === 'score') {
      const scored = items.map(item => ({ ...item, ...scoreOpportunity({
        buyerIntent: item.category === 'direct_lead' ? 1 : 0,
        painSeverity: /\b(urgent|blocked|broken|struggling)\b/i.test(item.text) ? 1 : 0,
        icpFit: /\b(developer|consultant|software|project)\b/i.test(item.text) ? 1 : 0,
        recency: 0, repetition: 0, crossSourceSupport: 0, evidenceQuality: item.text ? 1 : 0, risk: 0,
      }, item.category ?? 'market_signal') }))
      return { stage, count: items.length, dataRef: this.write(job, stage, scored) }
    }
    if (stage === 'summarize') {
      const actionableCount = items.filter(item => item.category === 'direct_lead' && (item.score ?? 0) >= 50).length
      return {
        stage, recordCount: items.length, actionableCount, actionable: actionableCount > 0,
        summary: `Reviewed ${items.length} records; ${actionableCount} potential opportunities.`,
        extractorVersion: 'deterministic-v1',
      }
    }
    throw new RecipeStepError('permanent')
  }
}
