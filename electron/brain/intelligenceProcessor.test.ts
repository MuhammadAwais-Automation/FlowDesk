import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from './database'
import {
  calculateRecency,
  extractBuyerIntent,
  extractPainSeverity,
  extractRisk,
  parseIntelligenceResult,
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

  it('keeps stored pre-domain intelligence checkpoints readable', () => {
    const current = processIntelligence({ scopeId: 'client-a', now, records: [{
      platform: 'linkedin', externalId: 'legacy', sourceRef: 'li:legacy',
      text: 'Looking for a React developer.', observedAt: now,
    }] })
    const { organizationDomain: _organizationDomain, ...legacyOpportunity } = current.opportunities[0]
    const parsed = parseIntelligenceResult({ ...current, opportunities: [legacyOpportunity] })
    expect(parsed.opportunities[0].organizationDomain).toBeNull()
  })
})

describe('deterministic intelligence golden fixtures', () => {
  it('keeps descriptive topics separate from ICP matches and gives zero ICP fit when no configured term matches', () => {
    const record = {
      platform: 'linkedin', externalId: 'lead', sourceRef: 'li:lead',
      text: 'Looking for a React developer for a migration.', observedAt: now,
    }
    const matched = processIntelligence({ scopeId: 'client-a', now, icpTerms: ['react'], records: [record] }).opportunities[0]
    const unmatched = processIntelligence({ scopeId: 'client-a', now, icpTerms: ['fintech'], records: [record] }).opportunities[0]

    expect(matched.topicTokens).toContain('react')
    expect(unmatched.topicTokens).toContain('react')
    expect(matched.score - unmatched.score).toBe(15)
    expect(processIntelligence({ scopeId: 'client-a', now, records: [record] }).opportunities[0].score).toBe(unmatched.score)
  })

  it('correlates differently worded cross-platform signals only through a safe normalized organization domain', () => {
    const result = processIntelligence({ scopeId: 'client-a', now, icpTerms: ['unmatched-icp'], records: [
      {
        platform: 'linkedin', externalId: 'li-acme', canonicalUrl: 'https://www.Acme.test/jobs/123',
        sourceRef: 'li:acme', text: 'Our deployment pipeline is broken.', observedAt: now,
      },
      {
        platform: 'whatsapp', externalId: 'wa-acme', canonicalUrl: 'https://acme.test/help/releases',
        sourceRef: 'wa:acme', text: 'Production releases remain blocked.', observedAt: now,
      },
    ] })

    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0]).toMatchObject({
      category: 'product_opportunity',
      crossSourceSupport: 1,
      evidence: [{ platform: 'linkedin' }, { platform: 'whatsapp' }],
    })
  })

  it('does not correlate unrelated signals through shared social or common hosting domains', () => {
    const result = processIntelligence({ scopeId: 'client-a', now, records: [
      {
        platform: 'linkedin', externalId: 'li-release', canonicalUrl: 'https://linkedin.com/posts/a',
        sourceRef: 'li:a', text: 'Our deployment pipeline is broken.', observedAt: now,
      },
      {
        platform: 'whatsapp', externalId: 'wa-billing', canonicalUrl: 'https://www.linkedin.com/posts/b',
        sourceRef: 'wa:b', text: 'Invoice reconciliation remains blocked.', observedAt: now,
      },
      {
        platform: 'linkedin', externalId: 'li-github', canonicalUrl: 'https://github.com/acme/repository/issues/1',
        sourceRef: 'li:github', text: 'Release automation is failing.', observedAt: now,
      },
      {
        platform: 'whatsapp', externalId: 'wa-github', canonicalUrl: 'https://github.com/other/repository/issues/2',
        sourceRef: 'wa:github', text: 'Customer imports are broken.', observedAt: now,
      },
    ] })

    expect(result.opportunities).toHaveLength(4)
    expect(result.opportunities.every(item => item.crossSourceSupport === 0)).toBe(true)
  })

  it('keeps different signal categories separate even on the same organization domain', () => {
    const result = processIntelligence({ scopeId: 'client-a', now, records: [
      {
        platform: 'linkedin', externalId: 'li-hire', canonicalUrl: 'https://acme.test/jobs/react',
        sourceRef: 'li:hire', text: 'Looking for a React developer.', observedAt: now,
      },
      {
        platform: 'whatsapp', externalId: 'wa-pain', canonicalUrl: 'https://www.acme.test/status/releases',
        sourceRef: 'wa:pain', text: 'Production releases are blocked.', observedAt: now,
      },
    ] })

    expect(result.opportunities).toHaveLength(2)
    expect(new Set(result.opportunities.map(item => item.category))).toEqual(new Set(['direct_lead', 'product_opportunity']))
  })

  it('correlates a normalized organization domain across separate durable processing runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-domain-correlation-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'client', externalRef: 'acme', name: 'Acme' })

    persistIntelligence(database, processIntelligence({ scopeId: scope.id, now, records: [{
      platform: 'linkedin', externalId: 'li-acme', canonicalUrl: 'https://www.Acme.test/jobs/123',
      sourceRef: 'li:acme', text: 'Our deployment pipeline is broken.', observedAt: now,
    }] }))
    persistIntelligence(database, processIntelligence({ scopeId: scope.id, now, records: [{
      platform: 'whatsapp', externalId: 'wa-acme', canonicalUrl: 'https://acme.test/help/releases',
      sourceRef: 'wa:acme', text: 'Production releases remain blocked.', observedAt: now,
    }] }))

    const opportunities = database.listOpportunities({ scopeId: scope.id })
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].evidenceCount).toBe(2)
    expect(database.getOpportunityEvidence({ id: opportunities[0].id, scopeId: scope.id }).map(item => item.platform).sort())
      .toEqual(['linkedin', 'whatsapp'])
    database.close()
  })

  it('correlates organization subdomains at the registrable domain and respects public suffix boundaries', () => {
    const result = processIntelligence({ scopeId: 'client-a', now, records: [
      {
        platform: 'linkedin', externalId: 'li-acme', canonicalUrl: 'https://jobs.acme.co.uk/openings/1',
        sourceRef: 'li:acme', text: 'Our deployment pipeline is broken.', observedAt: now,
      },
      {
        platform: 'whatsapp', externalId: 'wa-acme', canonicalUrl: 'https://support.acme.co.uk/releases',
        sourceRef: 'wa:acme', text: 'Production releases remain blocked.', observedAt: now,
      },
      {
        platform: 'linkedin', externalId: 'li-other', canonicalUrl: 'https://other.co.uk/status',
        sourceRef: 'li:other', text: 'Invoice reconciliation remains blocked.', observedAt: now,
      },
    ] })

    expect(result.opportunities).toHaveLength(2)
    expect(result.opportunities.find(item => item.evidence.length === 2)?.crossSourceSupport).toBe(1)
  })

  it('does not treat public suffixes, IPs or multi-tenant hosting domains as organizations', () => {
    const result = processIntelligence({ scopeId: 'client-a', now, records: [
      { platform: 'linkedin', externalId: 'suffix-a', canonicalUrl: 'https://co.uk/a', sourceRef: 'li:suffix', text: 'Release automation is broken.', observedAt: now },
      { platform: 'whatsapp', externalId: 'suffix-b', canonicalUrl: 'https://co.uk/b', sourceRef: 'wa:suffix', text: 'Invoice imports are blocked.', observedAt: now },
      { platform: 'linkedin', externalId: 'host-a', canonicalUrl: 'https://acme.github.io/a', sourceRef: 'li:host', text: 'Customer exports are broken.', observedAt: now },
      { platform: 'whatsapp', externalId: 'host-b', canonicalUrl: 'https://other.github.io/b', sourceRef: 'wa:host', text: 'Billing reports are blocked.', observedAt: now },
      { platform: 'linkedin', externalId: 'ip-a', canonicalUrl: 'https://192.0.2.1/a', sourceRef: 'li:ip', text: 'Data ingestion is broken.', observedAt: now },
      { platform: 'whatsapp', externalId: 'ip-b', canonicalUrl: 'https://192.0.2.1/b', sourceRef: 'wa:ip', text: 'Notifications remain blocked.', observedAt: now },
    ] })

    expect(result.opportunities).toHaveLength(6)
    expect(result.opportunities.every(item => item.crossSourceSupport === 0)).toBe(true)
  })

  it('does not correlate unrelated tenants through private public suffix hosting domains', () => {
    const result = processIntelligence({ scopeId: 'client-a', now, records: [
      {
        platform: 'linkedin', externalId: 'web-app-a', canonicalUrl: 'https://tenant-a.web.app/releases',
        sourceRef: 'li:web-app-a', text: 'Release automation is broken.', observedAt: now,
      },
      {
        platform: 'whatsapp', externalId: 'web-app-b', canonicalUrl: 'https://tenant-b.web.app/billing',
        sourceRef: 'wa:web-app-b', text: 'Invoice reconciliation remains blocked.', observedAt: now,
      },
      {
        platform: 'linkedin', externalId: 'appspot-a', canonicalUrl: 'https://tenant-a.appspot.com/imports',
        sourceRef: 'li:appspot-a', text: 'Customer imports are failing.', observedAt: now,
      },
      {
        platform: 'whatsapp', externalId: 'appspot-b', canonicalUrl: 'https://tenant-b.appspot.com/notifications',
        sourceRef: 'wa:appspot-b', text: 'Notifications remain blocked.', observedAt: now,
      },
    ] })

    expect(result.opportunities).toHaveLength(4)
    expect(result.opportunities.every(item => item.organizationDomain === null)).toBe(true)
    expect(result.opportunities.every(item => item.crossSourceSupport === 0)).toBe(true)
  })

  it('does not merge separate private-suffix tenants through legacy cross-run correlation', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-private-suffix-legacy-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'client', externalRef: 'private-hosting', name: 'Private hosting' })
    const legacy = database.upsertOpportunity({
      scopeId: scope.id, fingerprint: 'legacy-private-hosting', category: 'product_opportunity',
      title: 'Legacy tenant signal', summary: 'Legacy tenant signal', score: 55, confidence: 0.6, freshness: now,
    })
    database.recordOpportunityEvidence({
      opportunityId: legacy.id, scopeId: scope.id, evidenceId: 'legacy-private-hosting-evidence', sourceId: null,
      excerpt: 'legacy descriptor', confidence: 0.6, sourceRef: 'https://tenant-a.web.app/releases',
      platform: 'linkedin', observedAt: now,
    })

    const current = processIntelligence({ scopeId: scope.id, now, records: [{
      platform: 'whatsapp', externalId: 'tenant-b', canonicalUrl: 'https://tenant-b.web.app/billing',
      sourceRef: 'wa:tenant-b', text: 'Invoice reconciliation remains blocked.', observedAt: now,
    }] })
    persistIntelligence(database, current)

    const opportunities = database.listOpportunities({ scopeId: scope.id })
    const legacyEvidence = database.getOpportunityEvidence({ id: legacy.id, scopeId: scope.id })
    database.close()
    expect(opportunities).toHaveLength(2)
    expect(legacyEvidence).toHaveLength(1)
  })

  it('merges a new domain-keyed signal into a compatible legacy topic fingerprint across runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-domain-legacy-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'client', externalRef: 'legacy-acme', name: 'Legacy Acme' })
    const legacyFingerprint = createHash('sha256')
      .update(`${scope.id}\u0000product_opportunity\u0000deployment|pipeline`)
      .digest('hex')
    const legacy = database.upsertOpportunity({
      scopeId: scope.id, fingerprint: legacyFingerprint, category: 'product_opportunity',
      title: 'Legacy signal', summary: 'Legacy signal', score: 55, confidence: 0.6, freshness: now,
    })
    database.recordOpportunityEvidence({
      opportunityId: legacy.id, scopeId: scope.id, evidenceId: 'legacy-evidence', sourceId: null,
      excerpt: 'legacy descriptor', confidence: 0.6, sourceRef: 'https://jobs.acme.co.uk/openings/1',
      platform: 'linkedin', observedAt: now,
    })

    const current = processIntelligence({ scopeId: scope.id, now, records: [{
      platform: 'whatsapp', externalId: 'wa-acme', canonicalUrl: 'https://support.acme.co.uk/releases',
      sourceRef: 'wa:acme', text: 'Production releases remain blocked.', observedAt: now,
    }] })
    expect(current.opportunities[0].organizationDomain).toBe('acme.co.uk')
    expect(database.getOpportunityEvidence({ id: legacy.id, scopeId: scope.id })[0].sourceRef).toBe('https://jobs.acme.co.uk/openings/1')
    persistIntelligence(database, current)

    const opportunities = database.listOpportunities({ scopeId: scope.id })
    expect(opportunities).toHaveLength(1)
    expect(opportunities[0].id).toBe(legacy.id)
    expect(database.getOpportunityEvidence({ id: legacy.id, scopeId: scope.id })).toHaveLength(2)
    database.close()
  })

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
    expect(result.metrics.find(metric => metric.platform === 'whatsapp')?.percentile).toBe(0)
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
