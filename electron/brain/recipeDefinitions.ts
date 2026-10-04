import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import type { BrainJob } from '../../src/types/brain'
import type { ArtifactStore } from './artifactStore'
import type { BrainDatabase } from './database'
import type { CandidateStore } from './knowledge/candidates'
import { parseIntelligenceResult, persistIntelligence, persistIntelligenceEntities, processIntelligence, type IntelligenceRecord } from './intelligenceProcessor'
import { socialRecipeRequestSchema } from './socialRecipes'
import { capabilityFailure, type BrainCapabilityErrorCode, type BrainCapabilityRequest, type BrainCapabilityResult } from './capabilityProtocol'

export const socialRecipeDefinitions = [
  // v2 adds `digest`: the first five steps mine a capture for opportunities and
  // then drop the words, which left everything the chats actually said outside
  // the knowledge store and invisible to retrieval. `digest` turns each thread
  // into one short note and proposes it for review.
  // `digest` sits before `summarize` because `summarize` is the step that
  // completes the job — anything after it would never be claimed.
  { id: 'whatsapp.unread_intelligence', version: 2, title: 'WhatsApp Unread Intelligence', steps: ['capture', 'normalize', 'classify', 'score', 'digest', 'summarize'] },
  { id: 'linkedin.community_scan', version: 1, title: 'LinkedIn Community Scan', steps: ['capture', 'normalize', 'classify', 'score', 'summarize'] },
  { id: 'linkedin.opportunity_scan', version: 1, title: 'LinkedIn Opportunity Scan', steps: ['capture', 'normalize', 'classify', 'score', 'summarize'] },
  { id: 'reddit.lead_sniper', version: 1, title: 'Reddit Lead Sniper', steps: ['capture', 'normalize', 'classify', 'score', 'summarize'] },
]

export const socialIntelligenceKeywordConfig = {
  icpTerms: [
    'developer', 'react', 'typescript', 'software', 'dashboard', 'support', 'backlog',
    'automation', 'integration', 'migration', 'consulting',
    'flutter', 'nextjs', 'next.js', 'supabase', 'electron', 'fullstack', 'full-stack', 'mvp', 'ai agent'
  ],
} as const

export class RecipeStepError extends Error {
  constructor(readonly code: BrainCapabilityErrorCode) {
    const result = capabilityFailure('error', code)
    super(result.ok ? 'Recipe step failed' : result.error.message)
  }
}

function field(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === 'string') return String(record[key])
  return ''
}

function numberField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof record[key] === 'number' && Number.isFinite(record[key])) return Math.max(0, Number(record[key]))
  return 0
}

/** Text budget for one normalized record, matching the slice below. */
const TEXT_LIMIT = 4000

/**
 * How many chats one scan may spend a model call on.
 *
 * Matches the capability contract's own ceiling. This is the one step in the
 * Brain that costs tokens, so the bound is fixed rather than parameterised:
 * a recipe run should never be able to grow its own budget.
 */
const MAX_DIGEST_CHATS = 10

/**
 * A chat's recent messages folded into one readable transcript.
 *
 * `whatsapp.list_unread` now answers with each chat's messages rather than a
 * single preview line, and that preview was null whenever the newest event
 * was a protocol message — in a real capture, six of eight unread chats had
 * no readable text at all. Everything downstream reads `text`, so this is
 * where a chat stops being a row and becomes a conversation.
 *
 * Separated by ` | ` rather than newlines because the caller collapses all
 * whitespace; the structured messages survive intact in the raw artifact,
 * which is what the digest step reads.
 *
 * Truncates from the front: when a thread is longer than the budget the
 * recent end is the part worth keeping.
 */
export function conversationText(record: Record<string, unknown>): string {
  if (!Array.isArray(record.messages)) return ''
  const lines: string[] = []
  for (const entry of record.messages) {
    if (!entry || typeof entry !== 'object') continue
    const message = entry as Record<string, unknown>
    const body = field(message, ['body', 'caption'])
    if (!body) continue
    const sender = field(message, ['sender']) || (message.fromMe === true ? 'You' : 'Unknown')
    lines.push(`${sender}: ${body}`)
  }
  const transcript = lines.join(' | ')
  return transcript.length > TEXT_LIMIT ? transcript.slice(-TEXT_LIMIT) : transcript
}

function observedAt(record: Record<string, unknown>) {
  for (const key of ['createdAt', 'observedAt', 'timestamp', 'sentAt']) {
    const value = record[key]
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString()
  }
  return null
}

