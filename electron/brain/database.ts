import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { splitSections } from './knowledge/sectioning'
import type { BrainEvent, BrainEventAction } from '../../src/types/brainKnowledge'
import {
  MONITOR_DEFAULT_MINIMUM_SCORE,
  MONITOR_MINIMUM_INTERVAL_MINUTES,
  isMonitorableRecipe,
} from './scheduler'
import type {
  AgentContinuation,
  BrainCandidate,
  BrainContextPack,
  BrainJob,
  BrainMemory,
  BrainMonitor,
  BrainOpportunity,
  BrainOpportunityStatus,
  BrainQuery,
  BrainScope,
  BrainScopeType,
  BrainSourceMetric,
  BrainStatus,
  CaptureEnvelope,
  MemoryKind,
  OpportunityCategory,
  OpportunityEvidence,
} from '../../src/types/brain'

/** SQLite schema version (`PRAGMA user_version`), not the backup archive's. */
export const SCHEMA_VERSION = 6

const TABLES = [
  'scopes', 'scope_links', 'memories', 'memory_revisions', 'memory_candidates',
  'claims', 'evidence', 'entities', 'entity_aliases', 'entity_edges', 'sources',
  'capture_envelopes', 'source_deletions', 'retrieval_chunks', 'retrieval_fts',
  'summaries', 'recipes', 'jobs', 'job_steps', 'job_checkpoints', 'job_artifacts',
  'agent_continuations', 'outbox_events', 'consents', 'audit_events',
  'vault_conflicts', 'processing_cache', 'schema_migrations',
  'opportunities', 'opportunity_evidence', 'monitors', 'source_metrics',
  'knowledge_documents', 'knowledge_fts', 'knowledge_links', 'knowledge_candidates',
  'knowledge_sections', 'knowledge_vectors',
] as const

type SqlRow = Record<string, unknown>

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}


const MONITOR_OBSERVATION_PREFIX = 'monitor.observation:'

interface MonitorObservation {
  score: number
  minimumScore: number
  observedAt: string
  notifiedAt: string | null
}

