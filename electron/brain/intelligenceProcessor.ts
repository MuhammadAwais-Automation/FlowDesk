import { createHash } from 'node:crypto'
import { getDomain } from 'tldts'
import { z } from 'zod'
import type { BrainSourceMetric, OpportunityCategory } from '../../src/types/brain'
import type { BrainDatabase } from './database'
import { EntityStore } from './knowledge/entities'
import { percentileMomentum, scoreOpportunity } from './intelligence'

export interface IntelligenceAuthor {
  name: string
  verifiedHandle?: string | null
}

export interface IntelligenceRecord {
  platform: string
  externalId: string | null
  sourceRef: string
  sourceId?: string | null
  canonicalUrl?: string | null
  text: string
  observedAt?: string | null
  engagement?: number | null
  author?: IntelligenceAuthor | null
}

export interface IntelligenceEvidence {
  id: string
  sourceId: string | null
  sourceRef: string
  platform: string
  observedAt: string | null
  excerpt: string
  confidence: number
}

export interface IntelligenceOpportunity {
  fingerprint: string
  category: OpportunityCategory
  title: string
  summary: string
  score: number
  confidence: number
  freshness: string
  evidence: IntelligenceEvidence[]
  topicTokens: string[]
  crossSourceSupport: number
  momentum: number
  recency: number
  risk: number
  organizationDomain: string | null
}

export interface IntelligenceResult {
  scopeId: string
  records: number
  deduplicated: number
  opportunities: IntelligenceOpportunity[]
  qualifiedCandidates: number
  entities: Array<{ id: string; name: string; verifiedHandle: string | null; platforms: string[] }>
  metrics: Array<Omit<BrainSourceMetric, 'id' | 'scopeId'>>
  coverage: { platforms: string[]; observedFrom: string | null; observedTo: string | null }
  warnings: string[]
  failures: string[]
}

const intelligenceEvidenceSchema = z.object({
  id: z.string(), sourceId: z.string().nullable(), sourceRef: z.string(), platform: z.string(),
  observedAt: z.string().nullable(), excerpt: z.string(), confidence: z.number().min(0).max(1),
}).strict()

const intelligenceOpportunitySchema = z.object({
  fingerprint: z.string(), category: z.enum(['direct_lead', 'warm_opportunity', 'market_signal', 'content_opportunity', 'product_opportunity', 'partnership_opportunity']),
  title: z.string(), summary: z.string(), score: z.number().min(0).max(100), confidence: z.number().min(0).max(1),
  freshness: z.string(), evidence: z.array(intelligenceEvidenceSchema).max(500), topicTokens: z.array(z.string()).max(50),
  crossSourceSupport: z.number().min(0).max(1), momentum: z.number().min(0).max(1), recency: z.number().min(0).max(1), risk: z.number().min(0).max(1),
  organizationDomain: z.string().nullable().optional().transform(value => value ?? null),
}).strict()

const intelligenceResultSchema = z.object({
  scopeId: z.string(), records: z.number().int().nonnegative(), deduplicated: z.number().int().nonnegative(),
  opportunities: z.array(intelligenceOpportunitySchema).max(500), qualifiedCandidates: z.number().int().nonnegative(),
  entities: z.array(z.object({ id: z.string(), name: z.string(), verifiedHandle: z.string().nullable(), platforms: z.array(z.string()) }).strict()).max(500),
  metrics: z.array(z.object({ platform: z.string(), metric: z.string(), value: z.number(), percentile: z.number().min(0).max(1), observedAt: z.string() }).strict()).max(500),
  coverage: z.object({ platforms: z.array(z.string()), observedFrom: z.string().nullable(), observedTo: z.string().nullable() }).strict(),
  warnings: z.array(z.string()), failures: z.array(z.string()),
}).strict()

export function parseIntelligenceResult(value: unknown): IntelligenceResult {
  return intelligenceResultSchema.parse(value) as IntelligenceResult
}

const stopWords = new Set([
  'a', 'an', 'and', 'are', 'build', 'customer', 'for', 'is', 'it', 'keeps', 'looking',
  'need', 'our', 'remains', 'solution', 'team', 'the', 'this', 'to', 'us', 'we', 'with',
])

