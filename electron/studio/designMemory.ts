import { readFile, writeFile, rename, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import { dirname, join, resolve } from 'path'
import { app } from 'electron'
import { readElement } from './nodeOps'

/**
 * The third agent-native feature: turning what the user *changes* about an
 * agent's output into guidance for next time, without a general event log.
 *
 * There is no "who wrote this" field anywhere in a Studio document — the
 * HTML looks the same whether an agent tool or the panel wrote it. What
 * distinguishes them is timing and call site:
 *
 * - `studio_set_text_style` / `studio_set_fill` / `studio_set_stroke`
 *   (electron/agent/studioTools.ts) know, at the moment they write, exactly
 *   which element and CSS property they just set and to what. They record
 *   that as a short-lived "agent proposal" via `recordAgentProposal`.
 * - The panel's only write path is the `studio:writeArtboardHtml` IPC
 *   handler in electron/main.ts — the comment there already establishes
 *   it's fed by "the canvas edits inside the iframe", i.e. a human dragging
 *   a handle or typing in the properties panel. That handler calls
 *   `checkForOverrides` with the artboard HTML it is about to persist.
 *
 * A pending proposal that is still live (within `PROPOSAL_TTL_MS`) when a
 * panel write lands on the *same* elementId+property with a *different*
 * value is an override: the user corrected what the agent just did. That is
 * the whole signal — no new tracking system, no ids threaded through IPC.
 *
 * What this can and cannot see, precisely:
 * - Distinguishable: `studio_set_text_style`, `studio_set_fill`,
 *   `studio_set_stroke` (agent) vs. any panel edit reaching
 *   `studio:writeArtboardHtml` (user) — because those are the only two call
 *   sites this module is wired into, and they're the only two ways the
 *   properties in question get set.
 * - Not distinguishable, and not approximated: `studio_set_effect`, because
 *   its "value" is a JSON blob of effect parameters written to a data
 *   attribute plus derived CSS, not a plain style property the panel writes
 *   the same way — there's no clean single field to compare. Overrides of
 *   text-shadow/-webkit-text-stroke that originate from an effect are
 *   invisible to this module by design, not by oversight.
 * - Not distinguishable: `studio_write_html`, `studio_update_styles`, and
 *   `studio_layer_op`, which replace a whole artboard/subtree or the
 *   document's style tokens rather than one element's one property — there
 *   is no single elementId+property to attribute a later change to, so
 *   these never record proposals and can never register overrides either
 *   as the agent side or the user side of one.
 * - A panel write that changes an elementId+property with no live agent
 *   proposal (the ordinary case — most edits are not corrections of
 *   something the agent just did) is correctly invisible: nothing is
 *   recorded, because nothing was overridden.
 */

// ---------------------------------------------------------------------------
// Pending agent proposals — small in-memory table, deliberately not
// persisted. A proposal that outlives the process was never going to be
// "just corrected" by the user anyway; TTL plus process lifetime is enough.
// ---------------------------------------------------------------------------

const PROPOSAL_TTL_MS = 2 * 60 * 1000

interface PendingProposal {
  value: string
  at: number
}

const pendingProposals = new Map<string, Map<string, PendingProposal>>()

function normalizeValue(value: string): string {
  return value.trim().toLowerCase()
}

/** Called by an agent tool right after it successfully writes one CSS property on one element. */
export function recordAgentProposal(elementId: string, property: string, value: string, now = Date.now()): void {
  let byProperty = pendingProposals.get(elementId)
  if (!byProperty) {
    byProperty = new Map()
    pendingProposals.set(elementId, byProperty)
  }
  byProperty.set(property, { value, at: now })
}

/**
 * Called with the user-authored value now present for elementId+property.
 * Returns the override event if a live agent proposal for that same pair
 * exists and the value genuinely differs, else null. Either way, consumes
 * (removes) the proposal — a value has been observed for it now, live or
 * expired, matching or not, so it should not match again later.
 */
export function detectOverride(elementId: string, property: string, userValue: string, now = Date.now()): OverrideEvent | null {
  const byProperty = pendingProposals.get(elementId)
  const pending = byProperty?.get(property)
  if (!byProperty || !pending) return null
  byProperty.delete(property)
  if (byProperty.size === 0) pendingProposals.delete(elementId)

  if (now - pending.at > PROPOSAL_TTL_MS) return null
  if (normalizeValue(pending.value) === normalizeValue(userValue)) return null

  return {
    property,
    agentValue: pending.value,
    userValue,
    at: new Date(now).toISOString(),
  }
}

/** Test/reset hook — clears every pending proposal. */
export function clearPendingProposals(): void {
  pendingProposals.clear()
}

/**
 * Given the artboard HTML a panel write is about to persist, checks every
 * live pending proposal against that HTML's current value for the same
 * elementId+property and records any override found. Cheap: it only looks
 * at elements that actually have a pending proposal, not every element in
 * the artboard.
 */
export async function checkForOverrides(artboardHtml: string, now = Date.now()): Promise<void> {
  const elementIds = [...pendingProposals.keys()]
  for (const elementId of elementIds) {
    const byProperty = pendingProposals.get(elementId)
    if (!byProperty) continue
    for (const property of [...byProperty.keys()]) {
      const el = readElement(artboardHtml, elementId)
      if (!el) continue
      const currentValue = el.style[property]
      if (currentValue === undefined) continue
      const override = detectOverride(elementId, property, currentValue, now)
      if (override) await recordOverride(override)
    }
  }
}

// ---------------------------------------------------------------------------
// Pure aggregation — no file IO, fully unit-testable on its own.
// ---------------------------------------------------------------------------

export interface OverrideEvent {
  property: string
  agentValue: string
  userValue: string
  /** ISO timestamp. */
  at: string
}

export interface AggregatedOverride {
  property: string
  agentValue: string
  userValue: string
  count: number
  lastAt: string
}

/** A single override becomes a stated preference once it recurs this many times with the same shape. */
export const PREFERENCE_THRESHOLD = 3

/**
 * Absolute tolerance for treating two numeric replacement values as "the
 * same shape" for a continuous property, in that property's own unit
 * (assumed consistent — see `sameShape`). Anything not listed here is
 * discrete: font-family, colours, alignment, transform keywords, etc. only
 * match on exact (trimmed, case-insensitive) string equality, because
 * "close" has no defensible meaning for a font name or a hex colour.
 */
const CONTINUOUS_TOLERANCE: Record<string, number> = {
  'font-size': 4, // px
  'letter-spacing': 0.5, // px
  'line-height': 0.15, // unitless multiplier
  'stroke-width': 1, // px (width portion of -webkit-text-stroke / border)
}

function parseNumeric(value: string): { num: number; unit: string } | null {
  const match = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z%]*)$/.exec(value.trim())
  if (!match) return null
  return { num: parseFloat(match[1]), unit: match[2] }
}