// Checkpoints contain counts and local references. Text remains in utility-owned
// artifacts; Task 5 can consume these deterministic per-stage artifacts directly.
export class RecipeStepHandlers {
  constructor(
    private readonly artifacts: ArtifactStore,
    private readonly brainRoot: string,
    private readonly database: BrainDatabase,
    private readonly candidates: CandidateStore,
  ) {}

  private write(job: BrainJob, stage: string, items: unknown) {
    const directory = join(this.brainRoot, 'artifacts', job.id, 'derived')
    mkdirSync(directory, { recursive: true })
    const json = JSON.stringify(items)
    const hash = createHash('sha256').update(json).digest('hex')
    const path = join(directory, `${stage}-${hash}.json.gz`)
    if (!existsSync(path)) writeFileSync(path, gzipSync(json), { flag: 'wx' })
    return path
  }

  private read(job: BrainJob, prior: Record<string, unknown> | undefined): unknown {
    if (!prior || typeof prior.dataRef !== 'string') throw new RecipeStepError('permanent')
    const root = resolve(this.brainRoot, 'artifacts', job.id, 'derived')
    const path = resolve(prior.dataRef)
    if (!path.startsWith(`${root}${sep}`)) throw new RecipeStepError('permanent')
    return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as unknown
  }

  private readCapture(job: BrainJob, prior: Record<string, unknown> | undefined) {
    if (!prior || prior.stage !== 'capture' || typeof prior.dataRef !== 'string' || !prior.dataRef.startsWith('file://')) throw new RecipeStepError('permanent')
    const root = resolve(this.brainRoot, 'artifacts', job.id, 'raw')
    const path = resolve(prior.dataRef.slice('file://'.length))
    if (!path.startsWith(`${root}${sep}`)) throw new RecipeStepError('permanent')
    const content = gunzipSync(readFileSync(path)).toString('utf8')
    return content ? content.split('\n').map(line => z.record(z.string(), z.unknown()).parse(JSON.parse(line) as unknown)) : []
  }

  /**
   * The capture step's own checkpoint, whatever step is asking.
   *
   * `digest` runs fifth, so the `prior` the runner hands it is `score` — but
   * what it needs is the raw transcripts, which only the capture checkpoint
   * points at.
   */
  private captureCheckpoint(job: BrainJob): Record<string, unknown> | undefined {
    for (const row of this.database.listCheckpoints(job.id)) {
      const checkpoint = JSON.parse(String(row.checkpoint_json)) as Record<string, unknown>
      if (checkpoint.stage === 'capture') return checkpoint
    }
    return undefined
  }

  /**
   * The capability a step needs before it can run, or null when it needs none.
   *
   * Two steps reach outside the utility process now: `capture` for the
   * connector read, and `digest` for the model. Everything between them is
   * deterministic and runs on what those two brought back.
   */
  capabilityRequestFor(job: BrainJob, stepName: string, id: string): BrainCapabilityRequest | null {
    if (stepName === 'capture') return this.captureRequest(job, id)
    if (stepName !== 'digest') return null

    const chats = this.digestInput(job)
    // Nothing readable in this capture — no model call, and the step still
    // succeeds. A quiet scan is a normal outcome, not a failure.
    return chats.length === 0 ? null : { id, capability: 'model.digest_chats', input: { chats } }
  }

  /**
   * Chats worth spending a model call on: those with an actual transcript.
   *
   * Capped at the capability's own ceiling so the request cannot be rejected
   * for being too large, and sorted by transcript length so that when a scan
   * returns more chats than the ceiling the substantial threads win over a
   * one-line exchange.
   */
  private digestInput(job: BrainJob): Array<{ chatId: string; name: string; transcript: string }> {
    let records: Array<Record<string, unknown>>
    try {
      records = this.readCapture(job, this.captureCheckpoint(job))
    } catch {
      return []
    }
    return records
      .map(record => ({
        chatId: field(record, ['id', 'chatId', 'externalId']),
        name: field(record, ['name', 'title']),
        transcript: conversationText(record),
      }))
      .filter(chat => chat.chatId !== '' && chat.transcript !== '')
      .sort((left, right) => right.transcript.length - left.transcript.length)
      .slice(0, MAX_DIGEST_CHATS)
  }

