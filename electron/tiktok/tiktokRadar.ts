/**
 * TikTok niche radar: the collector and its scheduler.
 *
 * Every request runs inside the logged-in TikTok page (the view from
 * getTikTokView) with a plain page `fetch`, so the page's own signing and
 * cookies apply. Verified live 2026-09-28:
 *   - /api/search/general/full/  works bare (page signs it)
 *   - /api/post/item_list/ and friends answer an EMPTY 200 (tt_orcas_res: 1)
 *     unless the query carries TikTok's full common params, which we copy from
 *     one of the page's own recent /api/ requests (minus X-*, msToken, _signature)
 *   - /api/music/detail/ works bare with aid=1988 + language=en
 * A block is: HTTP >= 400, an empty body with tt_orcas_res: 1, or statusCode
 * 10000 (captcha). Calls are spaced >= 4 s; three blocks end a cycle.
 *
 * One global lock: all niches share the TikTok view, so two cycles never run
 * at once.
 */

import { radarReport, toCount } from '../radar/radarCore'
import type { RadarReport, RadarReportOptions, SoundSnapshot } from '../radar/types'
import { ensureTikTokWebApp, getTikTokView } from './tiktok'
import {
  appendRecommendation,
  appendRunLog,
  appendSoundSnapshots,
  appendVideoSnapshots,
  getNiche,
  pruneNiche,
  readSoundSnapshots,
  readVideoSnapshots,
  saveNicheCreators,
  type RadarCreator,
  type RadarNiche,
  type RadarRecommendation,
  type RadarRunLog,
  type RadarVideoSnapshot,
} from './tiktokRadarStore'

export const RADAR_COLLECT = {
  minGapMs: 4000,
  maxBlocks: 3,
  discoveryBelow: 20,
  discoveryTarget: 40,
  maxDiscoveryChecks: 40,
  activeWithinSec: 7 * 86400,
  searchOffsets: [0, 20],
  /** Videos younger than this are snapshotted every cycle. */
  freshWindowSec: 72 * 3600,
  /** A creator's full recent list (for baselines) is snapshotted this often. */
  historyEverySec: 6 * 3600,
  topSounds: 30,
  soundWindowSec: 7 * 86400,
  defaultIntervalMin: 20,
  backoffMin: 60,
  lockRetryMs: 60_000,
  pruneEverySec: 24 * 3600,
  reportWindowSec: 7 * 86400,
  execTimeoutMs: 20_000,
} as const

export const NO_COMMON_PARAMS_ERROR = 'open TikTok explore first: no signed TikTok /api/ request found on the page to copy common params from'

// ─── Dependencies (overridable in tests) ────────────────────────────────────

export interface RadarDeps {
  /** Runs a script in the TikTok page for `account` and returns its result. */
  exec(script: string, account?: string): Promise<unknown>
  sleep(ms: number): Promise<void>
  nowMs(): number
}

