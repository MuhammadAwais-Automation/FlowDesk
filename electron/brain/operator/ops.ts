/**
 * The one entry point to Brain v3 (protocol method `operator`): every op is
 * validated here, run against the OperatorStore, and the Second-Brain style
 * files (brain/operator/*.md) are re-rendered shortly after any change.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CLAUDE_MD, DEFAULT_AGENTS_MD, agentsMd, briefing, hotMd, indexMd, logMd, sessionLogBody, type SystemStatus } from './documents'
import { OperatorStore, type FactStatus } from './store'

const IDLE_SESSION_MS = 2 * 60 * 60_000
const LOG_FILE_ENTRIES = 500

const s = z.string().trim()
const opt = (t: z.ZodTypeAny) => t.optional().nullable()
const stage = z.enum(['idea', 'made', 'approved', 'scheduled', 'live', 'measured', 'dropped'])
const isoish = s.min(10).max(40)

const schemas = {
  'status.set': z.object({ health: opt(z.object({ ranAt: s, status: s, failing: z.array(s), warnings: z.array(s) })), openReports: z.number().int().min(0).optional(), skills: z.array(z.object({ id: s, name: s, description: s.optional() })).optional(), knowledge: z.record(z.string(), z.number()).optional() }),
  'accounts.sync': z.object({ accounts: z.array(z.object({ platform: s.min(1), slotId: s.min(1), label: s })).max(500) }),
  'session.start': z.object({ sessionId: s.min(1), client: s.optional(), platform: s.optional(), brandId: s.optional(), account: s.optional() }),
  'session.briefed': z.object({ sessionId: s.min(1) }),
  'session.wrap': z.object({ sessionId: s.min(1), client: s.optional(), summary: s.min(1).max(4000), decisions: z.array(s.max(500)).max(30).optional(), next: s.max(1000).optional(), focus: s.max(500).optional() }),
  'session.end': z.object({ sessionId: s.min(1), reason: z.enum(['exit', 'idle']).default('exit') }),
  'sessions.list': z.object({ limit: z.number().int().min(1).max(200).optional() }),
  'ledger.record': z.object({ sessionId: opt(s), client: s.optional(), platform: s.min(1), account: opt(s), tool: s.min(1), kind: z.enum(['write', 'read', 'system']), outcome: z.enum(['ok', 'error']), targetId: opt(s.max(300)), targetUrl: opt(s.max(1000)), contentId: opt(s), error: opt(s.max(2000)), summary: opt(s.max(500)), assets: z.array(s.max(1000)).max(20).optional() }),
  activity: z.object({ platform: s.optional(), account: s.optional(), brandId: s.optional(), since: isoish.optional(), until: isoish.optional(), sessionId: s.optional(), contentId: s.optional(), limit: z.number().int().min(1).max(2000).optional() }),
  briefing: z.object({ platform: s.optional(), brandId: s.optional(), account: s.optional() }),
  'files.get': z.object({ name: z.enum(['AGENTS', 'CLAUDE', 'hot', 'index', 'log']) }),
  'agents.set': z.object({ text: s.min(20).max(50_000) }),
  'agents.reset': z.object({}),
  'profile.get': z.object({}),
  'profile.set': z.object({ field: s.min(1).max(80), value: z.unknown(), status: z.enum(['accepted', 'proposed']).optional(), source: s.optional() }),
  'brand.upsert': z.object({ id: s.optional(), name: s.min(1).max(120), status: z.enum(['active', 'proposed', 'archived']).optional(), fields: z.record(z.string(), z.unknown()).optional(), factStatus: z.enum(['accepted', 'proposed']).optional(), source: s.optional() }),
  'brand.list': z.object({ includeArchived: z.boolean().optional() }),
  'brand.get': z.object({ id: s.min(1) }),
  'account.update': z.object({ platform: s.min(1), account: s.min(1), fields: z.record(z.string(), z.unknown()), status: z.enum(['accepted', 'proposed']).optional(), source: s.optional() }),
  'account.list': z.object({ platform: s.optional(), brandId: s.optional() }),
  history: z.object({ subject: s.min(1), field: s.optional() }),
  'facts.proposed': z.object({}),
  'fact.decide': z.object({ id: s.min(1), decision: z.enum(['accept', 'reject']), value: z.unknown().optional() }),
  'content.create': z.object({ id: s.optional(), brandId: opt(s), kind: s.min(1).max(40), title: s.min(1).max(300), stage: stage.optional(), ideaSource: opt(s), data: z.record(z.string(), z.unknown()).optional() }),
  'content.get': z.object({ id: s.min(1) }),
  'content.update': z.object({ id: s.min(1), title: s.optional(), stage: stage.optional(), brandId: opt(s), data: z.record(z.string(), z.unknown()).optional() }),
  'content.list': z.object({ brandId: s.optional(), stage: stage.optional(), limit: z.number().int().min(1).max(1000).optional() }),
  'content.link': z.object({ contentId: s.min(1), type: z.enum(['prompt', 'asset', 'placement', 'note', 'approval', 'edit']), platform: opt(s), account: opt(s), externalId: opt(s), url: opt(s), detail: opt(s.max(2000)) }),
  'metric.record': z.object({ platform: s.min(1), account: opt(s), externalId: s.min(1), metrics: z.record(z.string(), z.number()), contentId: opt(s) }),
  'metric.latest': z.object({ platform: s.optional(), contentId: s.optional(), limit: z.number().int().min(1).max(2000).optional() }),
  'learning.propose': z.object({ statement: s.min(5).max(1000), scope: opt(s), evidence: z.array(z.unknown()).max(50).optional(), confidence: z.number().min(0).max(1).optional() }),
  'learning.list': z.object({ status: z.enum(['proposed', 'accepted', 'rejected', 'retired']).optional(), scope: s.optional() }),
  'learning.decide': z.object({ id: s.min(1), decision: z.enum(['accept', 'reject', 'retire']), statement: s.optional() }),
  'task.upsert': z.object({ id: s.optional(), title: s.min(1).max(300), brandId: opt(s), platform: opt(s), account: opt(s), dueAt: opt(isoish), state: z.enum(['open', 'waiting', 'done', 'cancelled']).optional(), waitingOn: opt(s), source: s.optional(), externalId: opt(s), contentId: opt(s), notes: opt(s.max(2000)) }),
  'task.list': z.object({ from: isoish.optional(), to: isoish.optional(), state: z.enum(['open', 'waiting', 'done', 'cancelled', 'active']).optional(), brandId: s.optional(), limit: z.number().int().min(1).max(2000).optional() }),
  'contact.upsert': z.object({ id: s.optional(), platform: s.min(1), name: s.min(1).max(200), stage: s.optional(), lastContactAt: opt(isoish), nextStep: opt(s.max(500)), notes: opt(s.max(2000)) }),
  'contact.list': z.object({ platform: s.optional(), stage: s.optional() }),
  'idea.add': z.object({ text: s.min(2).max(1000), source: opt(s), score: opt(z.number()), brandId: opt(s) }),
  'idea.list': z.object({ status: z.enum(['new', 'used', 'dropped']).optional(), brandId: s.optional(), limit: z.number().int().min(1).max(1000).optional() }),
  'idea.status': z.object({ id: s.min(1), status: z.enum(['new', 'used', 'dropped']) }),
  'inbox.add': z.object({ kind: s.min(1), title: s.min(1).max(300), body: s.max(20_000).default(''), refId: opt(s), needsAgent: z.boolean().optional(), packet: z.unknown().optional() }),
  'inbox.list': z.object({ status: z.enum(['new', 'taken', 'done', 'open']).optional(), needsAgent: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }),
  'inbox.take': z.object({ id: s.min(1), sessionId: s.optional() }),
  'inbox.done': z.object({ id: s.min(1), note: s.max(2000).optional() }),
  'job.create': z.object({ recipe: s.min(1), params: z.record(z.string(), z.unknown()).default({}), sessionId: opt(s), monitorId: opt(s) }),
  'job.update': z.object({ id: s.min(1), status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(), progress: opt(s.max(300)), resultPath: opt(s), summary: opt(s.max(4000)), error: opt(s.max(2000)) }),
  'job.get': z.object({ id: s.min(1) }),
  'job.list': z.object({ status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'active']).optional(), limit: z.number().int().min(1).max(500).optional() }),
  'monitor.create': z.object({ recipe: s.min(1), params: z.record(z.string(), z.unknown()).default({}), everyMinutes: z.number().int().min(15).max(60 * 24 * 7), firstRunAt: isoish.optional() }),
  'monitor.list': z.object({}),
  'monitor.status': z.object({ id: s.min(1), status: z.enum(['active', 'paused', 'deleted']) }),
  'monitor.takeDue': z.object({}),
  'log.append': z.object({ type: s.min(1).max(40), title: s.min(1).max(300), body: s.max(20_000).optional() }),
  'log.list': z.object({ limit: z.number().int().min(1).max(5000).optional(), type: s.optional(), since: isoish.optional() }),
  overview: z.object({}),
  'brand.decide': z.object({ id: s.min(1), decision: z.enum(['accept', 'reject']) }),
  'seed.fromKnowledge': z.object({ force: z.boolean().optional() }),
} as const

export type OperatorOp = keyof typeof schemas
export const OPERATOR_OPS = Object.keys(schemas) as OperatorOp[]
const READ_ONLY = new Set<OperatorOp>(['session.briefed', 'sessions.list', 'activity', 'briefing', 'files.get', 'profile.get', 'brand.list', 'brand.get', 'account.list', 'history', 'facts.proposed', 'content.get', 'content.list', 'metric.latest', 'learning.list', 'task.list', 'contact.list', 'idea.list', 'inbox.list', 'job.get', 'job.list', 'monitor.list', 'log.list', 'overview'])

export interface KnowledgePort {
  /** Count of active knowledge documents per type, for index.md. */
  countsByType(): Record<string, number>
  /** Work-relevant vault documents (wiki/me, business/agency) with their body text. */
  seedDocs?(): Array<{ path: string; title: string; body: string }>
  /** Legacy accepted memories, for brand rules that already exist there. */
  memories?(): Array<{ id: string; kind: string; text: string }>
}

