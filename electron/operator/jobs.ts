/**
 * Background jobs (docs/brain-v3-plan.md §4): "run in background" for MCP
 * agents. A job runs read-only FlowDesk tools in the main process (no AI),
 * saves its full result to disk, records numbers / calendar items / ideas in
 * Brain, and lands in the Inbox. Work that needs thinking ends as an agent
 * packet: the next connected agent takes it, thinks, and writes back.
 *
 * Own job ids, not MCP Tasks: that spec feature is still experimental.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export interface RecipeContext {
  invoke: (method: string, params: Record<string, unknown>) => Promise<any>
  brain: (op: string, args?: Record<string, unknown>) => Promise<any>
  progress: (text: string) => void
}

export interface RecipeOutput {
  summary: string
  data: unknown
  /** The list a reader pages through (jobs.result). */
  items?: unknown[]
  metrics?: Array<{ platform: string; account?: string | null; externalId: string; metrics: Record<string, number> }>
  tasks?: Array<{ title: string; platform: string; account?: string | null; dueAt: string | null; externalId: string; notes?: string }>
  ideas?: Array<{ text: string; source: string; score?: number | null }>
  /** Set when an agent should think about this result. */
  agent?: { title: string; instructions: string }
}

export interface Recipe {
  id: string
  title: string
  description: string
  params: z.ZodTypeAny
  run: (ctx: RecipeContext, params: any) => Promise<RecipeOutput>
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const fail = (r: any, what: string) => {
  if (!r || r.ok === false) throw new Error(`${what}: ${String(r?.error ?? 'no answer').slice(0, 300)}`)
  return r
}
/** The first list among `keys`, else the first array the answer holds (shapes verified 2026-10-09). */
const firstList = (r: any, keys: string[]): any[] => {
  for (const k of keys) if (Array.isArray(r?.[k])) return r[k]
  return (Object.values(r ?? {}).find(Array.isArray) as any[] | undefined) ?? []
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const compact = (o: Record<string, number | null>) => Object.fromEntries(Object.entries(o).filter((e): e is [string, number] => e[1] !== null))

async function accountsOf(ctx: RecipeContext, platform: string, account?: string): Promise<Array<string | undefined>> {
  if (account) return [account]
  const list = arr(await ctx.brain('account.list', { platform }))
  return list.length ? list.map(a => String(a.slotId)) : [undefined]
}

export const RECIPES: Recipe[] = [
  {
    id: 'tiktok.radar',
    title: 'TikTok radar collect + report',
    description: 'Collects new videos for a saved radar niche, then reports the last 24 hours. Ends as an agent packet to pick winners.',
    params: z.object({ niche: z.string().min(1), hours: z.number().int().min(1).max(168).optional() }),
    async run(ctx, p) {
      ctx.progress('collecting')
      fail(await ctx.invoke('tiktok.radarCollect', { id: p.niche }), 'radar collect')
      ctx.progress('building report')
      const r = fail(await ctx.invoke('tiktok.radarReport', { id: p.niche, hours: p.hours ?? 24 }), 'radar report')
      const report = r.report ?? r
      const items = firstList(report, ['topVideos', 'videos', 'items'])
      return {
        summary: `TikTok radar "${p.niche}": ${items.length} top videos in the last ${p.hours ?? 24}h`,
        data: r, items,
        ideas: arr(report.opportunities).slice(0, 5).map((o: any) => ({ text: `TikTok ${p.niche}: ${String(o.title ?? o.idea ?? o.text ?? o.label ?? JSON.stringify(o)).slice(0, 200)}`, source: 'tiktok.radar', score: num(o.score) })),
        agent: { title: `Pick winners from the "${p.niche}" radar`, instructions: 'Read the result with jobs.result, choose the strongest ideas for the matching brand, save them with brain_record type=idea, and save any pattern you see with brain_learning (record).' },
      }
    },
  },
  {
    id: 'tiktok.search',
    title: 'TikTok search',
    description: 'Searches TikTok for a query (read-only).',
    params: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(100).optional(), account: z.string().optional() }),
    async run(ctx, p) {
      const r = fail(await ctx.invoke('tiktok.apiSearch', { query: p.query, limit: p.limit ?? 30, account: p.account }), 'tiktok search')
      const items = firstList(r, ['videos', 'items'])
      return { summary: `TikTok search "${p.query}": ${items.length} results`, data: r, items }
    },
  },
  {
    id: 'pinterest.trends',
    title: 'Pinterest trends',
    description: 'Reads Pinterest trends and saves each as an idea.',
    params: z.object({ country: z.string().optional(), type: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), account: z.string().optional() }),
    async run(ctx, p) {
      const r = fail(await ctx.invoke('pinterest.trends', { country: p.country, type: p.type, limit: p.limit ?? 25, account: p.account }), 'pinterest trends')
      const items = firstList(r, ['terms', 'trends', 'items'])
      return {
        summary: `Pinterest trends: ${items.length}`, data: r, items,
        ideas: items.slice(0, 25).map((t: any) => ({ text: `Pinterest trend: ${String(t.term ?? t.keyword ?? t.name ?? JSON.stringify(t)).slice(0, 200)}`, source: 'pinterest.trends', score: num(t.monthChange ?? t.weekChange ?? t.score) })),
      }
    },
  },
  {
    id: 'pinterest.niche',
    title: 'Pinterest niche research',
    description: 'Researches one niche on Pinterest (search, saves, competition).',
    params: z.object({ niche: z.string().min(1), country: z.string().optional(), queries: z.array(z.string()).max(10).optional(), account: z.string().optional() }),
    async run(ctx, p) {
      const r = fail(await ctx.invoke('pinterest.nicheResearch', p), 'niche research')
      const items = firstList(r, ['topPins', 'pins', 'keywords'])
      return { summary: `Pinterest niche "${p.niche}": ${items.length} items`, data: r, items }
    },
  },
  {
    id: 'pinfactory.nicheScan',
    title: 'Pin factory niche scan',
    description: 'Scores candidate niches on Pinterest demand and Gumroad competition.',
    params: z.object({ candidates: z.array(z.string().min(1)).min(1).max(30), country: z.string().optional(), account: z.string().optional(), gumroadAccount: z.string().optional() }),
    async run(ctx, p) {
      const r = fail(await ctx.invoke('pinFactory.nicheScan', p), 'niche scan')
      const items = firstList(r, ['ranked', 'niches'])
      return {
        summary: `Niche scan: ${items.length} niches scored`, data: r, items,
        ideas: items.slice(0, 10).map((n: any) => ({ text: `Niche: ${String(n.niche ?? n.name ?? n.candidate ?? '').slice(0, 120)}`, source: 'pinFactory.nicheScan', score: num(n.score ?? n.total) })),
        agent: { title: 'Choose niches from the scan', instructions: 'Read jobs.result, recommend the best 1-3 niches with reasons, and save them as ideas for the coloring brand.' },
      }
    },
  },
  {
    id: 'reddit.search',
    title: 'Reddit search',
    description: 'Searches Reddit posts (read-only).',
    params: z.object({ query: z.string().min(1), subreddit: z.string().optional(), sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional(), limit: z.number().int().min(1).max(100).optional(), account: z.string().optional() }),
    async run(ctx, p) {
      const r = fail(await ctx.invoke('reddit.apiSearch', p), 'reddit search')
      const items = firstList(r, ['items', 'posts', 'results'])
      return { summary: `Reddit "${p.query}": ${items.length} posts`, data: r, items }
    },
  },
  {
    id: 'linkedin.search',
    title: 'LinkedIn search',
    description: 'Searches LinkedIn (people, companies or posts).',
    params: z.object({ query: z.string().min(1), resultType: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), account: z.string().optional() }),
    async run(ctx, p) {
      const r = fail(await ctx.invoke('linkedin.search', p), 'linkedin search')
      const items = arr(r.clusters).flatMap((c: any) => arr(c.items))
      return { summary: `LinkedIn "${p.query}": ${items.length} results`, data: r, items }
    },
  },
  {
    id: 'metrics.tiktok',
    title: 'TikTok numbers',
    description: 'Reads views, likes, comments, shares and saves of every post on each TikTok account; scheduled posts go to the calendar.',
    params: z.object({ account: z.string().optional() }),
    async run(ctx, p) {
      const metrics: NonNullable<RecipeOutput['metrics']> = []
      const tasks: NonNullable<RecipeOutput['tasks']> = []
      const errors: string[] = []
      for (const account of await accountsOf(ctx, 'tiktok', p.account)) {
        ctx.progress(`reading ${account ?? 'default account'}`)
        const r = await ctx.invoke('tiktok.listPosts', { account })
        if (!r || r.ok === false) { errors.push(`${account}: ${String(r?.error ?? 'no answer').slice(0, 120)}`); continue }
        for (const post of arr(r.posts)) {
          if (post.isScheduled) {
            tasks.push({ title: `TikTok scheduled: ${String(post.caption || post.id).slice(0, 80)}`, platform: 'tiktok', account: account ?? null, dueAt: post.scheduledAt ?? null, externalId: String(post.id) })
          } else {
            metrics.push({ platform: 'tiktok', account: account ?? null, externalId: String(post.id), metrics: compact({ views: num(post.views), likes: num(post.likes), comments: num(post.comments), shares: num(post.shares), saves: num(post.saves) }) })
          }
        }
      }
      if (!metrics.length && !tasks.length && errors.length) throw new Error(errors.join('; '))
      return { summary: `TikTok: numbers for ${metrics.length} posts, ${tasks.length} scheduled${errors.length ? `; ${errors.length} account(s) failed` : ''}`, data: { errors }, items: metrics, metrics, tasks }
    },
  },
  {
    id: 'metrics.pinterest',
    title: 'Pinterest numbers',
    description: 'Reads saves and comments of the latest pins on each Pinterest account; scheduled pins go to the calendar.',
    params: z.object({ account: z.string().optional(), limit: z.number().int().min(1).max(250).optional() }),
    async run(ctx, p) {
      const metrics: NonNullable<RecipeOutput['metrics']> = []
      const tasks: NonNullable<RecipeOutput['tasks']> = []
      const errors: string[] = []
      for (const account of await accountsOf(ctx, 'pinterest', p.account)) {
        ctx.progress(`reading ${account ?? 'default account'}`)
        const me = await ctx.invoke('pinterest.me', { account })
        const username = me?.username ?? me?.me?.username ?? me?.profile?.username ?? me?.user?.username
        if (!me || me.ok === false || !username) { errors.push(`${account}: ${String(me?.error ?? 'profile not readable').slice(0, 120)}`); continue }
        const pins = await ctx.invoke('pinterest.userPins', { username, limit: p.limit ?? 50, account })
        for (const pin of arr(pins?.pins)) {
          metrics.push({ platform: 'pinterest', account: account ?? null, externalId: String(pin.id), metrics: compact({ saves: num(pin.saves), comments: num(pin.comments), repins: num(pin.repins) }) })
        }
        const scheduled = await ctx.invoke('pinterest.scheduledPins', { account })
        for (const s of arr(scheduled?.scheduledPins)) {
          tasks.push({ title: `Pinterest scheduled: ${String(s.title || s.id).slice(0, 80)}${s.board ? ` → ${s.board}` : ''}`, platform: 'pinterest', account: account ?? null, dueAt: s.publishAt ?? null, externalId: String(s.id) })
        }
      }
      if (!metrics.length && !tasks.length && errors.length) throw new Error(errors.join('; '))
      return { summary: `Pinterest: numbers for ${metrics.length} pins, ${tasks.length} scheduled${errors.length ? `; ${errors.length} account(s) failed` : ''}`, data: { errors }, items: metrics, metrics, tasks }
    },
  },
  {
    id: 'metrics.gumroad',
    title: 'Gumroad sales',
    description: 'Reads sales and revenue per product on each Gumroad account.',
    params: z.object({ account: z.string().optional() }),
    async run(ctx, p) {
      const metrics: NonNullable<RecipeOutput['metrics']> = []
      const errors: string[] = []
      for (const account of await accountsOf(ctx, 'gumroad', p.account)) {
        const r = await ctx.invoke('gumroad.products', { account })
        if (!r || r.ok === false) { errors.push(`${account}: ${String(r?.error ?? 'no answer').slice(0, 120)}`); continue }
        for (const prod of arr(r.products)) {
          if (!prod.permalink) continue
          metrics.push({ platform: 'gumroad', account: account ?? null, externalId: String(prod.permalink), metrics: compact({ sales: num(prod.sales), revenueUsd: num(prod.revenueUsd) }) })
        }
      }
      if (!metrics.length && errors.length) throw new Error(errors.join('; '))
      return { summary: `Gumroad: ${metrics.length} products${errors.length ? `; ${errors.length} account(s) failed` : ''}`, data: { errors }, items: metrics, metrics }
    },
  },
  {
    id: 'whatsapp.digest',
    title: 'WhatsApp unread digest',
    description: 'Reads unread WhatsApp chats and leaves them for an agent to summarise (this replaces the old in-app chat digest).',
    params: z.object({ limit: z.number().int().min(1).max(20).optional(), account: z.string().optional() }),
    async run(ctx, p) {
      const r = fail(await ctx.invoke('whatsapp.unread', { limit: p.limit ?? 10, account: p.account }), 'whatsapp unread')
      const chats = arr(r.chats ?? r.unread ?? r.items)
      return {
        summary: `WhatsApp: ${chats.length} unread chats`, data: r, items: chats,
        agent: chats.length ? { title: `Summarise ${chats.length} unread WhatsApp chats`, instructions: 'Read jobs.result, write a short digest per chat (who, what they want, reply needed?). Save people worth following up with brain_record type=contact, and tasks with brain_record type=task. Do not reply to anyone without the user\'s yes.' } : undefined,
      }
    },
  },
  {
    id: 'brief.daily',
    title: 'Morning brief',
    description: 'Prepares today\'s brief (calendar, waiting items, failures, inbox) as an agent packet.',
    params: z.object({}),
    async run(ctx) {
      const brief = await ctx.brain('briefing', {})
      return { summary: 'Morning brief ready', data: brief, agent: { title: 'Morning brief', instructions: 'Read jobs.result and tell the user, in Roman Urdu, what is due today, what is waiting on them and what failed. Keep it to 6 lines.' } }
    },
  },
  {
    id: 'brief.weekly',
    title: 'Weekly review',
    description: 'Collects the week\'s activity and numbers as an agent packet that turns into learnings.',
    params: z.object({}),
    async run(ctx) {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const activity = await ctx.brain('activity', { since, limit: 500 })
      const metrics = await ctx.brain('metric.latest', { limit: 300 })
      const content = await ctx.brain('content.list', { limit: 200 })
      return {
        summary: `Weekly review: ${arr(activity?.events).length} actions, ${arr(metrics).length} measured items`,
        data: { activity, metrics, content },
        agent: { title: 'Weekly review', instructions: 'Read jobs.result. Compare what was posted with its numbers per brand, write a short review for the user, and save 1-5 learnings with evidence (brain_learning record); retire older ones the numbers no longer support.' },
      }
    },
  },
]

