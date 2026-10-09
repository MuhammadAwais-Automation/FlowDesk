/**
 * The Second-Brain files, FlowDesk version (docs/brain-v3-plan.md §1):
 * AGENTS.md (user-edited rules), CLAUDE.md (pointer), hot.md (Now + Handoff),
 * index.md (catalog), log.md (append-only history), and the briefing an agent
 * gets from brain_start. All are rendered from the operator store, so they are
 * never stale and never depend on an agent remembering to update them.
 */
import type { Account, Brand, InboxItem, Job, LogEntry, OperatorStore, OpEvent, Session, Task } from './store'

export const DEFAULT_AGENTS_MD = `# AGENTS.md — FlowDesk operator rules

Every agent connected to FlowDesk over MCP follows these rules. The user edits
this file in FlowDesk → Brain → Rules.

## Who you work for
The user runs several brands from FlowDesk (see the briefing). Talk to them in
Roman Urdu / Hinglish unless they ask otherwise; keep it simple and direct.

## Session protocol
1. Start every session with \`brain_start\` (or the /flowdesk:start prompt). It
   returns these rules, hot.md and a briefing for the platform you will work on.
2. Read the skill the briefing names before using a platform's tools.
3. Pass \`contentId\` to generation, upload and posting tools when the work
   belongs to a content item (\`brain_content\` creates one), so its life path
   stays connected.
4. End with \`brain_wrap\` (or /flowdesk:wrap): what you did, decisions, next step.
   If you forget, FlowDesk still logs the session, but without your handoff.

## Rules
- Public or outbound actions (post, comment, send, like, vote, follow, delete,
  profile edits, Gumroad product create/edit/publish) need the user's explicit
  yes in chat for that exact action first.
- Pinterest pin images always come from ChatGPT image tools, never from Google
  Flow. Flow is only for product content, with the user's approval.
- Never enter passwords or codes; the user signs in.
- A tool result with isError did not happen. When a tool keeps failing, do not
  work around it or touch FlowDesk's files: file it with flowdesk_report_issue
  and tell the user.
- Long collection work (radar, trends, niche scans, metric pulls) goes to
  \`jobs\` and runs in the background; pick results up from \`inbox\`.
- Learnings you notice go to \`brain_learning\` as proposals; the user accepts
  them. Never write a learning as accepted yourself.
`

export const CLAUDE_MD = `# FlowDesk operator

All instructions are in [AGENTS.md](AGENTS.md) — read it first. Do not duplicate them here.

Start every session with the FlowDesk tool \`brain_start\`; end it with \`brain_wrap\`.
`

/** Which built-in skill an agent should read before a platform's tools. */
export const PLATFORM_SKILL: Record<string, string> = {
  chatgpt: 'chatgpt', flow: 'google-flow', tiktok: 'tiktok', linkedin: 'linkedin', reddit: 'reddit',
  whatsapp: 'whatsapp', facebook: 'facebook', pinterest: 'pinterest', gumroad: 'gumroad',
}

export interface SystemStatus {
  health?: { ranAt: string; status: string; failing: string[]; warnings: string[] } | null
  openReports?: number
  skills?: Array<{ id: string; name: string; description?: string }>
  knowledge?: Record<string, number>
}

const hm = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const plus = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000).toISOString()
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** Account ids and labels can hold the sign-in email; files and briefings never show it. */
export const maskEmail = (s: string) => s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')

export function agentsMd(store: OperatorStore): string {
  return store.getMeta<string>('agentsMd', DEFAULT_AGENTS_MD)
}

