import { mkdtempSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrainDatabase } from './database'
import {
  MONITOR_DEFAULT_MINIMUM_SCORE,
  MONITOR_MINIMUM_INTERVAL_MINUTES,
  MONITOR_TICK_INTERVAL_MS,
  MonitorScheduler,
  createMonitorSchedulerPort,
} from './scheduler'
import type { BrainMonitor } from '../../src/types/brain'

const roots: string[] = []
const START = '2026-09-12T10:00:00.000Z'

function createBrain() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-monitor-'))
  roots.push(root)
  const database = new BrainDatabase(join(root, 'brain.sqlite'))
  database.registerRecipe({ id: 'notebooklm.research', version: 1, title: 'NotebookLM Research', steps: ['capture', 'normalize', 'summarize'] })
  database.registerRecipe({ id: 'whatsapp.unread_intelligence', version: 1, title: 'WhatsApp Unread Intelligence', steps: ['capture', 'normalize', 'summarize'] })
  const scope = database.ensureScope({ type: 'project', externalRef: 'monitor-project', name: 'Monitor Project' })
  return { database, scopeId: scope.id }
}

/** Wires the shipped database port so the clock tests exercise real persistence. */
function createScheduler(database: BrainDatabase, onRun?: (monitor: BrainMonitor, windowStart: string) => void) {
  const runs: Array<{ monitorId: string; windowStart: string }> = []
  const port = createMonitorSchedulerPort(database, (monitor, windowStart) => {
    runs.push({ monitorId: monitor.id, windowStart })
    onRun?.(monitor, windowStart)
  })
  return { scheduler: new MonitorScheduler(port), runs }
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse(START) })
})

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('MonitorScheduler clock', () => {
  it('enqueues exactly one job when an active monitor is due', () => {
    const { database, scopeId } = createBrain()
    const monitor = database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 30 })
    const { scheduler } = createScheduler(database)
    scheduler.start()

    // Not due yet: the first window opens intervalMinutes after creation.
    vi.advanceTimersByTime(MONITOR_TICK_INTERVAL_MS)
    expect(database.listJobs()).toHaveLength(0)

    vi.advanceTimersByTime(30 * 60_000)
    const jobs = database.listJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ recipeId: 'notebooklm.research', scopeId, status: 'queued' })
    expect(jobs[0].parameters.monitorId).toBe(monitor.id)
    expect(database.getMonitor(monitor.id)?.lastRunAt).not.toBeNull()

    scheduler.stop()
    database.close()
  })

  it('enqueues nothing for a paused monitor', () => {
    const { database, scopeId } = createBrain()
    const monitor = database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    database.setMonitorStatus(monitor.id, 'paused')
    const { scheduler, runs } = createScheduler(database)
    scheduler.start()

    vi.advanceTimersByTime(6 * 60 * 60_000)
    expect(runs).toEqual([])
    expect(database.listJobs()).toHaveLength(0)

    // Resuming makes the overdue window run once on the next tick.
    database.setMonitorStatus(monitor.id, 'active')
    vi.advanceTimersByTime(MONITOR_TICK_INTERVAL_MS)
    expect(database.listJobs()).toHaveLength(1)

    scheduler.stop()
    database.close()
  })

  it('coalesces every interval missed while FlowDesk was closed into one run', () => {
    const { database, scopeId } = createBrain()
    const monitor = database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })

    // FlowDesk is closed for eight hours: 32 windows elapse with no process running.
    vi.setSystemTime(Date.parse(START) + 8 * 60 * 60_000)
    const { scheduler, runs } = createScheduler(database)
    scheduler.start()
    vi.advanceTimersByTime(MONITOR_TICK_INTERVAL_MS)

    expect(runs).toHaveLength(1)
    expect(database.listJobs()).toHaveLength(1)
    const next = database.getMonitor(monitor.id)?.nextRunAt ?? ''
    expect(Date.parse(next)).toBeGreaterThan(Date.now())
    expect(Date.parse(next) - Date.now()).toBeLessThanOrEqual(15 * 60_000)

    scheduler.stop()
    database.close()
  })

  it('never enqueues twice for the same window', () => {
    const { database, scopeId } = createBrain()
    const monitor = database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    const { scheduler, runs } = createScheduler(database)

    vi.setSystemTime(Date.parse(START) + 20 * 60_000)
    // Two ticks inside one window, plus a replayed run of the same window.
    scheduler.tick()
    scheduler.tick()
    const window = runs[0].windowStart
    scheduler.runWindow(database.getMonitor(monitor.id) as BrainMonitor, window)

    expect(runs).toHaveLength(1)
    expect(database.listJobs()).toHaveLength(1)

    // The next window is a different job, not a deduplicated repeat.
    vi.setSystemTime(Date.parse(START) + 40 * 60_000)
    scheduler.tick()
    expect(database.listJobs()).toHaveLength(2)

    scheduler.stop()
    database.close()
  })

  it('runs only inside the FlowDesk process and registers no external service', () => {
    const { database, scopeId } = createBrain()
    database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    const { scheduler, runs } = createScheduler(database)
    scheduler.start()
    expect(scheduler.running).toBe(true)

    // Stopping the utility process stops every monitor: nothing outlives it.
    scheduler.stop()
    expect(scheduler.running).toBe(false)
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(runs).toEqual([])
    expect(database.listJobs()).toHaveLength(0)

    const source = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8')
    for (const forbidden of ['child_process', 'schtasks', 'launchd', 'crontab', 'Task Scheduler', 'setLoginItemSettings']) {
      expect(source).not.toContain(forbidden)
    }

    database.close()
  })
})

