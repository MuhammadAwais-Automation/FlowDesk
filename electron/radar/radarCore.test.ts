import { describe, expect, it } from 'vitest'
import {
  RADAR_DEFAULTS,
  ageBucket,
  buildVideoSeries,
  burstStates,
  creatorOutlier,
  durationBucket,
  hashtagMomentum,
  isGenericTag,
  logRobustZ,
  mad,
  median,
  nicheOpportunity,
  nicheRelevance,
  nicheRelevanceMap,
  outlierBand,
  percentileInCohort,
  pickTags,
  quantile,
  radarReport,
  robustZ,
  soundMomentum,
  toCount,
  videoBreakout,
} from './radarCore'
import type { SoundSnapshot, TagScore, VideoSeries, VideoSnapshot } from './types'

const NOW = 1_800_000_000
const H = 3600
const D = 24 * H

interface SnapInput extends Partial<VideoSnapshot> {
  id: string
  t: number
}

function snap(input: SnapInput): VideoSnapshot {
  return {
    createTime: NOW - 3 * H,
    author: `author-${input.id}`,
    secUid: `sec-${input.id}`,
    followers: 5000,
    duration: 25,
    music: null,
    tags: [],
    pinned: false,
    plays: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    ...input,
  }
}

/** A video observed at the given ages (hours) with the given view counts. */
function videoSnaps(id: string, createTime: number, ages: number[], views: number[], extra: Partial<VideoSnapshot> = {}): VideoSnapshot[] {
  return ages.map((age, i) =>
    snap({
      id,
      t: createTime + age * H,
      createTime,
      plays: views[i],
      likes: Math.round(views[i] * 0.05),
      shares: Math.round(views[i] * 0.005),
      saves: Math.round(views[i] * 0.003),
      ...extra,
    }),
  )
}

function series(snaps: VideoSnapshot[]): VideoSeries[] {
  return buildVideoSeries(snaps)
}

function seriesById(all: VideoSeries[], id: string): VideoSeries {
  const s = all.find((x) => x.id === id)
  if (!s) throw new Error(`missing series ${id}`)
  return s
}

/** 12 steady cohort videos, ~200 views/h, created 3 h before NOW, observed at 1/2/3 h. */
function steadyCohort(): VideoSnapshot[] {
  const out: VideoSnapshot[] = []
  for (let i = 0; i < 12; i++) {
    const k = 0.8 + (i % 5) * 0.1
    out.push(...videoSnaps(`c${i}`, NOW - 3 * H, [1, 2, 3], [200 * k, 400 * k, 600 * k].map(Math.round)))
  }
  return out
}

describe('robust stats', () => {
  it('returns 0 for empty samples instead of NaN', () => {
    expect(median([])).toBe(0)
    expect(mad([])).toBe(0)
    expect(quantile([], 0.5)).toBe(0)
    expect(robustZ(5, [])).toBe(0)
    expect(logRobustZ(5, [])).toBe(0)
    expect(percentileInCohort(5, [])).toBe(0.5)
  })

  it('computes median, MAD and quantiles', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(mad([1, 2, 3, 4, 100])).toBe(1)
    expect(quantile([0, 10], 0.9)).toBeCloseTo(9)
    expect(median([1, NaN, 3])).toBe(2)
  })

  it('never divides by zero when MAD is zero', () => {
    expect(robustZ(5, [3, 3, 3])).toBeCloseTo(2 / RADAR_DEFAULTS.stats.minLogScale)
    expect(robustZ(5, [3, 3, 3], 0)).toBe(0)
    const z = robustZ(9, [3, 3, 3, 9], 0)
    expect(Number.isFinite(z)).toBe(true)
    expect(z).toBeGreaterThan(0)
  })

  it('computes mid-rank percentiles', () => {
    expect(percentileInCohort(3, [1, 2, 3, 4])).toBeCloseTo(0.625)
    expect(percentileInCohort(10, [1, 2, 3])).toBe(1)
    expect(percentileInCohort(0, [1, 2, 3])).toBe(0)
  })

  it('buckets ages and durations at the spec edges', () => {
    expect(ageBucket(0.5)).toBe('0-1')
    expect(ageBucket(1)).toBe('1-2')
    expect(ageBucket(3.9)).toBe('2-4')
    expect(ageBucket(7)).toBe('4-8')
    expect(ageBucket(23)).toBe('8-24')
    expect(ageBucket(30)).toBe('24-48')
    expect(ageBucket(100)).toBe('48+')
    expect(ageBucket(-1)).toBe('0-1')
    expect(durationBucket(10)).toBe('<15')
    expect(durationBucket(15)).toBe('15-30')
    expect(durationBucket(45)).toBe('30-60')
    expect(durationBucket(120)).toBe('60-180')
    expect(durationBucket(600)).toBe('180+')
  })

  it('parses counts that arrive as strings', () => {
    expect(toCount('12345')).toBe(12345)
    expect(toCount('1,234')).toBe(1234)
    expect(toCount('1.2K')).toBe(1200)
    expect(toCount('3m')).toBe(3_000_000)
    expect(toCount('abc')).toBe(0)
    expect(toCount(-5)).toBe(0)
    expect(toCount(NaN)).toBe(0)
    expect(toCount(undefined)).toBe(0)
  })

  it('detects a Kleinberg burst at the end of a stream', () => {
    const d = new Array(48).fill(10)
    const r = [...new Array(40).fill(1), ...new Array(8).fill(6)]
    const states = burstStates(r, d, 2, 1)
    expect(states.slice(0, 30).every((s) => s === 0)).toBe(true)
    expect(states.slice(-6).every((s) => s === 1)).toBe(true)
    expect(burstStates([], [], 2, 1)).toEqual([])
    expect(burstStates([0, 0], [5, 5], 2, 1)).toEqual([0, 0])
  })
})