function rulesSection(md: string): string {
  const m = md.match(/## Rules\s*\n([\s\S]*?)(?=\n## |\s*$)/)
  return (m ? m[1] : md).trim()
}

function accountLine(a: Account, brands: Map<string, Brand>): string {
  const brand = typeof a.fields.brand === 'string' ? brands.get(a.fields.brand)?.name ?? a.fields.brand : 'no brand yet'
  const purpose = typeof a.fields.purpose === 'string' ? a.fields.purpose : 'purpose not set'
  const extra = [a.fields.dailyLimit ? `limit ${a.fields.dailyLimit}/day` : '', a.fields.rules ? `rules: ${clip(String(a.fields.rules), 80)}` : ''].filter(Boolean).join('; ')
  return `- ${a.platform} · ${maskEmail(a.label)} (${maskEmail(a.slotId)}) → ${brand}, ${purpose}${extra ? `; ${extra}` : ''}${a.lastActionAt ? `; last action ${hm(a.lastActionAt)}` : ''}`
}

function brandLine(b: Brand): string {
  const f = b.fields
  const bits = [f.niche, f.audience && `audience: ${f.audience}`, f.voice && `voice: ${f.voice}`, f.goal && `goal: ${f.goal}`].filter(Boolean).map(String)
  return `- **${b.name}** (${b.id}${b.status !== 'active' ? `, ${b.status}` : ''})${bits.length ? ` — ${clip(bits.join('; '), 220)}` : ''}`
}

export function eventLine(e: OpEvent): string {
  const target = e.targetUrl ?? e.targetId
  return `- ${hm(e.at)} ${e.platform}${e.account ? `/${maskEmail(e.account)}` : ''} ${e.tool} → ${e.outcome}${target ? ` (${clip(target, 80)})` : ''}${e.error ? ` — ${clip(e.error, 100)}` : ''}`
}

function taskLine(t: Task): string {
  return `- ${t.dueAt ? hm(t.dueAt) : 'no date'} · ${t.title}${t.platform ? ` [${t.platform}${t.account ? `/${maskEmail(t.account)}` : ''}]` : ''}${t.state === 'waiting' ? ` — waiting on ${t.waitingOn ?? 'user'}` : ''}`
}

function inboxLine(i: InboxItem): string {
  return `- ${i.needsAgent ? '[needs agent] ' : ''}${i.title} (${i.id})`
}

function jobLine(j: Job): string {
  return `- ${j.recipe} (${j.id}) ${j.status}${j.progress ? `: ${j.progress}` : ''}`
}

/** hot.md: "Now" is computed; "Handoff" is the last agent's note. */
export function hotMd(store: OperatorStore, status: SystemStatus, now = new Date()): string {
  const today = store.listTasks({ state: 'active', to: plus(now, 1) })
  const waiting = store.listTasks({ state: 'waiting' })
  const jobs = store.listJobs({ status: 'active' })
  const inbox = store.listInbox({ status: 'new', limit: 10 })
  const handoff = store.lastHandoff()
  const lines = [
    '# Hot Cache',
    `_Updated ${hm(now.toISOString())} by FlowDesk. "Now" is automatic; "Handoff" is the last agent's note._`,
    '',
    '## Now',
    '### Due in the next 24 hours',
    ...(today.length ? today.slice(0, 10).map(taskLine) : ['- nothing scheduled']),
    '### Waiting on the user',
    ...(waiting.length ? waiting.slice(0, 10).map(taskLine) : ['- nothing']),
    '### Background jobs running',
    ...(jobs.length ? jobs.map(jobLine) : ['- none']),
    '### Ready in the inbox',
    ...(inbox.length ? inbox.map(inboxLine) : ['- empty']),
    '### Tool health',
    status.health
      ? `- last check ${hm(status.health.ranAt)}: ${status.health.status}${status.health.failing.length ? `; failing: ${status.health.failing.join(', ')}` : ''}${status.health.warnings.length ? `; warnings: ${status.health.warnings.join(', ')}` : ''}`
      : '- no health check yet (flowdesk_health_check)',
    `- open problem reports: ${status.openReports ?? 0}`,
    '',
    '## Handoff',
  ]
  if (handoff) {
    const h = handoff.handoff
    lines.push(`_From ${handoff.session.client}, ${hm(handoff.session.lastSeenAt)}_`)
    if (h.focus) lines.push(`**Focus:** ${h.focus}`)
    lines.push(`**Last session:** ${h.summary}`)
    if (h.decisions?.length) lines.push('**Decisions:**', ...h.decisions.map(d => `- ${d}`))
    if (h.next) lines.push(`**Next session start:** ${h.next}`)
  } else {
    lines.push('- no handoff yet')
  }
  return `${lines.join('\n')}\n`
}

export function indexMd(store: OperatorStore, status: SystemStatus): string {
  const brands = store.listBrands()
  const brandMap = new Map(brands.map(b => [b.id, b]))
  const accounts = store.listAccounts()
  const content = store.listContent({ limit: 500 })
  const byStage = content.reduce<Record<string, number>>((acc, c) => { acc[c.stage] = (acc[c.stage] ?? 0) + 1; return acc }, {})
  const learnings = store.listLearnings({ status: 'accepted' })
  const monitors = store.listMonitors()
  const lines = [
    '# Index',
    '_Generated by FlowDesk on every change. Do not edit by hand._',
    '',
    '## Core',
    '- [[AGENTS]] — rules for every connected agent',
    '- [[hot]] — what is happening now and the last handoff',
    '- [[log]] — history: sessions, jobs, health checks, reports',
    '',
    '## Brands',
    ...(brands.length ? brands.map(brandLine) : ['- none yet (brain_record type=brand)']),
    '',
    '## Accounts',
    ...(accounts.length ? accounts.map(a => accountLine(a, brandMap)) : ['- none synced yet']),
    '',
    '## Content',
    `- ${content.length} items: ${Object.entries(byStage).map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`,
    ...content.slice(0, 15).map(c => `- ${c.id} · ${c.kind} · ${clip(c.title, 70)} — ${c.stage}${c.brandId ? ` (${c.brandId})` : ''}`),
    '',
    '## Learnings (accepted)',
    ...(learnings.length ? learnings.slice(0, 20).map(l => `- ${clip(l.statement, 160)}${l.scope ? ` [${l.scope}]` : ''}`) : ['- none yet']),
    '',
    '## Background monitors',
    ...(monitors.length ? monitors.map(m => `- ${m.recipe} every ${m.everyMinutes} min — ${m.status} (${m.id})`) : ['- none']),
    '',
    '## Skills',
    ...(status.skills?.length ? status.skills.map(s => `- ${s.id}${s.description ? ` — ${clip(s.description, 110)}` : ''}`) : ['- see flowdesk_skills_list']),
    '',
    '## Knowledge library',
    ...(status.knowledge && Object.keys(status.knowledge).length ? Object.entries(status.knowledge).map(([t, n]) => `- ${t}: ${n} documents`) : ['- empty']),
  ]
  return `${lines.join('\n')}\n`
}

export function logMd(entries: LogEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at))
  const body = sorted.map(e => `## [${hm(e.at)}] | ${e.type} | ${e.title}\n${e.body ? `\n${e.body.trim()}\n` : ''}`).join('\n')
  return `# Log\n_Append-only history written by FlowDesk. Newest at the bottom._\n\n${body}`
}