function now() {
  return new Date().toISOString()
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function mapScope(row: SqlRow): BrainScope {
  return {
    id: String(row.id),
    type: String(row.type) as BrainScopeType,
    externalRef: String(row.external_ref),
    name: String(row.name),
    parentId: row.parent_id ? String(row.parent_id) : null,
    createdAt: String(row.created_at),
  }
}

function mapMemory(row: SqlRow): BrainMemory {
  return {
    id: String(row.id),
    scopeId: String(row.scope_id),
    kind: String(row.kind) as MemoryKind,
    text: String(row.text),
    status: String(row.status) as BrainMemory['status'],
    shareable: Number(row.shareable) === 1,
    importance: Number(row.importance),
    subject: row.subject ? String(row.subject) : null,
    predicate: row.predicate ? String(row.predicate) : null,
    sourceRef: String(row.source_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapJob(row: SqlRow): BrainJob {
  return {
    id: String(row.id),
    recipeId: String(row.recipe_id),
    recipeVersion: Number(row.recipe_version),
    scopeId: String(row.scope_id),
    accountId: row.account_id ? String(row.account_id) : null,
    status: String(row.status) as BrainJob['status'],
    parameters: JSON.parse(String(row.parameters_json)) as Record<string, unknown>,
    result: row.result_json ? JSON.parse(String(row.result_json)) as Record<string, unknown> : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapMonitor(row: SqlRow): BrainMonitor {
  return {
    id: String(row.id),
    scopeId: String(row.scope_id),
    recipeId: String(row.recipe_id),
    intervalMinutes: Number(row.interval_minutes),
    minimumScore: Number(row.minimum_score),
    status: String(row.status) as BrainMonitor['status'],
    lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
    nextRunAt: String(row.next_run_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function mapOpportunity(row: SqlRow): BrainOpportunity {
  return {
    id: String(row.id),
    scopeId: String(row.scope_id),
    category: String(row.category) as OpportunityCategory,
    title: String(row.title),
    summary: String(row.summary),
    score: Number(row.score),
    confidence: Number(row.confidence),
    freshness: String(row.freshness),
    status: String(row.status) as BrainOpportunityStatus,
    evidenceCount: Number(row.evidence_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapOpportunityEvidence(row: SqlRow): OpportunityEvidence {
  return {
    opportunityId: String(row.opportunity_id),
    evidenceId: String(row.evidence_id),
    sourceId: row.source_id ? String(row.source_id) : null,
    excerpt: String(row.excerpt),
    confidence: Number(row.confidence),
    sourceRef: String(row.source_ref),
    platform: String(row.platform),
    observedAt: row.observed_at ? String(row.observed_at) : null,
    stale: Number(row.stale) === 1,
    createdAt: String(row.created_at),
    ...(row.claim_status ? { claimStatus: String(row.claim_status) as OpportunityEvidence['claimStatus'] } : {}),
  }
}

export class BrainDatabase {
  private readonly db: DatabaseSync

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    try {
      this.db.exec('PRAGMA journal_mode=WAL')
      // node:sqlite defaults foreign_keys=ON (unlike the sqlite3 CLI/library
      // default of OFF) -- confirmed by DROP TABLE cascade-deleting a
      // referencing row even with no explicit PRAGMA. That's fatal for the
      // v4 migration, which rebuilds knowledge_documents (dropping the old
      // table so the new one can be renamed into its place, since ALTER
      // TABLE can't drop the inline UNIQUE a partial index needs to replace)
      // while knowledge_links still references it: ON DELETE CASCADE would
      // wipe every link row the moment the old table is dropped. So foreign
      // keys stay off for the migration transaction and turn on afterward,
      // for normal runtime operation.
      this.db.exec('PRAGMA foreign_keys=OFF')
      this.migrate()
      this.db.exec('PRAGMA foreign_keys=ON')
    } catch (error) {
      // Opening a file that is not a SQLite database (a truncated or corrupt
      // one inside a backup archive, say) throws here — with the handle already
      // open and now unreachable, which on Windows locks the file for the rest
      // of the process. The probe in `BrainBackupManager.stageArchive` opens
      // exactly such files on purpose, so the failed open closes after itself.
      this.db.close()
      throw error
    }
  }

  private migrate() {
    const current = Number((this.db.prepare('PRAGMA user_version').get() as SqlRow).user_version ?? 0)
    if (current >= SCHEMA_VERSION) return

    // v3 created knowledge_documents with an inline UNIQUE(scope_id, path),
    // which blocks the v4 supersession model (an active row plus a
    // superseded one for the same path). Detected before the transaction
    // starts, because the CREATE TABLE IF NOT EXISTS below is a no-op once
    // the table already exists in its old shape.
    const existingKnowledgeDocumentsDdl = (this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_documents'",
    ).get() as { sql?: string } | undefined)?.sql
    const needsKnowledgeDocumentsRebuild = existingKnowledgeDocumentsDdl?.includes('UNIQUE(scope_id, path)') ?? false

    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (needsKnowledgeDocumentsRebuild) {
        // Renaming the live `knowledge_documents` table would make SQLite
        // rewrite `knowledge_links`' REFERENCES clause to follow it to the
        // new name -- and then dropping the renamed table leaves that clause
        // pointing at nothing. So the replacement table is built and filled
        // under a scratch name first, and swapped into place last: the name
        // `knowledge_links` actually references only ever holds the old
        // table (until this transaction commits) or the new one, never a
        // renamed-away one.
        this.db.exec(`
          CREATE TABLE knowledge_documents_v4 (
            id TEXT PRIMARY KEY, path TEXT NOT NULL, scope_id TEXT NOT NULL REFERENCES scopes(id),
            type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
            content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL DEFAULT 0,
            origin TEXT NOT NULL DEFAULT 'curated',
            valid_from TEXT NOT NULL, valid_to TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
          );
          INSERT INTO knowledge_documents_v4 (
            id, path, scope_id, type, title, summary, content_hash, byte_size,
            origin, valid_from, valid_to, created_at, updated_at
          )
          SELECT
            id, path, scope_id, type, title, summary, content_hash, byte_size,
            origin, valid_from, valid_to, created_at, updated_at
          FROM knowledge_documents;
          DROP TABLE knowledge_documents;
          ALTER TABLE knowledge_documents_v4 RENAME TO knowledge_documents;
        `)
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scopes (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, external_ref TEXT NOT NULL,
          name TEXT NOT NULL, parent_id TEXT REFERENCES scopes(id), created_at TEXT NOT NULL,
          UNIQUE(type, external_ref)
        );
        CREATE TABLE IF NOT EXISTS scope_links (
          parent_scope_id TEXT NOT NULL REFERENCES scopes(id), child_scope_id TEXT NOT NULL REFERENCES scopes(id),
          relation TEXT NOT NULL DEFAULT 'contains', PRIMARY KEY(parent_scope_id, child_scope_id, relation)
        );
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), kind TEXT NOT NULL,
          text TEXT NOT NULL, status TEXT NOT NULL, shareable INTEGER NOT NULL DEFAULT 0,
          importance INTEGER NOT NULL DEFAULT 50, subject TEXT, predicate TEXT, source_ref TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS memory_revisions (
          id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id), revision INTEGER NOT NULL,
          text TEXT NOT NULL, status TEXT NOT NULL, source_ref TEXT NOT NULL, created_at TEXT NOT NULL,
          UNIQUE(memory_id, revision)
        );
        CREATE TABLE IF NOT EXISTS memory_candidates (
          id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), kind TEXT NOT NULL,
          text TEXT NOT NULL, origin TEXT NOT NULL, status TEXT NOT NULL, source_ref TEXT NOT NULL,
          created_at TEXT NOT NULL, decided_at TEXT
        );
        CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), subject TEXT NOT NULL, predicate TEXT NOT NULL, value_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, claim_id TEXT REFERENCES claims(id), source_id TEXT, excerpt TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0, extractor_version TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), type TEXT NOT NULL, name TEXT NOT NULL, properties_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entity_aliases (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), alias TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, UNIQUE(entity_id, alias));
        CREATE TABLE IF NOT EXISTS entity_edges (id TEXT PRIMARY KEY, from_entity_id TEXT NOT NULL REFERENCES entities(id), to_entity_id TEXT NOT NULL REFERENCES entities(id), relation TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0, source_ref TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), platform TEXT NOT NULL, external_id TEXT, canonical_url TEXT, content_hash TEXT NOT NULL, captured_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS capture_envelopes (id TEXT PRIMARY KEY, source_id TEXT REFERENCES sources(id), job_id TEXT, envelope_json TEXT NOT NULL, content_hash TEXT NOT NULL UNIQUE, captured_at TEXT NOT NULL, expires_at TEXT);
        CREATE TABLE IF NOT EXISTS source_deletions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, reason TEXT NOT NULL, deleted_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS retrieval_chunks (id TEXT PRIMARY KEY, memory_id TEXT REFERENCES memories(id), scope_id TEXT NOT NULL REFERENCES scopes(id), text TEXT NOT NULL, source_ref TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_fts USING fts5(chunk_id UNINDEXED, text, tokenize='unicode61');
        CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), level TEXT NOT NULL, source_ref TEXT NOT NULL, text TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS recipes (id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id, version));
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL, recipe_version INTEGER NOT NULL, scope_id TEXT NOT NULL REFERENCES scopes(id), account_id TEXT, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, parameters_json TEXT NOT NULL, result_json TEXT, lease_expires_at TEXT, retry_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS job_steps (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), step_index INTEGER NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_expires_at TEXT, started_at TEXT, completed_at TEXT, error TEXT, UNIQUE(job_id, step_index));
        CREATE TABLE IF NOT EXISTS job_checkpoints (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), step_id TEXT NOT NULL REFERENCES job_steps(id), checkpoint_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS job_artifacts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), kind TEXT NOT NULL, uri TEXT NOT NULL, content_hash TEXT NOT NULL, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_continuations (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), session_id TEXT NOT NULL, provider_session_id TEXT, mode TEXT NOT NULL, context_budget INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(job_id, session_id));
        CREATE TABLE IF NOT EXISTS outbox_events (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, consumed_at TEXT, UNIQUE(aggregate_id, type));
        CREATE TABLE IF NOT EXISTS consents (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), recipe_id TEXT NOT NULL, provider TEXT NOT NULL, fields_json TEXT NOT NULL, granted_at TEXT NOT NULL, revoked_at TEXT, UNIQUE(scope_id, recipe_id, provider));
        -- Also the activity timeline the daily note is built from (S2). The
        -- shape was already right and the table had one writer and no reader,
        -- so a second near-identical events table would have been waste.
        CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, scope_id TEXT, action TEXT NOT NULL, target_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_audit_events_scope_created ON audit_events(scope_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS vault_conflicts (id TEXT PRIMARY KEY, memory_id TEXT REFERENCES memories(id), file_path TEXT NOT NULL, base_revision INTEGER NOT NULL, database_text TEXT NOT NULL, file_text TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
        CREATE TABLE IF NOT EXISTS processing_cache (cache_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT);
        CREATE TABLE IF NOT EXISTS opportunities (
          id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), fingerprint TEXT NOT NULL,
          category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, score REAL NOT NULL,
          confidence REAL NOT NULL, freshness TEXT NOT NULL, status TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(scope_id, fingerprint)
        );
        CREATE TABLE IF NOT EXISTS opportunity_evidence (
          opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
          evidence_id TEXT NOT NULL REFERENCES evidence(id), source_ref TEXT NOT NULL,
          platform TEXT NOT NULL, observed_at TEXT, stale INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, PRIMARY KEY(opportunity_id, evidence_id)
        );
        CREATE TABLE IF NOT EXISTS monitors (
          id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), recipe_id TEXT NOT NULL,
          interval_minutes INTEGER NOT NULL, minimum_score REAL NOT NULL DEFAULT 70, status TEXT NOT NULL,
          last_run_at TEXT, next_run_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_metrics (
          id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id), platform TEXT NOT NULL,
          metric TEXT NOT NULL, value REAL NOT NULL, percentile REAL NOT NULL,
          observed_at TEXT NOT NULL, UNIQUE(scope_id, platform, metric, observed_at)
        );
        CREATE INDEX IF NOT EXISTS idx_memories_scope_status ON memories(scope_id, status);
        CREATE INDEX IF NOT EXISTS idx_candidates_scope_status ON memory_candidates(scope_id, status);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_opportunities_scope_status_score ON opportunities(scope_id, status, score DESC);
        CREATE INDEX IF NOT EXISTS idx_opportunity_evidence_opportunity ON opportunity_evidence(opportunity_id);
        CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitors(status, next_run_at);
        CREATE INDEX IF NOT EXISTS idx_source_metrics_scope_platform ON source_metrics(scope_id, platform, observed_at);

        -- v3: the knowledge layer. Documents are the corpus an agent navigates
        -- by manifest; these tables are a derived index over files on disk, and
        -- the modules in electron/brain/knowledge/ own the SQL against them.
        CREATE TABLE IF NOT EXISTS knowledge_documents (
          id TEXT PRIMARY KEY, path TEXT NOT NULL, scope_id TEXT NOT NULL REFERENCES scopes(id),
          type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
          content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL DEFAULT 0,
          origin TEXT NOT NULL DEFAULT 'curated',
          -- valid_to is how a document is superseded; nothing here is deleted.
          -- Uniqueness on (scope_id, path) is enforced only for the active row
          -- (see the partial index below), so a superseded row can keep the
          -- same path as its replacement.
          valid_from TEXT NOT NULL, valid_to TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(document_id UNINDEXED, title, summary, body, tokenize='unicode61');
        CREATE TABLE IF NOT EXISTS knowledge_links (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          target_path TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
          UNIQUE(document_id, target_path)
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_scope_type ON knowledge_documents(scope_id, type, updated_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_documents_active_path ON knowledge_documents(scope_id, path) WHERE valid_to IS NULL;

        -- v4: the write gate. A proposed document write sits here until a
        -- human accepts (promoting it into knowledge_documents, superseding
        -- any existing active row at the same path) or rejects it. Explicit
        -- user statements skip this table entirely -- see candidates.ts.
        CREATE TABLE IF NOT EXISTS knowledge_candidates (
          id TEXT PRIMARY KEY,
          scope_id TEXT NOT NULL REFERENCES scopes(id),
          target_path TEXT,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          origin TEXT NOT NULL,
          session_ref TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          decided_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_scope_status ON knowledge_candidates(scope_id, status, created_at DESC);

        -- v5: heading-bounded slices of each document, so retrieval can return
        -- the paragraph that answers instead of the whole file. Section text is
        -- materialised here on purpose: document bodies otherwise live only in
        -- knowledge_fts.body, which cannot be sliced by line.
        CREATE TABLE IF NOT EXISTS knowledge_sections (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL,
          level INTEGER NOT NULL,
          heading TEXT NOT NULL,
          heading_path TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          text TEXT NOT NULL,
          UNIQUE(document_id, ordinal)
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_sections_document ON knowledge_sections(document_id, ordinal);

        -- v6: one embedding per document, for meaning-based retrieval. Stored as
        -- a Float32 blob and compared in JS: at this corpus size a brute-force
        -- scan is microseconds, and a vector extension would be a native
        -- dependency and a second index to keep in sync for no measured gain.
        -- The model name is recorded so a model change invalidates rather than
        -- silently mixes incompatible vectors.
        CREATE TABLE IF NOT EXISTS knowledge_vectors (
          document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          model TEXT NOT NULL,
          dims INTEGER NOT NULL,
          vector BLOB NOT NULL,
          created_at TEXT NOT NULL
        );
      `)
      this.backfillKnowledgeSections()
      this.db.prepare('INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, now())
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Fills `knowledge_sections` for documents that predate it.
   *
   * Runs inside `migrate()`'s transaction, after the CREATE block (the table
   * must exist) and before the version stamp (so a failure rolls the whole
   * migration back rather than leaving a half-sectioned store). The first
   * post-CREATE backfill in this file — later ones should follow this shape.
   *
   * Idempotent through the NOT EXISTS guard, which also makes it correct for a
   * store jumping several versions at once. Bodies come from `knowledge_fts`
   * because that is the only place they are stored. Superseded rows are
   * sectioned too, so `document_id` stays a total key.
   */
  private backfillKnowledgeSections() {
    const pending = this.db.prepare(`
      SELECT d.id AS document_id, f.body AS body
      FROM knowledge_documents d
      JOIN knowledge_fts f ON f.document_id = d.id
      WHERE NOT EXISTS (SELECT 1 FROM knowledge_sections s WHERE s.document_id = d.id)
    `).all() as SqlRow[]
    if (pending.length === 0) return

    const insert = this.db.prepare(`
      INSERT INTO knowledge_sections(
        id, document_id, ordinal, level, heading, heading_path, start_line, end_line, text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of pending) {
      const documentId = String(row.document_id)
      for (const section of splitSections(String(row.body ?? ''))) {
        insert.run(
          randomUUID(), documentId, section.ordinal, section.level,
          section.heading, section.headingPath, section.startLine, section.endLine, section.text,
        )
      }
    }
  }

  /**
   * The shared connection, for the knowledge modules only.
   *
   * Those modules own their own SQL rather than adding methods here, so that
   * several of them can be built in parallel without every one editing this
   * file. Everything else must go through a method on this class.
   */
  get handle(): DatabaseSync {
    return this.db
  }

  close() {
    this.db.close()
  }

  checkpoint() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  exportSnapshot(outputPath: string) {
    mkdirSync(dirname(outputPath), { recursive: true })
    this.checkpoint()
    const escaped = outputPath.replaceAll("'", "''")
    this.db.exec(`VACUUM INTO '${escaped}'`)
  }

  getStatus(): BrainStatus {
    try {
      this.db.prepare("SELECT count(*) AS total FROM retrieval_fts WHERE retrieval_fts MATCH 'flowdesk'").get()
      return { ready: true, degraded: false, fts5: true, schemaVersion: SCHEMA_VERSION }
    } catch (error) {
      return { ready: false, degraded: true, fts5: false, schemaVersion: SCHEMA_VERSION, error: error instanceof Error ? error.message : String(error) }
    }
  }

  getJournalMode() {
    return String((this.db.prepare('PRAGMA journal_mode').get() as SqlRow).journal_mode)
  }

  getForeignKeysEnabled() {
    return Number((this.db.prepare('PRAGMA foreign_keys').get() as SqlRow).foreign_keys) === 1
  }

  listSchemaTables() {
    const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as SqlRow[]
    const names = new Set(rows.map(row => String(row.name)))
    return TABLES.filter(table => names.has(table))
  }

  ensureScope(input: { type: BrainScopeType; externalRef: string; name: string; parentId?: string | null }): BrainScope {
    const existing = this.db.prepare('SELECT * FROM scopes WHERE type = ? AND external_ref = ?').get(input.type, input.externalRef) as SqlRow | undefined
    if (existing) return mapScope(existing)
    const id = randomUUID()
    const createdAt = now()
    this.db.prepare('INSERT INTO scopes(id, type, external_ref, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.type, input.externalRef, input.name, input.parentId ?? null, createdAt)
    if (input.parentId) {
      this.db.prepare('INSERT OR IGNORE INTO scope_links(parent_scope_id, child_scope_id, relation) VALUES (?, ?, ?)')
        .run(input.parentId, id, 'contains')
    }
    return { id, type: input.type, externalRef: input.externalRef, name: input.name, parentId: input.parentId ?? null, createdAt }
  }

  listScopes(types?: BrainScopeType[]): BrainScope[] {
    if (!types?.length) {
      return (this.db.prepare('SELECT * FROM scopes ORDER BY created_at, name').all() as SqlRow[]).map(mapScope)
    }
    const placeholders = types.map(() => '?').join(', ')
    return (this.db.prepare(`SELECT * FROM scopes WHERE type IN (${placeholders}) ORDER BY created_at, name`).all(...types) as SqlRow[]).map(mapScope)
  }

  recordSourceMetric(input: Omit<BrainSourceMetric, 'id'>): BrainSourceMetric {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO source_metrics(id, scope_id, platform, metric, value, percentile, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_id, platform, metric, observed_at) DO UPDATE SET
        value = excluded.value, percentile = excluded.percentile
    `).run(id, input.scopeId, input.platform, input.metric, input.value, clamp(input.percentile, 0, 1), input.observedAt)
    const row = this.db.prepare(`
      SELECT * FROM source_metrics WHERE scope_id = ? AND platform = ? AND metric = ? AND observed_at = ?
    `).get(input.scopeId, input.platform, input.metric, input.observedAt) as SqlRow
    return {
      id: String(row.id), scopeId: String(row.scope_id), platform: String(row.platform), metric: String(row.metric),
      value: Number(row.value), percentile: Number(row.percentile), observedAt: String(row.observed_at),
    }
  }

  /**
   * `since` bounds the read to a date window. Without one this returns every
   * observation ever written for the scope, which is what let a months-old
   * spike outrank today's row on the Trends tab. It stays optional because the
   * capture processor reads full history deliberately.
   */
  listSourceMetrics(input: { scopeId: string; platform?: string; since?: string }): BrainSourceMetric[] {
    const since = input.since ?? ''
    const rows = input.platform
      ? (since
          ? this.db.prepare('SELECT * FROM source_metrics WHERE scope_id = ? AND platform = ? AND observed_at >= ? ORDER BY observed_at DESC').all(input.scopeId, input.platform, since)
          : this.db.prepare('SELECT * FROM source_metrics WHERE scope_id = ? AND platform = ? ORDER BY observed_at DESC').all(input.scopeId, input.platform))
      : (since
          ? this.db.prepare('SELECT * FROM source_metrics WHERE scope_id = ? AND observed_at >= ? ORDER BY observed_at DESC').all(input.scopeId, since)
          : this.db.prepare('SELECT * FROM source_metrics WHERE scope_id = ? ORDER BY observed_at DESC').all(input.scopeId))
    return (rows as SqlRow[]).map(row => ({
      id: String(row.id), scopeId: String(row.scope_id), platform: String(row.platform), metric: String(row.metric),
      value: Number(row.value), percentile: Number(row.percentile), observedAt: String(row.observed_at),
    }))
  }

  upsertOpportunity(input: {
    scopeId: string
    fingerprint: string
    category: OpportunityCategory
    title: string
    summary: string
    score: number
    confidence: number
    freshness: string
  }): BrainOpportunity {
    const id = randomUUID()
    const timestamp = now()
    this.db.prepare(`
      INSERT INTO opportunities(
        id, scope_id, fingerprint, category, title, summary, score, confidence,
        freshness, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
      ON CONFLICT(scope_id, fingerprint) DO UPDATE SET
        category = excluded.category,
        title = excluded.title,
        summary = excluded.summary,
        score = excluded.score,
        confidence = excluded.confidence,
        freshness = excluded.freshness,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.scopeId,
      input.fingerprint.trim(),
      input.category,
      input.title.trim(),
      input.summary.trim(),
      clamp(input.score, 0, 100),
      clamp(input.confidence, 0, 1),
      input.freshness,
      timestamp,
      timestamp,
    )
    const opportunity = this.db.prepare(`
      SELECT o.*, (SELECT count(*) FROM opportunity_evidence oe WHERE oe.opportunity_id = o.id) AS evidence_count
      FROM opportunities o WHERE o.scope_id = ? AND o.fingerprint = ?
    `).get(input.scopeId, input.fingerprint.trim()) as SqlRow
    return mapOpportunity(opportunity)
  }

  listOpportunities(input: { scopeId: string; status?: BrainOpportunityStatus; limit?: number }): BrainOpportunity[] {
    // 500, not 100: a single scan can legitimately produce hundreds of
    // clustered signals, and this list had no pagination — anything past the
    // old 100-row ceiling was invisible with no indication more existed.
    // countOpportunities (below) lets the UI say so honestly if a scope ever
    // does exceed this.
    const limit = Math.min(500, Math.max(1, Math.trunc(input.limit ?? 50)))
    const rows = input.status
      ? this.db.prepare(`
        SELECT o.*, (SELECT count(*) FROM opportunity_evidence oe WHERE oe.opportunity_id = o.id) AS evidence_count
        FROM opportunities o WHERE o.scope_id = ? AND o.status = ?
        ORDER BY o.score DESC, o.updated_at DESC LIMIT ?
      `).all(input.scopeId, input.status, limit) as SqlRow[]
      : this.db.prepare(`
        SELECT o.*, (SELECT count(*) FROM opportunity_evidence oe WHERE oe.opportunity_id = o.id) AS evidence_count
        FROM opportunities o WHERE o.scope_id = ?
        ORDER BY o.score DESC, o.updated_at DESC LIMIT ?
      `).all(input.scopeId, limit) as SqlRow[]
    return rows.map(mapOpportunity)
  }

  /** Total opportunities matching the same filter listOpportunities uses, so the UI can say "showing N of TOTAL" instead of silently truncating. */
  countOpportunities(input: { scopeId: string; status?: BrainOpportunityStatus }): number {
    const row = input.status
      ? this.db.prepare('SELECT count(*) AS total FROM opportunities WHERE scope_id = ? AND status = ?').get(input.scopeId, input.status) as SqlRow
      : this.db.prepare('SELECT count(*) AS total FROM opportunities WHERE scope_id = ?').get(input.scopeId) as SqlRow
    return Number(row.total ?? 0)
  }

  getOpportunityByFingerprint(scopeId: string, fingerprint: string): BrainOpportunity | null {
    const row = this.db.prepare(`
      SELECT o.*, (SELECT count(*) FROM opportunity_evidence oe WHERE oe.opportunity_id = o.id) AS evidence_count
      FROM opportunities o WHERE o.scope_id = ? AND o.fingerprint = ?
    `).get(scopeId, fingerprint) as SqlRow | undefined
    return row ? mapOpportunity(row) : null
  }

  listOpportunityCorrelationCandidates(input: { scopeId: string; category: OpportunityCategory }): Array<{ id: string; fingerprint: string }> {
    const rows = this.db.prepare(`
      SELECT id, fingerprint FROM opportunities
      WHERE scope_id = ? AND category = ?
      ORDER BY created_at, id
    `).all(input.scopeId, input.category) as SqlRow[]
    return rows.map(row => ({ id: String(row.id), fingerprint: String(row.fingerprint) }))
  }

  reviewOpportunity(input: { id: string; scopeId: string; decision: 'qualify' | 'dismiss' | 'convert' }): BrainOpportunity {
    const statusByDecision = {
      qualify: 'qualified',
      dismiss: 'dismissed',
      convert: 'converted',
    } as const
    const result = this.db.prepare('UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ? AND scope_id = ?')
      .run(statusByDecision[input.decision], now(), input.id, input.scopeId)
    if (Number(result.changes) !== 1) throw new Error('Opportunity not found')
    const row = this.db.prepare(`
      SELECT o.*, (SELECT count(*) FROM opportunity_evidence oe WHERE oe.opportunity_id = o.id) AS evidence_count
      FROM opportunities o WHERE o.id = ? AND o.scope_id = ?
    `).get(input.id, input.scopeId) as SqlRow
    return mapOpportunity(row)
  }

  recordOpportunityEvidence(input: {
    opportunityId: string
    scopeId: string
    evidenceId: string
    sourceId: string | null
    excerpt: string
    confidence: number
    sourceRef: string
    platform: string
    observedAt?: string | null
    stale?: boolean
    extractorVersion?: string
  }): OpportunityEvidence {
    const opportunity = this.db.prepare('SELECT id FROM opportunities WHERE id = ? AND scope_id = ?')
      .get(input.opportunityId, input.scopeId) as SqlRow | undefined
    if (!opportunity) throw new Error('Opportunity not found')
    const evidenceScope = this.db.prepare(`
      SELECT o.scope_id
      FROM opportunity_evidence oe
      JOIN opportunities o ON o.id = oe.opportunity_id
      WHERE oe.evidence_id = ?
      LIMIT 1
    `).get(input.evidenceId) as SqlRow | undefined
    if (evidenceScope && String(evidenceScope.scope_id) !== input.scopeId) {
      throw new Error('Evidence belongs to another scope')
    }
    const claimScope = this.db.prepare(`
      SELECT c.scope_id
      FROM evidence e
      JOIN claims c ON c.id = e.claim_id
      WHERE e.id = ?
    `).get(input.evidenceId) as SqlRow | undefined
    if (claimScope && String(claimScope.scope_id) !== input.scopeId) {
      throw new Error('Evidence belongs to another scope')
    }
    const sourceScope = this.db.prepare(`
      SELECT s.scope_id
      FROM evidence e
      JOIN sources s ON s.id = e.source_id
      WHERE e.id = ?
    `).get(input.evidenceId) as SqlRow | undefined
    if (sourceScope && String(sourceScope.scope_id) !== input.scopeId) {
      throw new Error('Evidence belongs to another scope')
    }
    if (input.sourceId) {
      const source = this.db.prepare('SELECT id FROM sources WHERE id = ? AND scope_id = ?')
        .get(input.sourceId, input.scopeId) as SqlRow | undefined
      if (!source) throw new Error('Source not found')
    }
    const timestamp = now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO evidence(id, claim_id, source_id, excerpt, confidence, extractor_version, created_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?)
      `).run(
        input.evidenceId,
        input.sourceId,
        input.excerpt.trim(),
        clamp(input.confidence, 0, 1),
        input.extractorVersion ?? 'brain-opportunity-v1',
        timestamp,
      )
      this.db.prepare(`
        INSERT OR IGNORE INTO opportunity_evidence(
          opportunity_id, evidence_id, source_ref, platform, observed_at, stale, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.opportunityId,
        input.evidenceId,
        input.sourceRef,
        input.platform,
        input.observedAt ?? null,
        input.stale ? 1 : 0,
        timestamp,
      )
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getOpportunityEvidence({ id: input.opportunityId, scopeId: input.scopeId })
      .find(item => item.evidenceId === input.evidenceId) as OpportunityEvidence
  }

  getOpportunityEvidence(input: { id: string; scopeId: string }): OpportunityEvidence[] {
    const opportunity = this.db.prepare('SELECT id FROM opportunities WHERE id = ? AND scope_id = ?')
      .get(input.id, input.scopeId) as SqlRow | undefined
    if (!opportunity) throw new Error('Opportunity not found')
    const rows = this.db.prepare(`
      SELECT oe.opportunity_id, oe.evidence_id, e.source_id, e.excerpt, e.confidence,
        oe.source_ref, oe.platform, oe.observed_at, oe.stale, oe.created_at, c.status AS claim_status
      FROM opportunity_evidence oe
      JOIN evidence e ON e.id = oe.evidence_id
      LEFT JOIN claims c ON c.id = e.claim_id
      WHERE oe.opportunity_id = ?
      ORDER BY oe.created_at, oe.evidence_id
    `).all(input.id) as SqlRow[]
    return rows.map(mapOpportunityEvidence)
  }

  remember(input: {
    scopeId: string
    kind: MemoryKind
    text: string
    shareable?: boolean
    importance?: number
    subject?: string
    predicate?: string
    sourceRef?: string
  }): BrainMemory {
    const id = randomUUID()
    const timestamp = now()
    const sourceRef = input.sourceRef ?? `brain://memory/${id}`
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (input.subject && input.predicate) {
        const previous = this.db.prepare("SELECT id FROM memories WHERE scope_id = ? AND subject = ? AND predicate = ? AND status = 'accepted'")
          .all(input.scopeId, input.subject, input.predicate) as SqlRow[]
        for (const row of previous) {
          this.db.prepare("UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?").run(timestamp, String(row.id))
          this.db.prepare("DELETE FROM retrieval_fts WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE memory_id = ?)").run(String(row.id))
        }
      }
      this.db.prepare(`INSERT INTO memories(id, scope_id, kind, text, status, shareable, importance, subject, predicate, source_ref, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.scopeId, input.kind, input.text.trim(), input.shareable ? 1 : 0, input.importance ?? 50, input.subject ?? null, input.predicate ?? null, sourceRef, timestamp, timestamp)
      this.db.prepare("INSERT INTO memory_revisions(id, memory_id, revision, text, status, source_ref, created_at) VALUES (?, ?, 1, ?, 'accepted', ?, ?)")
        .run(randomUUID(), id, input.text.trim(), sourceRef, timestamp)
      const chunkId = randomUUID()
      this.db.prepare('INSERT INTO retrieval_chunks(id, memory_id, scope_id, text, source_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(chunkId, id, input.scopeId, input.text.trim(), sourceRef, timestamp)
      this.db.prepare('INSERT INTO retrieval_fts(chunk_id, text) VALUES (?, ?)').run(chunkId, input.text.trim())
      this.db.prepare("INSERT INTO audit_events(id, scope_id, action, target_id, metadata_json, created_at) VALUES (?, ?, 'memory.accepted', ?, '{}', ?)")
        .run(randomUUID(), input.scopeId, id, timestamp)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getMemory(id) as BrainMemory
  }

  ingestMemory(input: { scopeId: string; kind: MemoryKind; text: string; origin: 'explicit_user' | 'confirmed_user' | 'inferred_user' | 'external' }) {
    if (input.origin === 'explicit_user' || input.origin === 'confirmed_user') return this.remember(input)
    const id = randomUUID()
    const timestamp = now()
    const sourceRef = `brain://candidate/${id}`
    this.db.prepare("INSERT INTO memory_candidates(id, scope_id, kind, text, origin, status, source_ref, created_at) VALUES (?, ?, ?, ?, ?, 'candidate', ?, ?)")
      .run(id, input.scopeId, input.kind, input.text.trim(), input.origin, sourceRef, timestamp)
    return { id, scopeId: input.scopeId, kind: input.kind, text: input.text.trim(), status: 'candidate' as const, origin: input.origin, createdAt: timestamp }
  }

  getMemory(id: string): BrainMemory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as SqlRow | undefined
    return row ? mapMemory(row) : null
  }

  getMemoryRevision(id: string) {
    const row = this.db.prepare('SELECT max(revision) AS revision FROM memory_revisions WHERE memory_id = ?').get(id) as SqlRow
    return Number(row.revision ?? 0)
  }

  reviseMemory(id: string, text: string, sourceRef: string): BrainMemory {
    const memory = this.getMemory(id)
    if (!memory || memory.status === 'deleted') throw new Error('Memory not found')
    const revision = this.getMemoryRevision(id) + 1
    const timestamp = now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE memories SET text = ?, source_ref = ?, updated_at = ? WHERE id = ?').run(text.trim(), sourceRef, timestamp, id)
      this.db.prepare('INSERT INTO memory_revisions(id, memory_id, revision, text, status, source_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, revision, text.trim(), memory.status, sourceRef, timestamp)
      const chunks = this.db.prepare('SELECT id FROM retrieval_chunks WHERE memory_id = ?').all(id) as SqlRow[]
      for (const chunk of chunks) {
        this.db.prepare('DELETE FROM retrieval_fts WHERE chunk_id = ?').run(String(chunk.id))
        this.db.prepare('UPDATE retrieval_chunks SET text = ?, source_ref = ? WHERE id = ?').run(text.trim(), sourceRef, String(chunk.id))
        this.db.prepare('INSERT INTO retrieval_fts(chunk_id, text) VALUES (?, ?)').run(String(chunk.id), text.trim())
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getMemory(id) as BrainMemory
  }

  addVaultConflict(input: { memoryId: string; filePath: string; baseRevision: number; databaseText: string; fileText: string }) {
    const existing = this.db.prepare("SELECT id FROM vault_conflicts WHERE memory_id = ? AND file_path = ? AND status = 'pending'").get(input.memoryId, input.filePath) as SqlRow | undefined
    if (existing) return String(existing.id)
    const id = randomUUID()
    this.db.prepare("INSERT INTO vault_conflicts(id, memory_id, file_path, base_revision, database_text, file_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(id, input.memoryId, input.filePath, input.baseRevision, input.databaseText, input.fileText, now())
    return id
  }

  listVaultConflicts(scopeId?: string) {
    if (scopeId !== undefined) {
      return this.db.prepare("SELECT c.* FROM vault_conflicts c JOIN memories m ON m.id = c.memory_id WHERE c.status = 'pending' AND m.scope_id = ? ORDER BY c.created_at DESC").all(scopeId) as SqlRow[]
    }
    return this.db.prepare("SELECT * FROM vault_conflicts WHERE status = 'pending' ORDER BY created_at DESC").all() as SqlRow[]
  }

  resolveVaultConflict(id: string, resolution: 'database' | 'file', scopeId: string) {
    const conflict = this.db.prepare("SELECT c.* FROM vault_conflicts c JOIN memories m ON m.id = c.memory_id WHERE c.id = ? AND c.status = 'pending' AND m.scope_id = ?").get(id, scopeId) as SqlRow | undefined
    if (!conflict) return null
    const memoryId = String(conflict.memory_id)
    if (resolution === 'file') this.reviseMemory(memoryId, String(conflict.file_text), `vault://${memoryId}`)
    this.db.prepare("UPDATE vault_conflicts SET status = ?, resolved_at = ? WHERE id = ?")
      .run(`resolved_${resolution}`, now(), id)
    return this.getMemory(memoryId)
  }

  grantConsent(input: { scopeId: string; recipeId: string; provider: string; fields: string[] }) {
    const timestamp = now()
    this.db.prepare(`INSERT INTO consents(id, scope_id, recipe_id, provider, fields_json, granted_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(scope_id, recipe_id, provider) DO UPDATE SET fields_json = excluded.fields_json, granted_at = excluded.granted_at, revoked_at = NULL`)
      .run(randomUUID(), input.scopeId, input.recipeId, input.provider, stableJson(input.fields), timestamp)
    return true
  }

  revokeConsent(scopeId: string, recipeId: string, provider: string) {
    const result = this.db.prepare('UPDATE consents SET revoked_at = ? WHERE scope_id = ? AND recipe_id = ? AND provider = ? AND revoked_at IS NULL')
      .run(now(), scopeId, recipeId, provider)
    return Number(result.changes) > 0
  }

  hasConsent(scopeId: string, recipeId: string, provider: string) {
    return Boolean(this.db.prepare('SELECT id FROM consents WHERE scope_id = ? AND recipe_id = ? AND provider = ? AND revoked_at IS NULL')
      .get(scopeId, recipeId, provider))
  }

  createEntity(input: { scopeId: string; type: string; name: string; properties?: Record<string, unknown> }) {
    const id = randomUUID()
    const timestamp = now()
    this.db.prepare('INSERT INTO entities(id, scope_id, type, name, properties_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.scopeId, input.type, input.name, stableJson(input.properties ?? {}), timestamp, timestamp)
    return { id, scopeId: input.scopeId, type: input.type, name: input.name, properties: input.properties ?? {}, createdAt: timestamp, updatedAt: timestamp }
  }

  linkEntities(input: { fromEntityId: string; toEntityId: string; relation: string; confidence: number; sourceRef: string }) {
    const entities = this.db.prepare('SELECT id, scope_id FROM entities WHERE id IN (?, ?)').all(input.fromEntityId, input.toEntityId) as SqlRow[]
    if (entities.length !== 2 || String(entities[0].scope_id) !== String(entities[1].scope_id)) throw new Error('Entity links must remain inside one scope')
    const id = randomUUID()
    this.db.prepare('INSERT INTO entity_edges(id, from_entity_id, to_entity_id, relation, confidence, source_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.fromEntityId, input.toEntityId, input.relation, Math.max(0, Math.min(1, input.confidence)), input.sourceRef, now())
    return id
  }

  listEntities(scopeId: string) {
    return (this.db.prepare('SELECT * FROM entities WHERE scope_id = ? ORDER BY updated_at DESC').all(scopeId) as SqlRow[]).map(row => ({
      id: String(row.id), scopeId: String(row.scope_id), type: String(row.type), name: String(row.name),
      properties: JSON.parse(String(row.properties_json)) as Record<string, unknown>, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
  }

  getGraph(scopeId: string) {
    const nodes = this.listEntities(scopeId)
    if (nodes.length === 0) return { nodes, edges: [] }
    const ids = new Set(nodes.map(node => node.id))
    const edges = (this.db.prepare('SELECT * FROM entity_edges ORDER BY created_at DESC').all() as SqlRow[])
      .filter(row => ids.has(String(row.from_entity_id)) && ids.has(String(row.to_entity_id)))
      .map(row => ({ id: String(row.id), from: String(row.from_entity_id), to: String(row.to_entity_id), relation: String(row.relation), confidence: Number(row.confidence), sourceRef: String(row.source_ref) }))
    return { nodes, edges }
  }

  listMemories(scopeId?: string): BrainMemory[] {
    const rows = scopeId
      ? this.db.prepare("SELECT * FROM memories WHERE scope_id = ? AND status != 'deleted' ORDER BY updated_at DESC").all(scopeId)
      : this.db.prepare("SELECT * FROM memories WHERE status != 'deleted' ORDER BY updated_at DESC").all()
    return (rows as SqlRow[]).map(mapMemory)
  }

  listCandidates(scopeId?: string): BrainCandidate[] {
    const rows = scopeId
      ? this.db.prepare("SELECT * FROM memory_candidates WHERE scope_id = ? AND status = 'candidate' ORDER BY created_at DESC").all(scopeId)
      : this.db.prepare("SELECT * FROM memory_candidates WHERE status = 'candidate' ORDER BY created_at DESC").all()
    return (rows as SqlRow[]).map(row => ({
      id: String(row.id), scopeId: String(row.scope_id), kind: String(row.kind) as MemoryKind,
      text: String(row.text), status: 'candidate', origin: String(row.origin) as BrainCandidate['origin'], createdAt: String(row.created_at),
    }))
  }

  decideCandidate(id: string, decision: 'accept' | 'reject', editedText?: string) {
    const row = this.db.prepare("SELECT * FROM memory_candidates WHERE id = ? AND status = 'candidate'").get(id) as SqlRow | undefined
    if (!row) throw new Error('Memory candidate not found')
    const timestamp = now()
    this.db.prepare('UPDATE memory_candidates SET status = ?, decided_at = ? WHERE id = ?').run(decision === 'accept' ? 'accepted' : 'rejected', timestamp, id)
    if (decision === 'reject') return null
    return this.remember({ scopeId: String(row.scope_id), kind: String(row.kind) as MemoryKind, text: editedText?.trim() || String(row.text), sourceRef: String(row.source_ref) })
  }

  forget(id: string) {
    const memory = this.getMemory(id)
    if (!memory) return false
    const timestamp = now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare("UPDATE memories SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, id)
      this.db.prepare('DELETE FROM retrieval_fts WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE memory_id = ?)').run(id)
      this.db.prepare("INSERT INTO memory_revisions(id, memory_id, revision, text, status, source_ref, created_at) SELECT ?, id, (SELECT count(*) + 1 FROM memory_revisions WHERE memory_id = ?), text, 'deleted', source_ref, ? FROM memories WHERE id = ?")
        .run(randomUUID(), id, timestamp, id)
      this.db.exec('COMMIT')
      return true
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * The scope chain from `scopeId` up to its root ancestor, nearest first.
   * Used both by `search()` below and by `BrainService` to give the
   * knowledge-document store (which has no notion of scope topology of its
   * own) the ordered scope list a "read inherits from ancestors" query needs.
   */
  scopePath(scopeId: string): BrainScope[] {
    const path: BrainScope[] = []
    let currentId: string | null = scopeId
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const row = this.db.prepare('SELECT * FROM scopes WHERE id = ?').get(currentId) as SqlRow | undefined
      if (!row) break
      const scope = mapScope(row)
      path.push(scope)
      currentId = scope.parentId
    }
    return path
  }

  search(query: BrainQuery): BrainContextPack {
    const tokenBudget = Math.max(1, Math.min(query.tokenBudget ?? 1200, 2000))
    const limit = Math.max(1, Math.min(query.limit ?? 12, 12))
    const scopes = this.scopePath(query.scopeId)
    const permitted = query.includeParents ? scopes : scopes.slice(0, 1)
    if (permitted.length === 0) return { summary: '', citations: [], conflicts: [], scopePath: [], estimatedTokens: 0 }
    const tokens = query.text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
    if (tokens.length === 0) return { summary: '', citations: [], conflicts: [], scopePath: permitted.map(scope => scope.id), estimatedTokens: 0 }
    const match = tokens.slice(0, 12).map(token => `"${token.replaceAll('"', '""')}"`).join(' OR ')
    const scopePlaceholders = permitted.map(() => '?').join(', ')
    const kindClause = query.kinds?.length ? ` AND m.kind IN (${query.kinds.map(() => '?').join(', ')})` : ''
    const rows = this.db.prepare(`
      SELECT m.*, bm25(retrieval_fts) AS rank
      FROM retrieval_fts
      JOIN retrieval_chunks c ON c.id = retrieval_fts.chunk_id
      JOIN memories m ON m.id = c.memory_id
      WHERE retrieval_fts MATCH ? AND m.status = 'accepted'
        AND m.scope_id IN (${scopePlaceholders})
        AND (m.scope_id = ? OR m.shareable = 1)
        ${kindClause}
      ORDER BY (bm25(retrieval_fts) - (m.importance / 1000.0)) ASC, m.updated_at DESC
      LIMIT ?
    `).all(match, ...permitted.map(scope => scope.id), query.scopeId, ...(query.kinds ?? []), limit * 3) as SqlRow[]

    const citations: BrainContextPack['citations'] = []
    let usedTokens = 0
    for (const row of rows) {
      const text = String(row.text)
      const estimated = Math.ceil(text.length / 4) + 8
      if (usedTokens + estimated > tokenBudget) continue
      usedTokens += estimated
      citations.push({
        id: `citation-${row.id}`,
        memoryId: String(row.id),
        text,
        kind: String(row.kind) as MemoryKind,
        scopeId: String(row.scope_id),
        sourceRef: String(row.source_ref),
        score: Math.max(0, 1 - Math.abs(Number(row.rank ?? 0))),
      })
      if (citations.length >= limit) break
    }
    return {
      summary: citations.map((item, index) => `[${index + 1}] ${item.text}`).join('\n'),
      citations,
      conflicts: [],
      scopePath: permitted.map(scope => scope.id),
      estimatedTokens: usedTokens,
    }
  }

  registerRecipe(input: { id: string; version: number; title: string; steps: string[] }) {
    this.db.prepare('INSERT OR REPLACE INTO recipes(id, version, title, definition_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.id, input.version, input.title, stableJson(input), now())
  }

  /** The registered-recipe list is the only recipe surface a monitor may target. */
  getLatestRecipeVersion(recipeId: string): number | null {
    const row = this.db.prepare('SELECT max(version) AS version FROM recipes WHERE id = ?').get(recipeId) as SqlRow | undefined
    return row && row.version !== null && row.version !== undefined ? Number(row.version) : null
  }

  enqueueJob(input: {
    recipeId: string
    recipeVersion: number
    scopeId: string
    accountId?: string | null
    parameters: Record<string, unknown>
    continuation?: { sessionId: string; providerSessionId?: string | null; mode: AgentContinuation['mode']; contextBudget: number }
  }): BrainJob {
    const keySource = stableJson({ recipeId: input.recipeId, recipeVersion: input.recipeVersion, scopeId: input.scopeId, accountId: input.accountId ?? null, parameters: input.parameters })
    const idempotencyKey = createHash('sha256').update(keySource).digest('hex')
    const existing = this.db.prepare("SELECT * FROM jobs WHERE idempotency_key = ? AND status NOT IN ('failed', 'cancelled')").get(idempotencyKey) as SqlRow | undefined
    if (existing) return mapJob(existing)
    const id = randomUUID()
    const timestamp = now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare("INSERT INTO jobs(id, recipe_id, recipe_version, scope_id, account_id, status, idempotency_key, parameters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)")
        .run(id, input.recipeId, input.recipeVersion, input.scopeId, input.accountId ?? null, idempotencyKey, stableJson(input.parameters), timestamp, timestamp)
      const recipe = this.db.prepare('SELECT definition_json FROM recipes WHERE id = ? AND version = ?').get(input.recipeId, input.recipeVersion) as SqlRow | undefined
      if (!recipe) throw new Error(`Unknown recipe ${input.recipeId}@${input.recipeVersion}`)
      const steps = (JSON.parse(String(recipe.definition_json)) as { steps: string[] }).steps
      steps.forEach((step, index) => {
        this.db.prepare("INSERT INTO job_steps(id, job_id, step_index, name, status) VALUES (?, ?, ?, ?, 'queued')")
          .run(randomUUID(), id, index, step)
      })
      if (input.continuation) {
        this.db.prepare("INSERT INTO agent_continuations(id, job_id, session_id, provider_session_id, mode, context_budget, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)")
          .run(randomUUID(), id, input.continuation.sessionId, input.continuation.providerSessionId ?? null, input.continuation.mode, input.continuation.contextBudget, timestamp)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getJob(id) as BrainJob
  }

  getJob(id: string): BrainJob | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as SqlRow | undefined
    return row ? mapJob(row) : null
  }

  registerJobArtifact(input: { jobId: string; kind: string; uri: string; contentHash: string; manifest: Record<string, unknown> }) {
    const existing = this.db.prepare('SELECT id FROM job_artifacts WHERE job_id = ? AND uri = ?').get(input.jobId, input.uri) as SqlRow | undefined
    if (existing) return String(existing.id)
    const id = randomUUID()
    this.db.prepare('INSERT INTO job_artifacts(id, job_id, kind, uri, content_hash, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.jobId, input.kind, input.uri, input.contentHash, stableJson(input.manifest), now())
    return id
  }

  getArtifactManifest(jobId: string) {
    const row = this.db.prepare("SELECT manifest_json FROM job_artifacts WHERE job_id = ? ORDER BY (kind = 'intelligence') DESC, created_at DESC LIMIT 1").get(jobId) as SqlRow | undefined
    if (row) return JSON.parse(String(row.manifest_json)) as Record<string, unknown>
    return this.getJob(jobId)?.result ?? null
  }

  listJobs(): BrainJob[] {
    return (this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as SqlRow[]).map(mapJob)
  }

  claimNextJob(at = now(), leaseSeconds = 30, recipeIds?: string[]) {
    const leaseExpiresAt = new Date(new Date(at).getTime() + leaseSeconds * 1000).toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare(`
        SELECT s.*, j.id AS job_id
        FROM jobs j JOIN job_steps s ON s.job_id = j.id
        WHERE j.status IN ('queued', 'retry_scheduled') AND s.status IN ('queued', 'retry_scheduled')
          AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= ?)
          ${recipeIds ? `AND j.recipe_id IN (${recipeIds.map(() => '?').join(',')}) AND j.recipe_version = 1` : ''}
          AND NOT EXISTS (SELECT 1 FROM job_steps earlier WHERE earlier.job_id = j.id AND earlier.step_index < s.step_index AND earlier.status != 'completed')
        ORDER BY j.created_at, s.step_index LIMIT 1
      `).get(at, ...(recipeIds ?? [])) as SqlRow | undefined
      if (!row) {
        this.db.exec('COMMIT')
        return null
      }
      this.db.prepare("UPDATE jobs SET status = 'running', lease_expires_at = ?, updated_at = ? WHERE id = ?")
        .run(leaseExpiresAt, at, String(row.job_id))
      this.db.prepare("UPDATE job_steps SET status = 'running', attempts = attempts + 1, lease_expires_at = ?, started_at = coalesce(started_at, ?) WHERE id = ?")
        .run(leaseExpiresAt, at, String(row.id))
      this.db.exec('COMMIT')
      return {
        id: String(row.id),
        jobId: String(row.job_id),
        name: String(row.name),
        stepIndex: Number(row.step_index),
        attempts: Number(row.attempts) + 1,
        status: 'running' as const,
        leaseExpiresAt,
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  heartbeatJob(jobId: string, stepId: string, at = now(), leaseSeconds = 30) {
    const leaseExpiresAt = new Date(new Date(at).getTime() + leaseSeconds * 1000).toISOString()
    const result = this.db.prepare("UPDATE job_steps SET lease_expires_at = ? WHERE id = ? AND job_id = ? AND status = 'running'")
      .run(leaseExpiresAt, stepId, jobId)
    if (Number(result.changes) === 0) return false
    this.db.prepare("UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(leaseExpiresAt, at, jobId)
    return true
  }

  ownsJobStep(jobId: string, stepId: string, attempts: number, at = now()) {
    return Boolean(this.db.prepare(`SELECT 1 FROM jobs j JOIN job_steps s ON s.job_id = j.id
      WHERE j.id = ? AND s.id = ? AND s.attempts = ? AND j.status = 'running' AND s.status = 'running' AND s.lease_expires_at > ?`)
      .get(jobId, stepId, attempts, at))
  }

  deferJobStep(jobId: string, stepId: string, attempts: number, status: 'retry_scheduled' | 'waiting_for_login' | 'waiting_for_approval', dueAt: string | null, error: string) {
    if (!this.ownsJobStep(jobId, stepId, attempts)) return false
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE job_steps SET status = ?, lease_expires_at = NULL, error = ? WHERE id = ? AND job_id = ?').run(status, error, stepId, jobId)
      this.db.prepare('UPDATE jobs SET status = ?, lease_expires_at = ?, retry_count = retry_count + 1, updated_at = ? WHERE id = ?').run(status, dueAt, now(), jobId)
      this.db.exec('COMMIT')
      return true
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  saveCheckpoint(jobId: string, stepId: string, checkpoint: Record<string, unknown>) {
    const json = stableJson(checkpoint)
    const hash = createHash('sha256').update(json).digest('hex')
    const existing = this.db.prepare('SELECT id FROM job_checkpoints WHERE job_id = ? AND step_id = ? AND content_hash = ?').get(jobId, stepId, hash) as SqlRow | undefined
    if (existing) return String(existing.id)
    const id = randomUUID()
    this.db.prepare('INSERT INTO job_checkpoints(id, job_id, step_id, checkpoint_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, jobId, stepId, json, hash, now())
    return id
  }

  listCheckpoints(jobId: string) {
    return this.db.prepare('SELECT * FROM job_checkpoints WHERE job_id = ? ORDER BY created_at').all(jobId) as SqlRow[]
  }

  getJobStepNames(jobId: string) {
    return (this.db.prepare('SELECT name FROM job_steps WHERE job_id = ? ORDER BY step_index').all(jobId) as SqlRow[]).map(row => String(row.name))
  }

  completeJobStep(jobId: string, stepId: string, checkpoint?: Record<string, unknown>) {
    const timestamp = now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (checkpoint) this.saveCheckpoint(jobId, stepId, checkpoint)
      this.db.prepare("UPDATE job_steps SET status = 'completed', completed_at = ?, lease_expires_at = NULL WHERE id = ? AND job_id = ?").run(timestamp, stepId, jobId)
      const remaining = Number((this.db.prepare("SELECT count(*) AS total FROM job_steps WHERE job_id = ? AND status != 'completed'").get(jobId) as SqlRow).total)
      this.db.prepare(`UPDATE jobs SET status = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?`)
        .run(remaining === 0 ? 'processing' : 'queued', timestamp, jobId)
      this.db.exec('COMMIT')
      return remaining
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  recoverExpiredLeases(at = now()) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const rows = this.db.prepare("SELECT id FROM jobs WHERE status = 'running' AND lease_expires_at < ?").all(at) as SqlRow[]
      for (const row of rows) {
        const jobId = String(row.id)
        this.db.prepare("UPDATE job_steps SET status = 'retry_scheduled', lease_expires_at = NULL WHERE job_id = ? AND status = 'running'").run(jobId)
        this.db.prepare("UPDATE jobs SET status = 'retry_scheduled', lease_expires_at = NULL, retry_count = retry_count + 1, updated_at = ? WHERE id = ?").run(at, jobId)
      }
      this.db.exec('COMMIT')
      return rows.length
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  cancelJob(id: string) {
    const timestamp = now()
    const result = this.db.prepare("UPDATE jobs SET status = 'cancelled', lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')")
      .run(timestamp, id)
    if (Number(result.changes) === 0) return false
    this.db.prepare("UPDATE job_steps SET status = 'cancelled', lease_expires_at = NULL WHERE job_id = ? AND status != 'completed'").run(id)
    this.db.prepare("UPDATE agent_continuations SET status = 'cancelled' WHERE job_id = ? AND status IN ('waiting', 'queued')").run(id)
    return true
  }

  retryJob(id: string) {
    const timestamp = now()
    const result = this.db.prepare("UPDATE jobs SET status = 'retry_scheduled', lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'partially_completed', 'cancelled', 'waiting_for_login', 'waiting_for_approval')")
      .run(timestamp, id)
    if (Number(result.changes) === 0) return false
    this.db.prepare("UPDATE job_steps SET status = 'retry_scheduled', lease_expires_at = NULL, error = NULL WHERE job_id = ? AND status != 'completed'").run(id)
    return true
  }

  failJob(id: string, error: string) {
    const timestamp = now()
    const result = this.db.prepare("UPDATE jobs SET status = 'failed', result_json = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'cancelled')")
      .run(stableJson({ error }), timestamp, id)
    if (Number(result.changes) === 0) return false
    this.db.prepare("UPDATE job_steps SET status = 'failed', lease_expires_at = NULL, error = ? WHERE job_id = ? AND status != 'completed'").run(error, id)
    this.db.prepare("UPDATE agent_continuations SET status = 'cancelled' WHERE job_id = ? AND status = 'waiting'").run(id)
    return true
  }

  completeJob(id: string, result: Record<string, unknown>) {
    const job = this.getJob(id)
    if (!job) throw new Error('Job not found')
    if (job.status === 'completed') return job
    const timestamp = now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare("UPDATE jobs SET status = 'completed', result_json = ?, updated_at = ? WHERE id = ?").run(stableJson(result), timestamp, id)
      this.db.prepare("UPDATE job_steps SET status = 'completed', completed_at = ? WHERE job_id = ? AND status != 'completed'").run(timestamp, id)
      // A monitor run is actionable only on its own terms. The recipe's own
      // `actionable` flag uses a fixed recipe-level bar and knows nothing about
      // what this monitor has already reported, so it is not consulted here.
      const monitorId = typeof job.parameters.monitorId === 'string' ? job.parameters.monitorId : null
      const actionable = monitorId
        ? this.evaluateMonitorActionability(monitorId, timestamp).fingerprints.length > 0
        : result.actionable === true
      this.db.prepare(`UPDATE agent_continuations
        SET status = CASE
          WHEN mode = 'background' THEN 'consumed'
          WHEN mode = 'actionable_only' AND ? = 0 THEN 'consumed'
          ELSE 'queued'
        END
        WHERE job_id = ? AND status = 'waiting'`).run(actionable ? 1 : 0, id)
      this.db.prepare("INSERT OR IGNORE INTO outbox_events(id, aggregate_id, type, payload_json, created_at) VALUES (?, ?, 'job.completed', ?, ?)")
        .run(randomUUID(), id, stableJson({ jobId: id, result }), timestamp)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getJob(id) as BrainJob
  }

  listOutboxEvents(type?: string) {
    const rows = type
      ? this.db.prepare('SELECT * FROM outbox_events WHERE type = ? ORDER BY created_at').all(type)
      : this.db.prepare('SELECT * FROM outbox_events ORDER BY created_at').all()
    return rows as SqlRow[]
  }

  recordConversationTurn(input: {
    turnId: string
    sessionId: string
    scopeId: string
    role: 'user' | 'assistant'
    sourceRef: string
    contentHash: string
    characterCount: number
    createdAt: string
  }) {
    const payload = stableJson({
      turnId: input.turnId,
      sessionId: input.sessionId,
      scopeId: input.scopeId,
      role: input.role,
      sourceRef: input.sourceRef,
      contentHash: input.contentHash,
      characterCount: input.characterCount,
      createdAt: input.createdAt,
    })
    const result = this.db.prepare("INSERT OR IGNORE INTO outbox_events(id, aggregate_id, type, payload_json, created_at) VALUES (?, ?, 'conversation.turn_recorded', ?, ?)")
      .run(randomUUID(), input.turnId, payload, input.createdAt)
    return Number(result.changes) > 0
  }

  /**
   * Appends one activity-timeline row. Never throws into the caller's path --
   * losing a timeline row must not fail an agent turn or an import.
   */
  recordEvent(input: {
    scopeId: string | null
    action: BrainEventAction
    targetId?: string | null
    metadata?: Record<string, unknown>
    createdAt?: string
  }): void {
    try {
      this.db.prepare('INSERT INTO audit_events(id, scope_id, action, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          randomUUID(), input.scopeId, input.action, input.targetId ?? null,
          JSON.stringify(input.metadata ?? {}), input.createdAt ?? now(),
        )
    } catch (error) {
      console.log(`[FlowDesk brain] event not recorded: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Timeline rows for a scope chain within a half-open range [from, to).
   * `memory.accepted` rows predate this table's second use and carry no
   * metadata, so they are excluded rather than rendered as empty lines.
   */
  listEvents(input: { scopeIds: string[]; from: string; to: string; limit?: number }): BrainEvent[] {
    if (input.scopeIds.length === 0) return []
    const placeholders = input.scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT * FROM audit_events
      WHERE scope_id IN (${placeholders}) AND created_at >= ? AND created_at < ?
        AND action IN ('agent.turn', 'tool.action', 'knowledge.accepted', 'knowledge.imported', 'knowledge.compacted', 'job.completed')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(...input.scopeIds, input.from, input.to, Math.min(input.limit ?? 500, 2000)) as SqlRow[]
    return rows.map(row => ({
      id: String(row.id),
      scopeId: row.scope_id === null ? null : String(row.scope_id),
      action: String(row.action) as BrainEventAction,
      targetId: row.target_id === null ? null : String(row.target_id),
      metadata: parseMetadata(row.metadata_json),
      createdAt: String(row.created_at),
    }))
  }

  storeCaptureEnvelope(envelope: CaptureEnvelope, retentionDays = 30) {
    const expiresAt = new Date(new Date(envelope.capturedAt).getTime() + Math.max(1, retentionDays) * 86_400_000).toISOString()
    // The legacy table has a global UNIQUE content_hash. Scope-keying the stored
    // value preserves hard client isolation without changing the provenance hash
    // retained inside the envelope itself.
    const storageHash = createHash('sha256').update(`${envelope.scopeId}\u0000${envelope.contentHash}`).digest('hex')
    const sourceId = randomUUID()
    const envelopeId = randomUUID()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT id FROM capture_envelopes WHERE content_hash = ?').get(storageHash)
      if (existing) {
        this.db.exec('COMMIT')
        return false
      }
      this.db.prepare('INSERT INTO sources(id, scope_id, platform, external_id, canonical_url, content_hash, captured_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sourceId, envelope.scopeId, envelope.source, envelope.externalId, envelope.canonicalUrl, storageHash, envelope.capturedAt, stableJson({ connectorId: envelope.connectorId, connectorVersion: envelope.connectorVersion }))
      this.db.prepare('INSERT INTO capture_envelopes(id, source_id, job_id, envelope_json, content_hash, captured_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(envelopeId, sourceId, envelope.jobId, stableJson(envelope), storageHash, envelope.capturedAt, expiresAt)
      this.db.exec('COMMIT')
      return true
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  findCaptureSource(input: { scopeId: string; jobId: string; platform: string; externalId: string | null; canonicalUrl: string | null }): string | null {
    const row = this.db.prepare(`
      SELECT s.id
      FROM sources s
      JOIN capture_envelopes c ON c.source_id = s.id
      WHERE s.scope_id = ? AND s.platform = ?
        AND ((? IS NOT NULL AND s.external_id = ?) OR (? IS NOT NULL AND s.canonical_url = ?))
      ORDER BY (c.job_id = ?) DESC, c.captured_at DESC
      LIMIT 1
    `).get(
      input.scopeId, input.platform,
      input.externalId, input.externalId, input.canonicalUrl, input.canonicalUrl, input.jobId,
    ) as SqlRow | undefined
    return row ? String(row.id) : null
  }

  purgeExpiredCaptures(at = now()) {
    const rows = this.db.prepare('SELECT id, source_id, envelope_json FROM capture_envelopes WHERE expires_at IS NOT NULL AND expires_at < ?').all(at) as SqlRow[]
    const artifactRefs = rows.map(row => {
      const envelope = JSON.parse(String(row.envelope_json)) as CaptureEnvelope
      return envelope.rawPayloadRef
    })
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        this.db.prepare('DELETE FROM capture_envelopes WHERE id = ?').run(String(row.id))
        this.db.prepare(`
          UPDATE opportunity_evidence SET stale = 1
          WHERE evidence_id IN (SELECT id FROM evidence WHERE source_id = ?)
        `).run(String(row.source_id))
        // Deleting a source invalidates the derived signal that cited it, so an
        // open opportunity goes back for human review rather than continuing to
        // read as a live, fully-sourced lead. `dismissed` and `converted` are a
        // reviewer's durable decisions and are never reopened by retention.
        this.db.prepare(`
          UPDATE opportunities SET status = 'reviewing', updated_at = ?
          WHERE status IN ('new', 'qualified') AND id IN (
            SELECT oe.opportunity_id FROM opportunity_evidence oe
            JOIN evidence e ON e.id = oe.evidence_id
            WHERE e.source_id = ?
          )
        `).run(at, String(row.source_id))
        this.db.prepare('UPDATE evidence SET source_id = NULL WHERE source_id = ?').run(String(row.source_id))
        this.db.prepare('DELETE FROM sources WHERE id = ? AND NOT EXISTS (SELECT 1 FROM capture_envelopes WHERE source_id = ?)').run(String(row.source_id), String(row.source_id))
      }
      this.db.exec('COMMIT')
      return artifactRefs
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listContinuations(jobId?: string): AgentContinuation[] {
    const rows = jobId
      ? this.db.prepare('SELECT * FROM agent_continuations WHERE job_id = ? ORDER BY created_at').all(jobId)
      : this.db.prepare('SELECT * FROM agent_continuations ORDER BY created_at').all()
    return (rows as SqlRow[]).map(row => ({
      id: String(row.id), jobId: String(row.job_id), sessionId: String(row.session_id),
      providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
      mode: String(row.mode) as AgentContinuation['mode'], contextBudget: Number(row.context_budget),
      status: String(row.status) as AgentContinuation['status'],
    }))
  }

  listQueuedContinuations() {
    const rows = this.db.prepare("SELECT * FROM agent_continuations WHERE status = 'queued' ORDER BY created_at").all() as SqlRow[]
    return rows.map(row => ({
      id: String(row.id), jobId: String(row.job_id), sessionId: String(row.session_id),
      providerSessionId: row.provider_session_id ? String(row.provider_session_id) : null,
      mode: String(row.mode) as AgentContinuation['mode'], contextBudget: Number(row.context_budget), status: 'queued' as const,
    }))
  }

  createMonitor(input: { scopeId: string; recipeId: string; intervalMinutes: number; minimumScore?: number; startAt?: string }): BrainMonitor {
    const intervalMinutes = Math.trunc(input.intervalMinutes)
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < MONITOR_MINIMUM_INTERVAL_MINUTES) {
      throw new Error(`Monitor interval must be at least ${MONITOR_MINIMUM_INTERVAL_MINUTES} minutes`)
    }
    // An arbitrary string must never reach enqueueJob: a monitor may only target
    // a recipe that is registered in this database AND actually claimed by the
    // job runner. A monitor on an unclaimed recipe would enqueue a job nothing
    // ever executes — one silently stuck job per interval, forever.
    if (!this.getLatestRecipeVersion(input.recipeId)) throw new Error(`Unknown recipe ${input.recipeId}`)
    if (!isMonitorableRecipe(input.recipeId)) throw new Error(`Recipe ${input.recipeId} cannot be monitored`)
    const createdAt = input.startAt ?? now()
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO monitors(id, scope_id, recipe_id, interval_minutes, minimum_score, status, last_run_at, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?)
    `).run(
      id,
      input.scopeId,
      input.recipeId,
      intervalMinutes,
      clamp(input.minimumScore ?? MONITOR_DEFAULT_MINIMUM_SCORE, 0, 100),
      new Date(Date.parse(createdAt) + intervalMinutes * 60_000).toISOString(),
      createdAt,
      createdAt,
    )
    return this.getMonitor(id) as BrainMonitor
  }

  /**
   * `scopeId` is optional only for the utility's own internal reads (the
   * scheduler already holds the monitor row). Every renderer-reachable caller
   * passes it, so a wrong-scope id reads as not-found rather than as data.
   */
  getMonitor(id: string, scopeId?: string): BrainMonitor | null {
    const row = scopeId
      ? this.db.prepare('SELECT * FROM monitors WHERE id = ? AND scope_id = ?').get(id, scopeId) as SqlRow | undefined
      : this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as SqlRow | undefined
    return row ? mapMonitor(row) : null
  }

  listMonitors(scopeId?: string): BrainMonitor[] {
    const rows = scopeId
      ? this.db.prepare('SELECT * FROM monitors WHERE scope_id = ? ORDER BY created_at').all(scopeId)
      : this.db.prepare('SELECT * FROM monitors ORDER BY created_at').all()
    return (rows as SqlRow[]).map(mapMonitor)
  }

  listDueMonitors(at = now()): BrainMonitor[] {
    const rows = this.db.prepare("SELECT * FROM monitors WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at").all(at) as SqlRow[]
    return rows.map(mapMonitor)
  }

  // Scope-keyed like every opportunity mutation: an id from another scope is
  // not found, never silently applied to that scope's monitor.
  setMonitorStatus(id: string, scopeId: string, status: BrainMonitor['status']): BrainMonitor | null {
    this.db.prepare('UPDATE monitors SET status = ?, updated_at = ? WHERE id = ? AND scope_id = ?').run(status, now(), id, scopeId)
    return this.getMonitor(id, scopeId)
  }

  deleteMonitor(id: string, scopeId: string) {
    const result = this.db.prepare('DELETE FROM monitors WHERE id = ? AND scope_id = ?').run(id, scopeId)
    if (Number(result.changes) === 0) return false
    this.db.prepare('DELETE FROM processing_cache WHERE cache_key LIKE ?').run(`${MONITOR_OBSERVATION_PREFIX}${id}:%`)
    return true
  }

  /**
   * Claims one monitor window by moving `nextRunAt` forward, conditional on the
   * window that is being claimed. A second tick for the same window loses the
   * swap and is told so, which is what keeps one window to one job.
   */
  markMonitorRun(input: { id: string; windowStart: string; lastRunAt: string; nextRunAt: string }) {
    const result = this.db.prepare(`
      UPDATE monitors SET last_run_at = ?, next_run_at = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND next_run_at = ?
    `).run(input.lastRunAt, input.nextRunAt, input.lastRunAt, input.id, input.windowStart)
    return Number(result.changes) > 0
  }

  /**
   * Decides whether a monitor run earns an Agent resume.
   *
   * Actionable means an opportunity in the monitor's scope meets its minimum
   * score AND was not already meeting it at the previous evaluation. The prior
   * state is kept per monitor and per fingerprint, so re-detecting an unchanged
   * signal — however many times the monitor runs — notifies exactly once.
   */
  evaluateMonitorActionability(monitorId: string, at = now()): { fingerprints: string[] } {
    const monitor = this.getMonitor(monitorId)
    if (!monitor) return { fingerprints: [] }
    const fingerprints: string[] = []
    // Scope isolation: only this monitor's own scope is ever considered. The
    // fingerprint is read straight from the ledger because it is deliberately
    // not part of the renderer-facing opportunity shape.
    const signals = this.db.prepare(`
      SELECT fingerprint, score, status FROM opportunities
      WHERE scope_id = ? ORDER BY score DESC, updated_at DESC LIMIT 100
    `).all(monitor.scopeId) as SqlRow[]
    for (const signal of signals) {
      const fingerprint = String(signal.fingerprint)
      const prior = this.readMonitorObservation(monitorId, fingerprint)
      const wasActionable = prior ? prior.score >= prior.minimumScore : false
      // A reviewer's dismissal is durable: a dismissed signal never re-notifies.
      const isActionable = Number(signal.score) >= monitor.minimumScore && !['dismissed', 'converted'].includes(String(signal.status))
      if (isActionable && !wasActionable) fingerprints.push(fingerprint)
      this.writeMonitorObservation(monitorId, fingerprint, {
        score: Number(signal.score),
        minimumScore: monitor.minimumScore,
        observedAt: at,
        notifiedAt: isActionable && !wasActionable ? at : prior?.notifiedAt ?? null,
      })
    }
    return { fingerprints }
  }

  /**
   * The per-fingerprint notification ledger lives in `processing_cache`, the v2
   * schema's durable key/value side table, with no expiry — the monitors feature
   * needs no schema migration of its own and works on every existing v2 database.
   */
  private readMonitorObservation(monitorId: string, fingerprint: string): MonitorObservation | null {
    const row = this.db.prepare('SELECT value_json FROM processing_cache WHERE cache_key = ?')
      .get(`${MONITOR_OBSERVATION_PREFIX}${monitorId}:${fingerprint}`) as SqlRow | undefined
    return row ? JSON.parse(String(row.value_json)) as MonitorObservation : null
  }

  private writeMonitorObservation(monitorId: string, fingerprint: string, observation: MonitorObservation) {
    this.db.prepare('INSERT OR REPLACE INTO processing_cache(cache_key, value_json, created_at, expires_at) VALUES (?, ?, ?, NULL)')
      .run(`${MONITOR_OBSERVATION_PREFIX}${monitorId}:${fingerprint}`, stableJson(observation), observation.observedAt)
  }

  consumeContinuation(id: string) {
    const result = this.db.prepare("UPDATE agent_continuations SET status = 'consumed' WHERE id = ? AND status = 'queued'").run(id)
    return Number(result.changes) > 0
  }
}