export interface JobsDeps {
  brain: (op: string, args?: Record<string, unknown>) => Promise<any>
  invoke: (method: string, params: Record<string, unknown>) => Promise<any>
  resultsDir: string
  recipes?: Recipe[]
}

const MAX_RUNNING = 2

export class BackgroundJobs {
  private running = 0
  private queue: Array<{ id: string; recipe: Recipe; params: unknown }> = []
  private cancelled = new Set<string>()
  private readonly recipes: Recipe[]

  constructor(private readonly deps: JobsDeps) {
    this.recipes = deps.recipes ?? RECIPES
  }

  listRecipes() {
    return this.recipes.map(r => ({ id: r.id, title: r.title, description: r.description }))
  }

  /** Jobs that were queued or running when FlowDesk last closed never finish; mark them failed. */
  async recover(): Promise<number> {
    const stale = arr(await this.deps.brain('job.list', { status: 'active', limit: 500 }))
    for (const j of stale) await this.deps.brain('job.update', { id: j.id, status: 'failed', error: 'FlowDesk closed while this job was running; start it again' })
    return stale.length
  }

  async start(recipeId: string, rawParams: unknown, opts: { sessionId?: string | null; monitorId?: string | null } = {}) {
    const recipe = this.recipes.find(r => r.id === recipeId)
    if (!recipe) throw new Error(`unknown job recipe "${recipeId}"; known: ${this.recipes.map(r => r.id).join(', ')}`)
    const params = recipe.params.parse(rawParams ?? {})
    const job = await this.deps.brain('job.create', { recipe: recipe.id, params, sessionId: opts.sessionId ?? null, monitorId: opts.monitorId ?? null })
    this.queue.push({ id: job.id, recipe, params })
    this.pump()
    return job
  }

