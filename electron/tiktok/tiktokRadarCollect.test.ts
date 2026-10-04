import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('./tiktok', () => ({
  getTikTokView: vi.fn(async () => { throw new Error('live TikTok must not be used in tests') }),
  ensureTikTokWebApp: vi.fn(async () => {}),
}))

import {
  NO_COMMON_PARAMS_ERROR,
  RADAR_COLLECT,
  classifyResponse,
  discoverCandidates,
  parseVideoItem,
  radarCollectOnce,
  radarFetchScript,
  radarReportFor,
  radarStatus,
  resetRadarState,
  setRadarDeps,
  startRadar,
  stopRadar,
  topSoundIds,
} from './tiktokRadar'
import {
  getNiche,
  readRecommendations,
  readRunLogs,
  readSoundSnapshots,
  readVideoSnapshots,
  setRadarStoreDir,
  upsertNiche,
} from './tiktokRadarStore'

const NOW_MS = Date.UTC(2026, 8, 28, 12, 0, 0)
const NOW = NOW_MS / 1000
const H = 3600
const D = 86400

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'radar-collect-'))
  setRadarStoreDir(dir)
  resetRadarState()
})

afterEach(() => {
  resetRadarState()
  setRadarDeps()
  setRadarStoreDir(null)
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

// ─── Fixtures ───────────────────────────────────────────────────────────────

interface ItemOpts { pinned?: boolean; musicId?: string; plays?: number; tags?: string[] }

function item(id: string, secUid: string, createTime: number, opts: ItemOpts = {}): Record<string, unknown> {
  return {
    id,
    createTime,
    desc: `video ${id}`,
    video: { duration: 21 },
    author: { uniqueId: `u_${secUid}`, secUid },
    authorStats: { followerCount: 5000, videoCount: 40 },
    music: opts.musicId ? { id: opts.musicId, title: `song ${opts.musicId}`, original: false } : undefined,
    textExtra: (opts.tags ?? ['decor']).map(hashtagName => ({ hashtagName })),
    isPinnedItem: opts.pinned === true,
    stats: { playCount: 1, diggCount: 1, commentCount: 1, shareCount: 1, collectCount: 1 },
    statsV2: { playCount: String(opts.plays ?? 1000), diggCount: '100', commentCount: '10', shareCount: '5', collectCount: '7' },
  }
}

function ok(json: unknown): Record<string, unknown> {
  return { ok: true, status: 200, orcas: null, text: JSON.stringify(json) }
}

const EMPTY_ORCAS = { ok: true, status: 200, orcas: '1', text: '' }

function route(script: string): { path: string; own: Record<string, string>; common: boolean } {
  const path = JSON.parse(/var path = (".*?")\n/.exec(script)?.[1] ?? '""') as string
  const own = JSON.parse(/var own = (\{.*?\})\n/.exec(script)?.[1] ?? '{}') as Record<string, string>
  return { path, own, common: script.includes(`if ("common" === 'common')`) }
}

type Handler = (r: ReturnType<typeof route>) => unknown

function install(handler: Handler): { exec: ReturnType<typeof vi.fn>; sleep: ReturnType<typeof vi.fn> } {
  const exec = vi.fn(async (script: string) => handler(route(script)))
  const sleep = vi.fn(async () => {})
  setRadarDeps({ exec, sleep, nowMs: () => NOW_MS })
  return { exec, sleep }
}

function creators(n: number): Array<{ secUid: string; uniqueId: string }> {
  return Array.from({ length: n }, (_, i) => ({ secUid: `c${i}`, uniqueId: `c${i}` }))
}

// ─── Page script: common params ─────────────────────────────────────────────

describe('radarFetchScript', () => {
  async function runInFakePage(script: string, entries: string[]): Promise<{ result: unknown; urls: string[] }> {
    const urls: string[] = []
    const performance = { getEntriesByType: () => entries.map(name => ({ name })) }
    const fetch = async (url: string) => {
      urls.push(url)
      return { status: 200, headers: { get: () => null }, text: async () => '{"itemList":[]}' }
    }
    const location = { href: 'https://www.tiktok.com/explore' }
    const run = new Function('performance', 'fetch', 'location', `return ${script}`) as (...a: unknown[]) => Promise<unknown>
    return { result: await run(performance, fetch, location), urls }
  }

  it('copies the newest device_id request params, drops signatures and sets its own', async () => {
    const older = 'https://www.tiktok.com/api/explore/item_list/?aid=1988&device_id=OLD&region=US'
    const newest = 'https://www.tiktok.com/api/recommend/item_list/?aid=1988&device_id=D1&tz_name=Europe%2FLondon&verifyFp=v1&secUid=other&msToken=m&X-Bogus=b&X-Gnarly=g&_signature=s'
    const unrelated = 'https://www.tiktok.com/static/app.js?device_id=nope'
    const script = radarFetchScript('/api/post/item_list/', { secUid: 'S1', count: '35' }, 'common')
    const { result, urls } = await runInFakePage(script, [older, newest, unrelated])

    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(urls).toHaveLength(1)
    const url = new URL(urls[0], 'https://www.tiktok.com')
    expect(url.pathname).toBe('/api/post/item_list/')
    expect(url.searchParams.get('device_id')).toBe('D1')
    expect(url.searchParams.get('tz_name')).toBe('Europe/London')
    expect(url.searchParams.get('verifyFp')).toBe('v1')
    expect(url.searchParams.get('secUid')).toBe('S1')
    expect(url.searchParams.get('count')).toBe('35')
    for (const k of ['msToken', 'X-Bogus', 'X-Gnarly', '_signature']) expect(url.searchParams.has(k)).toBe(false)
  })

  it('reports no-common-params when the page has made no signed /api/ request', async () => {
    const script = radarFetchScript('/api/post/item_list/', { secUid: 'S1' }, 'common')
    const { result, urls } = await runInFakePage(script, ['https://www.tiktok.com/api/foo/?aid=1'])
    expect(result).toEqual({ ok: false, error: 'no-common-params' })
    expect(urls).toHaveLength(0)
    expect(classifyResponse(result)).toEqual({ kind: 'error', error: NO_COMMON_PARAMS_ERROR, fatal: true })
  })

  it('sends plain requests with only the given params', async () => {
    const script = radarFetchScript('/api/search/general/full/', { keyword: 'cozy room', offset: '20', count: '20' }, 'plain')
    const { urls } = await runInFakePage(script, ['https://www.tiktok.com/api/x/?device_id=1'])
    expect(urls[0]).toBe('/api/search/general/full/?keyword=cozy+room&offset=20&count=20')
  })
})

// ─── Block detection ────────────────────────────────────────────────────────

describe('classifyResponse', () => {
  it('treats an empty body with tt_orcas_res: 1 as a block', () => {
    expect(classifyResponse(EMPTY_ORCAS).kind).toBe('block')
  })

  it('treats HTTP >= 400 as a block', () => {
    expect(classifyResponse({ ok: true, status: 429, orcas: null, text: '' }).kind).toBe('block')
    expect(classifyResponse({ ok: true, status: 403, orcas: null, text: '{}' }).kind).toBe('block')
  })

  it('treats statusCode 10000 as a captcha block', () => {
    expect(classifyResponse(ok({ statusCode: 10000 })).kind).toBe('block')
    expect(classifyResponse(ok({ status_code: 10000 })).kind).toBe('block')
  })

  it('treats other failures as non-block errors', () => {
    expect(classifyResponse({ ok: true, status: 200, orcas: null, text: '' })).toMatchObject({ kind: 'error', fatal: false })
    expect(classifyResponse({ ok: true, status: 200, orcas: null, text: '<html>' })).toMatchObject({ kind: 'error' })
    expect(classifyResponse({ ok: false, error: 'Failed to fetch' })).toMatchObject({ kind: 'error', fatal: false })
    expect(classifyResponse(undefined)).toMatchObject({ kind: 'error' })
  })

  it('passes a normal payload', () => {
    expect(classifyResponse(ok({ statusCode: 0, itemList: [] }))).toEqual({ kind: 'ok', json: { statusCode: 0, itemList: [] } })
  })
})

// ─── Parsing helpers ────────────────────────────────────────────────────────

describe('parsing', () => {
  it('prefers statsV2 strings over stats and maps the snapshot shape', () => {
    const v = parseVideoItem(item('v1', 's1', NOW - H, { musicId: 'm1', plays: 1234, tags: ['Decor', 'decor', 'home'] }), NOW)
    expect(v).toEqual({
      t: NOW, id: 'v1', createTime: NOW - H, desc: 'video v1', duration: 21, author: 'u_s1', secUid: 's1',
      followers: 5000, creatorVideos: 40, music: { id: 'm1', title: 'song m1', original: false },
      tags: ['decor', 'home'], pinned: false, plays: 1234, likes: 100, comments: 10, shares: 5, saves: 7,
    })
  })

  it('falls back to stats and tolerates missing fields', () => {
    const v = parseVideoItem({ id: 7, author: { uniqueId: 'x' }, stats: { playCount: 9 } }, NOW)
    expect(v).toMatchObject({ id: '7', author: 'x', secUid: '', plays: 9, likes: 0, music: null, tags: [] })
    expect(parseVideoItem({ id: 'no-author' }, NOW)).toBeNull()
  })

  it('dedupes discovery candidates and excludes known creators', () => {
    const vids = [item('a', 's1', NOW), item('b', 's1', NOW), item('c', 's2', NOW), item('d', 's3', NOW)]
      .map(i => parseVideoItem(i, NOW)!)
    expect(discoverCandidates(vids, new Set(['s3'])).map(c => c.secUid)).toEqual(['s1', 's2'])
  })

  it('ranks sounds by distinct recent videos', () => {
    const vids = [
      item('a', 's1', NOW - H, { musicId: 'm2' }), item('b', 's1', NOW - H, { musicId: 'm1' }),
      item('b', 's1', NOW - H, { musicId: 'm1' }), item('c', 's2', NOW - H, { musicId: 'm1' }),
      item('old', 's2', NOW - 10 * D, { musicId: 'm3' }),
    ].map(i => parseVideoItem(i, NOW)!)
    expect(topSoundIds(vids, NOW - 7 * D, 30)).toEqual(['m1', 'm2'])
    expect(topSoundIds(vids, NOW - 7 * D, 1)).toEqual(['m1'])
  })
})

// ─── Cycle ──────────────────────────────────────────────────────────────────

describe('radarCollectOnce', () => {
  function discoveryWorld(): Handler {
    return ({ path, own }) => {
      if (path === '/api/search/general/full/') {
        const items = own.offset === '0'
          ? [item('sa', 'A', NOW - H), item('sb', 'B', NOW - 20 * D), item('sc', 'C', NOW - 2 * H, { pinned: true })]
          : [item('sa2', 'A', NOW - 2 * H)]
        return ok({ data: items.map(i => ({ type: 1, item: i })) })
      }
      if (path === '/api/post/item_list/') {
        const lists: Record<string, unknown[]> = {
          A: [item('a1', 'A', NOW - H, { musicId: 'm1' }), item('a2', 'A', NOW - 30 * H, { musicId: 'm1' }), item('a3', 'A', NOW - 10 * D, { musicId: 'm2' })],
          B: [item('b1', 'B', NOW - 10 * D)],
          C: [item('c0', 'C', NOW - H, { pinned: true }), item('c1', 'C', NOW - 9 * D)],
        }
        return ok({ statusCode: 0, itemList: lists[own.secUid] ?? [] })
      }
      if (path === '/api/music/detail/') {
        return ok({ musicInfo: { music: { id: own.musicId, title: `song ${own.musicId}`, original: false }, stats: { videoCount: 321 } } })
      }
      return { ok: false, error: 'unexpected path ' + path }
    }
  }

  it('discovers only creators whose newest non-pinned post is within 7 days and writes snapshots', async () => {
    await upsertNiche({ id: 'decor', keywords: ['cozy room'] })
    const { exec, sleep } = install(discoveryWorld())

    const res = await radarCollectOnce('decor')
    expect(res.ok).toBe(true)

    const niche = await getNiche('decor')
    expect(niche?.creators.map(c => c.secUid)).toEqual(['A'])
    expect(niche?.creators[0]).toMatchObject({ uniqueId: 'u_A', followers: 5000, addedAt: NOW, lastPostAt: NOW - H })

    // 2 searches + 3 candidate reads (A, B, C) + 1 sound (m1; m2 is older than 7 days)
    expect(exec).toHaveBeenCalledTimes(6)
    const videos = await readVideoSnapshots('decor')
    expect(videos.map(v => v.id).sort()).toEqual(['a1', 'a2', 'a3'])
    const sounds = await readSoundSnapshots('decor')
    expect(sounds).toEqual([{ t: NOW, id: 'm1', title: 'song m1', original: false, videoCount: 321 }])

    const runs = await readRunLogs('decor')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ t: NOW, calls: 6, blocks: 0, creators: 1, fresh48h: 2, sounds: 1, discovered: 1 })
    expect(runs[0].blocked).toBeUndefined()

    // every call after the first waits out the 4 s gap
    expect(sleep).toHaveBeenCalledTimes(5)
    for (const c of sleep.mock.calls) expect(c[0]).toBeGreaterThanOrEqual(RADAR_COLLECT.minGapMs)
  })

  it('skips discovery with >= 20 creators, uses common params for creator reads, and snapshots only fresh videos between history passes', async () => {
    await upsertNiche({ id: 'big', keywords: ['k'], creators: creators(20) })
    const seen: Array<{ path: string; common: boolean }> = []
    install(r => {
      seen.push({ path: r.path, common: r.common })
      if (r.path === '/api/post/item_list/') {
        return ok({ itemList: [item(`${r.own.secUid}-new`, r.own.secUid, NOW - H), item(`${r.own.secUid}-old`, r.own.secUid, NOW - 5 * D)] })
      }
      return ok({})
    })

    await radarCollectOnce('big')
    expect(seen.filter(s => s.path === '/api/search/general/full/')).toHaveLength(0)
    expect(seen.filter(s => s.path === '/api/post/item_list/').every(s => s.common)).toBe(true)
    expect(await readVideoSnapshots('big')).toHaveLength(40) // first pass = full history

    await radarCollectOnce('big')
    expect(await readVideoSnapshots('big')).toHaveLength(60) // second pass = fresh only
  })

  it('stops after 3 blocks and returns blocked', async () => {
    await upsertNiche({ id: 'n', keywords: ['k'], creators: creators(3) })
    const answers = [EMPTY_ORCAS, { ok: true, status: 429, orcas: null, text: '' }, ok({ statusCode: 10000 })]
    const { exec } = install(() => answers.shift() ?? ok({ itemList: [] }))

    const res = await radarCollectOnce('n')
    expect(res).toMatchObject({ ok: false, blocked: true })
    expect(exec).toHaveBeenCalledTimes(3) // 2 searches + the first creator read
    const runs = await readRunLogs('n')
    expect(runs[0]).toMatchObject({ calls: 3, blocks: 3, blocked: true })
    expect(await readVideoSnapshots('n')).toEqual([])
    expect((await getNiche('n'))?.creators).toHaveLength(3)
  })

  it('aborts with a clear error when the page has no common params', async () => {
    await upsertNiche({ id: 'n', keywords: ['k'], creators: creators(20) })
    const { exec } = install(() => ({ ok: false, error: 'no-common-params' }))
    const res = await radarCollectOnce('n')
    expect(res).toMatchObject({ ok: false, error: NO_COMMON_PARAMS_ERROR })
    expect(res.blocked).toBeUndefined()
    expect(exec).toHaveBeenCalledTimes(1)
    expect((await readRunLogs('n'))[0]).toMatchObject({ calls: 1, blocks: 0, error: NO_COMMON_PARAMS_ERROR })
  })

  it('rejects unknown niches', async () => {
    install(() => ok({}))
    expect(await radarCollectOnce('nope')).toMatchObject({ ok: false })
  })
})

