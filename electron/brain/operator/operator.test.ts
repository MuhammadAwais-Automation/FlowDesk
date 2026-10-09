import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { OperatorService } from './ops'

function make(start = '2026-10-09T10:00:00.000Z') {
  let t = Date.parse(start)
  const clock = () => new Date(t)
  const advance = (ms: number) => { t += ms }
  const dir = mkdtempSync(join(tmpdir(), 'operator-'))
  const svc = new OperatorService(new DatabaseSync(':memory:'), dir, { countsByType: () => ({ me: 2, skill: 5 }) }, clock)
  const op = (name: string, args: unknown = {}) => svc.handle(name, args) as any
  return { svc, op, advance, dir }
}

const ACCOUNTS = [
  { platform: 'tiktok', slotId: 'social-tiktok', label: 'Account 1' },
  { platform: 'tiktok', slotId: 'social-tiktok-2', label: 'Account 2' },
  { platform: 'pinterest', slotId: 'social-pinterest', label: 'Account 1' },
]

describe('operator brain', () => {
  it('keeps the history of a fact instead of overwriting it', () => {
    const { op, advance } = make()
    op('profile.set', { field: 'goal', value: '10k followers' })
    advance(86_400_000)
    op('profile.set', { field: 'goal', value: '50k followers' })
    expect(op('profile.get').fields.goal).toBe('50k followers')
    const history = op('history', { subject: 'profile', field: 'goal' })
    expect(history.map((f: any) => [f.value, f.validTo !== null])).toEqual([['10k followers', true], ['50k followers', false]])
  })

  it('holds proposed facts until the user accepts them', () => {
    const { op } = make()
    const p = op('profile.set', { field: 'name', value: 'Awais', status: 'proposed', source: 'second-brain' })
    expect(op('profile.get').fields.name).toBeUndefined()
    op('fact.decide', { id: p.id, decision: 'accept' })
    expect(op('profile.get').fields.name).toBe('Awais')
  })

  it('tags accounts with a brand and refuses an unknown brand or account', () => {
    const { op } = make()
    op('accounts.sync', { accounts: ACCOUNTS })
    op('brand.upsert', { name: 'Alpha Paws', fields: { niche: 'cat videos' } })
    expect(() => op('account.update', { platform: 'tiktok', account: 'Account 2', fields: { brand: 'nope' } })).toThrow(/unknown brand/)
    expect(() => op('account.update', { platform: 'tiktok', account: 'Account 9', fields: { purpose: 'main' } })).toThrow(/unknown tiktok account/)
    const a = op('account.update', { platform: 'tiktok', account: 'Account 2', fields: { brand: 'alpha-paws', purpose: 'main' } })
    expect(a.fields).toEqual({ brand: 'alpha-paws', purpose: 'main' })
    expect(op('account.list', { brandId: 'alpha-paws' }).map((x: any) => x.slotId)).toEqual(['social-tiktok-2'])
  })

  it('records writes as events and only counts successful reads', () => {
    const { op } = make()
    op('accounts.sync', { accounts: ACCOUNTS })
    op('ledger.record', { sessionId: 's1', client: 'claude-code', platform: 'tiktok', tool: 'tiktok.listPosts', kind: 'read', outcome: 'ok' })
    op('ledger.record', { sessionId: 's1', platform: 'tiktok', tool: 'tiktok.listPosts', kind: 'read', outcome: 'ok' })
    op('ledger.record', { sessionId: 's1', platform: 'tiktok', account: 'Account 2', tool: 'tiktok.uploadVideo', kind: 'write', outcome: 'ok', targetId: '7550000000000000001' })
    op('ledger.record', { sessionId: 's1', platform: 'tiktok', account: 'Account 2', tool: 'tiktok.editVideoCaption', kind: 'write', outcome: 'error', error: 'caption too long' })
    const activity = op('activity', { platform: 'tiktok', account: 'Account 2' })
    expect(activity.events).toHaveLength(2)
    expect(activity.totals['tiktok/Account 2 tiktok.uploadVideo']).toEqual({ ok: 1, error: 0 })
    const session = op('sessions.list')[0]
    expect(session).toMatchObject({ id: 's1', client: 'claude-code', writes: 2, errors: 1, reads: { 'tiktok.listPosts': 2 } })
    expect(op('account.list', { platform: 'tiktok' })[1].lastActionAt).toBe('2026-10-09T10:00:00.000Z')
  })

  it('logs a wrapped session with its handoff, and an abandoned one without', () => {
    const { op, svc, advance } = make()
    op('ledger.record', { sessionId: 'a', client: 'claude-code', platform: 'pinterest', tool: 'pinterest.createPin', kind: 'write', outcome: 'ok', targetId: '123' })
    op('session.wrap', { sessionId: 'a', summary: 'Scheduled 3 coloring pins.', decisions: ['Use board Coloring Pages'], next: 'Check saves on Friday' })
    op('ledger.record', { sessionId: 'b', client: 'claude-desktop', platform: 'reddit', tool: 'reddit.apiSearch', kind: 'read', outcome: 'ok' })
    advance(3 * 60 * 60_000)
    expect(svc.sweepIdleSessions()).toBe(1)
    const log = op('log.list')
    expect(log.map((e: any) => e.type)).toEqual(['session', 'session'])
    expect(log[1].body).toContain('summary: Scheduled 3 coloring pins.')
    expect(log[0].body).toContain('no handoff')
    expect(svc.render('hot')).toContain('**Next session start:** Check saves on Friday')
  })

  it('threads a content item from creation to placement to numbers', () => {
    const { op } = make()
    const c = op('content.create', { kind: 'pin', title: 'Mandala coloring page', brandId: 'coloring', stage: 'made' })
    op('content.link', { contentId: c.id, type: 'prompt', detail: 'mandala, thick lines' })
    op('ledger.record', { sessionId: 's', platform: 'pinterest', account: 'Account 1', tool: 'pinterest.createPin', kind: 'write', outcome: 'ok', targetId: '987', targetUrl: 'https://pinterest.com/pin/987', contentId: c.id })
    expect(op('content.get', { id: c.id }).content.stage).toBe('live')
    op('metric.record', { platform: 'pinterest', externalId: '987', metrics: { saves: 12, impressions: 400 } })
    const got = op('content.get', { id: c.id })
    expect(got.content.stage).toBe('measured')
    expect(got.links.map((l: any) => l.type)).toEqual(['prompt', 'placement'])
    expect(got.metrics[0].metrics).toEqual({ saves: 12, impressions: 400 })
  })

  it('builds a briefing scoped to a platform with brands, accounts, activity and the skill to read', () => {
    const { op } = make()
    op('accounts.sync', { accounts: ACCOUNTS })
    op('brand.upsert', { name: 'Alpha Paws', fields: { niche: 'cat videos', voice: 'playful' } })
    op('brand.upsert', { name: 'Codveon', fields: { niche: 'agency' } })
    op('account.update', { platform: 'tiktok', account: 'Account 1', fields: { brand: 'alpha-paws', purpose: 'main' } })
    op('ledger.record', { platform: 'tiktok', account: 'Account 1', tool: 'tiktok.uploadVideo', kind: 'write', outcome: 'ok', targetId: '1' })
    op('learning.propose', { statement: 'Cat videos with a hook in the first second get 3x views', scope: 'alpha-paws' })
    const l = op('learning.list', { status: 'proposed' })[0]
    op('learning.decide', { id: l.id, decision: 'accept' })
    const text = op('briefing', { platform: 'tiktok' }).text as string
    expect(text).toContain('Alpha Paws')
    expect(text).not.toContain('Codveon')
    expect(text).toContain('tiktok · Account 1 (social-tiktok) → Alpha Paws, main')
    expect(text).toContain('1 write actions')
    expect(text).toContain('read skill `tiktok`')
    expect(text).toContain('## Rules (from AGENTS.md)')
    expect(text.length).toBeLessThan(7000)
    const scoped = op('briefing', { platform: 'tiktok', brandId: 'alpha-paws' }).text as string
    expect(scoped).toContain('3x views')
  })

  it('starts a session with rules, hot cache and briefing, and remembers it was briefed', () => {
    const { op } = make()
    expect(op('session.briefed', { sessionId: 'x' }).briefed).toBe(false)
    const start = op('session.start', { sessionId: 'x', client: 'claude-code', platform: 'pinterest' })
    expect(start.agents).toContain('# AGENTS.md')
    expect(start.hot).toContain('# Hot Cache')
    expect(start.briefing).toContain('FlowDesk briefing — pinterest')
    expect(op('session.briefed', { sessionId: 'x' }).briefed).toBe(true)
  })

  it('writes the five Second-Brain files', () => {
    const { op, svc, dir } = make()
    op('brand.upsert', { name: 'Alpha Paws' })
    svc.writeFiles()
    for (const f of ['AGENTS', 'CLAUDE', 'hot', 'index', 'log']) expect(readFileSync(join(dir, `${f}.md`), 'utf8').length).toBeGreaterThan(10)
    const index = readFileSync(join(dir, 'index.md'), 'utf8')
    expect(index).toContain('**Alpha Paws**')
    expect(index).toContain('me: 2 documents')
    svc.close()
  })

  it('runs monitors once per period and logs finished jobs', () => {
    const { op, advance } = make()
    const m = op('monitor.create', { recipe: 'tiktok.radar', params: { niche: 'cats' }, everyMinutes: 60 })
    expect(op('monitor.takeDue').map((x: any) => x.id)).toEqual([m.id])
    expect(op('monitor.takeDue')).toEqual([])
    advance(61 * 60_000)
    expect(op('monitor.takeDue')).toHaveLength(1)
    const j = op('job.create', { recipe: 'tiktok.radar', params: {} })
    op('job.update', { id: j.id, status: 'running', progress: '10/40' })
    op('job.update', { id: j.id, status: 'completed', summary: '40 videos' })
    expect(op('log.list', { type: 'job' })[0].title).toBe('tiktok.radar completed')
  })

  it('proposes the profile and brands from the vault once, for the user to accept or reject', () => {
    const svc = new OperatorService(new DatabaseSync(':memory:'), null, {
      countsByType: () => ({}),
      seedDocs: () => [
        { path: 'wiki/me/positioning.md', title: 'Positioning', body: '# Positioning\r\n_Last updated: 2026-06-17_\r\n\r\n## Current\r\nAwais is an **AI Engineer** building [[projects/FlowDesk|FlowDesk]].' },
        { path: 'wiki/business/agency/overview.md', title: 'Codveon — Digital Agency', body: '# Codveon\nA digital agency co-founded with a partner.' },
      ],
      memories: () => [{ id: 'm1', kind: 'preference', text: 'Alpha Paws hero character is a black cat.' }],
    })
    const op = (name: string, args: unknown = {}) => svc.handle(name, args) as any
    expect(op('seed.fromKnowledge')).toEqual({ ok: true, profile: 2, brands: 4 })
    expect(op('seed.fromKnowledge')).toMatchObject({ skipped: true })
    expect(op('profile.get').proposed.find((f: any) => f.field === 'positioning').value).toBe('Awais is an AI Engineer building FlowDesk.')
    const brands = op('brand.list')
    expect(brands.map((b: any) => [b.id, b.status])).toContainEqual(['alpha-paws', 'proposed'])
    expect(brands.find((b: any) => b.id === 'alpha-paws').fields).toEqual({})
    op('brand.decide', { id: 'alpha-paws', decision: 'accept' })
    expect(op('brand.get', { id: 'alpha-paws' })).toMatchObject({ status: 'active', fields: { niche: 'TikTok cat videos (Alpha Paws channel)', rules: 'Alpha Paws hero character is a black cat.' } })
    op('brand.decide', { id: 'codveon', decision: 'reject' })
    expect(op('brand.list').map((b: any) => b.id)).not.toContain('codveon')
  })

  it('rejects malformed input', () => {
    const { op } = make()
    expect(() => op('nope')).toThrow(/unknown operator op/)
    expect(() => op('ledger.record', { platform: 'x' })).toThrow()
  })
})
