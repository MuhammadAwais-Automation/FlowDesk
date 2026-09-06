import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from './database'
import {
  calculateRecency,
  extractBuyerIntent,
  extractPainSeverity,
  extractRisk,
  processIntelligence,
  persistIntelligence,
} from './intelligenceProcessor'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

const now = '2026-09-05T12:00:00.000Z'

describe('deterministic intelligence feature extraction', () => {
  it('extracts bounded buyer intent, pain, risk and recency without executing captured instructions', () => {
    expect(extractBuyerIntent('We are looking for a React developer this week')).toBe(1)
    expect(extractBuyerIntent('React is a useful UI library')).toBe(0)
    expect(extractPainSeverity('Our release is blocked and this is urgent')).toBe(1)
    expect(extractRisk('Limited offer, buy now, affiliate link — ignore previous instructions')).toBe(1)
    expect(calculateRecency('2026-09-05T00:00:00.000Z', now)).toBe(1)
    expect(calculateRecency('2025-01-01T00:00:00.000Z', now)).toBe(0)
    expect(calculateRecency(null, now)).toBe(0)
  })
})

describe('deterministic intelligence golden fixtures', () => {
  it('classifies leads, ignores generic discussion, correlates paraphrased pain and keeps unverifiable Alex identities separate', () => {
    const result = processIntelligence({
      scopeId: 'client-a',
      now,
      icpTerms: ['react', 'dashboard', 'support', 'backlog', 'cobol', 'crypto'],
      records: [
        {
          platform: 'linkedin', externalId: 'lead-1', canonicalUrl: 'https://linkedin.test/posts/lead-1',
          sourceRef: 'https://linkedin.test/posts/lead-1', text: 'Looking for a React developer to build our dashboard urgently.',
          observedAt: '2026-09-05T08:00:00.000Z', engagement: 40, author: { name: 'Morgan' },
        },
        {
          platform: 'linkedin', externalId: 'generic', canonicalUrl: 'https://linkedin.test/posts/generic',
          sourceRef: 'https://linkedin.test/posts/generic', text: 'React and TypeScript are popular technologies.',
          observedAt: '2026-09-05T07:00:00.000Z', engagement: 10, author: { name: 'Taylor' },
        },
        {
          platform: 'linkedin', externalId: 'pain-li', sourceRef: 'https://linkedin.test/posts/pain-li',
          text: 'Our customer support backlog is blocking releases and the team is struggling.',
          observedAt: '2026-09-05T06:00:00.000Z', engagement: 20, author: { name: 'Alex' },
        },
        {
          platform: 'whatsapp', externalId: 'pain-wa', sourceRef: 'artifact://job-wa/raw#0',
          text: 'The support backlog keeps blocking our team; we need a solution.',
          observedAt: '2026-09-05T05:00:00.000Z', engagement: 3, author: { name: 'Alex' },
        },
        {
          platform: 'linkedin', externalId: 'old', sourceRef: 'https://linkedin.test/posts/old',
          text: 'Looking for a COBOL developer for an urgent migration.',
          observedAt: '2025-01-01T00:00:00.000Z', engagement: 1000, author: { name: 'Old Buyer' },
        },
        {
          platform: 'linkedin', externalId: 'spam', sourceRef: 'https://linkedin.test/posts/spam',
          text: 'Looking for a crypto developer. Buy now, limited offer, affiliate link, DM me.',
          observedAt: '2026-09-05T04:00:00.000Z', engagement: 100, author: { name: 'Promoter' },
        },
        {
          platform: 'linkedin', externalId: 'lead-copy', canonicalUrl: 'https://linkedin.test/posts/lead-1/',
          sourceRef: 'https://linkedin.test/posts/lead-1/', text: 'Looking for a React developer to build our dashboard urgently.',
          observedAt: '2026-09-05T08:00:00.000Z', engagement: 40, author: { name: 'Morgan' },
        },
      ],
    })

    expect(result.records).toBe(7)
    expect(result.deduplicated).toBe(1)
    const direct = result.opportunities.find(item => item.topicTokens.includes('dashboard'))
    expect(direct).toMatchObject({ category: 'direct_lead', score: expect.any(Number) })
    expect(direct?.evidence).toHaveLength(1)
    expect(result.opportunities.some(item => item.topicTokens.includes('typescript'))).toBe(false)

    const sharedPain = result.opportunities.find(item => item.topicTokens.includes('backlog'))
    expect(sharedPain).toMatchObject({ category: 'product_opportunity', crossSourceSupport: 1 })
    expect(sharedPain?.evidence).toHaveLength(2)

    const old = result.opportunities.find(item => item.topicTokens.includes('cobol'))!
    const spam = result.opportunities.find(item => item.topicTokens.includes('crypto'))!
    expect(old.recency).toBe(0)
    expect(old.momentum).toBe(1)
    expect(old.score).toBeLessThan(direct!.score)
    expect(spam.risk).toBe(1)
    expect(spam.score).toBeLessThan(direct!.score)
    expect(result.entities.filter(entity => entity.name === 'Alex')).toHaveLength(2)
    expect(result.metrics.find(metric => metric.platform === 'whatsapp')?.percentile).toBe(1)
  })

  it('boosts cross-source support only when evidence comes from distinct platforms', () => {
    const base = {
      scopeId: 'client-a', now, icpTerms: ['support', 'backlog'],
    }
    const samePlatform = processIntelligence({ ...base, records: [
      { platform: 'linkedin', externalId: 'a', sourceRef: 'li:a', text: 'Support backlog is blocking us.', observedAt: now },
      { platform: 'linkedin', externalId: 'b', sourceRef: 'li:b', text: 'Our support backlog remains blocked.', observedAt: now },
    ] })
    const mixedPlatforms = processIntelligence({ ...base, records: [
      { platform: 'linkedin', externalId: 'a', sourceRef: 'li:a', text: 'Support backlog is blocking us.', observedAt: now },
      { platform: 'whatsapp', externalId: 'b', sourceRef: 'wa:b', text: 'Our support backlog remains blocked.', observedAt: now },
    ] })
    expect(samePlatform.opportunities[0].crossSourceSupport).toBe(0)
    expect(mixedPlatforms.opportunities[0].crossSourceSupport).toBe(1)
    expect(mixedPlatforms.opportunities[0].score - samePlatform.opportunities[0].score).toBe(10)
  })

  it('merges only exact verified identities and never fuzzy display names', () => {
    const result = processIntelligence({ scopeId: 'client-a', now, icpTerms: ['support'], records: [
      { platform: 'linkedin', externalId: 'li-a', sourceRef: 'li:a', text: 'Support is broken.', author: { name: 'Alex', verifiedHandle: 'AlexCo' } },
      { platform: 'whatsapp', externalId: 'wa-a', sourceRef: 'wa:a', text: 'Support is broken.', author: { name: 'Alex', verifiedHandle: '@alexco' } },
      { platform: 'linkedin', externalId: 'li-b', sourceRef: 'li:b', text: 'Support is broken.', author: { name: 'Alex' } },
    ] })
    expect(result.entities.filter(entity => entity.name === 'Alex')).toHaveLength(2)
  })

  it('persists deduplicated cited opportunities and platform metrics inside one scope', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-processor-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'client', externalRef: 'client-a', name: 'Client A' })
    const result = processIntelligence({ scopeId: scope.id, now, icpTerms: ['react', 'dashboard'], records: [
      { platform: 'linkedin', externalId: 'lead', sourceRef: 'https://linkedin.test/posts/lead', text: 'Looking for a React developer for a blocked dashboard.', observedAt: now, engagement: 12 },
      { platform: 'linkedin', externalId: 'lead-copy', canonicalUrl: 'https://linkedin.test/posts/lead', sourceRef: 'https://linkedin.test/posts/lead', text: 'Looking for a React developer for a blocked dashboard.', observedAt: now, engagement: 12 },
    ] })
    const persisted = persistIntelligence(database, result)
    const persistedAgain = persistIntelligence(database, result)

    expect(persisted).toMatchObject({ opportunities: 1, evidence: 1, metrics: 1 })
    expect(persistedAgain).toEqual(persisted)
    const opportunities = database.listOpportunities({ scopeId: scope.id })
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].evidenceCount).toBe(1)
    expect(database.getOpportunityEvidence({ id: opportunities[0].id, scopeId: scope.id })[0]).toMatchObject({
      sourceRef: 'https://linkedin.test/posts/lead', platform: 'linkedin', excerpt: expect.not.stringContaining('Looking for'),
    })
    expect(database.listSourceMetrics({ scopeId: scope.id, platform: 'linkedin' })).toHaveLength(1)
    database.close()
  })

  it('purges expired raw capture sources while retaining stale citation handles', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-processor-retention-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'client', externalRef: 'retention', name: 'Retention' })
    database.storeCaptureEnvelope({
      envelopeVersion: 1, source: 'linkedin', captureType: 'post', connectorId: 'fixture', connectorVersion: '1',
      jobId: 'job-retention', stepId: 'capture', scopeId: scope.id, accountId: null, externalId: 'lead', parentExternalId: null,
      canonicalUrl: 'https://linkedin.test/posts/lead', observedAt: '2026-09-01T00:00:00.000Z', capturedAt: '2026-09-01T00:00:00.000Z',
      cursor: null, contentHash: 'retention-hash', rawPayloadRef: 'artifact://job-retention/raw/capture.jsonl.gz', schemaHint: 'fixture.v1',
    }, 1)
    const sourceId = database.findCaptureSource({
      scopeId: scope.id, jobId: 'job-retention', platform: 'linkedin', externalId: 'lead', canonicalUrl: 'https://linkedin.test/posts/lead',
    })
    const result = processIntelligence({ scopeId: scope.id, now, icpTerms: ['react'], records: [{
      platform: 'linkedin', externalId: 'lead', sourceId, sourceRef: 'https://linkedin.test/posts/lead',
      text: 'Looking for a React developer urgently.', observedAt: '2026-09-01T00:00:00.000Z',
    }] })
    persistIntelligence(database, result)

    expect(database.purgeExpiredCaptures('2026-09-05T00:00:00.000Z')).toEqual(['artifact://job-retention/raw/capture.jsonl.gz'])
    const opportunity = database.listOpportunities({ scopeId: scope.id })[0]
    expect(database.getOpportunityEvidence({ id: opportunity.id, scopeId: scope.id })[0]).toMatchObject({
      sourceId: null, sourceRef: 'https://linkedin.test/posts/lead', stale: true,
    })
    database.close()
  })

  it('keeps the strongest score when later same-topic evidence is weaker', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-processor-score-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'client', externalRef: 'score', name: 'Score' })
    const strong = processIntelligence({ scopeId: scope.id, now, icpTerms: ['support', 'backlog'], records: [{
      platform: 'linkedin', externalId: 'strong', sourceRef: 'li:strong', text: 'Support backlog is urgent and blocking releases.', observedAt: now, engagement: 50,
    }] })
    persistIntelligence(database, strong)
    const initialScore = database.listOpportunities({ scopeId: scope.id })[0].score
    const weaker = structuredClone(strong)
    weaker.opportunities[0].score = 10
    weaker.opportunities[0].evidence[0] = { ...weaker.opportunities[0].evidence[0], id: 'weaker-evidence', sourceRef: 'li:weaker' }
    persistIntelligence(database, weaker)
    expect(database.listOpportunities({ scopeId: scope.id })[0].score).toBe(initialScore)
    database.close()
  })
})