// ─── Scheduler ──────────────────────────────────────────────────────────────

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(NOW_MS)
  })

  function installLive(handler: Handler): ReturnType<typeof vi.fn> {
    const exec = vi.fn(async (script: string) => handler(route(script)))
    setRadarDeps({ exec, sleep: async () => {}, nowMs: () => Date.now() })
    return exec
  }

  async function until(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 50000; i++) {
      if (cond()) return
      await new Promise(r => setImmediate(r))
    }
    throw new Error('condition not reached')
  }

  const statusOf = (id: string) => radarStatus().niches.find(n => n.id === id)

  it('runs a cycle at start and re-arms at intervalMin', async () => {
    await upsertNiche({ id: 'n', keywords: ['k'], creators: creators(20), intervalMin: 30 })
    installLive(() => ok({ itemList: [] }))
    expect(await startRadar('n')).toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    await until(() => (statusOf('n')?.nextAt ?? 0) > NOW_MS)
    expect(statusOf('n')).toMatchObject({ backoff: false, nextAt: NOW_MS + 30 * 60_000 })
    expect(stopRadar('n')).toEqual({ ok: true })
    expect(radarStatus().niches).toEqual([])
  })

  it('backs off 60 minutes after a blocked cycle', async () => {
    await upsertNiche({ id: 'n', keywords: ['k'], creators: creators(20) })
    installLive(() => EMPTY_ORCAS)
    await startRadar('n')
    await vi.advanceTimersByTimeAsync(0)
    await until(() => (statusOf('n')?.nextAt ?? 0) > NOW_MS)
    expect(statusOf('n')).toMatchObject({ backoff: true, nextAt: NOW_MS + 60 * 60_000 })
    expect(statusOf('n')?.lastRun).toMatchObject({ blocked: true, blocks: 3 })
  })

  it('never runs two cycles at once across niches', async () => {
    await upsertNiche({ id: 'a', keywords: ['k'], creators: creators(20) })
    await upsertNiche({ id: 'b', keywords: ['k'], creators: creators(20) })
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const exec = installLive(async () => {
      await gate
      return ok({ itemList: [] })
    })

    await startRadar('a')
    await vi.advanceTimersByTimeAsync(0)
    await until(() => radarStatus().busy === 'a')

    await startRadar('b')
    await vi.advanceTimersByTimeAsync(0)
    expect(statusOf('b')?.nextAt).toBe(NOW_MS + RADAR_COLLECT.lockRetryMs)
    expect(statusOf('b')?.lastRun).toBeNull()
    expect(await radarCollectOnce('b')).toMatchObject({ ok: false, error: expect.stringContaining('another radar cycle') })
    const callsWhileLocked = exec.mock.calls.length
    expect(callsWhileLocked).toBe(1)

    release()
    await until(() => statusOf('a')?.lastRun != null)
    expect(radarStatus().busy).toBeNull()

    await vi.advanceTimersByTimeAsync(RADAR_COLLECT.lockRetryMs)
    await until(() => statusOf('b')?.lastRun != null)
  })

  it('does not re-arm a niche stopped mid-cycle', async () => {
    await upsertNiche({ id: 'n', keywords: ['k'], creators: creators(20) })
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    installLive(async () => {
      await gate
      return ok({ itemList: [] })
    })
    await startRadar('n')
    await vi.advanceTimersByTimeAsync(0)
    await until(() => radarStatus().busy === 'n')
    stopRadar('n')
    release()
    await until(() => radarStatus().busy === null)
    expect(radarStatus().niches).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses to start an unknown niche', async () => {
    expect(await startRadar('ghost')).toMatchObject({ ok: false })
  })
})

// ─── Report ─────────────────────────────────────────────────────────────────

describe('radarReportFor', () => {
  it('scores stored snapshots and appends a recommendation row', async () => {
    await upsertNiche({ id: 'decor', keywords: ['cozy room'], seedTags: ['decor'] })
    install(({ path, own }) => {
      if (path === '/api/search/general/full/') return ok({ data: [{ item: item('sa', 'A', NOW - H) }] })
      if (path === '/api/post/item_list/') {
        return ok({ itemList: [item('a1', own.secUid, NOW - H, { musicId: 'm1', plays: 50000 }), item('a2', own.secUid, NOW - 3 * D, { musicId: 'm1', plays: 900 })] })
      }
      return ok({ musicInfo: { music: { id: own.musicId, title: 't', original: true }, stats: { videoCount: 10 } } })
    })
    await radarCollectOnce('decor')

    const res = await radarReportFor('decor', 24)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.report.stats.videos).toBeGreaterThan(0)
    const recs = await readRecommendations('decor')
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ t: NOW, hours: 24 })
    expect(Array.isArray(recs[0].topVideos)).toBe(true)
  })

  it('reports unknown niches', async () => {
    expect(await radarReportFor('ghost')).toMatchObject({ ok: false })
  })
})