/** First real paragraph of a vault page: no headings, front-matter, dates or source lines. */
export function firstParagraph(body: string, max = 320): string {
  const lines = body.replace(/\r/g, '').split('\n').map(l => l.trim())
  const text = lines.filter(l => l && !/^(#|_|>|---|\||!\[|- \[\[|Sources?:)/.test(l)).join(' ')
  const plain = text.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a, b) => b || a).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

/**
 * Brands to propose on first run (plan §3.1). Proposed, not active: the user
 * accepts, edits or rejects each one in Brain → Brands.
 */
const SEED_BRANDS: Array<{ id: string; name: string; niche: string; match: RegExp }> = [
  { id: 'alpha-paws', name: 'Alpha Paws', niche: 'TikTok cat videos (Alpha Paws channel)', match: /alpha paws/i },
  { id: 'coloring-books', name: 'Coloring Books (Arcane Frames)', niche: 'Coloring pages: Pinterest pins that sell the Gumroad store Arcane Frames', match: /arcane frames|coloring|pin factory/i },
  { id: 'codveon', name: 'Codveon', niche: 'Digital agency (LinkedIn first)', match: /codveon/i },
  { id: 'personal', name: 'Personal brand (AI Engineer)', niche: 'The user as an AI Engineer: portfolio, LinkedIn, freelancing', match: /portfolio|positioning|ai engineer/i },
]
const PROFILE_FROM: Record<string, string> = {
  'wiki/me/profile.md': 'about', 'wiki/me/positioning.md': 'positioning', 'wiki/me/skills.md': 'skills',
  'wiki/me/tools.md': 'tools',
  // wiki/me/infrastructure.md is left out on purpose: server names and addresses
  // do not belong in a briefing every connected agent reads.
}

export class OperatorService {
  readonly store: OperatorStore
  private renderTimer: ReturnType<typeof setTimeout> | null = null

  constructor(db: ConstructorParameters<typeof OperatorStore>[0], readonly dir: string | null, private readonly knowledge?: KnowledgePort, clock?: () => Date) {
    this.store = new OperatorStore(db, clock)
    if (!this.store.getMeta<string | null>('agentsMd', null)) this.store.setMeta('agentsMd', DEFAULT_AGENTS_MD)
  }

  private status(): SystemStatus {
    const st = this.store.getMeta<SystemStatus>('status', {})
    return { ...st, knowledge: this.knowledge?.countsByType() ?? st.knowledge }
  }

  private now() { return new Date(this.store.now()) }

  handle(op: string, rawArgs: unknown): unknown {
    if (!(op in schemas)) throw new Error(`unknown operator op "${op}"`)
    const args = (schemas[op as OperatorOp] as z.ZodTypeAny).parse(rawArgs ?? {}) as Record<string, any>
    const result = this.run(op as OperatorOp, args)
    if (!READ_ONLY.has(op as OperatorOp)) this.scheduleRender()
    return result
  }

  private run(op: OperatorOp, a: Record<string, any>): unknown {
    const st = this.store
    switch (op) {
      case 'status.set': {
        const prev = st.getMeta<SystemStatus>('status', {})
        const next: SystemStatus = { ...prev }
        if (a.health !== undefined) next.health = a.health
        if (a.openReports !== undefined) next.openReports = a.openReports
        if (a.skills) next.skills = a.skills
        if (a.knowledge) next.knowledge = a.knowledge
        st.setMeta('status', next)
        return { ok: true }
      }
      case 'accounts.sync': return { ok: true, synced: st.syncAccounts(a.accounts) }
      case 'session.start': {
        st.touchSession(a.sessionId, a.client ?? 'unknown')
        st.markSessionBriefed(a.sessionId)
        const status = this.status()
        return {
          sessionId: a.sessionId,
          agents: agentsMd(st),
          hot: hotMd(st, status, this.now()),
          briefing: briefing(st, status, { platform: a.platform, brandId: a.brandId, account: a.account }, this.now()),
        }
      }
      case 'session.briefed': return { briefed: st.sessionBriefed(a.sessionId) }
      case 'session.wrap': {
        st.touchSession(a.sessionId, a.client ?? 'unknown')
        const handoff = { summary: a.summary, decisions: a.decisions, next: a.next, focus: a.focus }
        const ended = st.endSession(a.sessionId, 'wrap', handoff)
        if (ended) this.logSession(ended.id)
        return { ok: true, logged: !!ended }
      }
      case 'session.end': {
        const ended = st.endSession(a.sessionId, a.reason)
        if (ended && (ended.writes > 0 || Object.keys(ended.reads).length > 0 || ended.handoff)) this.logSession(ended.id)
        return { ok: true, logged: !!ended }
      }
      case 'sessions.list': return st.listSessions(a.limit)
      case 'ledger.record': return st.recordEvent(a as Parameters<OperatorStore['recordEvent']>[0])
      case 'activity': {
        let accounts: Array<{ platform: string; slotId: string; label: string }> | undefined
        if (a.brandId) accounts = st.listAccounts({ brandId: a.brandId }).map(x => ({ platform: x.platform, slotId: x.slotId, label: x.label }))
        const events = st.listEvents({ platform: a.platform, account: a.account, since: a.since, until: a.until, sessionId: a.sessionId, contentId: a.contentId, accounts, limit: a.limit })
        const totals: Record<string, { ok: number; error: number }> = {}
        for (const e of events) {
          const k = `${e.platform}${e.account ? `/${e.account}` : ''} ${e.tool}`
          totals[k] ??= { ok: 0, error: 0 }
          totals[k][e.outcome]++
        }
        return { events, totals }
      }
      case 'briefing': return { text: briefing(st, this.status(), a, this.now()) }
      case 'files.get': return { name: a.name, text: this.render(a.name) }
      case 'agents.set': st.setMeta('agentsMd', a.text); st.appendLog({ type: 'rules', title: 'AGENTS.md edited' }); return { ok: true }
      case 'agents.reset': st.setMeta('agentsMd', DEFAULT_AGENTS_MD); return { ok: true }
      case 'profile.get': return { fields: st.fields('profile'), proposed: st.proposedFacts().filter(f => f.subject === 'profile') }
      case 'profile.set': return st.setFact({ subject: 'profile', field: a.field, value: a.value, status: a.status as FactStatus | undefined, source: a.source })
      case 'brand.upsert': return st.upsertBrand(a as Parameters<OperatorStore['upsertBrand']>[0])
      case 'brand.list': return st.listBrands(a.includeArchived)
      case 'brand.get': return st.getBrand(a.id)
      case 'account.update': {
        const account = st.resolveAccount(a.platform, a.account)
        if (!account) throw new Error(`unknown ${a.platform} account "${a.account}"; known: ${st.listAccounts({ platform: a.platform }).map(x => `${x.label} (${x.slotId})`).join(', ') || 'none'}`)
        if (typeof a.fields.brand === 'string' && !st.getBrand(a.fields.brand)) throw new Error(`unknown brand "${a.fields.brand}"; create it first with brand.upsert`)
        for (const [field, value] of Object.entries(a.fields)) {
          st.setFact({ subject: st.accountSubject(account.platform, account.slotId), field, value, status: a.status as FactStatus | undefined, source: a.source })
        }
        return st.resolveAccount(account.platform, account.slotId)
      }
      case 'account.list': return st.listAccounts(a)
      case 'history': return st.history(a.subject, a.field)
      case 'facts.proposed': return st.proposedFacts()
      case 'fact.decide': return st.decideFact(a.id, a.decision, a.value)
      case 'content.create': return st.createContent(a as Parameters<OperatorStore['createContent']>[0])
      case 'content.get': {
        const content = st.getContent(a.id)
        if (!content) return null
        return { content, links: st.contentLinks(a.id), metrics: st.latestMetrics({ contentId: a.id }), events: st.listEvents({ contentId: a.id, limit: 100 }) }
      }
      case 'content.update': return st.updateContent(a.id, a)
      case 'content.list': return st.listContent(a)
      case 'content.link': return st.linkContent(a as Parameters<OperatorStore['linkContent']>[0])
      case 'metric.record': return st.recordMetric(a as Parameters<OperatorStore['recordMetric']>[0])
      case 'metric.latest': return st.latestMetrics(a)
      case 'learning.propose': return st.proposeLearning(a as Parameters<OperatorStore['proposeLearning']>[0])
      case 'learning.list': return st.listLearnings(a)
      case 'learning.decide': {
        const l = st.decideLearning(a.id, a.decision, a.statement)
        if (l) st.appendLog({ type: 'learning', title: `${l.status}: ${l.statement.slice(0, 120)}` })
        return l
      }
      case 'task.upsert': return st.upsertTask(a as Parameters<OperatorStore['upsertTask']>[0])
      case 'task.list': return st.listTasks(a)
      case 'contact.upsert': return st.upsertContact(a as Parameters<OperatorStore['upsertContact']>[0])
      case 'contact.list': return st.listContacts(a)
      case 'idea.add': return st.addIdea(a as Parameters<OperatorStore['addIdea']>[0])
      case 'idea.list': return st.listIdeas(a)
      case 'idea.status': return { ok: st.setIdeaStatus(a.id, a.status) }
      case 'inbox.add': return st.addInbox(a as Parameters<OperatorStore['addInbox']>[0])
      case 'inbox.list': return st.listInbox(a)
      case 'inbox.take': {
        if (!st.getInbox(a.id)) throw new Error(`no inbox item ${a.id}`)
        return st.setInboxStatus(a.id, 'taken', a.sessionId ?? null)
      }
      case 'inbox.done': {
        const item = st.setInboxStatus(a.id, 'done')
        if (item && a.note) st.appendLog({ type: 'inbox', title: `done: ${item.title}`, body: a.note })
        return item
      }
      case 'job.create': return st.createJob(a as Parameters<OperatorStore['createJob']>[0])
      case 'job.update': {
        const before = st.getJob(a.id)
        const job = st.updateJob(a.id, a)
        if (job && before && before.status !== job.status && ['completed', 'failed'].includes(job.status)) {
          st.appendLog({ type: 'job', title: `${job.recipe} ${job.status}`, body: [job.summary, job.error && `error: ${job.error}`].filter(Boolean).join('\n') })
        }
        return job
      }
      case 'job.get': return st.getJob(a.id)
      case 'job.list': return st.listJobs(a)
      case 'monitor.create': return st.createMonitor(a as Parameters<OperatorStore['createMonitor']>[0])
      case 'monitor.list': return st.listMonitors()
      case 'monitor.status': return { ok: st.setMonitorStatus(a.id, a.status) }
      case 'monitor.takeDue': return st.takeDueMonitors()
      case 'log.append': return st.appendLog(a as Parameters<OperatorStore['appendLog']>[0])
      case 'log.list': return st.listLog(a)
      case 'brand.decide': {
        const brand = st.getBrand(a.id)
        if (!brand) throw new Error(`no brand ${a.id}`)
        st.upsertBrand({ id: brand.id, name: brand.name, status: a.decision === 'accept' ? 'active' : 'archived' })
        for (const f of st.proposedFacts().filter(f => f.subject === `brand:${brand.id}`)) st.decideFact(f.id, a.decision)
        return st.getBrand(brand.id)
      }
      case 'seed.fromKnowledge': return this.seed(a.force === true)
      case 'overview': return {
        brands: st.listBrands().length,
        accounts: st.listAccounts().length,
        content: st.listContent({ limit: 1000 }).length,
        inboxNew: st.listInbox({ status: 'new', limit: 500 }).length,
        jobsActive: st.listJobs({ status: 'active' }).length,
        learningsProposed: st.listLearnings({ status: 'proposed' }).length,
        factsProposed: st.proposedFacts().length,
        tasksWaiting: st.listTasks({ state: 'waiting' }).length,
      }
    }
  }

  /** Proposes the profile and brands from the vault and legacy memories, once. */
  private seed(force: boolean) {
    const st = this.store
    if (!force && st.getMeta<boolean>('seeded', false)) return { ok: true, skipped: true }
    const docs = this.knowledge?.seedDocs?.() ?? []
    const memories = this.knowledge?.memories?.() ?? []
    let profile = 0
    for (const d of docs) {
      const field = PROFILE_FROM[d.path]
      const value = field ? firstParagraph(d.body) : ''
      if (field && value) { st.setFact({ subject: 'profile', field, value, status: 'proposed', source: `second-brain:${d.path}` }); profile++ }
    }
    st.setFact({ subject: 'profile', field: 'language', value: 'Roman Urdu / Hinglish, simple words', status: 'proposed', source: 'second-brain:AGENTS.md' })
    let brands = 0
    for (const b of SEED_BRANDS) {
      if (st.getBrand(b.id)) continue
      const doc = docs.find(d => b.match.test(d.title) || b.match.test(d.path))
      const rules = memories.filter(m => b.match.test(m.text)).map(m => m.text).join('\n').slice(0, 1500)
      st.upsertBrand({
        id: b.id, name: b.name, status: 'proposed', factStatus: 'proposed', source: 'seed',
        fields: { niche: b.niche, ...(doc ? { about: firstParagraph(doc.body) } : {}), ...(rules ? { rules } : {}) },
      })
      brands++
    }
    st.setMeta('seeded', true)
    st.appendLog({ type: 'seed', title: `proposed ${profile + 1} profile facts and ${brands} brands for review` })
    return { ok: true, profile: profile + 1, brands }
  }

  private logSession(id: string) {
    const session = this.store.getSession(id)
    if (!session) return
    const events = this.store.listEvents({ sessionId: id, limit: 200 })
    const title = session.handoff?.focus ?? session.handoff?.summary.split(/[.\n]/)[0]?.slice(0, 100) ?? `${session.writes} writes, ${Object.values(session.reads).reduce((n, c) => n + c, 0)} reads`
    this.store.appendLog({ type: 'session', title: `${session.client}: ${title}`, body: sessionLogBody(session, events) })
  }

  /** Ends sessions idle for 2 hours (the MCP client died without a clean exit). */
  sweepIdleSessions(): number {
    const cutoff = new Date(this.now().getTime() - IDLE_SESSION_MS).toISOString()
    let n = 0
    for (const s of this.store.idleSessions(cutoff)) {
      const ended = this.store.endSession(s.id, 'idle')
      if (ended && (ended.writes > 0 || Object.keys(ended.reads).length > 0)) { this.logSession(ended.id); n++ }
    }
    if (n) this.scheduleRender()
    return n
  }

  render(name: 'AGENTS' | 'CLAUDE' | 'hot' | 'index' | 'log'): string {
    const status = this.status()
    switch (name) {
      case 'AGENTS': return agentsMd(this.store)
      case 'CLAUDE': return CLAUDE_MD
      case 'hot': return hotMd(this.store, status, this.now())
      case 'index': return indexMd(this.store, status)
      case 'log': return logMd(this.store.listLog({ limit: LOG_FILE_ENTRIES }))
    }
  }

  writeFiles(): void {
    if (!this.dir) return
    mkdirSync(this.dir, { recursive: true })
    for (const name of ['AGENTS', 'CLAUDE', 'hot', 'index', 'log'] as const) {
      writeFileSync(join(this.dir, `${name}.md`), this.render(name))
    }
  }

  private scheduleRender() {
    if (!this.dir || this.renderTimer) return
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null
      try { this.writeFiles() } catch (e) { console.log(`[FlowDesk brain] operator files not written: ${e instanceof Error ? e.message : String(e)}`) }
    }, 1500)
    this.renderTimer.unref?.()
  }

  close() {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = null
      try { this.writeFiles() } catch { /* closing anyway */ }
    }
  }
}
