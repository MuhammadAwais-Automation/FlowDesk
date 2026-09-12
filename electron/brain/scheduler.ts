import type { BrainMonitor } from '../../src/types/brain'
import type { BrainDatabase } from './database'

/** A monitor may never run more often than this, however it was configured. */
export const MONITOR_MINIMUM_INTERVAL_MINUTES = 15
/** Default actionability bar: below this, a monitor stays completely silent. */
export const MONITOR_DEFAULT_MINIMUM_SCORE = 70
/** The scheduler wakes once a minute and only while FlowDesk itself is running. */
export const MONITOR_TICK_INTERVAL_MS = 60_000
/** Agent context budget for a monitor resume, inside the 2,000 token hard cap. */
export const MONITOR_CONTINUATION_CONTEXT_BUDGET = 1_200

const PRIVATE_RECIPE_PREFIXES = ['whatsapp.', 'linkedin.']
const CONSENT_PROVIDER = 'local-brain'

/**
 * Monitor resumes are unattended, so they carry no interactive session. They are
 * addressed to a synthetic per-scope session instead: every monitor result for
 * one scope coalesces into a single Agent turn, a monitor can never be grouped
 * into (and so never pollute or hijack) a user's live session, and cross-scope
 * results can never share a turn.
 */
export function monitorContinuationSessionId(scopeId: string) {
  return `monitor:${scopeId}`
}

/**
 * The next window strictly after `at`.
 *
 * Every interval missed while FlowDesk was closed collapses into the single run
 * that is happening now: the schedule is re-anchored forward rather than replayed.
 */
export function nextMonitorWindow(windowStart: string, intervalMinutes: number, at: string) {
  const step = Math.max(MONITOR_MINIMUM_INTERVAL_MINUTES, Math.trunc(intervalMinutes)) * 60_000
  const started = Date.parse(windowStart)
  const elapsed = Math.max(0, Date.parse(at) - started)
  return new Date(started + (Math.floor(elapsed / step) + 1) * step).toISOString()
}

export interface MonitorSchedulerPort {
  listDueMonitors(at: string): BrainMonitor[]
  markMonitorRun(input: { id: string; windowStart: string; lastRunAt: string; nextRunAt: string }): boolean
  /** Returns false when the run was skipped (for example: consent is missing). */
  runMonitor(monitor: BrainMonitor, windowStart: string): boolean
}

/**
 * Binds a monitor to the existing durable job engine. A monitor is only ever a
 * scheduled `enqueueJob`; there is no second job path and no second runner.
 */
export function createMonitorSchedulerPort(
  database: BrainDatabase,
  onRun?: (monitor: BrainMonitor, windowStart: string) => void,
): MonitorSchedulerPort {
  return {
    listDueMonitors: at => database.listDueMonitors(at),
    markMonitorRun: input => database.markMonitorRun(input),
    runMonitor(monitor, windowStart) {
      // The renderer can only name a registered recipe, and this re-checks it at
      // run time in case the recipe was removed after the monitor was created.
      const recipeVersion = database.getLatestRecipeVersion(monitor.recipeId)
      if (!recipeVersion) return false
      // A monitor gets no privilege a manual run would not have: private recipes
      // stay behind the same per-scope, per-recipe, per-provider consent gate.
      if (PRIVATE_RECIPE_PREFIXES.some(prefix => monitor.recipeId.startsWith(prefix))
        && !database.hasConsent(monitor.scopeId, monitor.recipeId, CONSENT_PROVIDER)) return false
      database.enqueueJob({
        recipeId: monitor.recipeId,
        recipeVersion,
        scopeId: monitor.scopeId,
        accountId: null,
        // windowStart makes each scheduled run its own job: without it the job
        // idempotency key would collapse every run of a monitor into the first.
        parameters: { monitorId: monitor.id, windowStart, limit: 50, retentionDays: 30 },
        continuation: {
          sessionId: monitorContinuationSessionId(monitor.scopeId),
          mode: 'actionable_only',
          contextBudget: MONITOR_CONTINUATION_CONTEXT_BUDGET,
        },
      })
      onRun?.(monitor, windowStart)
      return true
    },
  }
}

/**
 * An in-process interval. FlowDesk registers no OS scheduled task, cron entry or
 * background service: when the utility process stops, every monitor stops with it.
 */
export class MonitorScheduler {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly port: MonitorSchedulerPort) {}

  get running() {
    return this.timer !== null
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), MONITOR_TICK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  tick(at = new Date().toISOString()) {
    const runs: Array<{ monitorId: string; windowStart: string }> = []
    for (const monitor of this.port.listDueMonitors(at)) {
      if (monitor.status !== 'active') continue
      if (this.runWindow(monitor, monitor.nextRunAt, at)) runs.push({ monitorId: monitor.id, windowStart: monitor.nextRunAt })
    }
    return runs
  }

  /**
   * Claims one window before running it. The claim is a compare-and-swap on the
   * monitor's own `nextRunAt`, so a replayed or concurrent tick for the same
   * window loses the swap and enqueues nothing.
   */
  runWindow(monitor: BrainMonitor, windowStart: string, at = new Date().toISOString()) {
    const claimed = this.port.markMonitorRun({
      id: monitor.id,
      windowStart,
      lastRunAt: at,
      nextRunAt: nextMonitorWindow(windowStart, monitor.intervalMinutes, at),
    })
    if (!claimed) return false
    try {
      // A skipped run still keeps its advanced window: a monitor that cannot run
      // waits for its next interval instead of retrying on every tick.
      return this.port.runMonitor(monitor, windowStart)
    } catch {
      return false
    }
  }
}