/** The log entry for a finished session, from its captured calls. */
export function sessionLogBody(session: Session, events: OpEvent[]): string {
  const minutes = Math.max(1, Math.round((Date.parse(session.endedAt ?? session.lastSeenAt) - Date.parse(session.startedAt)) / 60_000))
  const reads = Object.entries(session.reads).sort((a, b) => b[1] - a[1])
  const lines = [
    `- client: ${session.client}; ${minutes} min; ${session.writes} writes, ${reads.reduce((n, [, c]) => n + c, 0)} reads, ${session.errors} errors; ended by ${session.endReason ?? 'unknown'}`,
  ]
  if (events.length) lines.push('- actions:', ...[...events].reverse().slice(0, 25).map(e => `  ${eventLine(e)}`))
  if (reads.length) lines.push(`- reads: ${reads.slice(0, 8).map(([t, n]) => `${t} ×${n}`).join(', ')}`)
  const h = session.handoff
  if (h) {
    lines.push(`- summary: ${h.summary}`)
    if (h.decisions?.length) lines.push(`- decisions: ${h.decisions.join('; ')}`)
    if (h.next) lines.push(`- next: ${h.next}`)
  } else {
    lines.push('- no handoff (the agent did not call brain_wrap)')
  }
  return lines.join('\n')
}

export interface BriefingInput { platform?: string; brandId?: string; account?: string }