async function defaultExec(script: string, account?: string): Promise<unknown> {
  const view = await getTikTokView(account)
  await ensureTikTokWebApp(view.webContents)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TikTok radar call timed out after ${RADAR_COLLECT.execTimeoutMs}ms`)), RADAR_COLLECT.execTimeoutMs)
  })
  try {
    return await Promise.race([view.webContents.executeJavaScript(script), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const defaultDeps: RadarDeps = {
  exec: defaultExec,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  nowMs: () => Date.now(),
}

let deps: RadarDeps = defaultDeps

/** Test hook: replace some dependencies; call with no argument to restore. */
export function setRadarDeps(overrides?: Partial<RadarDeps>): void {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps
}

// ─── Page script ────────────────────────────────────────────────────────────

export type RadarFetchMode = 'plain' | 'common'

/**
 * Builds the in-page script. `common` copies the query string of the page's
 * newest /api/ request carrying device_id (dropping X-*, msToken, _signature)
 * and then sets the endpoint's own params on top.
 */
export function radarFetchScript(path: string, params: Record<string, string>, mode: RadarFetchMode): string {
  return `(async function () {
  try {
    var path = ${JSON.stringify(path)}
    var own = ${JSON.stringify(params)}
    var q = new URLSearchParams()
    if (${JSON.stringify(mode)} === 'common') {
      var src = performance.getEntriesByType('resource').map(function (e) { return e.name }).reverse().find(function (u) {
        return u.indexOf('/api/') >= 0 && u.indexOf('device_id=') >= 0
      })
      if (!src) return { ok: false, error: 'no-common-params' }
      new URL(src, location.href).searchParams.forEach(function (v, k) {
        if (/^X-/i.test(k) || k === 'msToken' || k === '_signature') return
        q.set(k, v)
      })
    }
    Object.keys(own).forEach(function (k) { q.set(k, own[k]) })
    var r = await fetch(path + '?' + q.toString(), { credentials: 'include' })
    var text = await r.text()
    return { ok: true, status: r.status, orcas: r.headers.get('tt_orcas_res'), text: text }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})()`
}

// ─── Response classification ────────────────────────────────────────────────

export type RadarOutcome =
  | { kind: 'ok'; json: Record<string, unknown> }
  | { kind: 'block'; reason: string }
  | { kind: 'error'; error: string; fatal: boolean }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Maps a raw page-script result to ok / block / error. */
export function classifyResponse(raw: unknown): RadarOutcome {
  if (!isRecord(raw)) return { kind: 'error', error: 'page script returned nothing', fatal: false }
  if (raw.ok !== true) {
    const err = typeof raw.error === 'string' ? raw.error : 'page script failed'
    if (err === 'no-common-params') return { kind: 'error', error: NO_COMMON_PARAMS_ERROR, fatal: true }
    return { kind: 'error', error: err, fatal: false }
  }
  const status = typeof raw.status === 'number' ? raw.status : 0
  if (status >= 400) return { kind: 'block', reason: `HTTP ${status}` }
  const text = typeof raw.text === 'string' ? raw.text : ''
  const orcas = raw.orcas === null || raw.orcas === undefined ? '' : String(raw.orcas)
  if (!text.trim()) {
    if (orcas === '1') return { kind: 'block', reason: 'empty body (tt_orcas_res: 1)' }
    return { kind: 'error', error: `empty body (HTTP ${status})`, fatal: false }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { kind: 'error', error: 'response is not JSON', fatal: false }
  }
  if (!isRecord(json)) return { kind: 'error', error: 'response is not a JSON object', fatal: false }
  const code = json.statusCode ?? json.status_code
  if (Number(code) === 10000) return { kind: 'block', reason: 'captcha (statusCode 10000)' }
  return { kind: 'ok', json }
}

// ─── Payload parsing ────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

function pickStat(item: Record<string, unknown>, key: string): number {
  const v2 = isRecord(item.statsV2) ? item.statsV2[key] : undefined
  if (v2 !== undefined && v2 !== null && v2 !== '') return toCount(v2)
  const v1 = isRecord(item.stats) ? item.stats[key] : undefined
  return toCount(v1)
}

/** One TikTok item object → snapshot, or null if it lacks an id/author. */
export function parseVideoItem(item: unknown, t: number): RadarVideoSnapshot | null {
  if (!isRecord(item)) return null
  const id = str(item.id)
  const author = isRecord(item.author) ? item.author : {}
  const secUid = str(author.secUid)
  const uniqueId = str(author.uniqueId)
  if (!id || (!secUid && !uniqueId)) return null
  const authorStats = isRecord(item.authorStats) ? item.authorStats : {}
  const video = isRecord(item.video) ? item.video : {}
  const music = isRecord(item.music) && str(item.music.id)
    ? { id: str(item.music.id), title: str(item.music.title), original: item.music.original === true }
    : null
  const tags: string[] = []
  if (Array.isArray(item.textExtra)) {
    for (const x of item.textExtra) {
      const tag = isRecord(x) ? str(x.hashtagName).trim().toLowerCase() : ''
      if (tag && !tags.includes(tag)) tags.push(tag)
    }
  }
  return {
    t,
    id,
    createTime: toCount(item.createTime),
    desc: str(item.desc),
    duration: toCount(video.duration),
    author: uniqueId,
    secUid,
    followers: toCount(authorStats.followerCount),
    creatorVideos: toCount(authorStats.videoCount),
    music,
    tags,
    pinned: item.isPinnedItem === true,
    plays: pickStat(item, 'playCount'),
    likes: pickStat(item, 'diggCount'),
    comments: pickStat(item, 'commentCount'),
    shares: pickStat(item, 'shareCount'),
    saves: pickStat(item, 'collectCount'),
  }
}

/** /api/search/general/full/ → item objects. */
export function searchItems(json: Record<string, unknown>): unknown[] {
  if (!Array.isArray(json.data)) return []
  return json.data.map(d => (isRecord(d) ? d.item : undefined)).filter(isRecord)
}

/** /api/post/item_list/ → item objects. */
export function itemListItems(json: Record<string, unknown>): unknown[] {
  return Array.isArray(json.itemList) ? json.itemList.filter(isRecord) : []
}

export function parseMusicDetail(json: Record<string, unknown>, t: number): SoundSnapshot | null {
  const info = isRecord(json.musicInfo) ? json.musicInfo : null
  if (!info || !isRecord(info.music)) return null
  const id = str(info.music.id)
  if (!id) return null
  const stats = isRecord(info.stats) ? info.stats : {}
  return {
    t,
    id,
    title: str(info.music.title),
    original: info.music.original === true,
    videoCount: toCount(stats.videoCount),
  }
}

/** Newest non-pinned createTime, or 0. */
export function newestPostAt(videos: readonly RadarVideoSnapshot[]): number {
  let best = 0
  for (const v of videos) if (!v.pinned && Number(v.createTime) > best) best = Number(v.createTime)
  return best
}

/** Candidate creators from search results, in first-seen order, minus `exclude`. */
export function discoverCandidates(items: readonly RadarVideoSnapshot[], exclude: ReadonlySet<string>): Array<{ secUid: string; uniqueId: string; followers: number }> {
  const out = new Map<string, { secUid: string; uniqueId: string; followers: number }>()
  for (const v of items) {
    if (!v.secUid || exclude.has(v.secUid) || out.has(v.secUid)) continue
    out.set(v.secUid, { secUid: v.secUid, uniqueId: v.author, followers: Number(v.followers) || 0 })
  }
  return [...out.values()]
}

/** Top `limit` sound ids by distinct niche videos created since `since`. */
export function topSoundIds(videos: readonly RadarVideoSnapshot[], since: number, limit: number): string[] {
  const byMusic = new Map<string, Set<string>>()
  for (const v of videos) {
    if (!v.music?.id || Number(v.createTime) < since) continue
    const set = byMusic.get(v.music.id) ?? new Set<string>()
    set.add(v.id)
    byMusic.set(v.music.id, set)
  }
  return [...byMusic.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id)
}

// ─── One cycle ──────────────────────────────────────────────────────────────

export interface RadarCycleResult {
  ok: boolean
  blocked?: boolean
  error?: string
  run?: RadarRunLog
}

let busyNiche: string | null = null
let lastCallAt = 0
const lastHistoryAt = new Map<string, number>()
const lastPruneAt = new Map<string, number>()

class CycleStop extends Error {
  constructor(readonly blocked: boolean, message: string) {
    super(message)
  }
}

interface Cycle {
  account?: string
  calls: number
  blocks: number
}

async function call(cycle: Cycle, path: string, params: Record<string, string>, mode: RadarFetchMode): Promise<Record<string, unknown> | null> {
  const wait = RADAR_COLLECT.minGapMs - (deps.nowMs() - lastCallAt)
  if (lastCallAt > 0 && wait > 0) await deps.sleep(wait)
  lastCallAt = deps.nowMs()
  cycle.calls++
  let raw: unknown
  try {
    raw = await deps.exec(radarFetchScript(path, params, mode), cycle.account)
  } catch (e) {
    raw = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const outcome = classifyResponse(raw)
  if (outcome.kind === 'ok') return outcome.json
  if (outcome.kind === 'block') {
    cycle.blocks++
    if (cycle.blocks >= RADAR_COLLECT.maxBlocks) throw new CycleStop(true, `blocked ${cycle.blocks}x (last: ${outcome.reason})`)
    return null
  }
  if (outcome.fatal) throw new CycleStop(false, outcome.error)
  return null
}

function creatorPostsParams(secUid: string): Record<string, string> {
  return { secUid, count: '35', cursor: '0', coverFormat: '2', post_item_list_request_type: '0' }
}

/** Keeps fresh videos always, and the full list when the creator's history is due. */
function pickSnapshots(videos: readonly RadarVideoSnapshot[], secUid: string, nowSec: number): RadarVideoSnapshot[] {
  const historyDue = nowSec - (lastHistoryAt.get(secUid) ?? 0) >= RADAR_COLLECT.historyEverySec
  if (historyDue) {
    lastHistoryAt.set(secUid, nowSec)
    return [...videos]
  }
  return videos.filter(v => nowSec - Number(v.createTime) <= RADAR_COLLECT.freshWindowSec)
}

/**
 * Runs one collection cycle for a niche: discovery (when it has < 20
 * creators), creator posts, sound detail, then a runs.jsonl line.
 */
export async function radarCollectOnce(nicheId: string): Promise<RadarCycleResult> {
  if (busyNiche) return { ok: false, error: `another radar cycle is running (${busyNiche})` }
  busyNiche = nicheId
  try {
    return await collect(nicheId)
  } finally {
    busyNiche = null
  }
}

async function collect(nicheId: string): Promise<RadarCycleResult> {
  const niche = await getNiche(nicheId)
  if (!niche) return { ok: false, error: `unknown niche: ${nicheId}` }
  const startMs = deps.nowMs()
  const nowSec = Math.floor(startMs / 1000)
  const cycle: Cycle = { account: niche.account, calls: 0, blocks: 0 }
  const creators = new Map<string, RadarCreator>(niche.creators.map(c => [c.secUid, { ...c }]))
  const done = new Set<string>()
  let fresh48h = 0
  let discovered = 0
  let sounds = 0
  let stop: CycleStop | null = null

  const recordCreator = async (secUid: string, videos: RadarVideoSnapshot[]): Promise<void> => {
    done.add(secUid)
    const c = creators.get(secUid)
    if (c) {
      const last = newestPostAt(videos)
      if (last > 0) c.lastPostAt = last
      const followers = videos.map(v => Number(v.followers) || 0).find(f => f > 0)
      if (followers) c.followers = followers
      if (!c.uniqueId) c.uniqueId = videos.find(v => v.author)?.author ?? ''
    }
    const rows = pickSnapshots(videos, secUid, nowSec)
    fresh48h += rows.filter(v => nowSec - Number(v.createTime) <= 48 * 3600).length
    await appendVideoSnapshots(nicheId, rows)
  }

  const fetchCreator = async (secUid: string): Promise<RadarVideoSnapshot[] | null> => {
    const json = await call(cycle, '/api/post/item_list/', creatorPostsParams(secUid), 'common')
    if (!json) return null
    const t = Math.floor(deps.nowMs() / 1000)
    return itemListItems(json).map(i => parseVideoItem(i, t)).filter((v): v is RadarVideoSnapshot => v !== null)
  }

  try {
    // (a) discovery
    if (creators.size < RADAR_COLLECT.discoveryBelow) {
      const found: RadarVideoSnapshot[] = []
      for (const keyword of niche.keywords) {
        for (const offset of RADAR_COLLECT.searchOffsets) {
          const json = await call(cycle, '/api/search/general/full/', { keyword, offset: String(offset), count: '20' }, 'plain')
          if (!json) continue
          const t = Math.floor(deps.nowMs() / 1000)
          for (const item of searchItems(json)) {
            const v = parseVideoItem(item, t)
            if (v) found.push(v)
          }
        }
      }
      const candidates = discoverCandidates(found, new Set(creators.keys()))
      let checks = 0
      for (const cand of candidates) {
        if (creators.size >= RADAR_COLLECT.discoveryTarget || checks >= RADAR_COLLECT.maxDiscoveryChecks) break
        checks++
        const videos = await fetchCreator(cand.secUid)
        if (!videos) continue
        const last = newestPostAt(videos)
        if (last <= 0 || nowSec - last > RADAR_COLLECT.activeWithinSec) continue
        creators.set(cand.secUid, { secUid: cand.secUid, uniqueId: cand.uniqueId, followers: cand.followers, addedAt: nowSec, lastPostAt: last })
        discovered++
        await recordCreator(cand.secUid, videos)
      }
    }

    // (b) creators' newest posts
    for (const secUid of [...creators.keys()]) {
      if (done.has(secUid)) continue
      const videos = await fetchCreator(secUid)
      if (videos) await recordCreator(secUid, videos)
    }

    // (c) sounds used by niche videos in the last 7 days
    const recent = await readVideoSnapshots(nicheId, nowSec - RADAR_COLLECT.soundWindowSec)
    const soundIds = topSoundIds(recent, nowSec - RADAR_COLLECT.soundWindowSec, RADAR_COLLECT.topSounds)
    for (const musicId of soundIds) {
      const json = await call(cycle, '/api/music/detail/', { musicId, aid: '1988', app_language: 'en', language: 'en' }, 'plain')
      if (!json) continue
      const snap = parseMusicDetail(json, Math.floor(deps.nowMs() / 1000))
      if (snap) {
        await appendSoundSnapshots(nicheId, [snap])
        sounds++
      }
    }
  } catch (e) {
    if (e instanceof CycleStop) stop = e
    else throw e
  }

  await saveNicheCreators(nicheId, [...creators.values()])

  const run: RadarRunLog = {
    t: nowSec,
    calls: cycle.calls,
    blocks: cycle.blocks,
    creators: creators.size,
    fresh48h,
    sounds,
    durationMs: deps.nowMs() - startMs,
  }
  if (discovered) run.discovered = discovered
  if (stop?.blocked) run.blocked = true
  if (stop) run.error = stop.message
  await appendRunLog(nicheId, run)

  if (nowSec - (lastPruneAt.get(nicheId) ?? 0) >= RADAR_COLLECT.pruneEverySec) {
    lastPruneAt.set(nicheId, nowSec)
    await pruneNiche(nicheId, undefined, nowSec)
  }

  if (stop?.blocked) return { ok: false, blocked: true, error: stop.message, run }
  if (stop) return { ok: false, error: stop.message, run }
  return { ok: true, run }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

interface Scheduled {
  timer: ReturnType<typeof setTimeout> | null
  nextAt: number
  lastRun: RadarRunLog | null
  lastResult: RadarCycleResult | null
  backoff: boolean
}

const schedule = new Map<string, Scheduled>()

export interface RadarStatus {
  busy: string | null
  niches: Array<{ id: string; nextAt: number; backoff: boolean; lastRun: RadarRunLog | null; lastError: string | null }>
}

function arm(nicheId: string, entry: Scheduled, delayMs: number): void {
  if (entry.timer) clearTimeout(entry.timer)
  entry.nextAt = deps.nowMs() + delayMs
  entry.timer = setTimeout(() => {
    entry.timer = null
    void tick(nicheId)
  }, delayMs)
}

async function tick(nicheId: string): Promise<void> {
  const entry = schedule.get(nicheId)
  if (!entry) return
  if (busyNiche) {
    arm(nicheId, entry, RADAR_COLLECT.lockRetryMs)
    return
  }
  let result: RadarCycleResult
  try {
    result = await radarCollectOnce(nicheId)
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (schedule.get(nicheId) !== entry) return // stopped (or restarted) meanwhile
  entry.lastResult = result
  if (result.run) entry.lastRun = result.run
  entry.backoff = result.blocked === true
  let intervalMin: number = RADAR_COLLECT.defaultIntervalMin
  try {
    const niche = await getNiche(nicheId)
    if (niche?.intervalMin) intervalMin = niche.intervalMin
  } catch {
    // keep the default interval
  }
  if (schedule.get(nicheId) !== entry) return
  arm(nicheId, entry, (entry.backoff ? RADAR_COLLECT.backoffMin : intervalMin) * 60_000)
}

/** Schedules a niche: first cycle now, then every intervalMin (60 min after a block). */
export async function startRadar(nicheId: string): Promise<{ ok: boolean; error?: string }> {
  const niche = await getNiche(nicheId)
  if (!niche) return { ok: false, error: `unknown niche: ${nicheId}` }
  if (schedule.has(nicheId)) return { ok: true }
  const entry: Scheduled = { timer: null, nextAt: 0, lastRun: null, lastResult: null, backoff: false }
  schedule.set(nicheId, entry)
  arm(nicheId, entry, 0)
  return { ok: true }
}

/** Unschedules a niche. A cycle already running finishes but does not re-arm. */
export function stopRadar(nicheId: string): { ok: boolean } {
  const entry = schedule.get(nicheId)
  if (!entry) return { ok: false }
  if (entry.timer) clearTimeout(entry.timer)
  schedule.delete(nicheId)
  return { ok: true }
}

export function radarStatus(): RadarStatus {
  return {
    busy: busyNiche,
    niches: [...schedule.entries()].map(([id, e]) => ({
      id,
      nextAt: e.nextAt,
      backoff: e.backoff,
      lastRun: e.lastRun,
      lastError: e.lastResult?.error ?? null,
    })),
  }
}

/** Test hook: clears scheduler, lock and pacing state. */
export function resetRadarState(): void {
  for (const e of schedule.values()) if (e.timer) clearTimeout(e.timer)
  schedule.clear()
  busyNiche = null
  lastCallAt = 0
  lastHistoryAt.clear()
  lastPruneAt.clear()
}

// ─── Report ─────────────────────────────────────────────────────────────────

export type RadarReportResult = { ok: true; report: RadarReport } | { ok: false; error: string }

function nicheReportOptions(niche: RadarNiche, now: number, hours: number): RadarReportOptions & { seedKeywords: string[] } {
  return { niche: niche.name, seedTags: niche.seedTags, seedKeywords: niche.keywords, now, hours }
}

/** Scores the niche's stored snapshots and logs the top picks for calibration. */
export async function radarReportFor(nicheId: string, hours = 24): Promise<RadarReportResult> {
  const niche = await getNiche(nicheId)
  if (!niche) return { ok: false, error: `unknown niche: ${nicheId}` }
  const now = Math.floor(deps.nowMs() / 1000)
  const h = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 14) : 24
  const since = now - Math.max(RADAR_COLLECT.reportWindowSec, h * 3600)
  const [videos, soundRows] = await Promise.all([readVideoSnapshots(nicheId, since), readSoundSnapshots(nicheId, since)])
  const report = radarReport(videos, soundRows, nicheReportOptions(niche, now, h))

  const rec: RadarRecommendation = {
    t: now,
    hours: h,
    topVideos: report.topVideos.slice(0, 10).map(v => ({
      id: v.id,
      author: v.author,
      views: v.views,
      breakout: v.breakout.score,
      ratio: v.outlier.ratio,
      flagged: v.outlier.flagged,
    })),
    sounds: report.sounds.filter(s => s.recommend).slice(0, 10).map(s => ({ id: s.id, title: s.title, phase: s.phase, score: s.score })),
    tags: report.tags.picked.map(p => p.tag),
    opportunities: report.opportunities.filter(o => o.recommend).slice(0, 10).map(o => ({ id: o.id, label: o.label, opportunity: o.opportunity })),
  }
  await appendRecommendation(nicheId, rec)
  return { ok: true, report }
}