describe('buildVideoSeries', () => {
  it('sorts by t, dedupes identical t and parses string counts', () => {
    const out = buildVideoSeries([
      snap({ id: 'v1', t: NOW, plays: '300' }),
      snap({ id: 'v1', t: NOW - H, plays: '100' }),
      snap({ id: 'v1', t: NOW, plays: '1.5k' }),
      snap({ id: '', t: NOW, plays: 5 }),
      snap({ id: 'v2', t: 0, plays: 5 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].points.map((p) => p.plays)).toEqual([100, 1500])
    expect(out[0].points[0].ageH).toBeCloseTo(2)
  })

  it('normalizes tags and keeps latest metadata', () => {
    const [s] = buildVideoSeries([
      snap({ id: 'v1', t: NOW - H, tags: ['#Old'], followers: '10' }),
      snap({ id: 'v1', t: NOW, tags: ['#Gym', 'gym', ' LegDay '], followers: '2,000', music: { id: 'm1', title: 'x', original: true } }),
    ])
    expect(s.tags).toEqual(['gym', 'legday'])
    expect(s.followers).toBe(2000)
    expect(s.music?.id).toBe('m1')
  })
})

describe('A. videoBreakout', () => {
  const accelerating = videoSnaps('hot', NOW - 3 * H, [1, 2, 3], [300, 1200, 4000])
  const flat = videoSnaps('flat', NOW - 3 * H, [1, 2, 3], [2000, 2050, 2080])
  const all = series([...steadyCohort(), ...accelerating, ...flat])

  it('flags an accelerating video at 3x+ the cohort median', () => {
    const b = videoBreakout(seriesById(all, 'hot'), all, NOW)
    expect(b.flag).toBe('BREAKOUT')
    expect(b.score).toBeGreaterThanOrEqual(2)
    expect(b.accel).toBeGreaterThan(0)
    expect(b.cohortMultiple).toBeGreaterThanOrEqual(3)
    expect(b.why.join(' ')).toMatch(/views\/h 2\.8k/)
  })

  it('does not flag a plateaued video even when its level is high', () => {
    const b = videoBreakout(seriesById(all, 'flat'), all, NOW)
    expect(b.flag).not.toBe('BREAKOUT')
    expect(b.accel).toBeLessThan(0)
  })

  it('does not flag an ordinary cohort video', () => {
    const b = videoBreakout(seriesById(all, 'c2'), all, NOW)
    expect(b.flag).toBe('NONE')
    expect(Math.abs(b.components.levelZ)).toBeLessThan(2)
  })

  it('never flags BREAKOUT from a single snapshot', () => {
    const one = series([...steadyCohort(), snap({ id: 'solo', t: NOW, createTime: NOW - 3 * H, plays: 50_000, shares: 900, saves: 500, likes: 5000 })])
    const b = videoBreakout(seriesById(one, 'solo'), one, NOW)
    expect(b.flag).not.toBe('BREAKOUT')
    expect(b.snapshots).toBe(1)
  })

  it('handles an empty cohort without NaN', () => {
    const lone = series(accelerating)
    const b = videoBreakout(lone[0], lone, NOW)
    expect(b.flag).toBe('NONE')
    expect(Number.isFinite(b.score)).toBe(true)
    expect(b.why.join(' ')).toMatch(/no cohort/)
  })

  it('projects 24h views once enough past videos were seen at ~24h', () => {
    const past: VideoSnapshot[] = []
    for (let i = 0; i < 6; i++) {
      past.push(...videoSnaps(`p${i}`, NOW - 30 * H - i * H, [3, 24], [500, 5000]))
    }
    const withPast = series([...steadyCohort(), ...accelerating, ...past])
    const b = videoBreakout(seriesById(withPast, 'hot'), withPast, NOW)
    expect(b.projection).not.toBeNull()
    expect(b.projection?.views24h).toBeGreaterThan(b.views)
  })
})

describe('B. creatorOutlier', () => {
  const histViews = [900, 1000, 1100, 950, 1050, 1000]
  const history = series(histViews.map((v, i) => snap({ id: `h${i}`, t: NOW, createTime: NOW - (8 + i) * D, plays: v, author: 'me', secUid: 'me' })))
  const candidate = (views: number): VideoSeries =>
    series([snap({ id: 'cand', t: NOW, createTime: NOW - 8 * D, plays: views, author: 'me', secUid: 'me' })])[0]

  it.each([
    [1500, 'normal', false],
    [2500, 'watch', false],
    [3500, 'outlier', true],
    [6000, 'strong', true],
    [12_000, 'major', true],
    [25_000, 'anomalous', true],
  ])('%i views vs 1k creator median is %s', (views, band, flagged) => {
    const o = creatorOutlier(candidate(views), history, { now: NOW })
    expect(o.method).toBe('creator')
    expect(o.baseline).toBe(1000)
    expect(o.band).toBe(band)
    expect(o.flagged).toBe(flagged)
    expect(o.downweight).toBe(band === 'anomalous')
  })

  it('maps ratios onto bands', () => {
    expect(outlierBand(1.9)).toBe('normal')
    expect(outlierBand(2)).toBe('watch')
    expect(outlierBand(3)).toBe('outlier')
    expect(outlierBand(5)).toBe('strong')
    expect(outlierBand(10)).toBe('major')
    expect(outlierBand(20)).toBe('anomalous')
  })

  it('floors the baseline at 500', () => {
    const low = series([100, 120, 90, 110, 100].map((v, i) => snap({ id: `l${i}`, t: NOW, createTime: NOW - (8 + i) * D, plays: v })))
    const o = creatorOutlier(candidate(1000), low, { now: NOW })
    expect(o.baseline).toBe(500)
    expect(o.ratio).toBeCloseTo(2)
  })

  it('excludes young, pinned and the candidate itself from history, then falls back to the cohort', () => {
    const mixed = series([
      ...[1000, 1000, 1000, 1000].map((v, i) => snap({ id: `o${i}`, t: NOW, createTime: NOW - 9 * D, plays: v })),
      snap({ id: 'young', t: NOW, createTime: NOW - 2 * D, plays: 1000 }),
      snap({ id: 'pin', t: NOW, createTime: NOW - 30 * D, plays: 1_000_000, pinned: true }),
    ])
    const cand = candidate(10_000)
    const cohort = series(Array.from({ length: 20 }, (_, i) => snap({ id: `k${i}`, t: NOW, createTime: NOW - 8 * D, plays: 100 + i * 100 })))
    const o = creatorOutlier(cand, [...mixed, cand], { now: NOW, cohort })
    expect(o.historySize).toBe(4)
    expect(o.method).toBe('cohort')
    expect(o.cohortPct).toBe(1)
    expect(o.flagged).toBe(true)
    expect(o.why[0]).toMatch(/only 4 creator videos/)
  })

  it('does not flag in fallback without a cohort', () => {
    const o = creatorOutlier(candidate(10_000), [], { now: NOW })
    expect(o.method).toBe('cohort')
    expect(o.flagged).toBe(false)
    expect(o.baseline).toBe(500)
  })

  it('uses projected views for a young video when they are higher', () => {
    const young = series([snap({ id: 'y', t: NOW, createTime: NOW - 2 * H, plays: 800, author: 'me', secUid: 'me' })])[0]
    const o = creatorOutlier(young, history, { now: NOW, projectedViews: 4000 })
    expect(o.projected).toBe(true)
    expect(o.views).toBe(4000)
    expect(o.flagged).toBe(true)
  })
})

function soundSnaps(id: string, points: Array<[number, number | string]>, original = false): SoundSnapshot[] {
  return points.map(([t, videoCount]) => ({ t, id, title: `title ${id}`, original, videoCount }))
}

describe('C. soundMomentum', () => {
  const snaps = [
    ...soundSnaps('early', [[NOW - 4 * H, 100], [NOW - 2 * H, 130], [NOW, 250]]),
    ...soundSnaps('peaking', [[NOW - 4 * H, 1000], [NOW - 2 * H, 1400], [NOW, 1600]]),
    ...soundSnaps('saturated', [[NOW - 4 * H, 500_000], [NOW - 2 * H, 500_010], [NOW, 500_012]]),
    ...soundSnaps('single', [[NOW, 100]]),
    ...soundSnaps('tooShort', [[NOW - 30 * 60, 100], [NOW, 150]]),
    ...soundSnaps('twoPoints', [[NOW - 3 * H, 100], [NOW, '400']]),
  ]
  const byId = (id: string, list = soundMomentum(snaps, [], NOW)) => {
    const s = list.find((x) => x.id === id)
    if (!s) throw new Error(`missing sound ${id}`)
    return s
  }

  it('detects EARLY, PEAKING and SATURATED from short spans', () => {
    expect(byId('early').phase).toBe('EARLY')
    expect(byId('peaking').phase).toBe('PEAKING')
    expect(byId('saturated').phase).toBe('SATURATED')
  })

  it('is UNKNOWN with one snapshot, a span under 1h, or no midpoint for acceleration', () => {
    expect(byId('single').phase).toBe('UNKNOWN')
    expect(byId('tooShort').phase).toBe('UNKNOWN')
    expect(byId('twoPoints').phase).toBe('UNKNOWN')
  })

  it('still reports the short-window rate and an extrapolated 24h growth', () => {
    const e = byId('early')
    expect(e.shortRatePerH).toBeCloseTo(37.5)
    expect(e.growth24Estimated).toBe(true)
    expect(e.growth24).toBeCloseTo(9)
    expect(byId('twoPoints').shortRatePerH).toBeCloseTo(100)
    expect(byId('tooShort').shortRatePerH).toBeCloseTo(100)
  })

  it('uses exact day-over-day growth with 48h+ of history', () => {
    const list = soundMomentum(soundSnaps('long', [[NOW - 48 * H, 100], [NOW - 24 * H, 150], [NOW, 400]]), [], NOW)
    const s = list[0]
    expect(s.growth24Estimated).toBe(false)
    expect(s.growth24).toBeCloseTo(250 / 150)
    expect(s.accel).toBeCloseTo(Math.log(255 / 55))
    expect(s.phase).toBe('EARLY')
  })

  it('penalizes saturation and ranks the early sound above the saturated one', () => {
    const list = soundMomentum(snaps, [], NOW)
    expect(byId('saturated', list).saturation).toBeGreaterThan(0.5)
    expect(byId('early', list).score).toBeGreaterThan(byId('saturated', list).score)
  })

  it('measures niche lift and recommends an EARLY sound that performs', () => {
    const vids = series([
      ...[0, 1, 2, 3].map((i) => snap({ id: `r${i}`, t: NOW, createTime: NOW - (5 + i) * H, music: { id: 'early', title: 't', original: false } })),
      ...[0, 1, 2, 3, 4, 5].map((i) => snap({ id: `n${i}`, t: NOW, createTime: NOW - (10 + i) * H })),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => snap({ id: `p${i}`, t: NOW, createTime: NOW - (3 + i / 2) * D })),
    ])
    const ratios = new Map([['r0', 3], ['r1', 2], ['r2', 1.5], ['r3', 4]])
    const list = soundMomentum(snaps, vids, NOW, { outlierRatios: ratios })
    const e = byId('early', list)
    expect(e.nicheVideos48h).toBe(4)
    expect(e.nicheShare48h).toBeCloseTo(0.4)
    expect(e.nicheLift).toBeGreaterThan(1)
    expect(e.perfLift).toBeCloseTo(2.5)
    expect(e.recommend).toBe(true)
    expect(byId('peaking', list).recommend).toBe(false)
  })
})

function tagScore(tag: string, fields: Partial<TagScore>): TagScore {
  return {
    tag,
    isSeed: false,
    count: 10,
    share: 0.1,
    creators: 3,
    generic: false,
    freq24: 1,
    basePerDay: 1,
    lift: 1,
    burst: false,
    perf: null,
    perfN: 0,
    pmi: 0.2,
    score: 0.5,
    why: [],
    ...fields,
  }
}

describe('D. hashtag momentum and pickTags', () => {
  it('rejects tags with PMI < 0 even when they score highest', () => {
    const picked = pickTags([
      tagScore('offtopic', { pmi: -0.4, score: 0.99, lift: 5 }),
      tagScore('core1', { pmi: 1.2 }),
      tagScore('core2', { pmi: 1.0 }),
      tagScore('rising', { pmi: 0.3, lift: 3, score: 0.9 }),
      tagScore('fyp', { pmi: 0, share: 0.6, count: 60 }),
    ])
    const tags = picked.map((p) => p.tag)
    expect(tags).not.toContain('offtopic')
    expect(tags.slice(0, 2)).toEqual(['core1', 'core2'])
    expect(picked.find((p) => p.tag === 'rising')?.role).toBe('momentum')
    expect(picked.find((p) => p.tag === 'fyp')?.role).toBe('broad')
    expect(picked.length).toBeGreaterThanOrEqual(3)
    expect(picked.length).toBeLessThanOrEqual(5)
  })

  it('caps at 5 tags with at most 2 momentum and 1 broad', () => {
    const many = [
      ...[1, 2, 3].map((i) => tagScore(`core${i}`, { pmi: 2 - i * 0.1 })),
      ...[1, 2, 3, 4].map((i) => tagScore(`mom${i}`, { pmi: 0.5, lift: 4, score: 1 - i * 0.1 })),
      tagScore('broad1', { pmi: 0.1, share: 0.8 }),
      tagScore('broad2', { pmi: 0.1, share: 0.7 }),
    ]
    const picked = pickTags(many)
    expect(picked).toHaveLength(5)
    expect(picked.filter((p) => p.role === 'core')).toHaveLength(2)
    expect(picked.filter((p) => p.role === 'momentum')).toHaveLength(2)
    expect(picked.filter((p) => p.role === 'broad')).toHaveLength(1)
  })

  it('fills up to 3 when roles leave gaps, and skips core tags whose perf < 1', () => {
    const picked = pickTags([
      tagScore('weak', { pmi: 3, perf: 0.5 }),
      tagScore('a', { pmi: 1 }),
      tagScore('b', { pmi: 0.5, score: 0.2 }),
      tagScore('c', { pmi: 0.4, score: 0.8 }),
    ])
    expect(picked.length).toBe(3)
    expect(picked.find((p) => p.tag === 'weak')?.role ?? 'fill').toBe('fill')
    expect(picked.filter((p) => p.role === 'core').map((p) => p.tag)).toEqual(['a', 'b'])
  })

  it('scores tags from niche videos, with negative PMI for off-niche tags', () => {
    const vids: VideoSnapshot[] = []
    for (let i = 0; i < 10; i++) vids.push(snap({ id: `a${i}`, t: NOW, createTime: NOW - (2 + i) * H, tags: ['fitness', 'gym', 'workout'] }))
    for (let i = 0; i < 5; i++) vids.push(snap({ id: `b${i}`, t: NOW, createTime: NOW - 3 * D - i * H, tags: ['fitness', 'gym', 'fyp'] }))
    for (let i = 0; i < 5; i++) vids.push(snap({ id: `c${i}`, t: NOW, createTime: NOW - 2 * D - i * H, tags: ['fyp', 'cats', 'funny'] }))
    const scores = hashtagMomentum(series(vids), ['#Fitness'], NOW)
    const cats = scores.find((s) => s.tag === 'cats')
    expect(cats?.pmi).toBeLessThan(0)
    const workout = scores.find((s) => s.tag === 'workout')
    expect(workout?.pmi).toBeGreaterThan(0)
    expect(workout?.lift).toBeGreaterThan(2)
    expect(scores.find((s) => s.tag === 'fitness')?.isSeed).toBe(true)
    const pickedTags = pickTags(scores)
    const picked = pickedTags.map((p) => p.tag)
    expect(picked).not.toContain('cats')
    expect(picked).not.toContain('funny')
    // gym and workout sit on > 20% of this tiny niche, so they are generic:
    // only one of them may take the single broad slot, none may be core.
    expect(picked).toContain('fitness')
    expect(pickedTags.filter((p) => p.role === 'broad')).toHaveLength(1)
    expect(pickedTags.filter((p) => ['gym', 'workout', 'fyp'].includes(p.tag)).every((p) => p.role === 'broad')).toBe(true)
    expect(picked.length).toBeLessThanOrEqual(5)
  })

  it('returns nothing for an empty niche', () => {
    expect(hashtagMomentum([], ['x'], NOW)).toEqual([])
    expect(pickTags([])).toEqual([])
  })
})

/** A niche where one sound is breaking out across 5 small creators. */
function hotNiche(): { videos: VideoSnapshot[]; sounds: SoundSnapshot[] } {
  const videos: VideoSnapshot[] = []
  const created = NOW - 5 * H
  for (let i = 0; i < 5; i++) {
    videos.push(
      ...videoSnaps(`hot${i}`, created + i * 60, [3, 4, 5], [2000 + i * 100, 8000 + i * 300, 30_000 + i * 1000], {
        music: { id: 'hotSound', title: 'Hot Sound', original: false },
        tags: ['fitness', 'legday', 'gymtok'],
        followers: 3000,
        desc: `leg day trick ${i}`,
        author: `hotAuthor${i}`,
        secUid: `hotSec${i}`,
        duration: 45,
      }),
    )
  }
  for (let i = 0; i < 25; i++) {
    const k = 0.8 + (i % 5) * 0.1
    videos.push(
      ...videoSnaps(`n${i}`, created + i * 30, [3, 4, 5], [300, 400, 500].map((v) => Math.round(v * k)), {
        music: { id: `other${i % 3}`, title: `Other ${i % 3}`, original: false },
        tags: ['fitness', i % 2 ? 'fyp' : 'motivation', i % 2 ? 'cardio' : 'running'],
        followers: 20_000,
        desc: `normal ${i}`,
        duration: 20,
      }),
    )
  }
  const sounds = [
    ...soundSnaps('hotSound', [[NOW - 4 * H, 200], [NOW - 2 * H, 300], [NOW, 700]]),
    ...soundSnaps('other0', [[NOW - 4 * H, 300_000], [NOW - 2 * H, 300_050], [NOW, 300_060]]),
    ...soundSnaps('other1', [[NOW - 4 * H, 5000], [NOW - 2 * H, 5400], [NOW, 5600]]),
  ]
  return { videos, sounds }
}

describe('E. nicheOpportunity', () => {
  it('ranks the breaking sound cluster first with idea, sound, tags, hour and length', () => {
    const { videos, sounds } = hotNiche()
    const report = radarReport(videos, sounds, { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 })
    const top = report.opportunities[0]
    expect(top.id).toBe('sound:hotSound')
    expect(top.idea?.videoId).toMatch(/^hot/)
    expect(top.idea?.desc).toMatch(/leg day/)
    expect(top.sound?.phase).toBe('EARLY')
    expect(top.outlierCreators).toBe(5)
    expect(top.hot).toBe(1)
    expect(top.smallOk).toBe(1)
    expect(top.bestHour).toBe(new Date((NOW - 5 * H) * 1000).getUTCHours())
    expect(top.lengthBucket).toBe('30-60')
    expect(top.tags.map((t) => t.tag)).not.toContain('cats')
    expect(top.tags.length).toBeGreaterThanOrEqual(1)
    expect(top.recommend).toBe(true)
  })

  it('clusters hashtags by co-occurrence component, ignoring seed tags', () => {
    const { videos } = hotNiche()
    const all = series(videos)
    const clusters = nicheOpportunity(all, {
      now: NOW,
      seedTags: ['fitness'],
      breakouts: new Map(),
      outliers: new Map(),
      sounds: [],
      tags: [],
    })
    const ids = clusters.map((c) => c.id)
    expect(ids).toContain('tags:gymtok+legday')
    expect(ids.some((id) => id.includes('fitness'))).toBe(false)
    const legday = clusters.find((c) => c.id === 'tags:gymtok+legday')
    expect(legday?.recommend).toBe(false)
    expect(legday?.bestHour).toBeNull()
  })

  it('returns no clusters without recent videos', () => {
    expect(nicheOpportunity([], { now: NOW, seedTags: [], breakouts: new Map(), outliers: new Map(), sounds: [], tags: [] })).toEqual([])
  })
})

describe('radarReport', () => {
  it('states caveats honestly on thin data', () => {
    const videos = [
      snap({ id: 'a', t: NOW, plays: 100 }),
      snap({ id: 'b', t: NOW, plays: 200 }),
      snap({ id: 'c', t: NOW, plays: 300 }),
    ]
    const r = radarReport(videos, [], { niche: 'x', seedTags: ['x'], now: NOW, hours: 24 })
    const text = r.caveats.join('\n')
    expect(text).toMatch(/Only one snapshot/)
    expect(text).toMatch(/Only 3 niche videos/)
    expect(text).toMatch(/No sound snapshots/)
    expect(text).toMatch(/No creator has 5\+ videos/)
    expect(r.stats).toMatchObject({ videos: 3, fresh: 3, creators: 3, snapshotSpanMin: 0, snapshotTimes: 1 })
  })

  it('warns when snapshots span less than an hour', () => {
    const videos = [snap({ id: 'a', t: NOW - 20 * 60, plays: 100 }), snap({ id: 'a', t: NOW, plays: 150 })]
    const r = radarReport(videos, soundSnaps('s', [[NOW - 20 * 60, 10], [NOW, 12]]), { niche: 'x', seedTags: [], now: NOW, hours: 24 })
    const text = r.caveats.join('\n')
    expect(text).toMatch(/span only 20 min/)
    expect(text).toMatch(/Sound snapshots cover less than 1h/)
    expect(r.stats.snapshotSpanMin).toBe(20)
  })

  it('handles empty input', () => {
    const r = radarReport([], [], { niche: 'x', seedTags: [], now: NOW, hours: 24 })
    expect(r.topVideos).toEqual([])
    expect(r.opportunities).toEqual([])
    expect(r.caveats.join('\n')).toMatch(/No video snapshots/)
  })

  it('lists fresh breakouts first and drops the one-snapshot caveat with real history', () => {
    const { videos, sounds } = hotNiche()
    const old = snap({ id: 'old', t: NOW, createTime: NOW - 5 * D, plays: 900_000 })
    const r = radarReport([...videos, old], sounds, { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 })
    expect(r.topVideos.length).toBeGreaterThanOrEqual(5)
    expect(r.topVideos.slice(0, 5).every((v) => v.id.startsWith('hot'))).toBe(true)
    expect(r.topVideos[0].breakout.flag).toBe('BREAKOUT')
    expect(r.topVideos.some((v) => v.id === 'old')).toBe(false)
    expect(r.topVideos[0].why.length).toBeGreaterThan(0)
    expect(r.caveats.join('\n')).not.toMatch(/Only one snapshot/)
    expect(r.stats.fresh).toBe(30)
    expect(r.stats.snapshotSpanMin).toBe(132)
    expect(r.sounds[0].id).toBe('hotSound')
    expect(r.tags.picked.length).toBeGreaterThanOrEqual(3)
  })
})

describe('nicheRelevance', () => {
  const seeds = ['cat', 'kitten']
  const all = series([
    snap({ id: 'tagged', t: NOW, tags: ['cat', 'kitten'], author: 'catacct', secUid: 'catacct' }),
    snap({ id: 'tagged2', t: NOW, tags: ['cat'], author: 'catacct', secUid: 'catacct' }),
    snap({ id: 'caption', t: NOW, desc: 'My Cats stole the pizza #fyp', tags: ['fyp'], author: 'catacct', secUid: 'catacct' }),
    snap({ id: 'bare', t: NOW, desc: 'part 3 #fyp', tags: ['fyp'], author: 'catacct', secUid: 'catacct' }),
    snap({ id: 'mixedcat', t: NOW, tags: ['cat'], author: 'mixed', secUid: 'mixed' }),
    snap({ id: 'goat', t: NOW, desc: 'Gadha school nahi aaya #animal', tags: ['animal', 'fyp'], author: 'mixed', secUid: 'mixed' }),
    snap({ id: 'stray', t: NOW, desc: 'please support #funnystatus #funnycatsoftiktok', tags: ['funnystatus', 'funnycatsoftiktok'], author: 'comedy', secUid: 'comedy' }),
    snap({ id: 'stray2', t: NOW, desc: 'status #funnycatsoftiktok', tags: ['funnycatsoftiktok'], author: 'comedy', secUid: 'comedy' }),
    snap({ id: 'compound', t: NOW, tags: ['persiancat', 'persiankitten'], author: 'shop', secUid: 'shop' }),
    snap({ id: 'name', t: NOW, desc: 'Catherine and the education system', author: 'teacher', secUid: 'teacher' }),
  ])
  const rel = nicheRelevanceMap(all, seeds, seeds)
  const relOf = (id: string): number => rel.get(id) ?? -1
  const min = RADAR_DEFAULTS.relevance.min

  it('keeps seed-tagged, captioned and compound-tagged cat videos', () => {
    expect(relOf('tagged')).toBeGreaterThan(0.6)
    expect(relOf('caption')).toBeGreaterThanOrEqual(min)
    expect(relOf('compound')).toBeGreaterThanOrEqual(min)
    expect(relOf('mixedcat')).toBeGreaterThanOrEqual(min)
  })

  it('keeps a caption-less video from a creator whose videos are mostly on-niche', () => {
    expect(relOf('bare')).toBeGreaterThanOrEqual(min)
    expect(relOf('bare')).toBeLessThan(relOf('caption'))
  })

  it('drops off-niche videos, including a stray keyword tag from an off-niche creator', () => {
    expect(relOf('goat')).toBeLessThan(min)
    expect(relOf('stray')).toBeLessThan(min)
    expect(relOf('stray2')).toBeLessThan(min)
    expect(relOf('name')).toBe(0)
  })

  it('matches the per-video function and stays within 0..1', () => {
    for (const v of all) {
      const creatorVideos = all.filter((o) => o.secUid === v.secUid)
      const r = nicheRelevance(v, seeds, seeds, { creatorVideos })
      expect(r).toBeCloseTo(relOf(v.id), 10)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })

  it('treats every video as relevant without seed tags or keywords', () => {
    expect(nicheRelevance(seriesById(all, 'goat'), [], [])).toBe(1)
  })

  it('uses caption keywords that are not seed tags', () => {
    const [v] = series([snap({ id: 'k', t: NOW, desc: 'Sleepy loaf compilation' })])
    expect(nicheRelevance(v, ['cat'], ['loaf'])).toBeGreaterThanOrEqual(min)
    expect(nicheRelevance(v, ['cat'], ['cat'])).toBe(0)
  })
})

describe('generic and creator-private tags', () => {
  it('recognises platform tags by list, prefix and niche share', () => {
    expect(isGenericTag('fyp', 0, false)).toBe(true)
    expect(isGenericTag('fypシ', 0, false)).toBe(true)
    expect(isGenericTag('xyzbca', 0, false)).toBe(true)
    expect(isGenericTag('creatorsearchinsights', 0, false)).toBe(true)
    expect(isGenericTag('trendingsoundsfor2026', 0, false)).toBe(true)
    expect(isGenericTag('catlover', 0.1, false)).toBe(false)
    expect(isGenericTag('catlover', 0.25, false)).toBe(true)
    expect(isGenericTag('cat', 0.4, true)).toBe(false)
  })

  it('never picks a tag used by a single creator, however strong', () => {
    const picked = pickTags([
      tagScore('mycatname', { pmi: 3, lift: 6, score: 0.99, creators: 1 }),
      tagScore('core1', { pmi: 1.2 }),
      tagScore('core2', { pmi: 1.0 }),
      tagScore('other', { pmi: 0.5, score: 0.7 }),
    ])
    expect(picked.map((p) => p.tag)).not.toContain('mycatname')
    expect(picked.length).toBeGreaterThanOrEqual(3)
  })

  it('lets generic tags take only the single broad slot', () => {
    const picked = pickTags([
      tagScore('fyp', { pmi: 2, lift: 5, score: 0.99, share: 0.6 }),
      tagScore('viral', { pmi: 2, lift: 5, score: 0.98, share: 0.5 }),
      tagScore('gym', { pmi: 2, lift: 5, score: 0.97, share: 0.3 }),
      tagScore('core1', { pmi: 1.2 }),
      tagScore('core2', { pmi: 1.0 }),
      tagScore('rising', { pmi: 0.3, lift: 3, score: 0.9 }),
    ])
    const generic = picked.filter((p) => ['fyp', 'viral', 'gym'].includes(p.tag))
    expect(generic).toHaveLength(1)
    expect(generic[0].role).toBe('broad')
    expect(picked.filter((p) => p.role === 'broad')).toHaveLength(1)
    expect(picked.filter((p) => p.role === 'core').map((p) => p.tag)).toEqual(['core1', 'core2'])
    expect(picked.find((p) => p.tag === 'rising')?.role).toBe('momentum')
  })

  it('ranks core by PMI weighted by creator adoption, not by rare-tag PMI', () => {
    const picked = pickTags([
      tagScore('rare', { pmi: 0.56, count: 2, creators: 2 }),
      tagScore('catlover', { pmi: 0.34, count: 120, creators: 20 }),
      tagScore('orangecat', { pmi: 0.31, count: 80, creators: 13 }),
    ])
    expect(picked.filter((p) => p.role === 'core').map((p) => p.tag)).toEqual(['catlover', 'orangecat'])
  })

  it('counts distinct creators and flags generic tags while scoring', () => {
    const vids: VideoSnapshot[] = []
    for (let i = 0; i < 4; i++) vids.push(snap({ id: `m${i}`, t: NOW, createTime: NOW - (2 + i) * H, tags: ['cat', 'mycatname'], author: 'solo', secUid: 'solo' }))
    for (let i = 0; i < 16; i++) vids.push(snap({ id: `o${i}`, t: NOW, createTime: NOW - (2 + i) * H, tags: ['cat', i % 2 ? 'fyp' : 'catlover', `t${i % 8}`] }))
    const scores = hashtagMomentum(series(vids), ['cat'], NOW)
    const byTag = (t: string): TagScore | undefined => scores.find((s) => s.tag === t)
    expect(byTag('mycatname')?.creators).toBe(1)
    expect(byTag('catlover')?.creators).toBe(8)
    expect(byTag('fyp')?.generic).toBe(true)
    expect(byTag('cat')?.generic).toBe(false)
    expect(pickTags(scores).map((p) => p.tag)).not.toContain('mycatname')
  })
})

describe('E. tag clusters', () => {
  function clusterNiche(): VideoSeries[] {
    const vids: VideoSnapshot[] = []
    const at = (i: number): number => NOW - (2 + (i % 20)) * H
    for (let i = 0; i < 10; i++) vids.push(snap({ id: `a${i}`, t: NOW, createTime: at(i), tags: ['cat', 'fyp', 'topica'] }))
    for (let i = 0; i < 10; i++) vids.push(snap({ id: `b${i}`, t: NOW, createTime: at(i), tags: ['cat', 'fyp', 'topicb'] }))
    for (let i = 0; i < 5; i++) vids.push(snap({ id: `l${i}`, t: NOW, createTime: at(i), tags: ['cat', 'catloaf', 'sleepycat'] }))
    for (let i = 0; i < 3; i++) vids.push(snap({ id: `p${i}`, t: NOW, createTime: at(i), tags: ['cat', 'mycatname'], author: 'solo', secUid: 'solo' }))
    for (let i = 0; i < 3; i++) vids.push(snap({ id: `w${i}`, t: NOW, createTime: at(i), tags: ['cat', 'w1', 'w2', 'w3', 'w4', 'w5'] }))
    for (let i = 0; i < 19; i++) vids.push(snap({ id: `f${i}`, t: NOW, createTime: at(i), tags: ['cat', `misc${i}`] }))
    return series(vids)
  }
  const clusters = nicheOpportunity(clusterNiche(), { now: NOW, seedTags: ['cat'], breakouts: new Map(), outliers: new Map(), sounds: [], tags: [] })
  const ids = clusters.map((c) => c.id)

  it('does not let a generic tag chain topics into one giant cluster', () => {
    expect(ids.some((id) => id.includes('fyp'))).toBe(false)
    expect(ids).toContain('tags:topica')
    expect(ids).toContain('tags:topicb')
    expect(ids).toContain('tags:catloaf+sleepycat')
    expect(Math.max(...clusters.map((c) => c.videos))).toBeLessThanOrEqual(10)
  })

  it('ignores creator-private tags', () => {
    expect(ids.some((id) => id.includes('mycatname'))).toBe(false)
  })

  it('labels a cluster with at most 3 tags', () => {
    const wide = clusters.find((c) => c.id.startsWith('tags:w'))
    expect(wide?.label).toBe('#w1 #w2 #w3')
    for (const c of clusters) expect(c.label.split('#').length - 1).toBeLessThanOrEqual(3)
  })

  it('spells out why a cluster is recommended', () => {
    const { videos, sounds } = hotNiche()
    const top = radarReport(videos, sounds, { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 }).opportunities[0]
    expect(top.recommend).toBe(true)
    expect(top.why.join('\n')).toMatch(/recommended: score \d\.\d\d >= 0\.6, hot 100% >= 10%, 5 independent outlier creators >= 3, sound EARLY/)
  })
})

describe('radarReport relevance, evidence and sound ordering', () => {
  /** hotNiche plus off-niche fresh breakouts and an off-niche back catalogue for hotAuthor0. */
  function mixedNiche(): { videos: VideoSnapshot[]; sounds: SoundSnapshot[] } {
    const { videos, sounds } = hotNiche()
    const created = NOW - 5 * H
    for (let i = 0; i < 5; i++) {
      videos.push(
        ...videoSnaps(`off${i}`, created + i * 60, [3, 4, 5], [5000, 20_000, 80_000], {
          music: { id: 'offSound', title: 'Off Sound', original: false },
          tags: ['comedy', 'prank'],
          desc: `Gadha school nahi aaya ${i}`,
          author: `offAuthor${i}`,
          secUid: `offSec${i}`,
        }),
      )
    }
    for (let i = 0; i < 5; i++) {
      videos.push(snap({ id: `back${i}`, t: NOW, createTime: NOW - (10 + i) * D, plays: 100_000, tags: ['vlog'], author: 'hotAuthor0', secUid: 'hotSec0' }))
    }
    return { videos, sounds }
  }
  const { videos, sounds } = mixedNiche()
  const r = radarReport(videos, sounds, { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 })

  it('excludes off-niche videos from top videos, tags, sounds and opportunities', () => {
    expect(r.topVideos.some((v) => v.id.startsWith('off') || v.id.startsWith('back'))).toBe(false)
    expect(r.tags.scores.some((t) => ['comedy', 'prank', 'vlog'].includes(t.tag))).toBe(false)
    expect(r.sounds.some((s) => s.id === 'offSound')).toBe(false)
    expect(r.opportunities.some((o) => o.id.includes('offSound') || o.id.includes('comedy'))).toBe(false)
  })

  it('reports how many were dropped, with a caveat', () => {
    expect(r.stats).toMatchObject({ videos: 40, relevant: 30, offNiche: 10, fresh: 35, relevantFresh: 30 })
    expect(r.caveats.join('\n')).toMatch(/10 of 40 videos \(25%\) scored below niche relevance 0\.3/)
  })

  it('still uses off-niche videos as creator baselines', () => {
    const hot0 = r.topVideos.find((v) => v.id === 'hot0')
    expect(hot0?.outlier.method).toBe('creator')
    expect(hot0?.outlier.historySize).toBe(5)
  })

  it('gives every top video a relevance, a combined rank and a compact evidence line', () => {
    const rc = RADAR_DEFAULTS.report.rankClip
    expect(r.topVideos.length).toBeGreaterThan(0)
    for (const v of r.topVideos) {
      expect(v.relevance).toBeGreaterThanOrEqual(RADAR_DEFAULTS.relevance.min)
      const clipRc = (x: number): number => Math.min(rc, Math.max(-rc, x))
      expect(v.rank).toBeCloseTo(clipRc(v.breakout.score) + clipRc(v.outlier.robustZ), 10)
      expect(v.evidence).toMatch(/^[\d.]+k? views in [\d.]+(h|min) · [\d.]+k? views\/h · [\d.]+x (creator|niche) median.* · share [\d.]+% \([\d.]+x cohort\) · save [\d.]+% \([\d.]+x cohort\) · relevance [01]\.\d\d$/)
    }
    const ranks = r.topVideos.map((v) => v.rank)
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
  })

  it('never ranks a usage-only sound above one with real snapshots', () => {
    const vids = series(
      Array.from({ length: 6 }, (_, i) => snap({ id: `u${i}`, t: NOW, createTime: NOW - (2 + i) * H, music: { id: 'usageOnly', title: 'u', original: false } })),
    )
    const ratios = new Map(vids.map((v) => [v.id, 8]))
    const list = soundMomentum(soundSnaps('slow', [[NOW - 4 * H, 900_000], [NOW - 2 * H, 900_001], [NOW, 900_001]]), vids, NOW, { outlierRatios: ratios })
    expect(list.map((s) => [s.id, s.evidence])).toEqual([['slow', 'snapshots'], ['usageOnly', 'usage-only']])
  })
})

describe('A. velocity on short snapshot spans', () => {
  const M = 60
  /** 20 cohort videos 3h old, last two snapshots 14 min apart with no view change (TikTok count lag). */
  function staleCohort(): VideoSnapshot[] {
    const out: VideoSnapshot[] = []
    for (let i = 0; i < 20; i++) {
      const created = NOW - 3 * H
      const views = 2000 + (i % 5) * 200
      const counts = { plays: views, likes: views * 0.05, shares: views * 0.005, saves: views * 0.003 }
      out.push(snap({ id: `z${i}`, t: NOW - 14 * M, createTime: created, ...counts }), snap({ id: `z${i}`, t: NOW, createTime: created, ...counts }))
    }
    return out
  }

  it('does not flag a below-median video just because the cohort shows ~0 views/h over 14 min', () => {
    const created = NOW - 3 * H
    // 0.5x the niche median, with a small gain in the last 14 minutes.
    const cand = [
      snap({ id: 'low', t: NOW - 14 * M, createTime: created, plays: 1000, likes: 50, shares: 5, saves: 3 }),
      snap({ id: 'low', t: NOW, createTime: created, plays: 1100, likes: 55, shares: 6, saves: 3 }),
    ]
    const all = series([...staleCohort(), ...cand])
    const b = videoBreakout(seriesById(all, 'low'), all, NOW)
    expect(b.cohortMultiple).toBeLessThan(1)
    expect(b.flag).toBe('NONE')
    expect(b.score).toBeLessThan(RADAR_DEFAULTS.breakout.watchScore)
    expect(b.velocityBasis).toBe('lifetime')
    expect(b.velocityCohortSize).toBe(20)
    expect(b.components.velZ).toBeLessThan(0)
    expect(b.vphNow).toBeCloseTo(1100 / 3)
    expect(b.why.join('\n')).toMatch(/lifetime average \(last interval 14min < 15min\)/)
    expect(b.why.join('\n')).toMatch(/velocity z on lifetime views\/h/)
  })

  it('uses lifetime velocity for a single-snapshot video and its cohort', () => {
    const all = series([...staleCohort(), snap({ id: 'solo', t: NOW, createTime: NOW - 3 * H, plays: 2400 })])
    const b = videoBreakout(seriesById(all, 'solo'), all, NOW)
    expect(b.velocityBasis).toBe('lifetime')
    expect(Math.abs(b.components.velZ)).toBeLessThan(2)
    expect(b.why.join('\n')).toMatch(/single snapshot/)
  })

  it('builds the velocity sample only from cohort videos measured over long enough intervals', () => {
    const created = NOW - 3 * H
    const measured: VideoSnapshot[] = []
    for (let i = 0; i < 6; i++) measured.push(...videoSnaps(`m${i}`, created, [2, 3], [1500 + i * 50, 2000 + i * 60]))
    const all = series([...staleCohort(), ...measured, ...videoSnaps('cand', created, [2, 3], [1600, 2200])])
    const b = videoBreakout(seriesById(all, 'cand'), all, NOW)
    expect(b.velocityBasis).toBe('interval')
    expect(b.velocityCohortSize).toBe(6)
    expect(b.cohortSize).toBe(26)
    // Against the 6 interval-measured videos (~500 views/h) it is ordinary, not a 0-views/h outlier.
    expect(Math.abs(b.components.velZ)).toBeLessThan(2)
    expect(b.flag).toBe('NONE')
  })

  it('falls back to lifetime velocity when too few cohort videos were measured over long intervals', () => {
    const created = NOW - 3 * H
    const all = series([...staleCohort(), ...videoSnaps('few', created, [2, 3], [1000, 1100]), ...videoSnaps('cand', created, [2, 3], [1600, 2200])])
    const b = videoBreakout(seriesById(all, 'cand'), all, NOW)
    expect(b.velocityBasis).toBe('lifetime')
    expect(b.velocityCohortSize).toBe(21)
    expect(b.why.join('\n')).toMatch(/only 1 cohort videos have a >= 15min last interval/)
  })

  it('caps velocity z against a near-constant cohort', () => {
    const created = NOW - 3 * H
    const flatCohort: VideoSnapshot[] = []
    for (let i = 0; i < 12; i++) flatCohort.push(...videoSnaps(`f${i}`, created, [1, 2, 3], [100, 200, 300]))
    const all = series([...flatCohort, ...videoSnaps('rocket', created, [1, 2, 3], [100, 1000, 100_000])])
    const b = videoBreakout(seriesById(all, 'rocket'), all, NOW)
    const cap = RADAR_DEFAULTS.breakout.zCap
    expect(b.components.velZ).toBe(cap)
    for (const z of Object.values(b.components)) expect(Math.abs(z)).toBeLessThanOrEqual(cap)
    expect(b.flag).toBe('BREAKOUT')
  })

  it('checks the 3x views rule against the same cohort used for scoring', () => {
    const all = series([...staleCohort(), ...videoSnaps('mid', NOW - 3 * H, [2, 3], [2500, 4000])])
    const b = videoBreakout(seriesById(all, 'mid'), all, NOW)
    expect(b.cohortMedianViews).toBe(2400)
    expect(b.cohortMultiple).toBeLessThan(RADAR_DEFAULTS.breakout.cohortMultiple)
    expect(b.flag).not.toBe('BREAKOUT')
  })
})

describe('radarReport per-creator cap and diversity', () => {
  const maxPer = RADAR_DEFAULTS.report.maxPerCreator

  /** One prolific creator with 6 breakouts, `extraCreators` others with one each, plus ordinary videos. */
  function prolificNiche(extraCreators: number): VideoSnapshot[] {
    const videos: VideoSnapshot[] = []
    const created = NOW - 5 * H
    const hot = (id: string, author: string, scale: number): VideoSnapshot[] =>
      videoSnaps(id, created, [3, 4, 5], [2000, 8000, 30_000].map((v) => Math.round(v * scale)), {
        tags: ['fitness', 'legday'],
        music: { id: 'hotSound', title: 'Hot', original: false },
        author,
        secUid: author,
        desc: `leg day ${id}`,
      })
    for (let i = 0; i < 6; i++) videos.push(...hot(`big${i}`, 'bigCreator', 1.5 - i * 0.05))
    for (let i = 0; i < extraCreators; i++) videos.push(...hot(`solo${i}`, `soloCreator${i}`, 0.9 - i * 0.05))
    for (let i = 0; i < 25; i++) {
      const k = 0.8 + (i % 5) * 0.1
      videos.push(
        ...videoSnaps(`n${i}`, created + i * 30, [3, 4, 5], [300, 400, 500].map((v) => Math.round(v * k)), {
          tags: ['fitness', 'legday'],
          music: { id: 'hotSound', title: 'Hot', original: false },
          desc: `normal ${i}`,
        }),
      )
    }
    return videos
  }

  it('lists at most maxPerCreator videos per creator in topVideos, keeping the best', () => {
    const r = radarReport(prolificNiche(2), [], { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 })
    const counts = new Map<string, number>()
    for (const v of r.topVideos) counts.set(v.author, (counts.get(v.author) ?? 0) + 1)
    expect(counts.get('bigCreator')).toBe(maxPer)
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(maxPer)
    expect(r.topVideos.filter((v) => v.author === 'bigCreator').map((v) => v.id).sort()).toEqual(['big0', 'big1'])
    expect(r.topVideos.some((v) => v.diversityFill)).toBe(false)
  })

  it('fills the top 10 by rank up to 3 distinct creators when only 1 creator is flagged', () => {
    const r = radarReport(prolificNiche(0), [], { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 })
    const head = r.topVideos.slice(0, RADAR_DEFAULTS.report.diversityWindow)
    expect(new Set(head.map((v) => v.author)).size).toBe(RADAR_DEFAULTS.report.minCreatorsTop)
    const fills = r.topVideos.filter((v) => v.diversityFill)
    expect(fills).toHaveLength(2)
    for (const f of fills) expect(f.why[0]).toMatch(/not flagged: listed to show at least 3 creators/)
    const ranks = r.topVideos.map((v) => v.rank)
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
    expect(fills.every((f) => f.author !== 'bigCreator')).toBe(true)
    expect(new Set(fills.map((f) => f.author)).size).toBe(2)
  })

  it('does not fill when fewer relevant creators exist than the minimum', () => {
    const r = radarReport(prolificNiche(0).filter((s) => s.author === 'bigCreator'), [], { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 })
    expect(r.topVideos.every((v) => v.author === 'bigCreator' && !v.diversityFill)).toBe(true)
    expect(r.topVideos.length).toBeLessThanOrEqual(maxPer)
  })

  it('caps each opportunity example list per creator, idea first', () => {
    const r = radarReport(prolificNiche(2), [], { niche: 'fitness', seedTags: ['fitness'], now: NOW, hours: 24 })
    const cluster = r.opportunities.find((o) => o.id === 'sound:hotSound')
    const examples = cluster?.examples ?? []
    expect(examples.length).toBeGreaterThan(0)
    expect(examples.length).toBeLessThanOrEqual(RADAR_DEFAULTS.opportunity.maxExamples)
    const counts = new Map<string, number>()
    for (const e of examples) counts.set(e.author, (counts.get(e.author) ?? 0) + 1)
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(maxPer)
    expect(counts.get('bigCreator')).toBe(maxPer)
    expect(examples[0].videoId).toBe(cluster?.idea?.videoId)
  })
})
