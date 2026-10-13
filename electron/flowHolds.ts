/**
 * Google accounts Flow flagged with "unusual activity" rest here instead of
 * retrying. Other Flow tools that kept going after that flag got accounts
 * blocked for manual use too, for days (docs/flow-unusual-activity-research.md),
 * so a flagged account is parked for HOLD_HOURS, across restarts, and every
 * generation on it is refused until then.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const HOLD_HOURS = 12
export const UNUSUAL_ACTIVITY = /unusual activity|UNUSUAL_ACTIVITY/i

interface Hold { until: string; reason: string }
let holds: Record<string, Hold> | null = null

const holdsFile = () => join(app.getPath('userData'), 'flow-holds.json')

function load(): Record<string, Hold> {
  if (!holds) {
    try { holds = JSON.parse(readFileSync(holdsFile(), 'utf8')) as Record<string, Hold> } catch { holds = {} }
  }
  return holds
}

/** Parks `partition` until HOLD_HOURS from now; returns the end time. */
export function holdFlowAccount(partition: string, reason: string, now = Date.now()): string {
  const until = new Date(now + HOLD_HOURS * 3_600_000).toISOString()
  load()[partition] = { until, reason: reason.slice(0, 200) }
  try { writeFileSync(holdsFile(), JSON.stringify(holds)) } catch { /* the hold still applies this session */ }
  return until
}

/** The hold on `partition`, if it has not run out. */
export function flowHold(partition: string, now = Date.now()): Hold | null {
  const h = load()[partition]
  return h && Date.parse(h.until) > now ? h : null
}

export function heldError(h: Hold): string {
  return `Flow flagged this account for unusual activity; FlowDesk will not generate on it until ${h.until} (retrying makes the flag worse). Use another account, or wait. Reason: ${h.reason}`
}
