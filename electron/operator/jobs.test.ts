import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { OperatorService } from '../brain/operator/ops'
import { BackgroundJobs } from './jobs'

function setup(invoke: (method: string, params: Record<string, unknown>) => Promise<any>) {
  const svc = new OperatorService(new DatabaseSync(':memory:'), null)
  const brain = async (op: string, args: Record<string, unknown> = {}) => svc.handle(op, args) as any
  const jobs = new BackgroundJobs({ brain, invoke, resultsDir: mkdtempSync(join(tmpdir(), 'jobs-')) })
  return { svc, brain, jobs }
}

describe('background jobs', () => {
  it('runs a recipe in the background, saves the result, records numbers and calendar items, and lands in the inbox', async () => {
    const { brain, jobs } = setup(async (method, params) => {
      expect(method).toBe('tiktok.listPosts')
      expect(params.account).toBe('social-tiktok')
      return { ok: true, posts: [
        { id: '1', views: 1200, likes: 80, comments: 4, shares: 2, saves: 9, isScheduled: false },
        { id: '2', caption: 'cat on a roomba', isScheduled: true, scheduledAt: '2026-10-10T09:00:00.000Z' },
      ] }
    })
    await brain('accounts.sync', { accounts: [{ platform: 'tiktok', slotId: 'social-tiktok', label: 'Account 1' }] })
    const job = await jobs.start('metrics.tiktok', {}, { sessionId: 's1' })
    expect(job.status).toBe('queued')
    await jobs.idle()
    expect(await brain('job.get', { id: job.id })).toMatchObject({ status: 'completed', summary: 'TikTok: numbers for 1 posts, 1 scheduled', sessionId: 's1' })
    expect((await brain('metric.latest', {}))[0]).toMatchObject({ platform: 'tiktok', externalId: '1', metrics: { views: 1200, saves: 9 } })
    expect((await brain('task.list', {}))[0]).toMatchObject({ source: 'calendar', platform: 'tiktok', externalId: '2', dueAt: '2026-10-10T09:00:00.000Z' })
    expect((await brain('inbox.list', {}))[0]).toMatchObject({ kind: 'job_result', refId: job.id, needsAgent: false })
    const page = await jobs.result(job.id, 1, 10)
    expect(page).toMatchObject({ ready: true, total: 1, pages: 1 })
  })

  it('does not duplicate calendar items when the same schedule is read twice', async () => {
    const { brain, jobs } = setup(async () => ({ ok: true, scheduledPins: [{ id: 'sp1', title: 'Mandala', publishAt: '2026-10-11T10:00:00.000Z' }], pins: [], username: 'me' }))
    await jobs.start('metrics.pinterest', { account: 'social-pinterest' })
    await jobs.idle()
    await jobs.start('metrics.pinterest', { account: 'social-pinterest' })
    await jobs.idle()
    expect(await brain('task.list', {})).toHaveLength(1)
  })

  it('leaves an agent packet for work that needs thinking', async () => {
    const { brain, jobs } = setup(async () => ({ ok: true, chats: [{ name: 'Client A', messages: ['price?'] }] }))
    const job = await jobs.start('whatsapp.digest', {})
    await jobs.idle()
    const item = (await brain('inbox.list', { needsAgent: true }))[0]
    expect(item).toMatchObject({ needsAgent: true, refId: job.id, title: 'Summarise 1 unread WhatsApp chats' })
    expect(item.packet.instructions).toContain('Do not reply')
  })

  it('fails a job whose tool fails, with the reason in the inbox', async () => {
    const { brain, jobs } = setup(async () => ({ ok: false, error: 'not signed in' }))
    const job = await jobs.start('reddit.search', { query: 'coloring books' })
    await jobs.idle()
    expect(await brain('job.get', { id: job.id })).toMatchObject({ status: 'failed', error: 'reddit search: not signed in' })
    expect((await brain('inbox.list', {}))[0]).toMatchObject({ kind: 'job_failed' })
  })

  it('rejects unknown recipes and bad parameters before creating a job', async () => {
    const { brain, jobs } = setup(async () => ({ ok: true }))
    await expect(jobs.start('nope', {})).rejects.toThrow(/unknown job recipe/)
    await expect(jobs.start('reddit.search', {})).rejects.toThrow()
    expect(await brain('job.list', {})).toEqual([])
  })

  it('starts due monitors on tick, and marks jobs left running by a previous run as failed', async () => {
    const { brain, jobs } = setup(async () => ({ ok: true, posts: [] }))
    await brain('job.create', { recipe: 'reddit.search', params: {} })
    expect(await jobs.recover()).toBe(1)
    await brain('monitor.create', { recipe: 'reddit.search', params: { query: 'cats' }, everyMinutes: 60 })
    expect(await jobs.tick()).toBe(1)
    await jobs.idle()
    expect((await brain('job.list', { status: 'completed' }))[0]).toMatchObject({ recipe: 'reddit.search' })
  })
})