// These hosts identify publishing/hosting platforms, not the organization
// behind a signal. Using them as correlation keys would merge unrelated people.
const nonOrganizationDomains = new Set([
  'amazonaws.com', 'azurewebsites.net', 'blogspot.com', 'cloudfront.net', 'facebook.com',
  'firebaseapp.com', 'github.com', 'github.io', 'google.com', 'herokuapp.com',
  'linkedin.com', 'medium.com', 'netlify.app', 'notion.site', 'onrender.com',
  'pages.dev', 'railway.app', 'reddit.com', 'sharepoint.com', 'squarespace.com',
  'substack.com', 'twitter.com', 'vercel.app', 'whatsapp.com', 'wixsite.com',
  'x.com', 'youtube.com', 'youtu.be',
])
const nonOrganizationDomainLabels = new Set([
  'facebook', 'github', 'google', 'linkedin', 'medium', 'notion', 'reddit',
  'substack', 'twitter', 'whatsapp', 'x', 'youtube', 'youtu',
])

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const normalizeHandle = (value: string) => value.trim().replace(/^@/, '').toLowerCase()

function matchRatio(text: string, expressions: RegExp[]) {
  return clamp(expressions.filter(expression => expression.test(text)).length / 2)
}

export function extractBuyerIntent(text: string): number {
  if (/\b(looking for|hiring|seeking|recommend(?:ation)? for)\b/i.test(text)) return 1
  return /\b(need|want)\s+(?:an?\s+)?(?:developer|consultant|agency|freelancer|solution)\b/i.test(text) ? 0.5 : 0
}

export function extractPainSeverity(text: string): number {
  return matchRatio(text, [
    /\b(blocked|blocking|broken|failing|struggling)\b/i,
    /\b(urgent|urgently|critical|outage|backlog|overwhelmed)\b/i,
  ])
}

export function extractRisk(text: string): number {
  return clamp([
    /\b(buy now|limited offer|affiliate)\b/i,
    /\b(dm me|guaranteed|risk[- ]free|free money)\b/i,
    /ignore (?:all )?(?:previous|prior) instructions/i,
  ].filter(expression => expression.test(text)).length / 2)
}

export function calculateRecency(observedAt: string | null, now: string): number {
  if (!observedAt) return 0
  const observed = Date.parse(observedAt)
  const current = Date.parse(now)
  if (!Number.isFinite(observed) || !Number.isFinite(current) || observed > current) return 0
  const days = (current - observed) / 86_400_000
  if (days <= 1) return 1
  if (days <= 7) return 0.8
  if (days <= 30) return 0.5
  if (days <= 90) return 0.2
  return 0
}

function canonicalUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase() || null
  }
}

function normalizedOrganizationDomainFromUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, '')
    const firstLabel = hostname.split('.')[0]
    if (!hostname || nonOrganizationDomainLabels.has(firstLabel)
      || [...nonOrganizationDomains].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))) return null
    const domain = getDomain(hostname, { allowPrivateDomains: false })
    const privateAwareDomain = getDomain(hostname, { allowPrivateDomains: true })
    if (!domain || !privateAwareDomain || domain !== privateAwareDomain || nonOrganizationDomains.has(domain)) return null
    return domain
  } catch {
    return null
  }
}

function normalizedOrganizationDomain(record: IntelligenceRecord) {
  return normalizedOrganizationDomainFromUrl(record.canonicalUrl ?? (record.sourceRef.startsWith('http') ? record.sourceRef : null))
}

function tokens(text: string) {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(token => token.length > 2 && !stopWords.has(token))
}

function recordKey(record: IntelligenceRecord) {
  const url = canonicalUrl(record.canonicalUrl ?? (record.sourceRef.startsWith('http') ? record.sourceRef : null))
  if (url) return `url:${url}`
  if (record.externalId) return `external:${record.platform.toLowerCase()}:${record.externalId}`
  return `content:${hash(`${record.platform}\u0000${record.sourceRef}\u0000${record.text.replace(/\s+/g, ' ').trim()}`)}`
}