describe('Monitor model', () => {
  it('rejects intervals below the 15 minute minimum and unregistered recipes', () => {
    const { database, scopeId } = createBrain()
    expect(MONITOR_MINIMUM_INTERVAL_MINUTES).toBe(15)
    expect(MONITOR_TICK_INTERVAL_MS).toBe(60_000)
    expect(() => database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 14 })).toThrow(/15/)
    expect(() => database.createMonitor({ scopeId, recipeId: 'evil.arbitrary', intervalMinutes: 60 })).toThrow(/recipe/i)
    database.close()
  })

  it('defaults the minimum actionable score to 70 and supports delete', () => {
    const { database, scopeId } = createBrain()
    const monitor = database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    expect(monitor.minimumScore).toBe(MONITOR_DEFAULT_MINIMUM_SCORE)
    expect(MONITOR_DEFAULT_MINIMUM_SCORE).toBe(70)
    expect(database.listMonitors(scopeId)).toHaveLength(1)
    expect(database.deleteMonitor(monitor.id)).toBe(true)
    expect(database.listMonitors(scopeId)).toHaveLength(0)
    database.close()
  })

  it('keeps a monitor on a private recipe behind the same consent gate a manual run hits', () => {
    const { database, scopeId } = createBrain()
    database.createMonitor({ scopeId, recipeId: 'whatsapp.unread_intelligence', intervalMinutes: 15 })
    const { scheduler, runs } = createScheduler(database)

    vi.setSystemTime(Date.parse(START) + 20 * 60_000)
    scheduler.tick()
    expect(runs).toEqual([])
    expect(database.listJobs()).toHaveLength(0)

    database.grantConsent({ scopeId, recipeId: 'whatsapp.unread_intelligence', provider: 'local-brain', fields: ['message_text'] })
    vi.setSystemTime(Date.parse(START) + 40 * 60_000)
    scheduler.tick()
    expect(database.listJobs()).toHaveLength(1)

    database.close()
  })
})