/** Whether two replacement values for `property` count as the same learned shape. */
export function sameShape(property: string, a: string, b: string): boolean {
  if (normalizeValue(a) === normalizeValue(b)) return true
  const tolerance = CONTINUOUS_TOLERANCE[property]
  if (tolerance === undefined) return false
  const pa = parseNumeric(a)
  const pb = parseNumeric(b)
  if (!pa || !pb || pa.unit !== pb.unit) return false
  return Math.abs(pa.num - pb.num) <= tolerance
}

/**
 * Reduces a raw override log into stated preferences.
 *
 * - A property with fewer than PREFERENCE_THRESHOLD same-shape overrides
 *   produces nothing — noise, not a pattern.
 * - Overrides of the same property are clustered by shape (see
 *   `sameShape`); each cluster that reaches the threshold is a candidate
 *   preference.
 * - Contradictory overrides (two qualifying clusters for the same
 *   property, e.g. the user later reverses course) keep only the most
 *   recent cluster — the one whose latest event is newest — so only one
 *   preference per property ever surfaces.
 */
export function aggregateOverrides(events: OverrideEvent[]): AggregatedOverride[] {
  const byProperty = new Map<string, OverrideEvent[]>()
  for (const event of events) {
    const list = byProperty.get(event.property)
    if (list) list.push(event)
    else byProperty.set(event.property, [event])
  }

  const result: AggregatedOverride[] = []
  for (const [property, list] of byProperty) {
    const clusters: OverrideEvent[][] = []
    for (const event of list) {
      const cluster = clusters.find(c => sameShape(property, c[0].userValue, event.userValue))
      if (cluster) cluster.push(event)
      else clusters.push([event])
    }

    const qualifying = clusters.filter(c => c.length >= PREFERENCE_THRESHOLD)
    if (qualifying.length === 0) continue

    const latestOf = (cluster: OverrideEvent[]) => cluster.reduce((latest, e) => (e.at > latest.at ? e : latest))
    qualifying.sort((a, b) => latestOf(b).at.localeCompare(latestOf(a).at))
    const winner = qualifying[0]
    const lastEvent = latestOf(winner)

    result.push({
      property,
      agentValue: lastEvent.agentValue,
      userValue: lastEvent.userValue,
      count: winner.length,
      lastAt: lastEvent.at,
    })
  }

  return result.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

// ---------------------------------------------------------------------------
// File IO — a thin wrapper around aggregateOverrides. Persisted as a
// sibling of studio-documents in userData, not inside any one document's
// own folder (this is cross-document taste, not part of a document).
// ---------------------------------------------------------------------------

const MAX_STORED_EVENTS = 2000

function designMemoryPath(): string {
  return resolve(join(app.getPath('userData'), 'studio-design-memory.json'))
}

interface DesignMemoryFile {
  overrides: OverrideEvent[]
}

async function readMemoryFile(): Promise<OverrideEvent[]> {
  try {
    const raw = await readFile(designMemoryPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<DesignMemoryFile>
    return Array.isArray(parsed.overrides) ? parsed.overrides : []
  } catch {
    return []
  }
}

async function writeMemoryFileAtomic(events: OverrideEvent[]): Promise<void> {
  const target = designMemoryPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(temporary, JSON.stringify({ overrides: events } satisfies DesignMemoryFile, null, 2), 'utf8')
  await rename(temporary, target)
}

/** In-memory mirror of the persisted log, so `getLearnedPreferences` (called from the synchronous `getDesignGuide`) never needs to be async. */
let cachedEvents: OverrideEvent[] = []

/** One promise chain, so concurrent overrides cannot interleave writes to the same file. */
let writeChain: Promise<unknown> = Promise.resolve()

/** Loads the persisted log into the in-memory cache. Call once at startup; safe to call again to reload. */
export async function loadDesignMemory(): Promise<void> {
  cachedEvents = await readMemoryFile()
}

/** Persists one new override, updating both the in-memory cache and the on-disk log. */
export function recordOverride(event: OverrideEvent): Promise<void> {
  cachedEvents = [...cachedEvents, event].slice(-MAX_STORED_EVENTS)
  const snapshot = cachedEvents
  writeChain = writeChain.catch(() => {}).then(() => writeMemoryFileAtomic(snapshot))
  return writeChain as Promise<void>
}

/** Stated preferences derived from the in-memory cache — synchronous so `designGuide.ts` can call it directly. */
export function getLearnedPreferences(): AggregatedOverride[] {
  return aggregateOverrides(cachedEvents)
}

/** Test-only reset — clears both the in-memory cache and any pending proposals. */
export function resetDesignMemoryForTests(): void {
  cachedEvents = []
  writeChain = Promise.resolve()
  clearPendingProposals()
}
