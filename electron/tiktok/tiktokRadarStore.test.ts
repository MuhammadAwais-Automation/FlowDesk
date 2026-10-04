import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import {
  appendRecommendation,
  appendRunLog,
  appendVideoSnapshots,
  getNiche,
  loadNiches,
  pruneNiche,
  radarFilePath,
  readRecommendations,
  readRunLogs,
  readVideoSnapshots,
  removeNiche,
  saveNicheCreators,
  setRadarStoreDir,
  upsertNiche,
  validateNicheInput,
  type RadarVideoSnapshot,
} from './tiktokRadarStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'radar-store-'))
  setRadarStoreDir(dir)
})

afterEach(() => {
  setRadarStoreDir(null)
  rmSync(dir, { recursive: true, force: true })
})

function snap(t: number, id = 'v1'): RadarVideoSnapshot {
  return {
    t, id, createTime: t - 100, desc: '', duration: 20, author: 'a', secUid: 's', followers: 10, creatorVideos: 5,
    music: null, tags: [], pinned: false, plays: 1, likes: 0, comments: 0, shares: 0, saves: 0,
  }
}

describe('validateNicheInput', () => {
  it('accepts a minimal niche and fills defaults', () => {
    const v = validateNicheInput({ id: 'home-decor', keywords: ['cozy room'] })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.niche).toMatchObject({ id: 'home-decor', name: 'home-decor', keywords: ['cozy room'], seedTags: [], creators: [], enabled: true, intervalMin: 20 })
  })

  it('rejects ids that are not slugs', () => {
    for (const id of ['Home', 'a b', '../x', '', '-x', 'x'.repeat(41)]) {
      expect(validateNicheInput({ id, keywords: ['k'] }).ok).toBe(false)
    }
  })

  it('requires 1 to 30 keywords', () => {
    expect(validateNicheInput({ id: 'n', keywords: [] }).ok).toBe(false)
    expect(validateNicheInput({ id: 'n' }).ok).toBe(false)
    expect(validateNicheInput({ id: 'n', keywords: Array.from({ length: 31 }, (_, i) => `k${i}`) }).ok).toBe(false)
    expect(validateNicheInput({ id: 'n', keywords: Array.from({ length: 30 }, (_, i) => `k${i}`) }).ok).toBe(true)
  })

  it('rejects more than 80 creators and creators without secUid', () => {
    const many = Array.from({ length: 81 }, (_, i) => ({ secUid: `s${i}` }))
    expect(validateNicheInput({ id: 'n', keywords: ['k'], creators: many }).ok).toBe(false)
    expect(validateNicheInput({ id: 'n', keywords: ['k'], creators: [{ uniqueId: 'x' }] }).ok).toBe(false)
  })

  it('dedupes creators and keywords, normalises seed tags and clamps the interval', () => {
    const v = validateNicheInput({
      id: 'n', keywords: ['A', 'a', ' b '], seedTags: ['#Decor'], intervalMin: 1,
      creators: [{ secUid: 's1', uniqueId: '@x' }, { secUid: 's1' }],
    })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.niche.keywords).toEqual(['A', 'b'])
    expect(v.niche.seedTags).toEqual(['decor'])
    expect(v.niche.creators).toHaveLength(1)
    expect(v.niche.creators[0].uniqueId).toBe('x')
    expect(v.niche.intervalMin).toBe(5)
  })
})

describe('niche config', () => {
  it('upserts, reads, updates creators and removes niches', async () => {
    expect(await loadNiches()).toEqual([])
    expect((await upsertNiche({ id: 'n1', keywords: ['k'] })).ok).toBe(true)
    expect((await upsertNiche({ id: 'n1', name: 'Renamed', keywords: ['k'] })).ok).toBe(true)
    expect(await loadNiches()).toHaveLength(1)
    expect((await getNiche('n1'))?.name).toBe('Renamed')

    await saveNicheCreators('n1', [
      { secUid: 's1', uniqueId: 'a', followers: 1, addedAt: 1, lastPostAt: 1 },
      { secUid: 's1', uniqueId: 'dup', followers: 1, addedAt: 1, lastPostAt: 1 },
    ])
    expect((await getNiche('n1'))?.creators.map(c => c.uniqueId)).toEqual(['a'])

    expect(await removeNiche('n1')).toBe(true)
    expect(await removeNiche('n1')).toBe(false)
  })

  it('does not persist invalid input', async () => {
    const r = await upsertNiche({ id: 'BAD', keywords: ['k'] })
    expect(r.ok).toBe(false)
    expect(await loadNiches()).toEqual([])
  })

  it('treats a corrupt niches.json as empty', async () => {
    writeFileSync(join(dir, 'niches.json'), '{not json')
    expect(await loadNiches()).toEqual([])
  })
})

describe('jsonl files', () => {
  it('appends and reads rows inside a time window, skipping bad lines', async () => {
    await appendVideoSnapshots('n1', [snap(100), snap(200), snap(300)])
    const file = radarFilePath('n1', 'videos')
    writeFileSync(file, readFileSync(file, 'utf8') + 'garbage\n{"no":"t"}\n')
    expect((await readVideoSnapshots('n1')).map(r => r.t)).toEqual([100, 200, 300])
    expect((await readVideoSnapshots('n1', 150)).map(r => r.t)).toEqual([200, 300])
    expect((await readVideoSnapshots('n1', 150, 250)).map(r => r.t)).toEqual([200])
  })

  it('returns [] for a niche with no files', async () => {
    expect(await readRunLogs('empty')).toEqual([])
  })

  it('refuses path-traversal niche ids', () => {
    expect(() => radarFilePath('../evil', 'videos')).toThrow()
  })
})

describe('pruneNiche', () => {
  it('drops rows older than the retention window but keeps recommendations', async () => {
    const now = 100 * 86400
    const old = now - 15 * 86400
    const recent = now - 86400
    await appendVideoSnapshots('n1', [snap(old), snap(recent)])
    await appendRunLog('n1', { t: old, calls: 1, blocks: 0, creators: 0, fresh48h: 0, sounds: 0, durationMs: 1 })
    await appendRecommendation('n1', { t: old, hours: 24, topVideos: [], sounds: [], tags: [], opportunities: [] })

    const removed = await pruneNiche('n1', 14, now)
    expect(removed).toEqual({ videos: 1, sounds: 0, runs: 1 })
    expect((await readVideoSnapshots('n1')).map(r => r.t)).toEqual([recent])
    expect(await readRunLogs('n1')).toEqual([])
    expect(await readRecommendations('n1')).toHaveLength(1)
  })

  it('is a no-op when nothing is stale', async () => {
    mkdirSync(join(dir, 'n1'), { recursive: true })
    await appendVideoSnapshots('n1', [snap(1000)])
    expect(await pruneNiche('n1', 14, 1000)).toEqual({ videos: 0, sounds: 0, runs: 0 })
  })
})
