/**
 * Brain v3 operator store (docs/brain-v3-plan.md): what FlowDesk did, for
 * which brand and account, where content went, what was learned, and what
 * background work is waiting. Owns its own `op_*` tables on the shared Brain
 * handle, like the knowledge modules do, so database.ts stays untouched.
 *
 * Facts about the profile, a brand or an account are dated rows in op_facts:
 * changing a value closes the old row (valid_to) instead of overwriting it.
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

type Row = Record<string, unknown>

// Brain has no review queue: what an agent saves is current at once, and the
// agent corrects it by saving again (older values stay in the history).
export type FactStatus = 'accepted' | 'rejected'
export interface Fact { id: string; subject: string; field: string; value: unknown; status: FactStatus; source: string; validFrom: string; validTo: string | null; recordedAt: string }
export interface Brand { id: string; name: string; status: 'active' | 'archived'; fields: Record<string, unknown>; createdAt: string }
export interface Account { platform: string; slotId: string; label: string; lastActionAt: string | null; fields: Record<string, unknown> }
export interface Session { id: string; client: string; startedAt: string; lastSeenAt: string; endedAt: string | null; endReason: string | null; reads: Record<string, number>; writes: number; errors: number; handoff: Handoff | null }
export interface Handoff { summary: string; decisions?: string[]; next?: string; focus?: string }
export interface OpEvent { id: string; at: string; sessionId: string | null; platform: string; account: string | null; tool: string; kind: 'write' | 'read' | 'system'; outcome: 'ok' | 'error'; targetId: string | null; targetUrl: string | null; contentId: string | null; error: string | null; summary: string | null }
export interface ContentItem { id: string; brandId: string | null; kind: string; title: string; stage: ContentStage; ideaSource: string | null; data: Record<string, unknown>; createdAt: string; updatedAt: string }
export type ContentStage = 'idea' | 'made' | 'approved' | 'scheduled' | 'live' | 'measured' | 'dropped'
export interface ContentLink { id: string; contentId: string; at: string; type: string; platform: string | null; account: string | null; externalId: string | null; url: string | null; detail: string | null }
export interface Metric { id: string; at: string; platform: string; account: string | null; externalId: string; contentId: string | null; metrics: Record<string, number> }
export interface Learning { id: string; statement: string; scope: string | null; evidence: unknown[]; confidence: number; status: 'active' | 'retired'; createdAt: string; decidedAt: string | null }
export interface Task { id: string; title: string; brandId: string | null; platform: string | null; account: string | null; dueAt: string | null; state: 'open' | 'waiting' | 'done' | 'cancelled'; waitingOn: string | null; source: string; externalId: string | null; contentId: string | null; notes: string | null; createdAt: string; updatedAt: string }
export interface Contact { id: string; platform: string; name: string; stage: string; lastContactAt: string | null; nextStep: string | null; notes: string | null; updatedAt: string }
export interface Idea { id: string; text: string; source: string | null; score: number | null; brandId: string | null; status: 'new' | 'used' | 'dropped'; createdAt: string }
export interface InboxItem { id: string; at: string; kind: string; title: string; body: string; refId: string | null; needsAgent: boolean; status: 'new' | 'taken' | 'done'; takenBy: string | null; packet: unknown; updatedAt: string }
export interface Job { id: string; recipe: string; params: Record<string, unknown>; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; progress: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; resultPath: string | null; summary: string | null; error: string | null; sessionId: string | null; monitorId: string | null }
export interface Monitor { id: string; recipe: string; params: Record<string, unknown>; everyMinutes: number; status: 'active' | 'paused'; lastRunAt: string | null; nextRunAt: string; createdAt: string }
export interface LogEntry { id: string; at: string; type: string; title: string; body: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS op_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS op_facts (id TEXT PRIMARY KEY, subject TEXT NOT NULL, field TEXT NOT NULL, value_json TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, recorded_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS op_facts_subject ON op_facts(subject, field, valid_to);
CREATE TABLE IF NOT EXISTS op_brands (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS op_accounts (platform TEXT NOT NULL, slot_id TEXT NOT NULL, label TEXT NOT NULL, last_action_at TEXT, PRIMARY KEY (platform, slot_id));
CREATE TABLE IF NOT EXISTS op_sessions (id TEXT PRIMARY KEY, client TEXT NOT NULL, started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT, reads_json TEXT NOT NULL DEFAULT '{}', writes INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, handoff_json TEXT, started_brief INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS op_events (id TEXT PRIMARY KEY, at TEXT NOT NULL, session_id TEXT, platform TEXT NOT NULL, account TEXT, tool TEXT NOT NULL, kind TEXT NOT NULL, outcome TEXT NOT NULL, target_id TEXT, target_url TEXT, content_id TEXT, error TEXT, summary TEXT);
CREATE INDEX IF NOT EXISTS op_events_at ON op_events(at);
CREATE INDEX IF NOT EXISTS op_events_account ON op_events(platform, account, at);
CREATE TABLE IF NOT EXISTS op_content (id TEXT PRIMARY KEY, brand_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, stage TEXT NOT NULL, idea_source TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS op_content_links (id TEXT PRIMARY KEY, content_id TEXT NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, platform TEXT, account TEXT, external_id TEXT, url TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS op_content_links_content ON op_content_links(content_id, at);
CREATE INDEX IF NOT EXISTS op_content_links_external ON op_content_links(platform, external_id);
CREATE TABLE IF NOT EXISTS op_metrics (id TEXT PRIMARY KEY, at TEXT NOT NULL, platform TEXT NOT NULL, account TEXT, external_id TEXT NOT NULL, content_id TEXT, metrics_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS op_metrics_external ON op_metrics(platform, external_id, at);
CREATE TABLE IF NOT EXISTS op_learnings (id TEXT PRIMARY KEY, statement TEXT NOT NULL, scope TEXT, evidence_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 0.5, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS op_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, brand_id TEXT, platform TEXT, account TEXT, due_at TEXT, state TEXT NOT NULL, waiting_on TEXT, source TEXT NOT NULL, external_id TEXT, content_id TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS op_tasks_external ON op_tasks(source, platform, external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS op_contacts (id TEXT PRIMARY KEY, platform TEXT NOT NULL, name TEXT NOT NULL, stage TEXT NOT NULL, last_contact_at TEXT, next_step TEXT, notes TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS op_ideas (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT, score REAL, brand_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS op_inbox (id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, ref_id TEXT, needs_agent INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, taken_by TEXT, packet_json TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS op_jobs (id TEXT PRIMARY KEY, recipe TEXT NOT NULL, params_json TEXT NOT NULL, status TEXT NOT NULL, progress TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, result_path TEXT, summary TEXT, error TEXT, session_id TEXT, monitor_id TEXT);
CREATE TABLE IF NOT EXISTS op_monitors (id TEXT PRIMARY KEY, recipe TEXT NOT NULL, params_json TEXT NOT NULL, every_minutes INTEGER NOT NULL, status TEXT NOT NULL, last_run_at TEXT, next_run_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS op_log (id TEXT PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS op_log_at ON op_log(at);
`

const json = (v: unknown) => JSON.stringify(v ?? null)
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback
  try { return JSON.parse(v) as T } catch { return fallback }
}
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item'

export class OperatorStore {
  constructor(private readonly db: DatabaseSync, private readonly clock: () => Date = () => new Date()) {
    db.exec(SCHEMA)
    this.dropReviewQueue()
  }

  /** Data from the old propose → accept flow becomes current; rejected learnings are retired. */
  private dropReviewQueue(): void {
    this.db.exec("UPDATE op_brands SET status = 'active' WHERE status = 'proposed'")
    this.db.exec("UPDATE op_learnings SET status = 'active' WHERE status IN ('proposed', 'accepted')")
    this.db.exec("UPDATE op_learnings SET status = 'retired' WHERE status = 'rejected'")
    const pending = this.db.prepare("SELECT * FROM op_facts WHERE status = 'proposed' ORDER BY recorded_at").all() as Row[]
    for (const row of pending) {
      const fact = mapFact(row)
      this.db.prepare('DELETE FROM op_facts WHERE id = ?').run(fact.id)
      this.setFact({ subject: fact.subject, field: fact.field, value: fact.value, source: fact.source })
    }
  }

  now(): string { return this.clock().toISOString() }

  // ── meta ────────────────────────────────────────────────────────────────
  getMeta<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM op_meta WHERE key = ?').get(key) as Row | undefined
    return row ? parse<T>(row.value, fallback) : fallback
  }

  setMeta(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO op_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, json(value))
  }

  // ── dated facts ─────────────────────────────────────────────────────────
  /**
   * Sets subject.field: the new value closes the current row, which stays in
   * the history. Setting the same value again is a no-op.
   */
  setFact(input: { subject: string; field: string; value: unknown; source?: string }): Fact {
    const at = this.now()
    const current = this.currentFact(input.subject, input.field)
    if (current && json(current.value) === json(input.value)) return current
    if (current) this.db.prepare('UPDATE op_facts SET valid_to = ? WHERE id = ?').run(at, current.id)
    const id = randomUUID()
    this.db.prepare("INSERT INTO op_facts(id, subject, field, value_json, status, source, valid_from, valid_to, recorded_at) VALUES (?, ?, ?, ?, 'accepted', ?, ?, NULL, ?)")
      .run(id, input.subject, input.field, json(input.value), input.source ?? 'agent', at, at)
    return this.getFact(id)!
  }

  /** Ends subject.field without a new value (the agent found it wrong or stale). */
  clearFact(subject: string, field: string): boolean {
    const current = this.currentFact(subject, field)
    if (!current) return false
    this.db.prepare('UPDATE op_facts SET valid_to = ? WHERE id = ?').run(this.now(), current.id)
    return true
  }

  getFact(id: string): Fact | null {
    const row = this.db.prepare('SELECT * FROM op_facts WHERE id = ?').get(id) as Row | undefined
    return row ? mapFact(row) : null
  }

  currentFact(subject: string, field: string): Fact | null {
    const row = this.db.prepare("SELECT * FROM op_facts WHERE subject = ? AND field = ? AND status = 'accepted' AND valid_to IS NULL ORDER BY recorded_at DESC LIMIT 1")
      .get(subject, field) as Row | undefined
    return row ? mapFact(row) : null
  }

  /** Current accepted value of every field of a subject. */
  fields(subject: string): Record<string, unknown> {
    const rows = this.db.prepare("SELECT field, value_json FROM op_facts WHERE subject = ? AND status = 'accepted' AND valid_to IS NULL ORDER BY recorded_at").all(subject) as Row[]
    return Object.fromEntries(rows.map(r => [String(r.field), parse(r.value_json, null)]))
  }

  history(subject: string, field?: string): Fact[] {
    const rows = field
      ? this.db.prepare('SELECT * FROM op_facts WHERE subject = ? AND field = ? ORDER BY recorded_at').all(subject, field) as Row[]
      : this.db.prepare('SELECT * FROM op_facts WHERE subject = ? ORDER BY field, recorded_at').all(subject) as Row[]
    return rows.map(mapFact)
  }

  // ── brands ──────────────────────────────────────────────────────────────
  upsertBrand(input: { id?: string; name: string; status?: Brand['status']; fields?: Record<string, unknown>; source?: string }): Brand {
    const id = input.id ? slug(input.id) : slug(input.name)
    const existing = this.db.prepare('SELECT * FROM op_brands WHERE id = ?').get(id) as Row | undefined
    if (!existing) {
      this.db.prepare('INSERT INTO op_brands(id, name, status, created_at) VALUES (?, ?, ?, ?)').run(id, input.name, input.status ?? 'active', this.now())
    } else {
      this.db.prepare('UPDATE op_brands SET name = ?, status = COALESCE(?, status) WHERE id = ?').run(input.name, input.status ?? null, id)
    }
    for (const [field, value] of Object.entries(input.fields ?? {})) {
      this.setFact({ subject: `brand:${id}`, field, value, source: input.source })
    }
    return this.getBrand(id)!
  }

  getBrand(id: string): Brand | null {
    const row = this.db.prepare('SELECT * FROM op_brands WHERE id = ?').get(id) as Row | undefined
    return row ? { id: String(row.id), name: String(row.name), status: row.status as Brand['status'], createdAt: String(row.created_at), fields: this.fields(`brand:${row.id}`) } : null
  }

  listBrands(includeArchived = false): Brand[] {
    const rows = this.db.prepare(`SELECT id FROM op_brands ${includeArchived ? '' : "WHERE status != 'archived'"} ORDER BY status, name`).all() as Row[]
    return rows.map(r => this.getBrand(String(r.id))!)
  }

  // ── accounts ────────────────────────────────────────────────────────────
  /** Mirrors the social registry; never removes an account (history stays). */
  syncAccounts(accounts: Array<{ platform: string; slotId: string; label: string }>): number {
    const stmt = this.db.prepare('INSERT INTO op_accounts(platform, slot_id, label) VALUES (?, ?, ?) ON CONFLICT(platform, slot_id) DO UPDATE SET label = excluded.label')
    for (const a of accounts) stmt.run(a.platform, a.slotId, a.label)
    return accounts.length
  }

  accountSubject(platform: string, slotId: string) { return `account:${platform}:${slotId}` }

  listAccounts(filter: { platform?: string; brandId?: string } = {}): Account[] {
    const rows = (filter.platform
      ? this.db.prepare('SELECT * FROM op_accounts WHERE platform = ? ORDER BY platform, slot_id').all(filter.platform)
      : this.db.prepare('SELECT * FROM op_accounts ORDER BY platform, slot_id').all()) as Row[]
    const out = rows.map(r => ({
      platform: String(r.platform), slotId: String(r.slot_id), label: String(r.label), lastActionAt: str(r.last_action_at),
      fields: this.fields(this.accountSubject(String(r.platform), String(r.slot_id))),
    }))
    return filter.brandId ? out.filter(a => a.fields.brand === filter.brandId) : out
  }

  /** Finds an account by slot id, label or "Account N" text the tools accept. */
  resolveAccount(platform: string, ref: string | null | undefined): Account | null {
    const all = this.listAccounts({ platform })
    if (!ref) return all.length === 1 ? all[0] : null
    const r = ref.toLowerCase()
    return all.find(a => a.slotId.toLowerCase() === r || a.label.toLowerCase() === r) ?? null
  }

  // ── sessions + ledger ───────────────────────────────────────────────────
  touchSession(id: string, client: string): Session {
    const at = this.now()
    this.db.prepare(`INSERT INTO op_sessions(id, client, started_at, last_seen_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, ended_at = NULL, end_reason = NULL`).run(id, client || 'unknown', at, at)
    return this.getSession(id)!
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM op_sessions WHERE id = ?').get(id) as Row | undefined
    return row ? mapSession(row) : null
  }

  markSessionBriefed(id: string): void {
    this.db.prepare('UPDATE op_sessions SET started_brief = 1 WHERE id = ?').run(id)
  }

  sessionBriefed(id: string): boolean {
    const row = this.db.prepare('SELECT started_brief FROM op_sessions WHERE id = ?').get(id) as Row | undefined
    return Number(row?.started_brief ?? 0) === 1
  }

  listSessions(limit = 30): Session[] {
    return (this.db.prepare('SELECT * FROM op_sessions ORDER BY started_at DESC LIMIT ?').all(limit) as Row[]).map(mapSession)
  }

  recordEvent(input: { sessionId?: string | null; client?: string; platform: string; account?: string | null; tool: string; kind: OpEvent['kind']; outcome: OpEvent['outcome']; targetId?: string | null; targetUrl?: string | null; contentId?: string | null; error?: string | null; summary?: string | null; assets?: string[] }): OpEvent | null {
    const at = this.now()
    if (input.sessionId) {
      this.touchSession(input.sessionId, input.client ?? 'unknown')
      if (input.kind === 'read') {
        const s = this.getSession(input.sessionId)!
        const reads = { ...s.reads, [input.tool]: (s.reads[input.tool] ?? 0) + 1 }
        this.db.prepare('UPDATE op_sessions SET reads_json = ?, errors = errors + ? WHERE id = ?').run(json(reads), input.outcome === 'error' ? 1 : 0, input.sessionId)
      } else if (input.kind === 'write') {
        this.db.prepare('UPDATE op_sessions SET writes = writes + 1, errors = errors + ? WHERE id = ?').run(input.outcome === 'error' ? 1 : 0, input.sessionId)
      }
    }
    // Reads only count toward the session; a failed read is still worth a row.
    if (input.kind === 'read' && input.outcome === 'ok') return null
    const id = randomUUID()
    this.db.prepare(`INSERT INTO op_events(id, at, session_id, platform, account, tool, kind, outcome, target_id, target_url, content_id, error, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, at, input.sessionId ?? null, input.platform, input.account ?? null, input.tool, input.kind,
      input.outcome, input.targetId ?? null, input.targetUrl ?? null, input.contentId ?? null, input.error ?? null, input.summary ?? null)
    if (input.kind === 'write' && input.outcome === 'ok' && input.account) {
      this.db.prepare('UPDATE op_accounts SET last_action_at = ? WHERE platform = ? AND (slot_id = ? OR label = ?)').run(at, input.platform, input.account, input.account)
    }
    // A generation tool's files are the item's assets: the idea is now made.
    if (input.contentId && input.kind === 'write' && input.outcome === 'ok' && input.assets?.length) {
      for (const url of input.assets) this.linkContent({ contentId: input.contentId, type: 'asset', platform: input.platform, url, detail: input.tool })
      this.db.prepare("UPDATE op_content SET stage = 'made' WHERE id = ? AND stage = 'idea'").run(input.contentId)
    }
    if (input.contentId && input.kind === 'write' && input.outcome === 'ok' && (input.targetId || input.targetUrl)) {
      this.linkContent({ contentId: input.contentId, type: 'placement', platform: input.platform, account: input.account ?? null, externalId: input.targetId ?? null, url: input.targetUrl ?? null, detail: input.tool })
    }
    return this.getEvent(id)
  }

  getEvent(id: string): OpEvent | null {
    const row = this.db.prepare('SELECT * FROM op_events WHERE id = ?').get(id) as Row | undefined
    return row ? mapEvent(row) : null
  }

  listEvents(filter: { platform?: string; account?: string; since?: string; until?: string; sessionId?: string; contentId?: string; accounts?: Array<{ platform: string; slotId: string; label: string }>; limit?: number } = {}): OpEvent[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.platform) { where.push('platform = ?'); args.push(filter.platform) }
    if (filter.account) { where.push('account = ?'); args.push(filter.account) }
    if (filter.accounts) {
      if (!filter.accounts.length) return []
      where.push(`(${filter.accounts.map(() => '(platform = ? AND (account = ? OR account = ?))').join(' OR ')})`)
      for (const a of filter.accounts) args.push(a.platform, a.slotId, a.label)
    }
    if (filter.since) { where.push('at >= ?'); args.push(filter.since) }
    if (filter.until) { where.push('at < ?'); args.push(filter.until) }
    if (filter.sessionId) { where.push('session_id = ?'); args.push(filter.sessionId) }
    if (filter.contentId) { where.push('content_id = ?'); args.push(filter.contentId) }
    args.push(Math.min(filter.limit ?? 200, 2000))
    const sql = `SELECT * FROM op_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`
    return (this.db.prepare(sql).all(...args) as Row[]).map(mapEvent)
  }

  /** Ends a session; returns the session only the first time it ends. */
  endSession(id: string, reason: 'wrap' | 'exit' | 'idle', handoff?: Handoff): Session | null {
    const s = this.getSession(id)
    if (!s) return null
    if (handoff) this.db.prepare('UPDATE op_sessions SET handoff_json = ? WHERE id = ?').run(json(handoff), id)
    if (s.endedAt) return null
    this.db.prepare('UPDATE op_sessions SET ended_at = ?, end_reason = ? WHERE id = ?').run(this.now(), reason, id)
    return this.getSession(id)
  }

  idleSessions(olderThan: string): Session[] {
    return (this.db.prepare('SELECT * FROM op_sessions WHERE ended_at IS NULL AND last_seen_at < ?').all(olderThan) as Row[]).map(mapSession)
  }

  lastHandoff(): { session: Session; handoff: Handoff } | null {
    const row = this.db.prepare('SELECT * FROM op_sessions WHERE handoff_json IS NOT NULL ORDER BY last_seen_at DESC LIMIT 1').get() as Row | undefined
    if (!row) return null
    const session = mapSession(row)
    return session.handoff ? { session, handoff: session.handoff } : null
  }

  // ── content life path ───────────────────────────────────────────────────
  createContent(input: { id?: string; brandId?: string | null; kind: string; title: string; stage?: ContentStage; ideaSource?: string | null; data?: Record<string, unknown> }): ContentItem {
    const at = this.now()
    const id = input.id ?? `c-${randomUUID().slice(0, 8)}`
    this.db.prepare('INSERT INTO op_content(id, brand_id, kind, title, stage, idea_source, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.brandId ?? null, input.kind, input.title, input.stage ?? 'idea', input.ideaSource ?? null, json(input.data ?? {}), at, at)
    return this.getContent(id)!
  }

  getContent(id: string): ContentItem | null {
    const row = this.db.prepare('SELECT * FROM op_content WHERE id = ?').get(id) as Row | undefined
    return row ? mapContent(row) : null
  }

  updateContent(id: string, patch: { title?: string; stage?: ContentStage; brandId?: string | null; data?: Record<string, unknown> }): ContentItem | null {
    const c = this.getContent(id)
    if (!c) return null
    const data = patch.data ? { ...c.data, ...patch.data } : c.data
    this.db.prepare('UPDATE op_content SET title = ?, stage = ?, brand_id = ?, data_json = ?, updated_at = ? WHERE id = ?')
      .run(patch.title ?? c.title, patch.stage ?? c.stage, patch.brandId === undefined ? c.brandId : patch.brandId, json(data), this.now(), id)
    if (patch.stage && patch.stage !== c.stage) this.linkContent({ contentId: id, type: 'stage', detail: `${c.stage} → ${patch.stage}` })
    return this.getContent(id)
  }

  listContent(filter: { brandId?: string; stage?: ContentStage; limit?: number } = {}): ContentItem[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.brandId) { where.push('brand_id = ?'); args.push(filter.brandId) }
    if (filter.stage) { where.push('stage = ?'); args.push(filter.stage) }
    args.push(Math.min(filter.limit ?? 100, 1000))
    return (this.db.prepare(`SELECT * FROM op_content ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`).all(...args) as Row[]).map(mapContent)
  }

  linkContent(input: { contentId: string; type: string; platform?: string | null; account?: string | null; externalId?: string | null; url?: string | null; detail?: string | null }): ContentLink | null {
    if (!this.getContent(input.contentId)) return null
    const id = randomUUID()
    const at = this.now()
    this.db.prepare('INSERT INTO op_content_links(id, content_id, at, type, platform, account, external_id, url, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.contentId, at, input.type, input.platform ?? null, input.account ?? null, input.externalId ?? null, input.url ?? null, input.detail ?? null)
    this.db.prepare('UPDATE op_content SET updated_at = ? WHERE id = ?').run(at, input.contentId)
    if (input.type === 'placement') {
      const c = this.getContent(input.contentId)!
      if (['idea', 'made', 'approved'].includes(c.stage)) {
        this.db.prepare("UPDATE op_content SET stage = 'live' WHERE id = ?").run(input.contentId)
      }
    }
    return mapLink(this.db.prepare('SELECT * FROM op_content_links WHERE id = ?').get(id) as Row)
  }

  contentLinks(contentId: string): ContentLink[] {
    return (this.db.prepare('SELECT * FROM op_content_links WHERE content_id = ? ORDER BY at').all(contentId) as Row[]).map(mapLink)
  }

  placements(filter: { platform?: string } = {}): ContentLink[] {
    const rows = filter.platform
      ? this.db.prepare("SELECT * FROM op_content_links WHERE type = 'placement' AND platform = ? AND external_id IS NOT NULL").all(filter.platform)
      : this.db.prepare("SELECT * FROM op_content_links WHERE type = 'placement' AND external_id IS NOT NULL").all()
    return (rows as Row[]).map(mapLink)
  }

  // ── metrics ─────────────────────────────────────────────────────────────
  recordMetric(input: { platform: string; account?: string | null; externalId: string; metrics: Record<string, number>; contentId?: string | null }): Metric {
    const id = randomUUID()
    const contentId = input.contentId ?? (this.db.prepare("SELECT content_id FROM op_content_links WHERE type = 'placement' AND platform = ? AND external_id = ? LIMIT 1")
      .get(input.platform, input.externalId) as Row | undefined)?.content_id as string | undefined ?? null
    this.db.prepare('INSERT INTO op_metrics(id, at, platform, account, external_id, content_id, metrics_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, this.now(), input.platform, input.account ?? null, input.externalId, contentId, json(input.metrics))
    if (contentId) {
      const c = this.getContent(contentId)
      if (c && c.stage === 'live') this.db.prepare("UPDATE op_content SET stage = 'measured', updated_at = ? WHERE id = ?").run(this.now(), contentId)
    }
    return mapMetric(this.db.prepare('SELECT * FROM op_metrics WHERE id = ?').get(id) as Row)
  }

  /** Latest snapshot per external id. */
  latestMetrics(filter: { platform?: string; contentId?: string; limit?: number } = {}): Metric[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.platform) { where.push('m.platform = ?'); args.push(filter.platform) }
    if (filter.contentId) { where.push('m.content_id = ?'); args.push(filter.contentId) }
    args.push(Math.min(filter.limit ?? 200, 2000))
    const sql = `SELECT m.* FROM op_metrics m JOIN (SELECT platform, external_id, MAX(at) at FROM op_metrics GROUP BY platform, external_id) l
      ON l.platform = m.platform AND l.external_id = m.external_id AND l.at = m.at ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.at DESC LIMIT ?`
    return (this.db.prepare(sql).all(...args) as Row[]).map(mapMetric)
  }

  metricHistory(platform: string, externalId: string): Metric[] {
    return (this.db.prepare('SELECT * FROM op_metrics WHERE platform = ? AND external_id = ? ORDER BY at').all(platform, externalId) as Row[]).map(mapMetric)
  }

  // ── learnings ───────────────────────────────────────────────────────────
  recordLearning(input: { statement: string; scope?: string | null; evidence?: unknown[]; confidence?: number }): Learning {
    const id = randomUUID()
    this.db.prepare("INSERT INTO op_learnings(id, statement, scope, evidence_json, confidence, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)")
      .run(id, input.statement, input.scope ?? null, json(input.evidence ?? []), Math.max(0, Math.min(1, input.confidence ?? 0.5)), this.now())
    return this.getLearning(id)!
  }

  getLearning(id: string): Learning | null {
    const row = this.db.prepare('SELECT * FROM op_learnings WHERE id = ?').get(id) as Row | undefined
    return row ? mapLearning(row) : null
  }

  listLearnings(filter: { status?: Learning['status']; scope?: string } = {}): Learning[] {
    const where: string[] = []
    const args: string[] = []
    if (filter.status) { where.push('status = ?'); args.push(filter.status) }
    if (filter.scope) { where.push('(scope = ? OR scope IS NULL)'); args.push(filter.scope) }
    return (this.db.prepare(`SELECT * FROM op_learnings ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY confidence DESC, created_at DESC`).all(...args) as Row[]).map(mapLearning)
  }

  /** The agent rewrites a learning, re-scores it, or retires one that stopped being true. */
  updateLearning(id: string, input: { statement?: string; confidence?: number; status?: Learning['status'] }): Learning | null {
    const result = this.db.prepare('UPDATE op_learnings SET statement = COALESCE(?, statement), confidence = COALESCE(?, confidence), status = COALESCE(?, status), decided_at = ? WHERE id = ?')
      .run(input.statement ?? null, input.confidence === undefined ? null : Math.max(0, Math.min(1, input.confidence)), input.status ?? null, this.now(), id)
    return Number(result.changes) ? this.getLearning(id) : null
  }

  // ── tasks / calendar ────────────────────────────────────────────────────
  upsertTask(input: { id?: string; title: string; brandId?: string | null; platform?: string | null; account?: string | null; dueAt?: string | null; state?: Task['state']; waitingOn?: string | null; source?: string; externalId?: string | null; contentId?: string | null; notes?: string | null }): Task {
    const at = this.now()
    const source = input.source ?? 'agent'
    let id = input.id
    if (!id && input.externalId) {
      const row = this.db.prepare('SELECT id FROM op_tasks WHERE source = ? AND platform IS ? AND external_id = ?').get(source, input.platform ?? null, input.externalId) as Row | undefined
      if (row) id = String(row.id)
    }
    const existing = id ? this.getTask(id) : null
    if (existing) {
      this.db.prepare(`UPDATE op_tasks SET title = ?, brand_id = ?, platform = ?, account = ?, due_at = ?, state = ?, waiting_on = ?, content_id = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .run(input.title, input.brandId === undefined ? existing.brandId : input.brandId, input.platform === undefined ? existing.platform : input.platform,
          input.account === undefined ? existing.account : input.account, input.dueAt === undefined ? existing.dueAt : input.dueAt, input.state ?? existing.state,
          input.waitingOn === undefined ? existing.waitingOn : input.waitingOn, input.contentId === undefined ? existing.contentId : input.contentId,
          input.notes === undefined ? existing.notes : input.notes, at, existing.id)
      return this.getTask(existing.id)!
    }
    const newId = id ?? `t-${randomUUID().slice(0, 8)}`
    this.db.prepare(`INSERT INTO op_tasks(id, title, brand_id, platform, account, due_at, state, waiting_on, source, external_id, content_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId, input.title, input.brandId ?? null, input.platform ?? null, input.account ?? null, input.dueAt ?? null,
      input.state ?? 'open', input.waitingOn ?? null, source, input.externalId ?? null, input.contentId ?? null, input.notes ?? null, at, at)
    return this.getTask(newId)!
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM op_tasks WHERE id = ?').get(id) as Row | undefined
    return row ? mapTask(row) : null
  }

  listTasks(filter: { from?: string; to?: string; state?: Task['state'] | 'active'; brandId?: string; limit?: number } = {}): Task[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.state === 'active') where.push("state IN ('open', 'waiting')")
    else if (filter.state) { where.push('state = ?'); args.push(filter.state) }
    if (filter.from) { where.push('due_at >= ?'); args.push(filter.from) }
    if (filter.to) { where.push('due_at < ?'); args.push(filter.to) }
    if (filter.brandId) { where.push('brand_id = ?'); args.push(filter.brandId) }
    args.push(Math.min(filter.limit ?? 200, 2000))
    return (this.db.prepare(`SELECT * FROM op_tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY due_at IS NULL, due_at, created_at LIMIT ?`).all(...args) as Row[]).map(mapTask)
  }

  // ── contacts + ideas ────────────────────────────────────────────────────
  upsertContact(input: { id?: string; platform: string; name: string; stage?: string; lastContactAt?: string | null; nextStep?: string | null; notes?: string | null }): Contact {
    const at = this.now()
    const id = input.id ?? `${input.platform}:${slug(input.name)}`
    const existing = this.db.prepare('SELECT * FROM op_contacts WHERE id = ?').get(id) as Row | undefined
    if (existing) {
      this.db.prepare('UPDATE op_contacts SET name = ?, stage = ?, last_contact_at = COALESCE(?, last_contact_at), next_step = COALESCE(?, next_step), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?')
        .run(input.name, input.stage ?? String(existing.stage), input.lastContactAt ?? null, input.nextStep ?? null, input.notes ?? null, at, id)
    } else {
      this.db.prepare('INSERT INTO op_contacts(id, platform, name, stage, last_contact_at, next_step, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.platform, input.name, input.stage ?? 'lead', input.lastContactAt ?? null, input.nextStep ?? null, input.notes ?? null, at)
    }
    return mapContact(this.db.prepare('SELECT * FROM op_contacts WHERE id = ?').get(id) as Row)
  }

  listContacts(filter: { platform?: string; stage?: string } = {}): Contact[] {
    const where: string[] = []
    const args: string[] = []
    if (filter.platform) { where.push('platform = ?'); args.push(filter.platform) }
    if (filter.stage) { where.push('stage = ?'); args.push(filter.stage) }
    return (this.db.prepare(`SELECT * FROM op_contacts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`).all(...args) as Row[]).map(mapContact)
  }

  addIdea(input: { text: string; source?: string | null; score?: number | null; brandId?: string | null }): Idea {
    const id = `i-${randomUUID().slice(0, 8)}`
    this.db.prepare("INSERT INTO op_ideas(id, text, source, score, brand_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'new', ?)")
      .run(id, input.text, input.source ?? null, input.score ?? null, input.brandId ?? null, this.now())
    return mapIdea(this.db.prepare('SELECT * FROM op_ideas WHERE id = ?').get(id) as Row)
  }

  setIdeaStatus(id: string, status: Idea['status']): boolean {
    return Number(this.db.prepare('UPDATE op_ideas SET status = ? WHERE id = ?').run(status, id).changes) > 0
  }

  listIdeas(filter: { status?: Idea['status']; brandId?: string; limit?: number } = {}): Idea[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.status) { where.push('status = ?'); args.push(filter.status) }
    if (filter.brandId) { where.push('brand_id = ?'); args.push(filter.brandId) }
    args.push(Math.min(filter.limit ?? 100, 1000))
    return (this.db.prepare(`SELECT * FROM op_ideas ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY score DESC, created_at DESC LIMIT ?`).all(...args) as Row[]).map(mapIdea)
  }

  // ── inbox ───────────────────────────────────────────────────────────────
  addInbox(input: { kind: string; title: string; body: string; refId?: string | null; needsAgent?: boolean; packet?: unknown }): InboxItem {
    const id = `in-${randomUUID().slice(0, 8)}`
    const at = this.now()
    this.db.prepare("INSERT INTO op_inbox(id, at, kind, title, body, ref_id, needs_agent, status, packet_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)")
      .run(id, at, input.kind, input.title, input.body, input.refId ?? null, input.needsAgent ? 1 : 0, input.packet === undefined ? null : json(input.packet), at)
    return this.getInbox(id)!
  }

  getInbox(id: string): InboxItem | null {
    const row = this.db.prepare('SELECT * FROM op_inbox WHERE id = ?').get(id) as Row | undefined
    return row ? mapInbox(row) : null
  }

  listInbox(filter: { status?: InboxItem['status'] | 'open'; needsAgent?: boolean; limit?: number } = {}): InboxItem[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.status === 'open') where.push("status IN ('new', 'taken')")
    else if (filter.status) { where.push('status = ?'); args.push(filter.status) }
    if (filter.needsAgent !== undefined) { where.push('needs_agent = ?'); args.push(filter.needsAgent ? 1 : 0) }
    args.push(Math.min(filter.limit ?? 50, 500))
    return (this.db.prepare(`SELECT * FROM op_inbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`).all(...args) as Row[]).map(mapInbox)
  }

  setInboxStatus(id: string, status: InboxItem['status'], takenBy?: string | null): InboxItem | null {
    this.db.prepare('UPDATE op_inbox SET status = ?, taken_by = COALESCE(?, taken_by), updated_at = ? WHERE id = ?').run(status, takenBy ?? null, this.now(), id)
    return this.getInbox(id)
  }

  // ── background jobs + monitors ──────────────────────────────────────────
  createJob(input: { recipe: string; params: Record<string, unknown>; sessionId?: string | null; monitorId?: string | null }): Job {
    const id = `job-${randomUUID().slice(0, 8)}`
    this.db.prepare("INSERT INTO op_jobs(id, recipe, params_json, status, created_at, session_id, monitor_id) VALUES (?, ?, ?, 'queued', ?, ?, ?)")
      .run(id, input.recipe, json(input.params), this.now(), input.sessionId ?? null, input.monitorId ?? null)
    return this.getJob(id)!
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM op_jobs WHERE id = ?').get(id) as Row | undefined
    return row ? mapJob(row) : null
  }

  updateJob(id: string, patch: Partial<Pick<Job, 'status' | 'progress' | 'resultPath' | 'summary' | 'error'>>): Job | null {
    const j = this.getJob(id)
    if (!j) return null
    const at = this.now()
    const status = patch.status ?? j.status
    this.db.prepare('UPDATE op_jobs SET status = ?, progress = ?, result_path = ?, summary = ?, error = ?, started_at = ?, finished_at = ? WHERE id = ?').run(
      status, patch.progress ?? j.progress, patch.resultPath ?? j.resultPath, patch.summary ?? j.summary, patch.error ?? j.error,
      j.startedAt ?? (status === 'running' ? at : null), ['completed', 'failed', 'cancelled'].includes(status) ? j.finishedAt ?? at : null, id)
    return this.getJob(id)
  }

  listJobs(filter: { status?: Job['status'] | 'active'; limit?: number } = {}): Job[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.status === 'active') where.push("status IN ('queued', 'running')")
    else if (filter.status) { where.push('status = ?'); args.push(filter.status) }
    args.push(Math.min(filter.limit ?? 50, 500))
    return (this.db.prepare(`SELECT * FROM op_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...args) as Row[]).map(mapJob)
  }

  createMonitor(input: { recipe: string; params: Record<string, unknown>; everyMinutes: number; firstRunAt?: string }): Monitor {
    const id = `mon-${randomUUID().slice(0, 8)}`
    const at = this.now()
    this.db.prepare("INSERT INTO op_monitors(id, recipe, params_json, every_minutes, status, next_run_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)")
      .run(id, input.recipe, json(input.params), Math.max(15, Math.round(input.everyMinutes)), input.firstRunAt ?? at, at)
    return this.getMonitor(id)!
  }

  getMonitor(id: string): Monitor | null {
    const row = this.db.prepare('SELECT * FROM op_monitors WHERE id = ?').get(id) as Row | undefined
    return row ? mapMonitor(row) : null
  }

  listMonitors(): Monitor[] {
    return (this.db.prepare('SELECT * FROM op_monitors ORDER BY created_at').all() as Row[]).map(mapMonitor)
  }

  setMonitorStatus(id: string, status: Monitor['status'] | 'deleted'): boolean {
    const result = status === 'deleted'
      ? this.db.prepare('DELETE FROM op_monitors WHERE id = ?').run(id)
      : this.db.prepare('UPDATE op_monitors SET status = ? WHERE id = ?').run(status, id)
    return Number(result.changes) > 0
  }

  /** Monitors due now; each one returned is rescheduled, so it fires once per period. */
  takeDueMonitors(): Monitor[] {
    const at = this.now()
    const due = (this.db.prepare("SELECT * FROM op_monitors WHERE status = 'active' AND next_run_at <= ?").all(at) as Row[]).map(mapMonitor)
    for (const m of due) {
      const next = new Date(this.clock().getTime() + m.everyMinutes * 60_000).toISOString()
      this.db.prepare('UPDATE op_monitors SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(at, next, m.id)
    }
    return due
  }

  // ── log ─────────────────────────────────────────────────────────────────
  appendLog(input: { type: string; title: string; body?: string; at?: string }): LogEntry {
    const id = randomUUID()
    this.db.prepare('INSERT INTO op_log(id, at, type, title, body) VALUES (?, ?, ?, ?, ?)').run(id, input.at ?? this.now(), input.type, input.title, input.body ?? '')
    return mapLog(this.db.prepare('SELECT * FROM op_log WHERE id = ?').get(id) as Row)
  }

  listLog(filter: { limit?: number; type?: string; since?: string } = {}): LogEntry[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (filter.type) { where.push('type = ?'); args.push(filter.type) }
    if (filter.since) { where.push('at >= ?'); args.push(filter.since) }
    args.push(Math.min(filter.limit ?? 100, 5000))
    return (this.db.prepare(`SELECT * FROM op_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT ?`).all(...args) as Row[]).map(mapLog)
  }
}