/** The one-call context pack (plan §3.4). Kept near 1,500 tokens. */
export function briefing(store: OperatorStore, status: SystemStatus, input: BriefingInput = {}, now = new Date()): string {
  const brands = store.listBrands()
  const brandMap = new Map(brands.map(b => [b.id, b]))
  let accounts = store.listAccounts({ platform: input.platform })
  if (input.account) accounts = accounts.filter(a => a.slotId === input.account || a.label.toLowerCase() === input.account!.toLowerCase())
  if (input.brandId) accounts = accounts.filter(a => a.fields.brand === input.brandId)
  const accountBrandIds = new Set(accounts.map(a => a.fields.brand).filter((b): b is string => typeof b === 'string'))
  let relevantBrands = input.brandId ? brands.filter(b => b.id === input.brandId) : input.platform || input.account ? brands.filter(b => accountBrandIds.has(b.id)) : brands
  if (!relevantBrands.length) relevantBrands = brands
  const events = store.listEvents({
    platform: input.platform, since: plus(now, -7), limit: 400,
    accounts: input.account || input.brandId ? accounts.map(a => ({ platform: a.platform, slotId: a.slotId, label: a.label })) : undefined,
  })
  const writes = events.filter(e => e.kind === 'write')
  const failed = events.filter(e => e.outcome === 'error')
  const calendar = store.listTasks({ state: 'active', from: now.toISOString(), to: plus(now, 7), brandId: input.brandId }).filter(t => !input.platform || !t.platform || t.platform === input.platform)
  const waiting = store.listTasks({ state: 'waiting' })
  const inbox = store.listInbox({ status: 'new', limit: 8 })
  const jobs = store.listJobs({ status: 'active' })
  const learnings = store.listLearnings({ status: 'accepted', scope: input.brandId ?? input.platform }).slice(0, 6)
  const profile = store.fields('profile')
  const handoff = store.lastHandoff()
  const skill = input.platform ? PLATFORM_SKILL[input.platform] : undefined

  const sections: string[] = []
  sections.push(`# FlowDesk briefing${input.platform ? ` — ${input.platform}` : ''}${input.brandId ? ` — ${input.brandId}` : ''}\n_${hm(now.toISOString())}_`)
  if (Object.keys(profile).length) {
    sections.push(`## The user\n${Object.entries(profile).slice(0, 10).map(([k, v]) => `- ${k}: ${clip(typeof v === 'string' ? v : JSON.stringify(v), 160)}`).join('\n')}`)
  }
  sections.push(`## Rules (from AGENTS.md)\n${clip(rulesSection(agentsMd(store)), 1600)}`)
  sections.push(`## Brands\n${relevantBrands.length ? relevantBrands.map(brandLine).join('\n') : '- none recorded yet — ask the user and save them with brain_record'}`)
  sections.push(`## Accounts\n${accounts.length ? accounts.slice(0, 15).map(a => accountLine(a, brandMap)).join('\n') : '- none'}`)
  sections.push(`## Last 7 days\n- ${writes.length} write actions, ${failed.length} failures${writes.length ? `\n${writes.slice(0, 10).map(eventLine).join('\n')}` : ''}${failed.length ? `\n- failures:\n${failed.slice(0, 5).map(e => `  ${eventLine(e)}`).join('\n')}` : ''}`)
  sections.push(`## Next 7 days\n${calendar.length ? calendar.slice(0, 10).map(taskLine).join('\n') : '- nothing scheduled'}`)
  if (waiting.length) sections.push(`## Waiting on the user\n${waiting.slice(0, 8).map(taskLine).join('\n')}`)
  sections.push(`## Inbox and background work\n${[...inbox.map(inboxLine), ...jobs.map(jobLine)].join('\n') || '- nothing new'}`)
  if (learnings.length) sections.push(`## What has worked (accepted learnings)\n${learnings.map(l => `- ${clip(l.statement, 180)}`).join('\n')}`)
  const health = status.health
  sections.push(`## Tools\n${health ? `- health ${hm(health.ranAt)}: ${health.status}${health.failing.length ? `; failing: ${health.failing.join(', ')}` : ''}` : '- no health check yet'}\n- open problem reports: ${status.openReports ?? 0}${skill ? `\n- read skill \`${skill}\` (flowdesk_skill_get) before using ${input.platform} tools` : ''}`)
  if (handoff) sections.push(`## Last handoff (${handoff.session.client}, ${hm(handoff.session.lastSeenAt)})\n${clip(handoff.handoff.summary, 400)}${handoff.handoff.next ? `\n**Next:** ${clip(handoff.handoff.next, 300)}` : ''}`)
  return sections.join('\n\n')
}