function topicProfile(text: string, icpTerms: string[]) {
  const present = new Set(tokens(text))
  const matchedIcpTerms = [...new Set(icpTerms.map(term => term.toLowerCase().trim()).filter(term => {
    const termTokens = tokens(term)
    return termTokens.length > 0 && termTokens.every(token => present.has(token))
  }))].sort()
  const descriptiveTokens = [...present]
    .filter(token => !['blocked', 'blocking', 'broken', 'urgent', 'urgently', 'struggling'].includes(token))
    .sort()
    .slice(0, 3)
  const topicTokens = matchedIcpTerms.length
    ? [...new Set(matchedIcpTerms.flatMap(term => tokens(term)))].sort()
    : descriptiveTokens
  return { topicTokens, matchedIcpTerms }
}

function categoryFor(buyerIntent: number, painSeverity: number, text: string): OpportunityCategory | null {
  if (buyerIntent >= 0.75) return 'direct_lead'
  if (/\b(partner|partnership|collaborat(?:e|ion))\b/i.test(text)) return 'partnership_opportunity'
  if (painSeverity >= 0.5) return 'product_opportunity'
  if (/\b(what|how|guide|tutorial|ideas?)\b/i.test(text)) return 'content_opportunity'
  return null
}

function safeDescriptor(category: OpportunityCategory, topic: string[]) {
  const label = topic.length ? topic.join(', ') : 'unspecified topic'
  return `${category.replaceAll('_', ' ')} signal for ${label}`
}