function mapFact(r: Row): Fact {
  return { id: String(r.id), subject: String(r.subject), field: String(r.field), value: parse(r.value_json, null), status: r.status as FactStatus, source: String(r.source), validFrom: String(r.valid_from), validTo: str(r.valid_to), recordedAt: String(r.recorded_at) }
}
function mapSession(r: Row): Session {
  return { id: String(r.id), client: String(r.client), startedAt: String(r.started_at), lastSeenAt: String(r.last_seen_at), endedAt: str(r.ended_at), endReason: str(r.end_reason), reads: parse(r.reads_json, {}), writes: Number(r.writes), errors: Number(r.errors), handoff: parse<Handoff | null>(r.handoff_json, null) }
}
function mapEvent(r: Row): OpEvent {
  return { id: String(r.id), at: String(r.at), sessionId: str(r.session_id), platform: String(r.platform), account: str(r.account), tool: String(r.tool), kind: r.kind as OpEvent['kind'], outcome: r.outcome as OpEvent['outcome'], targetId: str(r.target_id), targetUrl: str(r.target_url), contentId: str(r.content_id), error: str(r.error), summary: str(r.summary) }
}
function mapContent(r: Row): ContentItem {
  return { id: String(r.id), brandId: str(r.brand_id), kind: String(r.kind), title: String(r.title), stage: r.stage as ContentStage, ideaSource: str(r.idea_source), data: parse(r.data_json, {}), createdAt: String(r.created_at), updatedAt: String(r.updated_at) }
}
function mapLink(r: Row): ContentLink {
  return { id: String(r.id), contentId: String(r.content_id), at: String(r.at), type: String(r.type), platform: str(r.platform), account: str(r.account), externalId: str(r.external_id), url: str(r.url), detail: str(r.detail) }
}
function mapMetric(r: Row): Metric {
  return { id: String(r.id), at: String(r.at), platform: String(r.platform), account: str(r.account), externalId: String(r.external_id), contentId: str(r.content_id), metrics: parse(r.metrics_json, {}) }
}
function mapLearning(r: Row): Learning {
  return { id: String(r.id), statement: String(r.statement), scope: str(r.scope), evidence: parse(r.evidence_json, []), confidence: Number(r.confidence), status: r.status as Learning['status'], createdAt: String(r.created_at), decidedAt: str(r.decided_at) }
}
function mapTask(r: Row): Task {
  return { id: String(r.id), title: String(r.title), brandId: str(r.brand_id), platform: str(r.platform), account: str(r.account), dueAt: str(r.due_at), state: r.state as Task['state'], waitingOn: str(r.waiting_on), source: String(r.source), externalId: str(r.external_id), contentId: str(r.content_id), notes: str(r.notes), createdAt: String(r.created_at), updatedAt: String(r.updated_at) }
}
function mapContact(r: Row): Contact {
  return { id: String(r.id), platform: String(r.platform), name: String(r.name), stage: String(r.stage), lastContactAt: str(r.last_contact_at), nextStep: str(r.next_step), notes: str(r.notes), updatedAt: String(r.updated_at) }
}
function mapIdea(r: Row): Idea {
  return { id: String(r.id), text: String(r.text), source: str(r.source), score: r.score === null ? null : Number(r.score), brandId: str(r.brand_id), status: r.status as Idea['status'], createdAt: String(r.created_at) }
}
function mapInbox(r: Row): InboxItem {
  return { id: String(r.id), at: String(r.at), kind: String(r.kind), title: String(r.title), body: String(r.body), refId: str(r.ref_id), needsAgent: Number(r.needs_agent) === 1, status: r.status as InboxItem['status'], takenBy: str(r.taken_by), packet: parse(r.packet_json, null), updatedAt: String(r.updated_at) }
}
function mapJob(r: Row): Job {
  return { id: String(r.id), recipe: String(r.recipe), params: parse(r.params_json, {}), status: r.status as Job['status'], progress: str(r.progress), createdAt: String(r.created_at), startedAt: str(r.started_at), finishedAt: str(r.finished_at), resultPath: str(r.result_path), summary: str(r.summary), error: str(r.error), sessionId: str(r.session_id), monitorId: str(r.monitor_id) }
}
function mapMonitor(r: Row): Monitor {
  return { id: String(r.id), recipe: String(r.recipe), params: parse(r.params_json, {}), everyMinutes: Number(r.every_minutes), status: r.status as Monitor['status'], lastRunAt: str(r.last_run_at), nextRunAt: String(r.next_run_at), createdAt: String(r.created_at) }
}
function mapLog(r: Row): LogEntry {
  return { id: String(r.id), at: String(r.at), type: String(r.type), title: String(r.title), body: String(r.body) }
}