  captureRequest(job: BrainJob, id: string): BrainCapabilityRequest {
    const parsed = socialRecipeRequestSchema.parse({ recipeId: job.recipeId, scopeId: job.scopeId, accountId: job.accountId, parameters: job.parameters })
    const limit = parsed.parameters.limit ?? 50
    if (job.recipeId === 'whatsapp.unread_intelligence') return { id, capability: 'whatsapp.list_unread', input: { limit } }
    if (job.recipeId === 'linkedin.community_scan') return { id, capability: 'linkedin.feed', input: { limit, sort: 'RECENT' } }
    if (job.recipeId === 'linkedin.opportunity_scan') return { id, capability: 'linkedin.search', input: { query: parsed.parameters.query || 'hiring developer consultant recommendation', limit } }
    if (job.recipeId === 'reddit.lead_sniper') {
      if (parsed.parameters.query) {
        const searchSort = parsed.parameters.sort === 'rising' ? 'new' : (parsed.parameters.sort ?? 'new')
        return { id, capability: 'reddit.search', input: { query: parsed.parameters.query, sort: searchSort, limit: Math.min(limit, 100) } }
      }
      return { id, capability: 'reddit.feed', input: { subreddit: parsed.parameters.subreddit || 'forhire', sort: parsed.parameters.sort ?? 'new', limit: Math.min(limit, 100) } }
    }
    throw new RecipeStepError('permanent')
  }

  capture(job: BrainJob, stepId: string, result: BrainCapabilityResult): Record<string, unknown> {
    if (!result.ok) throw new RecipeStepError(result.error.code)
    const source = job.recipeId.startsWith('whatsapp') ? 'whatsapp' : job.recipeId.startsWith('reddit') ? 'reddit' : 'linkedin'
    const manifest = this.artifacts.ingestBatch({
      source, jobId: job.id, stepId,
      scopeId: job.scopeId, accountId: job.accountId, connectorVersion: 'flowdesk-read-v1',
      records: result.records, retentionDays: Number(job.parameters.retentionDays ?? 30),
    })
    return { stage: 'capture', count: result.records.length, dataRef: manifest.artifactRefs[0], sourceRef: manifest.rawPayloadRef, manifestJobId: manifest.jobId }
  }

  /**
   * Writes each digested thread into the Review Inbox.
   *
   * Proposed, never written straight through: a chat digest is external
   * material read by a model, which the memory policy puts behind the human
   * gate. Accepting one runs the same `supersede()` an explicit user note
   * would, just after somebody agreed to it.
   *
   * Passes the intelligence `dataRef` through unchanged so `summarize`, which
   * runs next and reads its predecessor's artifact, still finds the scored
   * result rather than this step's bookkeeping.
   */
  digest(job: BrainJob, result: BrainCapabilityResult | null, prior: Record<string, unknown> | undefined): Record<string, unknown> {
    const passthrough = { stage: 'digest', dataRef: prior?.dataRef }
    if (result === null) return { ...passthrough, considered: 0, proposed: 0, skipped: 0 }
    if (!result.ok) throw new RecipeStepError(result.error.code)

    const day = new Date(job.createdAt).toISOString().slice(0, 10)
    const existing = new Set(this.candidates.list(job.scopeId).map(candidate => candidate.targetPath))
    let proposed = 0
    let skipped = 0
    for (const record of result.records) {
      const prose = field(record, ['prose']).trim()
      const chatId = field(record, ['chatId'])
      if (!prose || !chatId) {
        skipped += 1
        continue
      }
      const name = field(record, ['name']).trim() || chatId
      // One note per chat per day. A retry that lands before the checkpoint
      // saves would otherwise queue the same thread twice.
      const targetPath = `captures/whatsapp/${day}-${chatId.replace(/[^a-z0-9@._-]/gi, '-')}.md`
      if (existing.has(targetPath)) {
        skipped += 1
        continue
      }
      const title = `${name} — ${day}`
      this.candidates.propose({
        scopeId: job.scopeId,
        targetPath,
        type: 'note',
        title,
        summary: prose.split(/(?<=[.!?])\s/)[0].slice(0, 300),
        // The provenance line is written here, not by the model: where a note
        // came from is a fact the code knows and the model would only guess.
        body: `${prose}\n\nSource: WhatsApp chat \`${chatId}\`, captured ${day}.`,
        origin: 'machine-inferred',
        sessionRef: `job:${job.id}`,
      })
      existing.add(targetPath)
      proposed += 1
    }
    return { ...passthrough, considered: result.records.length, proposed, skipped }
  }