describe('Monitor actionability threshold', () => {
  function completeMonitorRun(database: BrainDatabase, jobId: string) {
    database.completeJob(jobId, { recordCount: 3, actionable: true, summary: 'monitor run' })
  }

  it('stays silent when no opportunity meets the minimum score', () => {
    const { database, scopeId } = createBrain()
    database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    const { scheduler } = createScheduler(database)
    vi.setSystemTime(Date.parse(START) + 20 * 60_000)
    scheduler.tick()

    database.upsertOpportunity({ scopeId, fingerprint: 'fp-low', category: 'warm_opportunity', title: 'Low', summary: 'Below threshold', score: 55, confidence: 0.5, freshness: 'fresh' })
    completeMonitorRun(database, database.listJobs()[0].id)

    expect(database.listQueuedContinuations()).toEqual([])
    database.close()
  })

  it('queues one continuation when an opportunity newly crosses the threshold', () => {
    const { database, scopeId } = createBrain()
    const monitor = database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    const { scheduler } = createScheduler(database)
    vi.setSystemTime(Date.parse(START) + 20 * 60_000)
    scheduler.tick()

    database.upsertOpportunity({ scopeId, fingerprint: 'fp-hot', category: 'warm_opportunity', title: 'Hot', summary: 'Above threshold', score: 82, confidence: 0.9, freshness: 'fresh' })
    completeMonitorRun(database, database.listJobs()[0].id)

    const queued = database.listQueuedContinuations()
    expect(queued).toHaveLength(1)
    expect(queued[0].mode).toBe('actionable_only')
    expect(queued[0].sessionId).toBe(`monitor:${monitor.scopeId}`)
    database.close()
  })

  it('never notifies twice for an unchanged fingerprint that is already above the threshold', () => {
    const { database, scopeId } = createBrain()
    database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    const { scheduler } = createScheduler(database)

    vi.setSystemTime(Date.parse(START) + 20 * 60_000)
    scheduler.tick()
    database.upsertOpportunity({ scopeId, fingerprint: 'fp-hot', category: 'warm_opportunity', title: 'Hot', summary: 'Above threshold', score: 82, confidence: 0.9, freshness: 'fresh' })
    completeMonitorRun(database, database.listJobs()[0].id)
    for (const item of database.listQueuedContinuations()) database.consumeContinuation(item.id)

    // Second window re-detects the same opportunity, slightly higher but unchanged in kind.
    vi.setSystemTime(Date.parse(START) + 40 * 60_000)
    scheduler.tick()
    database.upsertOpportunity({ scopeId, fingerprint: 'fp-hot', category: 'warm_opportunity', title: 'Hot', summary: 'Above threshold', score: 88, confidence: 0.9, freshness: 'fresh' })
    const second = database.listJobs().find(job => job.status === 'queued') as { id: string }
    completeMonitorRun(database, second.id)

    expect(database.listQueuedContinuations()).toEqual([])

    // A genuinely new fingerprint above the threshold still notifies.
    vi.setSystemTime(Date.parse(START) + 60 * 60_000)
    scheduler.tick()
    database.upsertOpportunity({ scopeId, fingerprint: 'fp-new', category: 'warm_opportunity', title: 'New', summary: 'Fresh signal', score: 91, confidence: 0.9, freshness: 'fresh' })
    const third = database.listJobs().find(job => job.status === 'queued') as { id: string }
    completeMonitorRun(database, third.id)

    expect(database.listQueuedContinuations()).toHaveLength(1)
    database.close()
  })

  it('notifies when a known fingerprint rises from below to above the threshold', () => {
    const { database, scopeId } = createBrain()
    database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    const { scheduler } = createScheduler(database)

    vi.setSystemTime(Date.parse(START) + 20 * 60_000)
    scheduler.tick()
    database.upsertOpportunity({ scopeId, fingerprint: 'fp-rising', category: 'warm_opportunity', title: 'Rising', summary: 'Below for now', score: 40, confidence: 0.5, freshness: 'fresh' })
    completeMonitorRun(database, database.listJobs()[0].id)
    expect(database.listQueuedContinuations()).toEqual([])

    vi.setSystemTime(Date.parse(START) + 40 * 60_000)
    scheduler.tick()
    database.upsertOpportunity({ scopeId, fingerprint: 'fp-rising', category: 'warm_opportunity', title: 'Rising', summary: 'Now actionable', score: 77, confidence: 0.8, freshness: 'fresh' })
    const second = database.listJobs().find(job => job.status === 'queued') as { id: string }
    completeMonitorRun(database, second.id)

    expect(database.listQueuedContinuations()).toHaveLength(1)
    database.close()
  })

  it('ignores opportunities from other scopes', () => {
    const { database, scopeId } = createBrain()
    const other = database.ensureScope({ type: 'client', externalRef: 'other-client', name: 'Other Client' })
    database.createMonitor({ scopeId, recipeId: 'notebooklm.research', intervalMinutes: 15 })
    const { scheduler } = createScheduler(database)
    vi.setSystemTime(Date.parse(START) + 20 * 60_000)
    scheduler.tick()

    database.upsertOpportunity({ scopeId: other.id, fingerprint: 'fp-elsewhere', category: 'warm_opportunity', title: 'Elsewhere', summary: 'Other scope', score: 95, confidence: 0.9, freshness: 'fresh' })
    completeMonitorRun(database, database.listJobs()[0].id)

    expect(database.listQueuedContinuations()).toEqual([])
    database.close()
  })
})