  private pump() {
    while (this.running < MAX_RUNNING && this.queue.length) {
      const next = this.queue.shift()!
      this.running++
      void this.execute(next.id, next.recipe, next.params).finally(() => { this.running--; this.pump() })
    }
  }

  /** Waits until nothing is queued or running (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.running || this.queue.length) await new Promise(r => setTimeout(r, 10))
  }

  private async execute(id: string, recipe: Recipe, params: unknown) {
    const brain = this.deps.brain
    if (this.cancelled.has(id)) return
    await brain('job.update', { id, status: 'running' })
    try {
      const out = await recipe.run({
        invoke: this.deps.invoke,
        brain,
        progress: text => { void brain('job.update', { id, progress: text.slice(0, 300) }).catch(() => {}) },
      }, params)
      if (this.cancelled.has(id)) return
      mkdirSync(this.deps.resultsDir, { recursive: true })
      const resultPath = join(this.deps.resultsDir, `${id}.json`)
      writeFileSync(resultPath, JSON.stringify({ jobId: id, recipe: recipe.id, params, finishedAt: new Date().toISOString(), summary: out.summary, items: out.items ?? null, data: out.data }, null, 2))
      for (const m of out.metrics ?? []) await brain('metric.record', m)
      for (const t of out.tasks ?? []) await brain('task.upsert', { ...t, source: 'calendar', state: 'open' })
      for (const i of out.ideas ?? []) await brain('idea.add', i)
      await brain('job.update', { id, status: 'completed', summary: out.summary, resultPath })
      await brain('inbox.add', {
        kind: 'job_result', title: out.agent?.title ?? out.summary, body: out.summary, refId: id,
        needsAgent: !!out.agent, packet: out.agent ? { jobId: id, instructions: out.agent.instructions } : undefined,
      })
    } catch (e) {
      if (this.cancelled.has(id)) return
      const error = e instanceof Error ? e.message : String(e)
      await brain('job.update', { id, status: 'failed', error: error.slice(0, 2000) })
      await brain('inbox.add', { kind: 'job_failed', title: `${recipe.title} failed`, body: error.slice(0, 1000), refId: id })
    }
  }

  async cancel(id: string) {
    this.cancelled.add(id)
    this.queue = this.queue.filter(q => q.id !== id)
    return this.deps.brain('job.update', { id, status: 'cancelled' })
  }

  /** One page of a finished job's result list (or its whole data when it has no list). */
  async result(id: string, page = 1, pageSize = 20) {
    const job = await this.deps.brain('job.get', { id })
    if (!job) throw new Error(`no job ${id}`)
    if (job.status !== 'completed' || !job.resultPath) return { job, ready: false }
    const saved = JSON.parse(readFileSync(job.resultPath, 'utf8')) as { items: unknown[] | null; data: unknown; summary: string }
    if (!Array.isArray(saved.items)) return { job, ready: true, summary: saved.summary, data: saved.data }
    const size = Math.max(1, Math.min(100, pageSize))
    const pages = Math.max(1, Math.ceil(saved.items.length / size))
    const p = Math.max(1, Math.min(pages, page))
    return { job, ready: true, summary: saved.summary, page: p, pages, total: saved.items.length, items: saved.items.slice((p - 1) * size, p * size) }
  }

  /** Starts every monitor that is due. Called once a minute. */
  async tick(): Promise<number> {
    const due = arr(await this.deps.brain('monitor.takeDue', {}))
    for (const m of due) {
      try { await this.start(m.recipe, m.params, { monitorId: m.id }) } catch (e) {
        await this.deps.brain('inbox.add', { kind: 'job_failed', title: `Monitor ${m.recipe} could not start`, body: e instanceof Error ? e.message : String(e), refId: m.id })
      }
    }
    return due.length
  }
}
