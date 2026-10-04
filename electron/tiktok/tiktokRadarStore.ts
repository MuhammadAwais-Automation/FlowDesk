/**
 * Local-first storage for the TikTok niche radar.
 *
 * Layout under the store dir (default `<userData>/radar`):
 *   niches.json                      niche configs
 *   <nicheId>/videos.jsonl           VideoSnapshot lines
 *   <nicheId>/sounds.jsonl           SoundSnapshot lines
 *   <nicheId>/runs.jsonl             one line per collection cycle
 *   <nicheId>/recommendations.jsonl  report picks, kept for later calibration
 *
 * Every jsonl row carries `t` (unix seconds), which is what the time-window
 * readers and the retention prune key on. Pure fs: no TikTok, no clock except
 * where a `now` default is convenient.
 */

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Count, SoundSnapshot, VideoSnapshot } from '../radar/types'

export interface RadarCreator {
  secUid: string
  uniqueId: string
  followers: number
  /** Unix seconds. */
  addedAt: number
  /** Unix seconds of the newest non-pinned post seen, 0 when unknown. */
  lastPostAt: number
}

export interface RadarNiche {
  id: string
  name: string
  keywords: string[]
  seedTags: string[]
  creators: RadarCreator[]
  enabled: boolean
  intervalMin: number
  account?: string
}

/** VideoSnapshot plus the creator's total video count at snapshot time. */
export interface RadarVideoSnapshot extends VideoSnapshot {
  creatorVideos: Count
}

export interface RadarRunLog {
  t: number
  calls: number
  blocks: number
  creators: number
  fresh48h: number
  sounds: number
  durationMs: number
  discovered?: number
  blocked?: boolean
  error?: string
}

export interface RadarRecommendation {
  t: number
  hours: number
  topVideos: Array<{ id: string; author: string; views: number; breakout: number; ratio: number; flagged: boolean }>
  sounds: Array<{ id: string; title: string; phase: string; score: number }>
  tags: string[]
  opportunities: Array<{ id: string; label: string; opportunity: number }>
}

export const RADAR_LIMITS = {
  maxKeywords: 30,
  maxCreators: 80,
  maxSeedTags: 30,
  defaultIntervalMin: 20,
  minIntervalMin: 5,
  maxIntervalMin: 24 * 60,
  retentionDays: 14,
} as const

export type RadarFile = 'videos' | 'sounds' | 'runs' | 'recommendations'

let storeDirOverride: string | null = null

/** Tests point the store at a temp dir; pass null to go back to userData. */
export function setRadarStoreDir(dir: string | null): void {
  storeDirOverride = dir
}

export function radarStoreDir(): string {
  return storeDirOverride ?? join(app.getPath('userData'), 'radar')
}

const NICHE_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export function isValidNicheId(id: unknown): id is string {
  return typeof id === 'string' && NICHE_ID_RE.test(id)
}

function nicheDir(id: string): string {
  if (!isValidNicheId(id)) throw new Error(`invalid niche id: ${String(id)}`)
  return join(radarStoreDir(), id)
}

export function radarFilePath(id: string, file: RadarFile): string {
  return join(nicheDir(id), `${file}.jsonl`)
}

// ─── Validation ─────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function cleanStrings(v: unknown, max: number, maxLen: number): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (typeof x !== 'string') return null
    const s = x.trim()
    if (!s || s.length > maxLen) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out.length > max ? null : out
}

