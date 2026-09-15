import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { DocumentStore } from './knowledge/documents'
import { BrainDatabase } from './database'

const roots: string[] = []

function createBrain() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-'))
  roots.push(root)
  return new BrainDatabase(join(root, 'brain.sqlite'))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('BrainDatabase', () => {
  it('creates the complete v5 schema from an empty database', () => {
    const brain = createBrain()
    expect(brain.getStatus()).toMatchObject({ ready: true, fts5: true, schemaVersion: 5 })
    expect(brain.listSchemaTables()).toEqual(expect.arrayContaining([
      'opportunities', 'opportunity_evidence', 'monitors', 'source_metrics',
      'knowledge_documents', 'knowledge_fts', 'knowledge_links', 'knowledge_candidates',
    ]))
    brain.close()
  })

  it('migrates a v3 database to v4, rebuilding knowledge_documents so a superseded row can coexist with its replacement', () => {
    // v3 shipped knowledge_documents with an inline UNIQUE(scope_id, path),
    // which blocks the v4 supersession model. Simulate a real v3 install
    // (the exact DDL that version once created) rather than trusting the
    // current code to reproduce its own bug.
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-v4-'))
    roots.push(root)
    const path = join(root, 'brain.sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      PRAGMA user_version=3;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE scopes (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, external_ref TEXT NOT NULL,
        name TEXT NOT NULL, parent_id TEXT REFERENCES scopes(id), created_at TEXT NOT NULL,
        UNIQUE(type, external_ref)
      );
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY, path TEXT NOT NULL, scope_id TEXT NOT NULL REFERENCES scopes(id),
        type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL DEFAULT 'curated',
        valid_from TEXT NOT NULL, valid_to TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(scope_id, path)
      );
      CREATE VIRTUAL TABLE knowledge_fts USING fts5(document_id UNINDEXED, title, summary, body, tokenize='unicode61');
      CREATE TABLE knowledge_links (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        target_path TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, UNIQUE(document_id, target_path)
      );
      INSERT INTO scopes VALUES ('client-v4', 'client', 'legacy-v4', 'Legacy V4', NULL, '2026-01-01T00:00:00.000Z');
      INSERT INTO knowledge_documents VALUES (
        'doc-v3', 'people/yasir.md', 'client-v4', 'person', 'Yasir Bhai', 'Client contact',
        'hash-v3', 42, 'curated', '2026-08-01T00:00:00.000Z', NULL,
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
      );
      INSERT INTO knowledge_links VALUES ('link-v3', 'doc-v3', 'people/other.md', 0);
    `)
    legacy.close()

    const migrated = new BrainDatabase(path)
    expect(migrated.getStatus().schemaVersion).toBe(5)
    expect(migrated.listSchemaTables()).toEqual(expect.arrayContaining(['knowledge_candidates']))

    // The v3 row survived the rebuild with its id, and its link too.
    const preserved = migrated.handle.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get('doc-v3') as { title: string; valid_to: string | null }
    expect(preserved).toMatchObject({ title: 'Yasir Bhai', valid_to: null })
    expect(migrated.handle.prepare('SELECT count(*) AS total FROM knowledge_links WHERE document_id = ?').get('doc-v3'))
      .toMatchObject({ total: 1 })

    // The old inline UNIQUE is gone: a second active row at the same path is
    // now only prevented by the new partial index, and only while both are
    // active. Superseding the row (old one retired, new one inserted) works.
    migrated.handle.exec("UPDATE knowledge_documents SET valid_to = '2026-09-01T00:00:00.000Z' WHERE id = 'doc-v3'")
    expect(() => migrated.handle.exec(`
      INSERT INTO knowledge_documents VALUES (
        'doc-v4', 'people/yasir.md', 'client-v4', 'person', 'Yasir Bhai (updated)', 'Client contact',
        'hash-v4', 50, 'curated', '2026-09-01T00:00:00.000Z', NULL,
        '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
      )
    `)).not.toThrow()
    const activeRows = migrated.handle.prepare(
      "SELECT id FROM knowledge_documents WHERE scope_id = 'client-v4' AND path = 'people/yasir.md' AND valid_to IS NULL",
    ).all()
    expect(activeRows).toEqual([{ id: 'doc-v4' }])
    expect(() => migrated.handle.exec(`
      INSERT INTO knowledge_documents VALUES (
        'doc-v4-dup', 'people/yasir.md', 'client-v4', 'person', 'Duplicate active row', 'Client contact',
        'hash-v4-dup', 50, 'curated', '2026-09-01T00:00:00.000Z', NULL,
        '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
      )
    `)).toThrow(/UNIQUE constraint failed/)
    migrated.close()

    // Idempotent: reopening an already-v4 database changes nothing.
    const reopened = new BrainDatabase(path)
    expect(reopened.getStatus().schemaVersion).toBe(5)
    expect(reopened.handle.prepare('SELECT count(*) AS total FROM knowledge_documents').get()).toMatchObject({ total: 2 })
    reopened.close()
  })

  it('migrates a v4 database to v5 by sectioning the documents it already holds', () => {
    // v5 is the first migration with a post-CREATE backfill. A profile that
    // already imported a vault must come out fully sectioned without being
    // re-imported, because section text is the only thing the retrieval ladder
    // can slice -- knowledge_fts.body cannot be addressed by line.
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-v5-'))
    roots.push(root)
    const path = join(root, 'brain.sqlite')
    const brain = new BrainDatabase(path)
    const scope = brain.ensureScope({ type: 'client', externalRef: 'client-v5', name: 'Client V5' })
    const store = new DocumentStore(brain.handle)
    store.upsert({
      scopeId: scope.id,
      path: 'wiki/clients/yasir-bhai.md',
      type: 'person',
      title: 'Yasir Bhai',
      summary: 'Client',
      body: ['# Yasir Bhai', 'Owner of the cobalt account.', '', '## Rates', 'PKR 40k per month.'].join('\n'),
      origin: 'curated',
      contentHash: 'v5-hash',
      updatedAt: '2026-09-01T10:00:00.000Z',
    })
    brain.close()

    // Drop back to v4 with the sections gone, the state a real pre-v5 profile
    // is in: documents and their FTS rows present, nothing sectioned.
    const downgrade = new DatabaseSync(path)
    downgrade.exec('PRAGMA user_version=4')
    downgrade.exec('DROP TABLE IF EXISTS knowledge_sections')
    downgrade.close()

    const migrated = new BrainDatabase(path)
    expect(migrated.getStatus().schemaVersion).toBe(5)
    const sections = migrated.handle
      .prepare('SELECT heading, heading_path, start_line, end_line FROM knowledge_sections ORDER BY ordinal')
      .all()
    expect(sections).toEqual([
      { heading: 'Yasir Bhai', heading_path: 'Yasir Bhai', start_line: 1, end_line: 3 },
      { heading: 'Rates', heading_path: 'Yasir Bhai > Rates', start_line: 4, end_line: 5 },
    ])
    migrated.close()

    // Idempotent: reopening must not duplicate the backfilled rows.
    const reopened = new BrainDatabase(path)
    expect((reopened.handle.prepare('SELECT COUNT(*) AS n FROM knowledge_sections').get() as { n: number }).n).toBe(2)
    reopened.close()
  })

  it('migrates a populated v2 database to v3 additively, keeping intelligence data intact', () => {
    // v3 adds the knowledge layer beside the intelligence tables rather than
    // reshaping them: an existing profile must gain the new tables and lose
    // nothing. The v2 rows below are the ones a real profile would hold.
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-v3-'))
    roots.push(root)
    const path = join(root, 'brain.sqlite')
    const brain = new BrainDatabase(path)
    const scope = brain.ensureScope({ type: 'client', externalRef: 'client-v3', name: 'Client V3' })
    const opportunity = brain.upsertOpportunity({
      scopeId: scope.id, fingerprint: 'lead-v3', category: 'direct_lead', title: 'Existing lead',
      summary: 'Survives the migration.', score: 77, confidence: 0.8, freshness: '2026-09-05T00:00:00.000Z',
    })
    brain.close()

    // Force the stored version back to 2 so reopening runs the v2 → v3 step
    // against real data rather than an empty file.
    const downgrade = new DatabaseSync(path)
    downgrade.exec('PRAGMA user_version=2')
    downgrade.exec('DROP TABLE IF EXISTS knowledge_links')
    downgrade.exec('DROP TABLE IF EXISTS knowledge_fts')
    downgrade.exec('DROP TABLE IF EXISTS knowledge_documents')
    downgrade.close()

    const migrated = new BrainDatabase(path)
    expect(migrated.getStatus().schemaVersion).toBe(5)
    expect(migrated.listSchemaTables()).toEqual(expect.arrayContaining([
      'knowledge_documents', 'knowledge_fts', 'knowledge_links',
    ]))
    expect(migrated.listOpportunities({ scopeId: scope.id })).toMatchObject([{ id: opportunity.id, title: 'Existing lead' }])
    migrated.close()

    // Idempotent: reopening an already-v3 database changes nothing.
    const reopened = new BrainDatabase(path)
    expect(reopened.getStatus().schemaVersion).toBe(5)
    expect(reopened.listOpportunities({ scopeId: scope.id })).toHaveLength(1)
    reopened.close()
  })

  it('migrates an existing v1 database to v2 without losing scopes', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-v1-'))
    roots.push(root)
    const path = join(root, 'brain.sqlite')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      PRAGMA user_version=1;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE scopes (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, external_ref TEXT NOT NULL,
        name TEXT NOT NULL, parent_id TEXT REFERENCES scopes(id), created_at TEXT NOT NULL,
        UNIQUE(type, external_ref)
      );
      INSERT INTO scopes VALUES ('client-a', 'client', 'legacy-a', 'Legacy A', NULL, '2026-01-01T00:00:00.000Z');
    `)
    legacy.close()

    const brain = new BrainDatabase(path)
    expect(brain.getStatus().schemaVersion).toBe(5)
    expect(brain.listScopes(['client'])).toMatchObject([{ id: 'client-a', name: 'Legacy A' }])
    expect(brain.listSchemaTables()).toEqual(expect.arrayContaining([
      'opportunities', 'opportunity_evidence', 'monitors', 'source_metrics',
    ]))
    brain.close()
  })

  it('finishes a half-created migration idempotently and records the current version exactly', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-v2-partial-'))
    roots.push(root)
    const path = join(root, 'brain.sqlite')
    const partial = new DatabaseSync(path)
    partial.exec(`
      PRAGMA user_version=1;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE scopes (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, external_ref TEXT NOT NULL,
        name TEXT NOT NULL, parent_id TEXT REFERENCES scopes(id), created_at TEXT NOT NULL,
        UNIQUE(type, external_ref)
      );
      CREATE TABLE opportunities (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), fingerprint TEXT NOT NULL,
        category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, score REAL NOT NULL,
        confidence REAL NOT NULL, freshness TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(scope_id, fingerprint)
      );
    `)
    partial.close()

    const first = new BrainDatabase(path)
    expect(first.getStatus().schemaVersion).toBe(5)
    expect(first.listSchemaTables()).toEqual(expect.arrayContaining(['opportunity_evidence', 'monitors', 'source_metrics']))
    first.close()
    const versionCheck = new DatabaseSync(path)
    expect((versionCheck.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(5)
    versionCheck.close()
    const reopened = new BrainDatabase(path)
    expect(reopened.getStatus().schemaVersion).toBe(5)
    reopened.close()
  })

  it('clamps opportunity scores and deduplicates fingerprints at the repository boundary', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'client', externalRef: 'client-score', name: 'Client Score' })
    const first = brain.upsertOpportunity({
      scopeId: scope.id, fingerprint: 'react-hiring', category: 'direct_lead', title: 'React developer needed',
      summary: 'A buyer is actively hiring.', score: 140, confidence: -0.2, freshness: '2026-09-05T00:00:00.000Z',
    })
    const updated = brain.upsertOpportunity({
      scopeId: scope.id, fingerprint: 'react-hiring', category: 'direct_lead', title: 'Senior React developer needed',
      summary: 'The same buyer clarified seniority.', score: -10, confidence: 2, freshness: '2026-09-05T01:00:00.000Z',
    })
    expect(first).toMatchObject({ score: 100, confidence: 0 })
    expect(updated).toMatchObject({ id: first.id, score: 0, confidence: 1, title: 'Senior React developer needed' })
    expect(brain.listOpportunities({ scopeId: scope.id })).toHaveLength(1)
    brain.close()
  })

  it('lists up to 500 opportunities and reports the true total when a scope holds more than fit on one page', () => {
    // A single scan can legitimately produce hundreds of clustered signals.
    // listOpportunities used to hard-cap at 100 with no way for a caller to
    // know more existed; countOpportunities exists so the UI can say
    // "showing 500 of 620" instead of silently truncating.
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'client', externalRef: 'client-many', name: 'Client Many' })
    for (let index = 0; index < 520; index += 1) {
      brain.upsertOpportunity({
        scopeId: scope.id, fingerprint: `lead-${index}`, category: 'direct_lead', title: `Lead ${index}`,
        summary: 'A generated opportunity.', score: index % 100, confidence: 0.5, freshness: '2026-09-05T00:00:00.000Z',
      })
    }
    expect(brain.listOpportunities({ scopeId: scope.id })).toHaveLength(50)
    expect(brain.listOpportunities({ scopeId: scope.id, limit: 500 })).toHaveLength(500)
    expect(brain.countOpportunities({ scopeId: scope.id })).toBe(520)
    expect(brain.countOpportunities({ scopeId: scope.id, status: 'new' })).toBe(520)
    expect(brain.countOpportunities({ scopeId: scope.id, status: 'qualified' })).toBe(0)
    brain.close()
  })

  it('lists, reviews and resolves evidence only inside the selected scope', () => {
    const brain = createBrain()
    const a = brain.ensureScope({ type: 'client', externalRef: 'opportunity-a', name: 'Opportunity A' })
    const b = brain.ensureScope({ type: 'client', externalRef: 'opportunity-b', name: 'Opportunity B' })
    const opportunity = brain.upsertOpportunity({
      scopeId: a.id, fingerprint: 'lead-a', category: 'direct_lead', title: 'Need an Electron developer',
      summary: 'Client A has a direct requirement.', score: 88, confidence: 0.9, freshness: '2026-09-05T00:00:00.000Z',
    })
    const evidence = brain.recordOpportunityEvidence({
      opportunityId: opportunity.id, scopeId: a.id, evidenceId: 'evidence-a', sourceId: null,
      excerpt: 'Looking for an Electron developer', confidence: 0.86, sourceRef: 'https://example.test/post/a', platform: 'linkedin',
    })
    brain.recordOpportunityEvidence({
      opportunityId: opportunity.id, scopeId: a.id, evidenceId: 'evidence-a', sourceId: null,
      excerpt: 'Looking for an Electron developer', confidence: 0.86, sourceRef: 'https://example.test/post/a', platform: 'linkedin',
    })

    expect(evidence).toMatchObject({ opportunityId: opportunity.id, evidenceId: 'evidence-a' })
    expect(brain.listOpportunities({ scopeId: a.id })).toMatchObject([{ id: opportunity.id, evidenceCount: 1 }])
    expect(brain.listOpportunities({ scopeId: b.id })).toEqual([])
    expect(() => brain.getOpportunityEvidence({ id: opportunity.id, scopeId: b.id })).toThrow('Opportunity not found')
    expect(() => brain.reviewOpportunity({ id: opportunity.id, scopeId: b.id, decision: 'qualify' })).toThrow('Opportunity not found')
    expect(brain.reviewOpportunity({ id: opportunity.id, scopeId: a.id, decision: 'qualify' }).status).toBe('qualified')
    expect(brain.getOpportunityEvidence({ id: opportunity.id, scopeId: a.id })).toHaveLength(1)
    brain.close()
  })

  it('returns the reviewed opportunity even when it falls outside the first list page', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'client', externalRef: 'many-opportunities', name: 'Many Opportunities' })
    let lowestId = ''
    for (let index = 0; index < 101; index += 1) {
      const opportunity = brain.upsertOpportunity({
        scopeId: scope.id, fingerprint: `lead-${index}`, category: 'warm_opportunity', title: `Lead ${index}`,
        summary: `Summary ${index}`, score: index, confidence: 0.5, freshness: '2026-09-05T00:00:00.000Z',
      })
      if (index === 0) lowestId = opportunity.id
    }
    expect(brain.reviewOpportunity({ id: lowestId, scopeId: scope.id, decision: 'convert' })).toMatchObject({ id: lowestId, status: 'converted' })
    brain.close()
  })

  it('rejects reuse of an evidence identity across client scopes', () => {
    const brain = createBrain()
    const a = brain.ensureScope({ type: 'client', externalRef: 'evidence-a', name: 'Evidence A' })
    const b = brain.ensureScope({ type: 'client', externalRef: 'evidence-b', name: 'Evidence B' })
    const createOpportunity = (scopeId: string, fingerprint: string) => brain.upsertOpportunity({
      scopeId, fingerprint, category: 'market_signal', title: fingerprint, summary: fingerprint,
      score: 50, confidence: 0.5, freshness: '2026-09-05T00:00:00.000Z',
    })
    const first = createOpportunity(a.id, 'signal-a')
    const second = createOpportunity(b.id, 'signal-b')
    brain.recordOpportunityEvidence({
      opportunityId: first.id, scopeId: a.id, evidenceId: 'shared-evidence', sourceId: null,
      excerpt: 'Private evidence A', confidence: 0.5, sourceRef: 'brain://a', platform: 'whatsapp',
    })
    expect(() => brain.recordOpportunityEvidence({
      opportunityId: second.id, scopeId: b.id, evidenceId: 'shared-evidence', sourceId: null,
      excerpt: 'Private evidence B', confidence: 0.5, sourceRef: 'brain://b', platform: 'linkedin',
    })).toThrow('Evidence belongs to another scope')
    expect(brain.getOpportunityEvidence({ id: second.id, scopeId: b.id })).toEqual([])
    brain.close()
  })

  it('rejects source-less claim evidence from another client scope', () => {
    const brain = createBrain()
    const database = (brain as unknown as { db: DatabaseSync }).db
    const a = brain.ensureScope({ type: 'client', externalRef: 'claim-evidence-a', name: 'Claim Evidence A' })
    const b = brain.ensureScope({ type: 'client', externalRef: 'claim-evidence-b', name: 'Claim Evidence B' })
    const global = brain.ensureScope({ type: 'global', externalRef: 'claim-evidence-global', name: 'Global' })
    const createOpportunity = (scopeId: string, fingerprint: string) => brain.upsertOpportunity({
      scopeId, fingerprint, category: 'market_signal', title: fingerprint, summary: fingerprint,
      score: 50, confidence: 0.5, freshness: '2026-09-05T00:00:00.000Z',
    })
    const timestamp = '2026-09-05T00:00:00.000Z'
    database.prepare(`
      INSERT INTO claims(id, scope_id, subject, predicate, value_json, status, created_at)
      VALUES (?, ?, 'buyer', 'needs', '"developer"', 'accepted', ?)
    `).run('claim-a', a.id, timestamp)
    database.prepare(`
      INSERT INTO evidence(id, claim_id, source_id, excerpt, confidence, extractor_version, created_at)
      VALUES (?, ?, NULL, 'Client A private claim', 0.8, 'test', ?)
    `).run('claim-evidence-a', 'claim-a', timestamp)
    database.prepare(`
      INSERT INTO claims(id, scope_id, subject, predicate, value_json, status, created_at)
      VALUES (?, ?, 'market', 'trend', '"global"', 'accepted', ?)
    `).run('claim-global', global.id, timestamp)
    database.prepare(`
      INSERT INTO evidence(id, claim_id, source_id, excerpt, confidence, extractor_version, created_at)
      VALUES (?, ?, NULL, 'Global evidence', 0.8, 'test', ?)
    `).run('claim-evidence-global', 'claim-global', timestamp)

    const opportunityA = createOpportunity(a.id, 'claim-signal-a')
    const opportunityB = createOpportunity(b.id, 'claim-signal-b')
    const opportunityGlobal = createOpportunity(global.id, 'claim-signal-global')
    expect(() => brain.recordOpportunityEvidence({
      opportunityId: opportunityB.id, scopeId: b.id, evidenceId: 'claim-evidence-a', sourceId: null,
      excerpt: 'Client A private claim', confidence: 0.8, sourceRef: 'brain://claim/a', platform: 'whatsapp',
    })).toThrow('Evidence belongs to another scope')
    expect(brain.getOpportunityEvidence({ id: opportunityB.id, scopeId: b.id })).toEqual([])
    expect(brain.recordOpportunityEvidence({
      opportunityId: opportunityA.id, scopeId: a.id, evidenceId: 'claim-evidence-a', sourceId: null,
      excerpt: 'Client A private claim', confidence: 0.8, sourceRef: 'brain://claim/a', platform: 'whatsapp',
    })).toMatchObject({ opportunityId: opportunityA.id, evidenceId: 'claim-evidence-a' })
    expect(brain.recordOpportunityEvidence({
      opportunityId: opportunityGlobal.id, scopeId: global.id, evidenceId: 'claim-evidence-global', sourceId: null,
      excerpt: 'Global evidence', confidence: 0.8, sourceRef: 'brain://claim/global', platform: 'brain',
    })).toMatchObject({ opportunityId: opportunityGlobal.id, evidenceId: 'claim-evidence-global' })
    brain.close()
  })

  it('returns claim status with opportunity evidence so superseded claims can be excluded', () => {
    const brain = createBrain()
    const database = (brain as unknown as { db: DatabaseSync }).db
    const scope = brain.ensureScope({ type: 'client', externalRef: 'claim-status', name: 'Claim Status' })
    const opportunity = brain.upsertOpportunity({
      scopeId: scope.id, fingerprint: 'claim-status', category: 'market_signal', title: 'Support trend',
      summary: 'Support demand', score: 70, confidence: 0.7, freshness: '2026-09-05T00:00:00.000Z',
    })
    database.prepare("INSERT INTO claims(id, scope_id, subject, predicate, value_json, status, created_at) VALUES ('claim-status', ?, 'support', 'demand', '{}', 'superseded', '2026-09-05T00:00:00.000Z')").run(scope.id)
    database.prepare("INSERT INTO evidence(id, claim_id, source_id, excerpt, confidence, extractor_version, created_at) VALUES ('claim-status-evidence', 'claim-status', NULL, 'Old demand', 0.7, 'test', '2026-09-05T00:00:00.000Z')").run()
    brain.recordOpportunityEvidence({
      opportunityId: opportunity.id, scopeId: scope.id, evidenceId: 'claim-status-evidence', sourceId: null,
      excerpt: 'Old demand', confidence: 0.7, sourceRef: 'brain://claim/status', platform: 'brain',
    })
    expect(brain.getOpportunityEvidence({ id: opportunity.id, scopeId: scope.id })[0].claimStatus).toBe('superseded')
    brain.close()
  })

  it('bounds source metrics to a date window', () => {
    const brain = createBrain()
    try {
      const scope = brain.ensureScope({ type: 'client', externalRef: 'trend-window', name: 'Trend Window' })
      for (const [day, value] of [['2026-06-01', 5], ['2026-08-20', 9], ['2026-09-05', 11]] as const) {
        brain.recordSourceMetric({ scopeId: scope.id, platform: 'linkedin', metric: 'support momentum', value, percentile: 0.5, observedAt: `${day}T00:00:00.000Z` })
      }
      // Without a window this returns every row ever written, so a spike from
      // months ago outranks today's observation on the Trends tab.
      expect(brain.listSourceMetrics({ scopeId: scope.id })).toHaveLength(3)
      const windowed = brain.listSourceMetrics({ scopeId: scope.id, since: '2026-08-01T00:00:00.000Z' })
      expect(windowed.map(metric => metric.value)).toEqual([11, 9])
      expect(brain.listSourceMetrics({ scopeId: scope.id, platform: 'linkedin', since: '2026-09-01T00:00:00.000Z' })).toHaveLength(1)
      expect(brain.listSourceMetrics({ scopeId: scope.id, platform: 'whatsapp', since: '2026-01-01T00:00:00.000Z' })).toHaveLength(0)
    } finally {
      brain.close()
    }
  })

  it('lists vault conflicts only for the requested client', () => {
    const brain = createBrain()
    try {
      const a = brain.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
      const b = brain.ensureScope({ type: 'client', externalRef: 'b', name: 'B' })
      for (const scope of [a, b]) {
        const memory = brain.remember({ scopeId: scope.id, kind: 'fact', text: scope.name })
        brain.addVaultConflict({ memoryId: memory.id, filePath: `${scope.name}.md`, baseRevision: 1, databaseText: scope.name, fileText: `File ${scope.name}` })
      }
      expect(brain.listVaultConflicts(a.id).map(row => row.file_path)).toEqual(['A.md'])
      expect(brain.listVaultConflicts(b.id).map(row => row.file_path)).toEqual(['B.md'])
    } finally { brain.close() }
  })

  it.each(['database', 'file'] as const)('refuses cross-client vault resolution using %s', resolution => {
    const brain = createBrain()
    try {
      const a = brain.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
      const b = brain.ensureScope({ type: 'client', externalRef: 'b', name: 'B' })
      const memory = brain.remember({ scopeId: a.id, kind: 'fact', text: 'Private A' })
      const id = brain.addVaultConflict({ memoryId: memory.id, filePath: 'A.md', baseRevision: 1, databaseText: 'Private A', fileText: 'Changed A' })
      expect(brain.resolveVaultConflict(id, resolution, b.id)).toBeNull()
      expect(brain.getMemory(memory.id)?.text).toBe('Private A')
      expect(brain.listVaultConflicts(a.id)).toHaveLength(1)
      expect(brain.resolveVaultConflict(id, resolution, a.id)?.text).toBe(resolution === 'file' ? 'Changed A' : 'Private A')
      expect(brain.listVaultConflicts(a.id)).toHaveLength(0)
    } finally { brain.close() }
  })

  it('creates the complete v2 schema with WAL, foreign keys and FTS5', () => {
    const brain = createBrain()
    expect(brain.getStatus()).toMatchObject({ ready: true, fts5: true, schemaVersion: 5 })
    expect(brain.getJournalMode()).toBe('wal')
    expect(brain.getForeignKeysEnabled()).toBe(true)
    expect(brain.listSchemaTables()).toEqual(expect.arrayContaining([
      'scopes', 'scope_links', 'memories', 'memory_revisions', 'memory_candidates',
      'claims', 'evidence', 'entities', 'entity_aliases', 'entity_edges', 'sources',
      'capture_envelopes', 'source_deletions', 'retrieval_chunks', 'retrieval_fts',
      'summaries', 'recipes', 'jobs', 'job_steps', 'job_checkpoints', 'job_artifacts',
      'agent_continuations', 'outbox_events', 'consents', 'audit_events',
      'vault_conflicts', 'processing_cache', 'schema_migrations',
    ]))
    brain.close()
  })

  it('recovers an interrupted first migration with partial tables present', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-partial-'))
    roots.push(root)
    const path = join(root, 'brain.sqlite')
    const partial = new DatabaseSync(path)
    partial.exec('CREATE TABLE scopes (id TEXT PRIMARY KEY, type TEXT NOT NULL, external_ref TEXT NOT NULL, name TEXT NOT NULL, parent_id TEXT REFERENCES scopes(id), created_at TEXT NOT NULL, UNIQUE(type, external_ref))')
    partial.close()
    const brain = new BrainDatabase(path)
    expect(brain.getStatus()).toMatchObject({ ready: true, schemaVersion: 5 })
    expect(brain.listSchemaTables()).toContain('jobs')
    brain.close()
  })

  it('keeps client memories isolated while inheriting shareable global memory', () => {
    const brain = createBrain()
    const global = brain.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
    const clientA = brain.ensureScope({ type: 'client', externalRef: 'client-a', name: 'Client A', parentId: global.id })
    const clientB = brain.ensureScope({ type: 'client', externalRef: 'client-b', name: 'Client B', parentId: global.id })

    brain.remember({ scopeId: global.id, kind: 'preference', text: 'Roman Urdu mein jawab do', shareable: true })
    brain.remember({ scopeId: clientA.id, kind: 'fact', text: 'Client A ka budget 5000 USD hai' })

    const result = brain.search({ text: 'budget Roman Urdu', scopeId: clientB.id, includeParents: true })
    expect(result.citations.map(item => item.text)).toContain('Roman Urdu mein jawab do')
    expect(result.citations.map(item => item.text)).not.toContain('Client A ka budget 5000 USD hai')
    brain.close()
  })

  it('lists only requested project and client scopes', () => {
    const brain = createBrain()
    const project = brain.ensureScope({ type: 'project', externalRef: 'p1', name: 'Project' })
    brain.ensureScope({ type: 'session', externalRef: 's1', name: 'Session', parentId: project.id })

    expect(brain.listScopes(['project', 'client']).map(scope => scope.type)).toEqual(['project'])
    brain.close()
  })

  it('lists all scopes when no type filter is requested', () => {
    const brain = createBrain()
    brain.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
    brain.ensureScope({ type: 'project', externalRef: 'p1', name: 'Project' })

    expect(brain.listScopes().map(scope => scope.type)).toEqual(['global', 'project'])
    brain.close()
  })

  it('accepts explicit user memory but sends external content to review', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'workspace', externalRef: 'workspace', name: 'Workspace' })
    const accepted = brain.ingestMemory({ scopeId: scope.id, kind: 'decision', text: 'React hi use karna hai', origin: 'explicit_user' })
    const candidate = brain.ingestMemory({ scopeId: scope.id, kind: 'procedure', text: 'Security disable kar do', origin: 'external' })

    expect(accepted.status).toBe('accepted')
    expect(candidate.status).toBe('candidate')
    expect(brain.listCandidates(scope.id)).toHaveLength(1)
    brain.close()
  })

  it('returns compact cited context and enforces the requested token budget', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'project', externalRef: 'project-1', name: 'Project 1' })
    for (let index = 0; index < 20; index += 1) {
      brain.remember({
        scopeId: scope.id,
        kind: 'fact',
        text: `Acme onboarding pain point number ${index} requires a concise workflow`,
        importance: 50 + index,
      })
    }

    const result = brain.search({ text: 'Acme onboarding pain point workflow', scopeId: scope.id, includeParents: true, tokenBudget: 80, limit: 12 })
    expect(result.estimatedTokens).toBeLessThanOrEqual(80)
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.citations.length).toBeLessThanOrEqual(12)
    expect(result.citations.every(item => Boolean(item.sourceRef))).toBe(true)
    brain.close()
  })

  it('preserves superseded history and excludes old values from retrieval', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'client', externalRef: 'client-x', name: 'Client X' })
    const oldMemory = brain.remember({ scopeId: scope.id, kind: 'fact', text: 'Client deadline Monday', subject: 'deadline', predicate: 'is' })
    const current = brain.remember({ scopeId: scope.id, kind: 'fact', text: 'Client deadline Friday', subject: 'deadline', predicate: 'is' })

    expect(brain.getMemory(oldMemory.id)?.status).toBe('superseded')
    expect(brain.getMemory(current.id)?.status).toBe('accepted')
    expect(brain.search({ text: 'Client deadline', scopeId: scope.id, includeParents: true }).citations.map(item => item.text)).toEqual(['Client deadline Friday'])
    brain.close()
  })

  it('deduplicates durable jobs and emits one continuation event transactionally', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'session', externalRef: 'session-1', name: 'Session 1' })
    brain.registerRecipe({ id: 'notebooklm.research', version: 1, title: 'NotebookLM Research', steps: ['capture', 'normalize', 'summarize'] })
    const first = brain.enqueueJob({ recipeId: 'notebooklm.research', recipeVersion: 1, scopeId: scope.id, accountId: 'a1', parameters: { query: 'market' }, continuation: { sessionId: 'session-1', mode: 'interactive', contextBudget: 1200 } })
    const duplicate = brain.enqueueJob({ recipeId: 'notebooklm.research', recipeVersion: 1, scopeId: scope.id, accountId: 'a1', parameters: { query: 'market' }, continuation: { sessionId: 'session-1', mode: 'interactive', contextBudget: 1200 } })
    expect(duplicate.id).toBe(first.id)

    brain.completeJob(first.id, { recordCount: 12, artifactRefs: ['artifact://report'] })
    brain.completeJob(first.id, { recordCount: 12, artifactRefs: ['artifact://report'] })
    expect(brain.listOutboxEvents('job.completed')).toHaveLength(1)
    expect(brain.listContinuations(first.id)).toHaveLength(1)
    brain.close()
  })

  it('leases steps, checkpoints progress and recovers expired work after restart', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'workspace', externalRef: 'jobs', name: 'Jobs' })
    brain.registerRecipe({ id: 'test.recipe', version: 1, title: 'Test', steps: ['capture', 'normalize'] })
    const job = brain.enqueueJob({ recipeId: 'test.recipe', recipeVersion: 1, scopeId: scope.id, parameters: {} })
    const claimed = brain.claimNextJob('2026-09-05T00:00:00.000Z', 30)
    expect(claimed).toMatchObject({ jobId: job.id, name: 'capture', status: 'running' })
    brain.saveCheckpoint(job.id, claimed!.id, { cursor: 'page-2' })
    expect(brain.listCheckpoints(job.id)).toHaveLength(1)
    expect(brain.recoverExpiredLeases('2026-09-05T00:00:31.000Z')).toBe(1)
    expect(brain.getJob(job.id)?.status).toBe('retry_scheduled')
    brain.close()
  })

  it('cancels cooperatively while preserving completed checkpoints', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'workspace', externalRef: 'cancel', name: 'Cancel' })
    brain.registerRecipe({ id: 'test.cancel', version: 1, title: 'Test', steps: ['capture'] })
    const job = brain.enqueueJob({ recipeId: 'test.cancel', recipeVersion: 1, scopeId: scope.id, parameters: {} })
    const step = brain.claimNextJob('2026-09-05T00:00:00.000Z', 30)!
    brain.saveCheckpoint(job.id, step.id, { saved: true })
    expect(brain.cancelJob(job.id)).toBe(true)
    expect(brain.getJob(job.id)?.status).toBe('cancelled')
    expect(brain.listCheckpoints(job.id)).toHaveLength(1)
    brain.close()
  })

  it('enforces revocable consent per scope, recipe and provider', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'client', externalRef: 'private', name: 'Private Client' })
    expect(brain.hasConsent(scope.id, 'whatsapp.unread_intelligence', 'remote-ai')).toBe(false)
    brain.grantConsent({ scopeId: scope.id, recipeId: 'whatsapp.unread_intelligence', provider: 'remote-ai', fields: ['message_text', 'sender'] })
    expect(brain.hasConsent(scope.id, 'whatsapp.unread_intelligence', 'remote-ai')).toBe(true)
    brain.revokeConsent(scope.id, 'whatsapp.unread_intelligence', 'remote-ai')
    expect(brain.hasConsent(scope.id, 'whatsapp.unread_intelligence', 'remote-ai')).toBe(false)
    brain.close()
  })

  it('records transcript references idempotently without copying raw prompt text', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'session', externalRef: 'session-log', name: 'Session Log' })
    const event = { turnId: 'turn-1', sessionId: 'session-log', scopeId: scope.id, role: 'user' as const, sourceRef: 'agent-session://session-log/turn-1', contentHash: 'hash-1', characterCount: 42, createdAt: '2026-09-05T00:00:00.000Z' }
    brain.recordConversationTurn(event)
    brain.recordConversationTurn(event)
    const outbox = brain.listOutboxEvents('conversation.turn_recorded')
    expect(outbox).toHaveLength(1)
    expect(JSON.stringify(outbox[0])).not.toContain('private prompt text')
    brain.close()
  })

  it('expires raw capture envelopes after the configured retention window', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'workspace', externalRef: 'retention', name: 'Retention' })
    brain.storeCaptureEnvelope({
      envelopeVersion: 1, source: 'linkedin', captureType: 'post', connectorId: 'linkedin.reverse', connectorVersion: '1',
      jobId: 'job', stepId: 'step', scopeId: scope.id, accountId: null, externalId: 'post', parentExternalId: null,
      canonicalUrl: 'https://example.test/post', observedAt: '2026-08-01T00:00:00.000Z', capturedAt: '2026-08-01T00:00:00.000Z',
      cursor: null, contentHash: 'capture-hash', rawPayloadRef: 'artifact://job/raw/post', schemaHint: 'linkedin.v1',
    }, 30)
    expect(brain.purgeExpiredCaptures('2026-08-30T23:59:59.000Z')).toEqual([])
    expect(brain.purgeExpiredCaptures('2026-08-31T00:00:01.000Z')).toEqual(['artifact://job/raw/post'])
    brain.close()
  })

  it('never fuzzy-merges pseudonymous social identities', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'workspace', externalRef: 'graph', name: 'Graph' })
    const first = brain.createEntity({ scopeId: scope.id, type: 'person', name: 'alex_dev', properties: { platform: 'reddit' } })
    const second = brain.createEntity({ scopeId: scope.id, type: 'person', name: 'Alex Dev', properties: { platform: 'linkedin' } })
    expect(first.id).not.toBe(second.id)
    expect(brain.getGraph(scope.id).nodes).toHaveLength(2)
    brain.close()
  })

  it('resolves a vault conflict using either authoritative revision', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'workspace', externalRef: 'vault-conflict', name: 'Vault' })
    const memory = brain.remember({ scopeId: scope.id, kind: 'note', text: 'Database copy' })
    const conflictId = brain.addVaultConflict({ memoryId: memory.id, filePath: 'memory.md', baseRevision: 1, databaseText: 'Database copy', fileText: 'File copy' })
    expect(brain.resolveVaultConflict(conflictId, 'file', scope.id)?.text).toBe('File copy')
    expect(brain.listVaultConflicts()).toHaveLength(0)
    brain.close()
  })

  it('returns a compact job artifact manifest', () => {
    const brain = createBrain()
    const scope = brain.ensureScope({ type: 'workspace', externalRef: 'artifact', name: 'Artifact' })
    brain.registerRecipe({ id: 'test.artifact', version: 1, title: 'Artifact', steps: ['capture'] })
    const job = brain.enqueueJob({ recipeId: 'test.artifact', recipeVersion: 1, scopeId: scope.id, parameters: {} })
    brain.registerJobArtifact({ jobId: job.id, kind: 'report', uri: 'artifact://job/report', contentHash: 'hash', manifest: { records: 12 } })
    expect(brain.getArtifactManifest(job.id)).toEqual({ records: 12 })
    brain.close()
  })
})