export function processIntelligence(input: {
  scopeId: string
  records: IntelligenceRecord[]
  icpTerms?: string[]
  now?: string
}): IntelligenceResult {
  const current = input.now ?? new Date().toISOString()
  const unique = new Map<string, IntelligenceRecord>()
  for (const record of input.records) if (!unique.has(recordKey(record))) unique.set(recordKey(record), record)
  const records = [...unique.values()]
  const engagementByPlatform = new Map<string, number[]>()
  for (const record of records) {
    const platform = record.platform.toLowerCase()
    const values = engagementByPlatform.get(platform) ?? []
    values.push(Math.max(0, Number(record.engagement ?? 0)))
    engagementByPlatform.set(platform, values)
  }

  const candidates = records.map(record => {
    const platform = record.platform.toLowerCase()
    const buyerIntent = extractBuyerIntent(record.text)
    const painSeverity = extractPainSeverity(record.text)
    const risk = extractRisk(record.text)
    const { topicTokens: topic, matchedIcpTerms } = topicProfile(record.text, input.icpTerms ?? [])
    const category = categoryFor(buyerIntent, painSeverity, record.text)
    const momentum = percentileMomentum(Math.max(0, Number(record.engagement ?? 0)), engagementByPlatform.get(platform) ?? [])
    const recency = calculateRecency(record.observedAt ?? null, current)
    const icpFit = matchedIcpTerms.length ? clamp(matchedIcpTerms.length) : 0
    const organizationDomain = normalizedOrganizationDomain(record)
    return { record, platform, buyerIntent, painSeverity, risk, topic, category, momentum, recency, icpFit, organizationDomain }
  }).filter(item => item.category && item.topic.length)

  const clusters = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const correlationKey = candidate.organizationDomain
      ? `organization-domain:${candidate.organizationDomain}`
      : `topic:${candidate.topic.join('|')}`
    const fingerprint = hash(`${input.scopeId}\u0000${candidate.category}\u0000${correlationKey}`)
    const cluster = clusters.get(fingerprint) ?? []
    cluster.push(candidate)
    clusters.set(fingerprint, cluster)
  }

  const opportunities = [...clusters.entries()].map(([fingerprint, cluster]) => {
    const platforms = new Set(cluster.map(item => item.platform))
    const average = (select: (item: (typeof cluster)[number]) => number) => cluster.reduce((sum, item) => sum + select(item), 0) / cluster.length
    const crossSourceSupport = platforms.size >= 2 ? 1 : 0
    const repetition = clamp((cluster.length - 1) / 2)
    const buyerIntent = average(item => item.buyerIntent)
    const painSeverity = average(item => item.painSeverity)
    const risk = average(item => item.risk)
    const momentum = average(item => item.momentum)
    const recency = average(item => item.recency)
    const evidenceQuality = 0.5 + momentum * 0.5
    const category = cluster[0].category as OpportunityCategory
    const score = scoreOpportunity({
      buyerIntent, painSeverity, icpFit: average(item => item.icpFit), recency, repetition,
      crossSourceSupport, evidenceQuality, risk: risk * 30,
    }, category).score
    const topic = cluster[0].topic
    const observed = cluster.map(item => item.record.observedAt).filter((value): value is string => Boolean(value)).sort()
    const evidence = cluster.map(item => ({
      id: `evidence-${hash(`${input.scopeId}\u0000${recordKey(item.record)}`)}`,
      sourceId: item.record.sourceId ?? null,
      sourceRef: item.record.sourceRef,
      platform: item.platform,
      observedAt: item.record.observedAt ?? null,
      excerpt: safeDescriptor(category, topic),
      confidence: clamp(0.5 + item.buyerIntent * 0.2 + item.painSeverity * 0.2 + item.recency * 0.1),
    }))
    return {
      fingerprint, category, title: safeDescriptor(category, topic),
      summary: `${cluster.length} cited signal${cluster.length === 1 ? '' : 's'} across ${platforms.size} platform${platforms.size === 1 ? '' : 's'}.`,
      score, confidence: clamp(0.5 + Math.min(cluster.length, 3) * 0.1 + crossSourceSupport * 0.2),
      freshness: observed.at(-1) ?? current, evidence, topicTokens: topic, crossSourceSupport, momentum, recency, risk,
      organizationDomain: cluster[0].organizationDomain,
    }
  }).sort((a, b) => b.score - a.score || a.fingerprint.localeCompare(b.fingerprint))

  const entityMap = new Map<string, { id: string; name: string; verifiedHandle: string | null; platforms: Set<string> }>()
  for (const record of records) {
    if (!record.author?.name.trim()) continue
    const verified = record.author.verifiedHandle ? normalizeHandle(record.author.verifiedHandle) : null
    const identity = verified ? `verified:${verified}` : `source:${record.platform}:${record.externalId ?? recordKey(record)}`
    const entity = entityMap.get(identity) ?? { id: `entity-${hash(identity)}`, name: record.author.name.trim(), verifiedHandle: verified, platforms: new Set<string>() }
    entity.platforms.add(record.platform.toLowerCase())
    entityMap.set(identity, entity)
  }

  const metrics = [...engagementByPlatform.entries()].map(([platform, values]) => ({
    platform, metric: 'engagement', value: values.reduce((sum, value) => sum + value, 0) / values.length,
    percentile: values.reduce((sum, value) => sum + percentileMomentum(value, values), 0) / values.length,
    observedAt: current,
  }))
  const observed = records.map(record => record.observedAt).filter((value): value is string => Boolean(value)).sort()
  return {
    scopeId: input.scopeId, records: input.records.length, deduplicated: input.records.length - records.length,
    opportunities, qualifiedCandidates: opportunities.filter(item => item.score >= 70).length,
    entities: [...entityMap.values()].map(entity => ({ ...entity, platforms: [...entity.platforms].sort() })),
    metrics, coverage: { platforms: [...engagementByPlatform.keys()].sort(), observedFrom: observed[0] ?? null, observedTo: observed.at(-1) ?? null },
    warnings: [], failures: [],
  }
}