function finiteOr(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

function parseCreator(v: unknown, now: number): RadarCreator | null {
  if (!isRecord(v)) return null
  const secUid = typeof v.secUid === 'string' ? v.secUid.trim() : ''
  if (!secUid || secUid.length > 200) return null
  return {
    secUid,
    uniqueId: typeof v.uniqueId === 'string' ? v.uniqueId.trim().replace(/^@/, '') : '',
    followers: Math.max(0, finiteOr(v.followers, 0)),
    addedAt: finiteOr(v.addedAt, now),
    lastPostAt: Math.max(0, finiteOr(v.lastPostAt, 0)),
  }
}

export type NicheValidation = { ok: true; niche: RadarNiche } | { ok: false; error: string }

/**
 * Validates untrusted niche input (IPC/MCP). Keywords 1-30, creators <= 80,
 * id a lowercase slug. Creators are de-duplicated by secUid.
 */
export function validateNicheInput(input: unknown, now = Math.floor(Date.now() / 1000)): NicheValidation {
  if (!isRecord(input)) return { ok: false, error: 'niche must be an object' }
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!isValidNicheId(id)) return { ok: false, error: 'id must be a lowercase slug (a-z, 0-9, -; max 40 chars)' }
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 100) : id

  const keywords = cleanStrings(input.keywords, RADAR_LIMITS.maxKeywords, 100)
  if (!keywords) return { ok: false, error: `keywords must be an array of at most ${RADAR_LIMITS.maxKeywords} strings` }
  if (keywords.length < 1) return { ok: false, error: 'at least one keyword is required' }

  const seedRaw = input.seedTags === undefined ? [] : input.seedTags
  const seedTags = cleanStrings(seedRaw, RADAR_LIMITS.maxSeedTags, 100)
  if (!seedTags) return { ok: false, error: `seedTags must be an array of at most ${RADAR_LIMITS.maxSeedTags} strings` }

  const creatorsRaw = input.creators === undefined ? [] : input.creators
  if (!Array.isArray(creatorsRaw)) return { ok: false, error: 'creators must be an array' }
  const creators: RadarCreator[] = []
  const seen = new Set<string>()
  for (const c of creatorsRaw) {
    const parsed = parseCreator(c, now)
    if (!parsed) return { ok: false, error: 'each creator needs a secUid' }
    if (seen.has(parsed.secUid)) continue
    seen.add(parsed.secUid)
    creators.push(parsed)
  }
  if (creators.length > RADAR_LIMITS.maxCreators) return { ok: false, error: `at most ${RADAR_LIMITS.maxCreators} creators` }

  const intervalRaw = finiteOr(input.intervalMin, RADAR_LIMITS.defaultIntervalMin)
  const intervalMin = Math.min(RADAR_LIMITS.maxIntervalMin, Math.max(RADAR_LIMITS.minIntervalMin, Math.round(intervalRaw)))

  const niche: RadarNiche = {
    id,
    name,
    keywords,
    seedTags: seedTags.map(t => t.replace(/^#/, '').toLowerCase()).filter(Boolean),
    creators,
    enabled: input.enabled !== false,
    intervalMin,
  }
  if (typeof input.account === 'string' && input.account.trim()) niche.account = input.account.trim()
  return { ok: true, niche }
}

// ─── Niches config ──────────────────────────────────────────────────────────

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

export async function loadNiches(): Promise<RadarNiche[]> {
  let raw: string
  try {
    raw = await readFile(join(radarStoreDir(), 'niches.json'), 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: RadarNiche[] = []
  for (const item of parsed) {
    const v = validateNicheInput(item)
    if (v.ok) out.push(v.niche)
  }
  return out
}

export async function saveNiches(niches: readonly RadarNiche[]): Promise<void> {
  await mkdir(radarStoreDir(), { recursive: true })
  await writeAtomic(join(radarStoreDir(), 'niches.json'), JSON.stringify(niches, null, 2))
}

export async function getNiche(id: string): Promise<RadarNiche | null> {
  return (await loadNiches()).find(n => n.id === id) ?? null
}

/** Validates and inserts or replaces a niche by id. */
export async function upsertNiche(input: unknown): Promise<NicheValidation> {
  const v = validateNicheInput(input)
  if (!v.ok) return v
  const niches = await loadNiches()
  const idx = niches.findIndex(n => n.id === v.niche.id)
  if (idx >= 0) niches[idx] = v.niche
  else niches.push(v.niche)
  await saveNiches(niches)
  return v
}

/** Removes the niche config. Snapshot files are left for the user to delete. */
export async function removeNiche(id: string): Promise<boolean> {
  const niches = await loadNiches()
  const next = niches.filter(n => n.id !== id)
  if (next.length === niches.length) return false
  await saveNiches(next)
  return true
}

/** Replaces a niche's creator list (capped at the creator limit). */
export async function saveNicheCreators(id: string, creators: readonly RadarCreator[]): Promise<RadarNiche | null> {
  const niches = await loadNiches()
  const niche = niches.find(n => n.id === id)
  if (!niche) return null
  const seen = new Set<string>()
  niche.creators = creators.filter(c => {
    if (!c.secUid || seen.has(c.secUid)) return false
    seen.add(c.secUid)
    return true
  }).slice(0, RADAR_LIMITS.maxCreators)
  await saveNiches(niches)
  return niche
}

// ─── JSONL ──────────────────────────────────────────────────────────────────

export async function appendJsonl(file: string, rows: readonly object[]): Promise<void> {
  if (rows.length === 0) return
  await mkdir(join(file, '..'), { recursive: true })
  await appendFile(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}

/** Reads rows with `t >= since` (and `t <= until` when given). Bad lines are skipped. */
export async function readJsonl<T extends { t: number }>(file: string, since = 0, until = Infinity): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return []
  }
  const out: T[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(row) || typeof row.t !== 'number') continue
    if (row.t < since || row.t > until) continue
    out.push(row as unknown as T)
  }
  return out
}

export function appendVideoSnapshots(id: string, rows: readonly RadarVideoSnapshot[]): Promise<void> {
  return appendJsonl(radarFilePath(id, 'videos'), rows)
}

export function appendSoundSnapshots(id: string, rows: readonly SoundSnapshot[]): Promise<void> {
  return appendJsonl(radarFilePath(id, 'sounds'), rows)
}

export function appendRunLog(id: string, row: RadarRunLog): Promise<void> {
  return appendJsonl(radarFilePath(id, 'runs'), [row])
}

export function appendRecommendation(id: string, row: RadarRecommendation): Promise<void> {
  return appendJsonl(radarFilePath(id, 'recommendations'), [row])
}

export function readVideoSnapshots(id: string, since = 0, until = Infinity): Promise<RadarVideoSnapshot[]> {
  return readJsonl<RadarVideoSnapshot>(radarFilePath(id, 'videos'), since, until)
}

export function readSoundSnapshots(id: string, since = 0, until = Infinity): Promise<SoundSnapshot[]> {
  return readJsonl<SoundSnapshot>(radarFilePath(id, 'sounds'), since, until)
}

export function readRunLogs(id: string, since = 0, until = Infinity): Promise<RadarRunLog[]> {
  return readJsonl<RadarRunLog>(radarFilePath(id, 'runs'), since, until)
}

export function readRecommendations(id: string, since = 0, until = Infinity): Promise<RadarRecommendation[]> {
  return readJsonl<RadarRecommendation>(radarFilePath(id, 'recommendations'), since, until)
}

/**
 * Drops rows older than `retentionDays` from the snapshot and run files.
 * Recommendations are kept: they are the calibration labels.
 * Returns the number of rows removed per file.
 */
export async function pruneNiche(
  id: string,
  retentionDays: number = RADAR_LIMITS.retentionDays,
  now = Math.floor(Date.now() / 1000),
): Promise<Record<'videos' | 'sounds' | 'runs', number>> {
  const cutoff = now - retentionDays * 86400
  const removed = { videos: 0, sounds: 0, runs: 0 }
  for (const file of ['videos', 'sounds', 'runs'] as const) {
    const path = radarFilePath(id, file)
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      continue
    }
    const kept: string[] = []
    let dropped = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let t: unknown
      try {
        const row: unknown = JSON.parse(line)
        t = isRecord(row) ? row.t : undefined
      } catch {
        dropped++
        continue
      }
      if (typeof t === 'number' && t >= cutoff) kept.push(line)
      else dropped++
    }
    if (dropped > 0) await writeAtomic(path, kept.length ? kept.join('\n') + '\n' : '')
    removed[file] = dropped
  }
  return removed
}