  execute(job: BrainJob, stage: string, prior: Record<string, unknown> | undefined): Record<string, unknown> {
    if (stage === 'normalize') {
      const records = z.array(z.record(z.string(), z.unknown())).max(500).parse(this.readCapture(job, prior))
      const source = job.recipeId.startsWith('whatsapp') ? 'whatsapp' : job.recipeId.startsWith('reddit') ? 'reddit' : 'linkedin'
      const intelligenceRecords: IntelligenceRecord[] = records.map((record, index) => {
        const last = record.last && typeof record.last === 'object' && !Array.isArray(record.last) ? record.last as Record<string, unknown> : {}
        let rawText = ''
        if (source === 'reddit') {
          const title = field(record, ['title'])
          const body = field(record, ['selftext', 'text', 'body'])
          rawText = [title, body].filter(Boolean).join('\n\n')
        } else {
          rawText = conversationText(record) || field(record, ['text', 'body', 'lastMessage', 'title']) || field(last, ['body', 'caption'])
        }
        const text = rawText.replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT)
        const externalId = field(record, ['id', 'shortId', 'urn', 'externalId', 'messageId', 'chatId']) || String(index)
        const permalink = field(record, ['permalink'])
        const canonicalUrl = permalink
          ? (permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`)
          : (field(record, ['url', 'canonicalUrl']) || null)
        const authorName = field(record, ['author', 'authorName', 'name'])
        const author = authorName ? {
          name: authorName,
          verifiedHandle: source === 'reddit' ? (authorName.startsWith('u/') ? authorName : `u/${authorName}`) : (field(record, ['verifiedHandle']) || null),
        } : null
        return {
          platform: source,
          externalId,
          sourceRef: canonicalUrl || field(record, ['url']) || `${String(prior?.sourceRef)}#${index}`,
          sourceId: this.database.findCaptureSource({ scopeId: job.scopeId, jobId: job.id, platform: source, externalId, canonicalUrl }),
          canonicalUrl,
          text,
          observedAt: observedAt(record),
          engagement: numberField(record, ['score', 'ups', 'numComments', 'reactions', 'reactionCount', 'likes', 'likeCount', 'comments', 'commentCount', 'unread', 'unreadCount']),
          author,
        }
      })
      const queryTerms = typeof job.parameters.query === 'string' ? job.parameters.query.toLowerCase().match(/[a-z0-9]+/g) ?? [] : []
      const result = processIntelligence({ scopeId: job.scopeId, records: intelligenceRecords, icpTerms: [...socialIntelligenceKeywordConfig.icpTerms, ...queryTerms], now: job.createdAt })
      // Store the authors before stripping them: names must not reach a durable
      // artifact, but the Brain is entitled to know who it heard from.
      persistIntelligenceEntities(this.database, result)
      // Display names are not required by later recipe stages, so keep them out of
      // durable derived artifacts. Raw provider content remains retention-governed.
      const safe = { ...result, entities: [] }
      return { stage, count: records.length, dataRef: this.write(job, stage, safe) }
    }
    const result = parseIntelligenceResult(this.read(job, prior))
    if (stage === 'classify') {
      const categoryCounts = Object.fromEntries(result.opportunities.map(item => item.category).map(category => [category, result.opportunities.filter(item => item.category === category).length]))
      return { stage, count: result.opportunities.length, dataRef: this.write(job, stage, result), categoryCounts }
    }
    if (stage === 'score') {
      const scoreBands = {
        qualified: result.opportunities.filter(item => item.score >= 70).length,
        review: result.opportunities.filter(item => item.score >= 50 && item.score < 70).length,
        low: result.opportunities.filter(item => item.score < 50).length,
      }
      return { stage, count: result.opportunities.length, dataRef: this.write(job, stage, result), scoreBands }
    }
    if (stage === 'summarize') {
      const persisted = persistIntelligence(this.database, result)
      const citations = [...new Set(result.opportunities.flatMap(item => item.evidence.map(evidence => evidence.sourceRef)))]
      const intelligenceHash = createHash('sha256').update(JSON.stringify(result)).digest('hex')
      const manifest = this.artifacts.writeIntelligenceManifest(job.id, {
        records: result.records, deduplicated: result.deduplicated, opportunities: persisted.opportunities,
        qualifiedCandidates: result.qualifiedCandidates, coverage: result.coverage, warnings: result.warnings,
        failures: result.failures, citations, hashes: { intelligence: intelligenceHash },
      })
      const actionableCount = result.opportunities.filter(item => item.score >= 50).length
      return {
        stage, recordCount: result.records, actionableCount, actionable: actionableCount > 0,
        summary: `Reviewed ${result.records} records; ${actionableCount} potential opportunities.`,
        extractorVersion: 'deterministic-v2', ...manifest,
      }
    }
    throw new RecipeStepError('permanent')
  }
}