export function persistIntelligence(database: BrainDatabase, result: IntelligenceResult) {
  let evidence = 0
  for (const item of result.opportunities) {
    const exactPrevious = database.getOpportunityByFingerprint(result.scopeId, item.fingerprint)
    const compatibleLegacy = !exactPrevious && item.organizationDomain
      ? database.listOpportunityCorrelationCandidates({ scopeId: result.scopeId, category: item.category }).find(candidate => (
        database.getOpportunityEvidence({ id: candidate.id, scopeId: result.scopeId })
          .some(citation => normalizedOrganizationDomainFromUrl(citation.sourceRef) === item.organizationDomain)
      ))
      : null
    const persistedFingerprint = compatibleLegacy?.fingerprint ?? item.fingerprint
    const previous = exactPrevious ?? (compatibleLegacy
      ? database.getOpportunityByFingerprint(result.scopeId, compatibleLegacy.fingerprint)
      : null)
    const previousEvidence = previous ? database.getOpportunityEvidence({ id: previous.id, scopeId: result.scopeId }) : []
    const opportunity = database.upsertOpportunity({
      scopeId: result.scopeId, fingerprint: persistedFingerprint, category: item.category, title: item.title,
      summary: item.summary, score: Math.max(item.score, previous?.score ?? 0), confidence: Math.max(item.confidence, previous?.confidence ?? 0), freshness: item.freshness,
    })
    for (const citation of item.evidence) {
      database.recordOpportunityEvidence({
        opportunityId: opportunity.id, scopeId: result.scopeId, evidenceId: citation.id, sourceId: citation.sourceId,
        excerpt: citation.excerpt, confidence: citation.confidence, sourceRef: citation.sourceRef,
        platform: citation.platform, observedAt: citation.observedAt, extractorVersion: 'brain-intelligence-v1',
      })
      evidence++
    }
    const combinedEvidence = database.getOpportunityEvidence({ id: opportunity.id, scopeId: result.scopeId })
    const previousPlatformCount = new Set(previousEvidence.map(citation => citation.platform)).size
    const platformCount = new Set(combinedEvidence.map(citation => citation.platform)).size
    if (combinedEvidence.length !== item.evidence.length || platformCount >= 2 || previous) {
      const crossSourceBoost = item.crossSourceSupport === 0 && previousPlatformCount < 2 && platformCount >= 2 ? 10 : 0
      database.upsertOpportunity({
        scopeId: result.scopeId,
        fingerprint: persistedFingerprint,
        category: item.category,
        title: item.title,
        summary: `${combinedEvidence.length} cited signal${combinedEvidence.length === 1 ? '' : 's'} across ${platformCount} platform${platformCount === 1 ? '' : 's'}.`,
        score: Math.min(100, Math.max(item.score, previous?.score ?? 0) + crossSourceBoost),
        confidence: clamp(Math.max(item.confidence, previous?.confidence ?? 0) + (crossSourceBoost ? 0.2 : 0)),
        freshness: [item.freshness, ...combinedEvidence.map(citation => citation.observedAt).filter((value): value is string => Boolean(value))].sort().at(-1) as string,
      })
    }
  }
  for (const metric of result.metrics) database.recordSourceMetric({ scopeId: result.scopeId, ...metric })

  return { opportunities: result.opportunities.length, evidence, metrics: result.metrics.length }
}

/**
 * Persists the author entities this module has always found and always thrown
 * away, which is why 93 opportunities sit in the database with nobody attached.
 *
 * Separate from `persistIntelligence`, and called a stage earlier, because of a
 * real constraint rather than taste: recipe stages talk to each other through
 * gzipped artifacts on disk, and `recipeDefinitions.ts` deliberately strips
 * author names out of those before writing. So entities have to be stored while
 * the result is still in memory -- by the time persistence runs at `summarize`,
 * the names are gone, correctly.
 *
 * The consequence is stated rather than hidden: entities are created here, but
 * they are **not** linked to their opportunities, because the identity does not
 * survive to the stage where opportunities get their ids. Closing that gap means
 * either putting handles into the durable artifact -- a privacy decision that
 * belongs to the owner -- or restructuring the recipe stages.
 *
 * Only verified handles are kept. A verified handle is evidence of identity; a
 * display name is one post's text, and trusting it would mint an entity per post.
 */
export function persistIntelligenceEntities(database: BrainDatabase, result: IntelligenceResult): { entities: number } {
  const entities = new EntityStore(database.handle)
  let stored = 0
  for (const author of result.entities) {
    if (!author.verifiedHandle) continue
    entities.resolve({
      scopeId: result.scopeId, type: 'person', name: author.name,
      identifier: { kind: 'handle', value: author.verifiedHandle },
    })
    stored += 1
  }
  return { entities: stored }
}
