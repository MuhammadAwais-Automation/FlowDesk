/**
 * TikTok niche radar: the pure scoring core.
 *
 * Implements the "Algorithms to implement" section of
 * `.conductor/research/radar-virality-signals.md`:
 *   A. videoBreakout     video breakout vs its age/duration cohort
 *   B. creatorOutlier    views vs the creator's own baseline (cohort fallback)
 *   C. soundMomentum     sound lifecycle phase + momentum score
 *   D. hashtagMomentum   tag momentum + pickTags (3-5 coherent tags)
 *   E. nicheOpportunity  topic clusters ranked by what to make now
 * plus nicheRelevance (drops off-niche search/creator results), and radarReport, which runs all of them over raw snapshots.
 *
 * No Electron, no fs, no clock: `now` is always passed in (unix seconds).
 * Every weight and threshold lives in RADAR_DEFAULTS. They are research priors
 * marked UNVERIFIED in the spec and must be recalibrated from our own labels.
 */

import type {
  AgeBucket,
  BreakoutProjection,
  CreatorOutlier,
  DurationBucket,
  OpportunityCluster,
  OpportunityIdea,
  OutlierBand,
  PickedTag,
  RadarReport,
  RadarReportOptions,
  RadarTopVideo,
  SnapshotMusic,
  SoundMomentum,
  SoundPhase,
  SoundSnapshot,
  TagScore,
  VelocityBasis,
  VideoBreakout,
  VideoPoint,
  VideoSeries,
  VideoSnapshot,
} from './types'

export const RADAR_DEFAULTS = {
  stats: {
    /** MAD -> sigma for normal data. */
    madScale: 1.4826,
    /** Floor for the robust-z scale on log values, so zero MAD never divides by zero. */
    minLogScale: 0.1,
  },
  cohort: {
    /** Below this an age cohort is widened to the whole niche. */
    minSize: 5,
    /** Below this percentiles/z-scores are reported as unreliable. */
    reliableSize: 10,
  },
  /** Upper edges (hours) of 0-1, 1-2, 2-4, 4-8, 8-24, 24-48; above is 48+. */
  ageBucketEdgesH: [1, 2, 4, 8, 24, 48],
  /** Upper edges (seconds) of <15, 15-30, 30-60, 60-180; above is 180+. */
  durationBucketEdgesS: [15, 30, 60, 180],
  breakout: {
    weights: { level: 0.3, velocity: 0.3, accel: 0.15, share: 0.1, save: 0.1, like: 0.05 },
    /** +10 in ln((vph_now + 10) / (vph_prev + 10)). */
    accelSmoothing: 10,
    accelClipLow: -1,
    accelClipHigh: 2,
    /** Bayesian-smoothed rates: (x + 1) / (views + 100). */
    rateNumPrior: 1,
    rateDenPrior: 100,
    flagScore: 2,
    watchScore: 1.25,
    /** v_t >= 3 x cohort median views. */
    cohortMultiple: 3,
    minSnapshots: 2,
    /**
     * A last snapshot interval shorter than this (hours) is too short to measure
     * views/hour: the video and its cohort sample fall back to lifetime velocity
     * (views / age hours).
     */
    minIntervalH: 0.25, // collector runs every 20 min; shorter intervals are too noisy
    /** Division floor (hours) for any views/hour rate, so a zero interval never divides by zero. */
    rateFloorH: 1 / 60,
    /**
     * Robust-scale floor for the velocity z (ln views/h). Higher than
     * stats.minLogScale so a near-constant cohort cannot inflate the z.
     */
    velMinLogScale: 0.5,
    /** Every breakout z component is clipped to +/- this. */
    zCap: 6,
    /** S-H projection: fit ln(v24 / v_t) per age bucket from past niche videos. */
    projectionMinSamples: 5,
    projectionTargetH: 24,
    projectionMaxTargetH: 36,
    projectionBandLow: 0.1,
    projectionBandHigh: 0.9,
  },
  outlier: {
    historyMinAgeH: 7 * 24,
    historySize: 15,
    historyMin: 5,
    baselineFloor: 500,
    minLogScale: 0.25,
    flagRatio: 3,
    flagZ: 2,
    bandWatch: 2,
    bandOutlier: 3,
    bandStrong: 5,
    bandMajor: 10,
    bandAnomalous: 20,
    /** Cohort fallback flags when ratio >= flagRatio and views pct >= this. */
    fallbackFlagPct: 0.9,
  },
  sound: {
    weights: { growth: 0.25, burst: 0.2, accel: 0.15, nicheLift: 0.2, perfLift: 0.2, saturation: 0.3 },
    /** N_sat, UNVERIFIED: calibrate by checking where perf_lift decays. */
    saturationCount: 100_000,
    saturationWidthLog10: 1,
    earlyGrowth: 0.25,
    saturatedGrowth: 0.05,
    growthFloor: 50,
    accelSmoothing: 5,
    burstWindowH: 6,
    burstPriorH: 72,
    burstPriorFloorPerH: 1,
    /** Below this span (or < 2 snapshots) the phase is UNKNOWN. */
    minSpanH: 1,
    /** Acceleration from a short span needs a midpoint, so >= 3 snapshots. */
    minSnapshotsForAccel: 3,
    nicheRecentH: 48,
    nichePriorH: 7 * 24,
    perfWindowH: 7 * 24,
    perfMinVideos: 3,
    recommendPerfLift: 1.2,
  },
  relevance: {
    /** Videos below this are off-niche: kept only as creator baselines. */
    min: 0.3,
    /** own = ownTag * tagPart + ownDesc * descPart, clipped to 1. */
    ownTag: 0.7,
    ownDesc: 0.5,
    /**
     * tagHits = exact seed tags + keywordTagWeight x tags that merely contain a
     * keyword (#persiankitten, #funnycatsoftiktok). tagPart is 1 at >= 2 hits,
     * oneSeedTag at >= 1, keywordInTag below that.
     */
    keywordTagWeight: 0.5,
    oneSeedTag: 0.7,
    keywordInTag: 0.4,
    /** Keywords shorter than this are not matched inside tags. */
    minKeywordInTagLength: 3,
    /** relevance = own * ownWeight + creatorShare * creatorWeight. */
    ownWeight: 0.55,
    creatorWeight: 0.45,
  },
  tags: {
    weights: { lift: 0.35, perf: 0.3, pmi: 0.2, burst: 0.15 },
    recentH: 24,
    priorDays: 7,
    perfWindowH: 7 * 24,
    perfMinVideos: 5,
    /** Additive smoothing on the joint count in PMI. */
    pmiSmoothing: 0.5,
    /** Non-seed tags seen on fewer niche videos are ignored as noise. */
    minCount: 2,
    momentumLift: 2,
    broadMinShare: 0.25,
    coreCount: 2,
    maxMomentum: 2,
    maxBroad: 1,
    minPick: 3,
    maxPick: 5,
    /** Kleinberg 2-state: high-state rate = s x base rate, transition cost gamma ln n. */
    burstRatio: 2,
    burstGamma: 1,
    /** When seed tags cover this share of the sample, PMI vs seed carries little signal. */
    pmiDegenerateCoverage: 0.95,
    /** A tag must appear on videos from this many distinct creators to be picked or clustered. */
    minCreators: 2,
    /** Platform-wide tags: broad role only, never core/momentum/fill, never clustered. */
    genericTags: [
      'fyp', 'foryou', 'foryoupage', 'foryourpage', 'fy', 'fypage', 'fypp', 'fyppp', 'fyppage', 'fypviral',
      'fypシ', 'fypシ゚viral', 'fypシ゚', 'foru', '4u', '4you', 'parati', 'pourtoi',
      'viral', 'viralvideo', 'viralvideos', 'viraltiktok', 'tiktokviral', 'goviral', 'blowthisup',
      'trending', 'trend', 'trends', 'trendingvideo', 'trendingsound', 'trendingsounds',
      'xyzbca', 'xyzabc', 'xybca', 'capcut', 'tiktok', 'tiktokfamous', 'explore', 'explorepage',
      'creatorsearchinsights', 'creatorsearchinsight', 'duet', 'stitch', 'greenscreen', 'video', 'videos',
      'unitedstates', 'usa',
    ],
    /** Tags starting with one of these are treated as generic too (fyp..., viral..., trending...). */
    genericTagPrefixes: ['fyp', 'foryou', 'viral', 'trending', 'xyz'],
    /** Non-seed tags on more than this share of niche videos are generic. */
    genericMaxShare: 0.2,
  },
  opportunity: {
    weights: { demand: 0.3, hot: 0.25, momentum: 0.2, freshness: 0.1, smallOk: 0.1, supply: 0.15 },
    windowH: 48,
    supplyRecentH: 24,
    supplyPriorDays: 7,
    freshnessTauH: 24,
    smallCreatorFollowers: 10_000,
    hotScore: 2,
    minScore: 0.6,
    minHot: 0.1,
    minOutlierCreators: 3,
    minClusterVideos: 2,
    minEdgeWeight: 2,
    /** Tags on more than this share of window videos are too broad to cluster on. */
    maxTagShare: 0.5,
    /** Smoothing weight (pseudo-videos) for best hour / length outlier rates. */
    rateSmoothing: 2,
    /** Example videos listed per opportunity (idea first). */
    maxExamples: 5,
  },
  report: {
    topVideosLimit: 20,
    /** At most this many videos per creator in topVideos and in each opportunity's examples. */
    maxPerCreator: 2,
    /** Distinct creators required among the first `diversityWindow` topVideos, when that many relevant creators exist. */
    minCreatorsTop: 3,
    diversityWindow: 10,
    soundsLimit: 20,
    opportunitiesLimit: 10,
    minSnapshotSpanMin: 60,
    /** Each rank component (breakout score, creator robust z) is clipped to +/- this. */
    rankClip: 3,
    minCohort: 10,
    minFresh: 10,
    staleSnapshotH: 6,
  },
}

export type RadarConfig = typeof RADAR_DEFAULTS

const HOUR = 3600

// ─── Parsing helpers ────────────────────────────────────────────────────────

/** Parses a non-negative count that may arrive as a string ("12,345", "1.2K"). Bad input is 0. */
export function toCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0
  if (typeof value !== 'string') return 0
  const match = value.trim().replace(/[,_\s]/g, '').match(/^(\d+(?:\.\d+)?)([kmb])?$/i)
  if (!match) return 0
  const suffix = (match[2] ?? '').toLowerCase()
  const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1
  const n = Number(match[1]) * mult
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Unix seconds; millisecond inputs (> 1e12) are converted. Bad input is 0. */
export function toSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e12 ? n / 1000 : n
}

export function normalizeTag(tag: unknown): string {
  if (typeof tag !== 'string') return ''
  return tag.trim().replace(/^#+/, '').trim().toLowerCase()
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

// ─── Niche relevance ────────────────────────────────────────────────────────

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return []
  const out: string[] = []
  for (const raw of keywords) {
    const kw = normalizeTag(raw)
    if (kw && !out.includes(kw)) out.push(kw)
  }
  return out
}

/** Caption words only: hashtags and mentions are matched through `tags`, not here. */
function captionText(desc: string): string {
  return desc.replace(/[#@]\S+/g, ' ').toLowerCase()
}

/**
 * The video's own niche signal, 0..1, from exact seed tags, tags containing a
 * keyword, and keywords in the caption text.
 */
function ownRelevance(video: VideoSeries, seeds: ReadonlySet<string>, keywords: readonly string[], cfg: RadarConfig): number {
  const r = cfg.relevance
  const seedHits = video.tags.filter((t) => seeds.has(t)).length
  const compact = keywords.filter((kw) => kw.length >= r.minKeywordInTagLength).map((kw) => kw.replace(/\s+/g, ''))
  const keywordTags = video.tags.filter((t) => !seeds.has(t) && compact.some((kw) => t.includes(kw))).length
  const tagHits = seedHits + r.keywordTagWeight * keywordTags
  const tagPart = tagHits >= 2 ? 1 : tagHits >= 1 ? r.oneSeedTag : tagHits > 0 ? r.keywordInTag : 0
  const text = captionText(video.desc)
  const descHit = keywords.some((kw) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(kw)}(s|es)?($|[^\\p{L}\\p{N}])`, 'u').test(text))
  return clip(r.ownTag * tagPart + r.ownDesc * (descHit ? 1 : 0), 0, 1)
}

export interface NicheRelevanceOptions {
  /** All of this creator's videos in the sample (the video itself may be included). */
  creatorVideos?: readonly VideoSeries[]
  cfg?: RadarConfig
}

/**
 * How on-niche a video is, 0..1: its own signal (seed tags, keyword tags,
 * caption keywords) blended with creator-level relevance, the share of that
 * creator's videos whose own signal clears `relevance.min`. A caption-less
 * video from a dedicated niche creator stays in; a stray #funnycatsoftiktok on
 * an off-niche creator's comedy clip does not. Without any seed tags or
 * keywords every video is relevant (1).
 */
export function nicheRelevance(video: VideoSeries, seedTags: readonly string[], seedKeywords: readonly string[] = [], options: NicheRelevanceOptions = {}): number {
  const cfg = options.cfg ?? RADAR_DEFAULTS
  const r = cfg.relevance
  const seeds = new Set(normalizeTags([...seedTags]))
  const keywords = normalizeKeywords([...seedKeywords])
  if (!seeds.size && !keywords.length) return 1
  const own = ownRelevance(video, seeds, keywords, cfg)
  const pool = [...(options.creatorVideos ?? []).filter((v) => v.id !== video.id), video]
  const creatorShare = pool.filter((v) => (v === video ? own : ownRelevance(v, seeds, keywords, cfg)) >= r.min).length / pool.length
  return clip(r.ownWeight * own + r.creatorWeight * creatorShare, 0, 1)
}

/** Platform-wide tag (list or prefix), or a non-seed tag on more than `genericMaxShare` of the niche. */
export function isGenericTag(tag: string, share: number | null, isSeed: boolean, cfg: RadarConfig = RADAR_DEFAULTS): boolean {
  const c = cfg.tags
  if (c.genericTags.includes(tag) || c.genericTagPrefixes.some((p) => tag.startsWith(p))) return true
  return !isSeed && share !== null && share > c.genericMaxShare
}

// ─── Robust statistics ──────────────────────────────────────────────────────

function finite(values: readonly number[]): number[] {
  return values.filter((v) => Number.isFinite(v))
}

/** Median of the finite values; 0 for an empty sample. */
export function median(values: readonly number[]): number {
  const xs = finite(values).sort((a, b) => a - b)
  if (!xs.length) return 0
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/** Median absolute deviation (unscaled); 0 for an empty sample. */
export function mad(values: readonly number[]): number {
  const xs = finite(values)
  if (!xs.length) return 0
  const m = median(xs)
  return median(xs.map((v) => Math.abs(v - m)))
}

/** Linear-interpolated quantile, q in [0, 1]; 0 for an empty sample. */
export function quantile(values: readonly number[], q: number): number {
  const xs = finite(values).sort((a, b) => a - b)
  if (!xs.length) return 0
  const pos = clip(q, 0, 1) * (xs.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)
}

/**
 * (x - median) / max(minScale, 1.4826 * MAD). With a zero floor and zero MAD it
 * falls back to the mean absolute deviation (x 1.2533); if that is also zero
 * the sample carries no spread and the result is 0. Never divides by zero.
 */
export function robustZ(x: number, sample: readonly number[], minScale: number = RADAR_DEFAULTS.stats.minLogScale): number {
  const xs = finite(sample)
  if (!xs.length || !Number.isFinite(x)) return 0
  const m = median(xs)
  let scale = Math.max(minScale, RADAR_DEFAULTS.stats.madScale * mad(xs))
  if (!(scale > 0)) {
    const meanAbs = xs.reduce((acc, v) => acc + Math.abs(v - m), 0) / xs.length
    scale = 1.2533 * meanAbs
  }
  if (!(scale > 0)) return 0
  return (x - m) / scale
}

/** Robust z of ln(1 + value) against ln(1 + sample): the heavy-tail-safe version. */
export function logRobustZ(value: number, sample: readonly number[], minScale: number = RADAR_DEFAULTS.stats.minLogScale): number {
  return robustZ(Math.log1p(Math.max(0, value)), sample.map((v) => Math.log1p(Math.max(0, v))), minScale)
}

/** Mid-rank percentile of x in the sample, in [0, 1]. 0.5 for an empty sample. */
export function percentileInCohort(x: number, sample: readonly number[]): number {
  const xs = finite(sample)
  if (!xs.length || !Number.isFinite(x)) return 0.5
  let below = 0
  let equal = 0
  for (const v of xs) {
    if (v < x) below++
    else if (v === x) equal++
  }
  return (below + 0.5 * equal) / xs.length
}

export function clip(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo
  return Math.min(hi, Math.max(lo, x))
}

const AGE_BUCKETS: AgeBucket[] = ['0-1', '1-2', '2-4', '4-8', '8-24', '24-48', '48+']
const DURATION_BUCKETS: DurationBucket[] = ['<15', '15-30', '30-60', '60-180', '180+']

export function ageBucket(ageH: number, cfg: RadarConfig = RADAR_DEFAULTS): AgeBucket {
  const a = Number.isFinite(ageH) ? Math.max(0, ageH) : Infinity
  const i = cfg.ageBucketEdgesH.findIndex((edge) => a < edge)
  return AGE_BUCKETS[i === -1 ? AGE_BUCKETS.length - 1 : i]
}

export function durationBucket(seconds: number, cfg: RadarConfig = RADAR_DEFAULTS): DurationBucket {
  const d = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const i = cfg.durationBucketEdgesS.findIndex((edge) => d < edge)
  return DURATION_BUCKETS[i === -1 ? DURATION_BUCKETS.length - 1 : i]
}

/**
 * Kleinberg 2-state burst detection (batched/binomial form). r[i] = items with
 * the term in bin i, d[i] = all items in bin i. Returns the Viterbi state per
 * bin: 1 = high-rate (bursting), 0 = base rate.
 */
export function burstStates(r: readonly number[], d: readonly number[], s: number, gamma: number): number[] {
  const n = Math.min(r.length, d.length)
  const zeros = new Array<number>(n).fill(0)
  const R = r.slice(0, n).reduce((a, b) => a + b, 0)
  const D = d.slice(0, n).reduce((a, b) => a + b, 0)
  if (n === 0 || D <= 0 || R <= 0) return zeros
  const p0 = R / D
  const p1 = Math.min(0.9999, p0 * s)
  if (p0 >= 0.9999 || p1 <= p0) return zeros
  const probs = [p0, p1]
  const cost = (state: number, ri: number, di: number): number => {
    if (di <= 0) return 0
    const p = probs[state]
    const hit = Math.min(ri, di)
    return -(hit * Math.log(p) + (di - hit > 0 ? (di - hit) * Math.log(1 - p) : 0))
  }
  const up = gamma * Math.log(Math.max(2, n))
  let c0 = cost(0, r[0], d[0])
  let c1 = up + cost(1, r[0], d[0])
  const back: Array<[number, number]> = [[0, 1]]
  for (let i = 1; i < n; i++) {
    const from0to0 = c0
    const from1to0 = c1
    const from0to1 = c0 + up
    const from1to1 = c1
    const prev0 = from0to0 <= from1to0 ? 0 : 1
    const prev1 = from0to1 < from1to1 ? 0 : 1
    const n0 = Math.min(from0to0, from1to0) + cost(0, r[i], d[i])
    const n1 = Math.min(from0to1, from1to1) + cost(1, r[i], d[i])
    back.push([prev0, prev1])
    c0 = n0
    c1 = n1
  }
  const states = zeros.slice()
  let state = c0 <= c1 ? 0 : 1
  for (let i = n - 1; i >= 0; i--) {
    states[i] = state
    if (i > 0) state = back[i][state]
  }
  return states
}

// ─── Formatting for `why` evidence ──────────────────────────────────────────

function fmtNum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a'
  const abs = Math.abs(n)
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  if (abs >= 10) return `${Math.round(n)}`
  return `${Math.round(n * 10) / 10}`
}

function fmtX(n: number): string {
  return `${Number.isFinite(n) ? n.toFixed(1) : 'n/a'}x`
}

function fmtPct(p: number | null): string {
  return p === null || !Number.isFinite(p) ? 'n/a' : `${Math.round(p * 100)}%`
}

function fmtZ(z: number): string {
  return `${z >= 0 ? '+' : ''}${z.toFixed(1)}`
}

// ─── Series ─────────────────────────────────────────────────────────────────

function normalizeMusic(music: unknown): SnapshotMusic | null {
  if (!music || typeof music !== 'object') return null
  const m = music as Record<string, unknown>
  const id = m.id === undefined || m.id === null ? '' : String(m.id).trim()
  if (!id) return null
  return { id, title: typeof m.title === 'string' ? m.title : '', original: m.original === true }
}

/**
 * Groups raw snapshots into one series per video: points sorted by `t`, one
 * point per `t` (the later record wins), counts parsed, metadata taken from the
 * latest snapshot. Snapshots without an id or a valid `t` are dropped.
 */
export function buildVideoSeries(snapshots: readonly VideoSnapshot[]): VideoSeries[] {
  const byId = new Map<string, Map<number, VideoSnapshot>>()
  for (const snap of snapshots ?? []) {
    if (!snap) continue
    const id = String(snap.id ?? '').trim()
    const t = toSeconds(snap.t)
    if (!id || !t) continue
    let points = byId.get(id)
    if (!points) byId.set(id, (points = new Map()))
    points.set(t, snap)
  }
  const out: VideoSeries[] = []
  for (const [id, byT] of byId) {
    const ordered = [...byT.entries()].sort((a, b) => a[0] - b[0])
    const latest = ordered[ordered.length - 1][1]
    let createTime = 0
    for (let i = ordered.length - 1; i >= 0 && !createTime; i--) createTime = toSeconds(ordered[i][1].createTime)
    let tags: string[] = []
    for (let i = ordered.length - 1; i >= 0 && !tags.length; i--) tags = normalizeTags(ordered[i][1].tags)
    const points: VideoPoint[] = ordered.map(([t, s]) => ({
      t,
      ageH: createTime ? Math.max(0, (t - createTime) / HOUR) : 0,
      plays: toCount(s.plays),
      likes: toCount(s.likes),
      comments: toCount(s.comments),
      shares: toCount(s.shares),
      saves: toCount(s.saves),
    }))
    out.push({
      id,
      createTime,
      author: typeof latest.author === 'string' ? latest.author : String(latest.author ?? ''),
      secUid: typeof latest.secUid === 'string' ? latest.secUid : '',
      followers: toCount(latest.followers),
      duration: toCount(latest.duration),
      music: normalizeMusic(latest.music),
      tags,
      pinned: latest.pinned === true,
      desc: typeof latest.desc === 'string' ? latest.desc : '',
      points,
    })
  }
  return out.sort((a, b) => b.createTime - a.createTime || a.id.localeCompare(b.id))
}

function latestPoint(series: VideoSeries): VideoPoint | null {
  return series.points.length ? series.points[series.points.length - 1] : null
}

function latestViews(series: VideoSeries): number {
  return latestPoint(series)?.plays ?? 0
}

interface Velocity {
  now: number
  prev: number
  /** Lifetime average: views / age hours. */
  lifetime: number
  basis: VelocityBasis
  /** Length of the last snapshot interval in hours (0 with a single snapshot). */
  lastIntervalH: number
}

/**
 * Views/hour in the last interval and the one before it. With a single
 * previous snapshot the "previous interval" runs from posting (0 views at age
 * 0). With a single snapshot, or a last interval shorter than
 * `breakout.minIntervalH`, both equal the lifetime average (basis 'lifetime'):
 * a 10-minute gap mostly measures TikTok's count refresh, not the video.
 */
function velocity(points: readonly VideoPoint[], cfg: RadarConfig): Velocity {
  const n = points.length
  if (!n) return { now: 0, prev: 0, lifetime: 0, basis: 'lifetime', lastIntervalH: 0 }
  const floor = cfg.breakout.rateFloorH
  const rate = (a: { ageH: number; plays: number }, b: { ageH: number; plays: number }): number =>
    Math.max(0, b.plays - a.plays) / Math.max(floor, b.ageH - a.ageH)
  const origin = { ageH: 0, plays: 0 }
  const last = points[n - 1]
  const lifetime = rate(origin, last)
  if (n === 1) return { now: lifetime, prev: lifetime, lifetime, basis: 'lifetime', lastIntervalH: 0 }
  const prevPoint = points[n - 2]
  const lastIntervalH = (last.t - prevPoint.t) / HOUR
  if (lastIntervalH < cfg.breakout.minIntervalH) return { now: lifetime, prev: lifetime, lifetime, basis: 'lifetime', lastIntervalH }
  return { now: rate(prevPoint, last), prev: rate(n >= 3 ? points[n - 3] : origin, prevPoint), lifetime, basis: 'interval', lastIntervalH }
}

interface CohortEntry {
  id: string
  ageH: number
  ageBucket: AgeBucket
  durationBucket: DurationBucket
  views: number
  /** Views/hour on this video's own basis. */
  vph: number
  vphLifetime: number
  velocityBasis: VelocityBasis
  shares: number
  saves: number
  likes: number
  followers: number
}

function cohortEntry(series: VideoSeries, cfg: RadarConfig): CohortEntry | null {
  const last = latestPoint(series)
  if (!last) return null
  const vel = velocity(series.points, cfg)
  return {
    id: series.id,
    ageH: last.ageH,
    ageBucket: ageBucket(last.ageH, cfg),
    durationBucket: durationBucket(series.duration, cfg),
    views: last.plays,
    vph: vel.now,
    vphLifetime: vel.lifetime,
    velocityBasis: vel.basis,
    shares: last.shares,
    saves: last.saves,
    likes: last.likes,
    followers: series.followers,
  }
}

/** Same-age-bucket cohort, widened to everything when too small. */
function ageCohort(entry: { id: string; ageBucket: AgeBucket }, all: readonly CohortEntry[], cfg: RadarConfig): { cohort: CohortEntry[]; widened: boolean } {
  const others = all.filter((o) => o.id !== entry.id)
  const same = others.filter((o) => o.ageBucket === entry.ageBucket)
  if (same.length >= cfg.cohort.minSize || same.length === others.length) return { cohort: same, widened: false }
  return { cohort: others, widened: true }
}

// ─── A. Video breakout ──────────────────────────────────────────────────────

export interface BetaEstimate {
  beta: number
  low: number
  high: number
  samples: number
}

/**
 * S-H projection coefficient for an age bucket: median of ln((1+v24)/(1+v_b))
 * over niche videos observed both in that bucket and at ~24 h. Null until
 * enough such videos exist.
 */
export function estimateBeta(allSeries: readonly VideoSeries[], bucket: AgeBucket, cfg: RadarConfig = RADAR_DEFAULTS): BetaEstimate | null {
  const b = cfg.breakout
  const samples: number[] = []
  for (const s of allSeries) {
    const inBucket = s.points.filter((p) => ageBucket(p.ageH, cfg) === bucket)
    if (!inBucket.length) continue
    const from = inBucket[inBucket.length - 1]
    let target: VideoPoint | null = null
    for (const p of s.points) {
      if (p.ageH < b.projectionTargetH || p.ageH > b.projectionMaxTargetH || p.t <= from.t) continue
      if (!target || Math.abs(p.ageH - b.projectionTargetH) < Math.abs(target.ageH - b.projectionTargetH)) target = p
    }
    if (target) samples.push(Math.log((1 + target.plays) / (1 + from.plays)))
  }
  if (samples.length < b.projectionMinSamples) return null
  return {
    beta: median(samples),
    low: quantile(samples, b.projectionBandLow),
    high: quantile(samples, b.projectionBandHigh),
    samples: samples.length,
  }
}

function smoothedRate(x: number, views: number, cfg: RadarConfig): number {
  return Math.log((x + cfg.breakout.rateNumPrior) / (views + cfg.breakout.rateDenPrior))
}

export interface VideoBreakoutOptions {
  cfg?: RadarConfig
}

/**
 * A. Breakout score of one video against the niche cohort (same age bucket;
 * like-rate additionally within the same duration bucket).
 */
export function videoBreakout(series: VideoSeries, cohortSeries: readonly VideoSeries[], now: number, options: VideoBreakoutOptions = {}): VideoBreakout {
  const cfg = options.cfg ?? RADAR_DEFAULTS
  const b = cfg.breakout
  const entry = cohortEntry(series, cfg)
  const empty: VideoBreakout = {
    id: series.id,
    author: series.author,
    flag: 'NONE',
    score: 0,
    ageH: 0,
    ageBucket: '0-1',
    durationBucket: durationBucket(series.duration, cfg),
    views: 0,
    vphNow: 0,
    vphPrev: 0,
    accel: 0,
    snapshots: 0,
    components: { levelZ: 0, velZ: 0, shareZ: 0, saveZ: 0, likeZ: 0 },
    cohortSize: 0,
    cohortMedianViews: 0,
    cohortMultiple: 0,
    projection: null,
    why: ['no snapshots for this video'],
  }
  if (!entry) return empty

  const all = cohortSeries.map((s) => cohortEntry(s, cfg)).filter((e): e is CohortEntry => e !== null)
  const { cohort, widened } = ageCohort(entry, all, cfg)
  const sameDuration = cohort.filter((o) => o.durationBucket === entry.durationBucket)
  const likeCohort = sameDuration.length >= cfg.cohort.minSize ? sameDuration : cohort

  const vel = velocity(series.points, cfg)
  const accel = Math.log((vel.now + b.accelSmoothing) / (vel.prev + b.accelSmoothing))
  const v = entry.views
  const minScale = cfg.stats.minLogScale
  const capZ = (z: number): number => clip(z, -b.zCap, b.zCap)

  // Velocity z compares like with like: an interval-measured video only against
  // cohort videos whose last interval was also long enough; otherwise (or when
  // too few of those exist) lifetime views/h for both the video and the cohort.
  let velBasis: VelocityBasis = vel.basis
  let velNow = vel.now
  let velSample = cohort.filter((o) => o.velocityBasis === 'interval').map((o) => o.vph)
  let velFallback = false
  if (velBasis === 'interval' && velSample.length < Math.min(cfg.cohort.minSize, cohort.length)) {
    velBasis = 'lifetime'
    velFallback = true
  }
  if (velBasis === 'lifetime') {
    velNow = vel.lifetime
    velSample = cohort.map((o) => o.vphLifetime)
  }

  const levelZ = capZ(logRobustZ(v, cohort.map((o) => o.views), minScale))
  const velZ = capZ(logRobustZ(velNow, velSample, b.velMinLogScale))
  const shareZ = capZ(robustZ(smoothedRate(entry.shares, v, cfg), cohort.map((o) => smoothedRate(o.shares, o.views, cfg)), minScale))
  const saveZ = capZ(robustZ(smoothedRate(entry.saves, v, cfg), cohort.map((o) => smoothedRate(o.saves, o.views, cfg)), minScale))
  const likeZ = capZ(robustZ(smoothedRate(entry.likes, v, cfg), likeCohort.map((o) => smoothedRate(o.likes, o.views, cfg)), minScale))

  const w = b.weights
  const score =
    w.level * levelZ +
    w.velocity * velZ +
    w.accel * clip(accel, b.accelClipLow, b.accelClipHigh) +
    w.share * shareZ +
    w.save * saveZ +
    w.like * likeZ

  const cohortMedianViews = median(cohort.map((o) => o.views))
  const cohortMultiple = v / Math.max(1, cohortMedianViews)
  const snapshots = series.points.length
  let flag: VideoBreakout['flag'] = 'NONE'
  if (
    cohort.length > 0 &&
    score >= b.flagScore &&
    v >= b.cohortMultiple * cohortMedianViews &&
    accel >= 0 &&
    snapshots >= b.minSnapshots
  ) {
    flag = 'BREAKOUT'
  } else if (cohort.length > 0 && score >= b.watchScore) {
    flag = 'WATCH'
  }

  let projection: BreakoutProjection | null = null
  if (entry.ageH < b.projectionTargetH) {
    const est = estimateBeta(cohortSeries, entry.ageBucket, cfg)
    if (est) {
      const base = Math.log1p(v)
      projection = {
        views24h: Math.max(v, Math.expm1(base + est.beta)),
        low: Math.max(v, Math.expm1(base + est.low)),
        high: Math.max(v, Math.expm1(base + est.high)),
        samples: est.samples,
      }
    }
  }

  const velLine = vel.basis === 'interval'
    ? `views/h ${fmtNum(vel.now)} (prev ${fmtNum(vel.prev)}), accel ${fmtZ(accel)}`
    : `views/h ${fmtNum(vel.lifetime)} lifetime average${snapshotsLabel(series.points.length, vel.lastIntervalH, b.minIntervalH)}, accel not measured`
  const why: string[] = [
    velLine,
    `views ${fmtNum(v)} at ${entry.ageH.toFixed(1)}h, ${fmtX(cohortMultiple)} cohort median ${fmtNum(cohortMedianViews)}`,
    `z: level ${fmtZ(levelZ)}, velocity ${fmtZ(velZ)}, share ${fmtZ(shareZ)}, save ${fmtZ(saveZ)}, like ${fmtZ(likeZ)}`,
  ]
  if (!cohort.length) why.push('no cohort to compare against')
  else if (widened) why.push(`age cohort ${entry.ageBucket}h too small, compared against all ${cohort.length} niche videos`)
  else why.push(`cohort: ${cohort.length} videos aged ${entry.ageBucket}h`)
  if (cohort.length) {
    if (velBasis === 'interval') {
      why.push(`velocity z vs ${velSample.length} cohort videos measured over >= ${fmtAge(b.minIntervalH)} intervals`)
    } else if (velFallback) {
      why.push(`velocity z on lifetime views/h: only ${cohort.filter((o) => o.velocityBasis === 'interval').length} cohort videos have a >= ${fmtAge(b.minIntervalH)} last interval`)
    } else {
      why.push(`velocity z on lifetime views/h (views / age) for this video and all ${velSample.length} cohort videos`)
    }
  }
  if (snapshots < b.minSnapshots) why.push('single snapshot: velocity is the lifetime average')
  else if (snapshots === 2) why.push('2 snapshots: acceleration measured against the lifetime average')
  if (flag !== 'BREAKOUT' && score >= b.flagScore) {
    if (accel < 0) why.push('not flagged: decelerating')
    else if (v < b.cohortMultiple * cohortMedianViews) why.push(`not flagged: below ${b.cohortMultiple}x cohort median`)
    else if (snapshots < b.minSnapshots) why.push(`not flagged: needs ${b.minSnapshots} snapshots`)
  }
  if (projection) {
    why.push(`projected 24h views ${fmtNum(projection.views24h)} (${fmtNum(projection.low)}-${fmtNum(projection.high)}, n=${projection.samples})`)
  }
  const last = latestPoint(series)
  if (last && now - last.t > cfg.report.staleSnapshotH * HOUR) {
    why.push(`last snapshot ${((now - last.t) / HOUR).toFixed(1)}h old`)
  }

  return {
    id: series.id,
    author: series.author,
    flag,
    score,
    ageH: entry.ageH,
    ageBucket: entry.ageBucket,
    durationBucket: entry.durationBucket,
    views: v,
    vphNow: vel.now,
    vphPrev: vel.prev,
    accel,
    snapshots,
    components: { levelZ, velZ, shareZ, saveZ, likeZ },
    cohortSize: cohort.length,
    cohortMedianViews,
    cohortMultiple,
    projection,
    velocityBasis: velBasis,
    velocityCohortSize: velSample.length,
    why,
  }
}

function snapshotsLabel(snapshots: number, lastIntervalH: number, minIntervalH: number): string {
  if (snapshots < 2) return ' (single snapshot)'
  return ` (last interval ${fmtAge(lastIntervalH)} < ${fmtAge(minIntervalH)})`
}

// ─── B. Creator-relative outlier ────────────────────────────────────────────

export function outlierBand(ratio: number, cfg: RadarConfig = RADAR_DEFAULTS): OutlierBand {
  const o = cfg.outlier
  if (ratio >= o.bandAnomalous) return 'anomalous'
  if (ratio >= o.bandMajor) return 'major'
  if (ratio >= o.bandStrong) return 'strong'
  if (ratio >= o.bandOutlier) return 'outlier'
  if (ratio >= o.bandWatch) return 'watch'
  return 'normal'
}

export interface CreatorOutlierOptions {
  now: number
  /** Niche videos for the fallback and for the views/follower percentile. */
  cohort?: readonly VideoSeries[]
  /** S-H projected 24 h views for a young video (from A). */
  projectedViews?: number
  cfg?: RadarConfig
}

/**
 * B. Views vs the creator's own baseline: median of their last 15 videos aged
 * >= 7 d (candidate and pinned videos excluded). With fewer than 5 such videos
 * it falls back to the niche cohort (same age bucket).
 */
export function creatorOutlier(video: VideoSeries, creatorHistory: readonly VideoSeries[], options: CreatorOutlierOptions): CreatorOutlier {
  const cfg = options.cfg ?? RADAR_DEFAULTS
  const o = cfg.outlier
  const now = toSeconds(options.now)
  const raw = latestViews(video)
  const projected = options.projectedViews !== undefined && Number.isFinite(options.projectedViews) && options.projectedViews > raw
  const v = projected ? (options.projectedViews as number) : raw

  const hist = creatorHistory
    .filter((h) => h.id !== video.id && !h.pinned && h.points.length > 0 && h.createTime > 0 && (now - h.createTime) / HOUR >= o.historyMinAgeH)
    .sort((a, b) => b.createTime - a.createTime)
    .slice(0, o.historySize)

  const lastAge = latestPoint(video)?.ageH ?? 0
  const entryBucket = ageBucket(lastAge, cfg)
  const cohortEntries = (options.cohort ?? []).map((s) => cohortEntry(s, cfg)).filter((e): e is CohortEntry => e !== null)
  const { cohort } = ageCohort({ id: video.id, ageBucket: entryBucket }, cohortEntries, cfg)
  const cohortViews = cohort.map((c) => c.views)
  const cohortPct = cohort.length ? percentileInCohort(raw, cohortViews) : null
  const vpf = (views: number, followers: number): number => views / Math.max(1, followers)
  const viewsPerFollowerPct = cohort.length ? percentileInCohort(vpf(raw, video.followers), cohort.map((c) => vpf(c.views, c.followers))) : null

  const why: string[] = []
  let method: CreatorOutlier['method']
  let baseline: number
  let robust: number
  let flagged: boolean

  if (hist.length >= o.historyMin) {
    method = 'creator'
    const histViews = hist.map(latestViews)
    baseline = Math.max(o.baselineFloor, median(histViews))
    robust = logRobustZ(v, histViews, o.minLogScale)
    const ratio = v / baseline
    flagged = ratio >= o.flagRatio && robust >= o.flagZ
    why.push(`${fmtNum(v)} views${projected ? ' (projected 24h)' : ''}, ${fmtX(ratio)} creator median ${fmtNum(baseline)} (last ${hist.length} videos >= 7d)`)
    why.push(`robust z ${fmtZ(robust)} vs creator history`)
  } else {
    method = 'cohort'
    baseline = Math.max(o.baselineFloor, median(cohortViews))
    robust = cohortViews.length ? logRobustZ(v, cohortViews, o.minLogScale) : 0
    const ratio = v / baseline
    flagged = cohortPct !== null && ratio >= o.flagRatio && cohortPct >= o.fallbackFlagPct
    why.push(`only ${hist.length} creator videos >= 7d (need ${o.historyMin}): compared to niche cohort`)
    if (cohortViews.length) {
      why.push(`${fmtNum(v)} views${projected ? ' (projected 24h)' : ''}, ${fmtX(ratio)} cohort median ${fmtNum(baseline)}, ${fmtPct(cohortPct)} percentile of ${cohortViews.length}`)
    } else {
      why.push(`no cohort: baseline is the ${fmtNum(o.baselineFloor)} floor`)
    }
  }
  const ratio = v / baseline
  const band = outlierBand(ratio, cfg)
  const downweight = ratio >= o.bandAnomalous
  if (downweight) why.push(`>= ${o.bandAnomalous}x: likely external factors, down-weight when learning`)
  if (viewsPerFollowerPct !== null) why.push(`views/follower at ${fmtPct(viewsPerFollowerPct)} cohort percentile`)

  return {
    id: video.id,
    author: video.author,
    method,
    views: v,
    projected,
    baseline,
    ratio,
    robustZ: robust,
    band,
    flagged,
    downweight,
    historySize: hist.length,
    cohortPct,
    viewsPerFollowerPct,
    why,
  }
}

// ─── C. Sound momentum ──────────────────────────────────────────────────────

interface CountPoint {
  t: number
  n: number
}

/** Linear interpolation of a count series at time T; null before the first point. */
function countAt(points: readonly CountPoint[], T: number): number | null {
  if (!points.length || T < points[0].t) return null
  const last = points[points.length - 1]
  if (T >= last.t) return last.n
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (T >= a.t && T <= b.t) {
      if (b.t === a.t) return b.n
      return a.n + ((b.n - a.n) * (T - a.t)) / (b.t - a.t)
    }
  }
  return last.n
}

function median7dRatios(ids: readonly string[], ratios: ReadonlyMap<string, number> | undefined, minN: number): { value: number | null; n: number } {
  if (!ratios) return { value: null, n: 0 }
  const xs = ids.map((id) => ratios.get(id)).filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
  return { value: xs.length >= minN ? median(xs) : null, n: xs.length }
}

/** Percentile of each value among the non-null values; null -> neutral 0.5. */
function pctAmong(values: ReadonlyArray<number | null>): number[] {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v))
  return values.map((v) => (v === null || !Number.isFinite(v) ? 0.5 : percentileInCohort(v, present)))
}

function safeLn(x: number | null): number | null {
  return x === null ? null : Math.log(Math.max(1e-6, x))
}

export interface SoundMomentumOptions {
  /** videoId -> creator-relative outlier ratio (B), for perf_lift. */
  outlierRatios?: ReadonlyMap<string, number>
  cfg?: RadarConfig
}

interface SoundFeatures {
  id: string
  title: string
  original: boolean
  snapshots: number
  spanH: number
  videoCount: number | null
  shortRatePerH: number | null
  growth24: number | null
  growth24Estimated: boolean
  accel: number | null
  burst: number | null
  insufficient: boolean
  staleH: number
}

function soundFeatures(id: string, snaps: readonly SoundSnapshot[], meta: SnapshotMusic | null, now: number, cfg: RadarConfig): SoundFeatures {
  const c = cfg.sound
  const byT = new Map<number, number>()
  let title = meta?.title ?? ''
  let original = meta?.original ?? false
  for (const s of snaps) {
    const t = toSeconds(s.t)
    if (!t) continue
    byT.set(t, toCount(s.videoCount))
    if (typeof s.title === 'string' && s.title) title = s.title
    if (typeof s.original === 'boolean') original = s.original
  }
  const pts: CountPoint[] = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ t, n }))
  const base: SoundFeatures = {
    id,
    title,
    original,
    snapshots: pts.length,
    spanH: 0,
    videoCount: pts.length ? pts[pts.length - 1].n : null,
    shortRatePerH: null,
    growth24: null,
    growth24Estimated: false,
    accel: null,
    burst: null,
    insufficient: true,
    staleH: pts.length ? Math.max(0, (now - pts[pts.length - 1].t) / HOUR) : 0,
  }
  if (pts.length < 2) return base
  const first = pts[0]
  const last = pts[pts.length - 1]
  const spanH = (last.t - first.t) / HOUR
  base.spanH = spanH
  base.shortRatePerH = spanH > 0 ? Math.max(0, last.n - first.n) / spanH : null
  if (spanH < c.minSpanH) return base
  base.insufficient = false
  const n = last.n
  const tRef = last.t

  // growth24: exact with >= 24 h of history, else extrapolated from the short-window rate.
  let d24 = 0
  let n24: number | null = null
  if (spanH >= 24) {
    n24 = countAt(pts, tRef - 24 * HOUR) ?? first.n
    d24 = Math.max(0, n - n24)
    base.growth24 = d24 / Math.max(n24, c.growthFloor)
  } else {
    d24 = (base.shortRatePerH ?? 0) * 24
    base.growth24 = d24 / Math.max(first.n, c.growthFloor)
    base.growth24Estimated = true
  }

  // accel: d24 vs the day before with >= 48 h, else second-half vs first-half rate.
  if (spanH >= 48 && n24 !== null) {
    const n48 = countAt(pts, tRef - 48 * HOUR) ?? first.n
    const d24Prev = Math.max(0, n24 - n48)
    base.accel = Math.log((d24 + c.accelSmoothing) / (d24Prev + c.accelSmoothing))
  } else if (pts.length >= c.minSnapshotsForAccel) {
    const half = (spanH / 2) * HOUR
    const mid = countAt(pts, tRef - half) ?? first.n
    const r1 = (Math.max(0, mid - first.n) / (spanH / 2)) * 24
    const r2 = (Math.max(0, n - mid) / (spanH / 2)) * 24
    base.accel = Math.log((r2 + c.accelSmoothing) / (r1 + c.accelSmoothing))
  }

  // burst: last-6h rate (or last half of a short span) vs the prior up-to-72h rate.
  if (pts.length >= c.minSnapshotsForAccel) {
    const w = Math.min(c.burstWindowH, spanH / 2)
    const tSplit = tRef - w * HOUR
    const nSplit = countAt(pts, tSplit) ?? first.n
    const priorStart = Math.max(first.t, tSplit - c.burstPriorH * HOUR)
    const priorH = (tSplit - priorStart) / HOUR
    if (priorH > 0 && w > 0) {
      const recent = Math.max(0, n - nSplit) / w
      const prior = Math.max(0, nSplit - (countAt(pts, priorStart) ?? first.n)) / priorH
      base.burst = recent / Math.max(c.burstPriorFloorPerH, prior)
    }
  }
  return base
}

function soundPhase(f: SoundFeatures, cfg: RadarConfig): { phase: SoundPhase; reason: string } {
  const c = cfg.sound
  if (f.snapshots < 2) return { phase: 'UNKNOWN', reason: `${f.snapshots} snapshot${f.snapshots === 1 ? '' : 's'}: need 2+ to measure growth` }
  if (f.insufficient) return { phase: 'UNKNOWN', reason: `snapshots span ${(f.spanH * 60).toFixed(0)} min: need ${c.minSpanH}h+` }
  if (f.accel === null || f.growth24 === null) return { phase: 'UNKNOWN', reason: `need ${c.minSnapshotsForAccel}+ snapshots to judge acceleration` }
  const g = f.growth24
  const a = f.accel
  const n = f.videoCount ?? 0
  if (a > 0 && g >= c.earlyGrowth && n < c.saturationCount) return { phase: 'EARLY', reason: 'accelerating, growing fast, below saturation' }
  if (a < 0 && g < c.saturatedGrowth) return { phase: 'SATURATED', reason: 'decelerating and barely growing' }
  if (g > 0 && a < 0) return { phase: 'PEAKING', reason: 'still growing but decelerating (past the inflection)' }
  if (n >= c.saturationCount && a <= 0) return { phase: 'SATURATED', reason: 'above saturation count and not accelerating' }
  if (a > 0 && g >= c.earlyGrowth) return { phase: 'PEAKING', reason: 'accelerating but already above saturation count' }
  return { phase: 'UNKNOWN', reason: `ambiguous: growth ${fmtPct(g)}/24h, accel ${fmtZ(a)}` }
}

/**
 * C. Momentum of every sound seen in the sound snapshots or in the niche
 * videos. Percentiles in sound_score are taken across that set of sounds.
 * Returned with snapshot-backed sounds first, then by score, best first.
 */
export function soundMomentum(soundSeries: readonly SoundSnapshot[], nicheVideos: readonly VideoSeries[], now: number, options: SoundMomentumOptions = {}): SoundMomentum[] {
  const cfg = options.cfg ?? RADAR_DEFAULTS
  const c = cfg.sound
  const nowS = toSeconds(now)

  const snapsById = new Map<string, SoundSnapshot[]>()
  for (const s of soundSeries ?? []) {
    const id = String(s?.id ?? '').trim()
    if (!id) continue
    const list = snapsById.get(id)
    if (list) list.push(s)
    else snapsById.set(id, [s])
  }
  const metaById = new Map<string, SnapshotMusic>()
  for (const v of nicheVideos) if (v.music && !metaById.has(v.music.id)) metaById.set(v.music.id, v.music)
  const ids = [...new Set([...snapsById.keys(), ...metaById.keys()])]

  const recentStart = nowS - c.nicheRecentH * HOUR
  const priorStart = recentStart - c.nichePriorH * HOUR
  const recent = nicheVideos.filter((v) => v.createTime >= recentStart && v.createTime <= nowS)
  const prior = nicheVideos.filter((v) => v.createTime >= priorStart && v.createTime < recentStart)
  const total = recent.length + prior.length
  const perfStart = nowS - c.perfWindowH * HOUR

  const rows = ids.map((id) => {
    const f = soundFeatures(id, snapsById.get(id) ?? [], metaById.get(id) ?? null, nowS, cfg)
    const k48 = recent.filter((v) => v.music?.id === id).length
    const kPrior = prior.filter((v) => v.music?.id === id).length
    const share48 = recent.length ? k48 / recent.length : null
    const sharePrior = prior.length ? kPrior / prior.length : null
    const nicheLift = total > 0 && share48 !== null && sharePrior !== null ? (share48 + 1 / total) / (sharePrior + 1 / total) : null
    const perfIds = nicheVideos.filter((v) => v.music?.id === id && v.createTime >= perfStart).map((v) => v.id)
    const perf = median7dRatios(perfIds, options.outlierRatios, c.perfMinVideos)
    const saturation = f.videoCount !== null && f.videoCount > 0
      ? clip((Math.log10(f.videoCount) - Math.log10(c.saturationCount)) / c.saturationWidthLog10, 0, 1)
      : 0
    return { f, k48, share48, sharePrior, nicheLift, perf, saturation }
  })

  const pGrowth = pctAmong(rows.map((r) => r.f.growth24))
  const pBurst = pctAmong(rows.map((r) => safeLn(r.f.burst)))
  const pAccel = pctAmong(rows.map((r) => r.f.accel))
  const pLift = pctAmong(rows.map((r) => safeLn(r.nicheLift)))
  const pPerf = pctAmong(rows.map((r) => safeLn(r.perf.value)))
  const w = c.weights

  const out = rows.map((r, i): SoundMomentum => {
    const { f } = r
    const score =
      w.growth * pGrowth[i] +
      w.burst * pBurst[i] +
      w.accel * pAccel[i] +
      w.nicheLift * pLift[i] +
      w.perfLift * pPerf[i] -
      w.saturation * r.saturation
    const { phase, reason } = soundPhase(f, cfg)
    const recommend = phase === 'EARLY' && r.perf.value !== null && r.perf.value >= c.recommendPerfLift
    const why: string[] = []
    if (f.videoCount !== null) {
      const rate = f.shortRatePerH !== null ? `, +${fmtNum(f.shortRatePerH)}/h over ${f.spanH.toFixed(1)}h` : ''
      why.push(`videoCount ${fmtNum(f.videoCount)}${rate}`)
    } else {
      why.push('no sound snapshots: seen only on niche videos')
    }
    if (f.growth24 !== null) why.push(`growth ${fmtPct(f.growth24)}/24h${f.growth24Estimated ? ' (extrapolated from short span)' : ''}`)
    if (f.accel !== null) why.push(`accel ${fmtZ(f.accel)}${f.burst !== null ? `, burst ${fmtX(f.burst)}` : ''}`)
    why.push(`phase ${phase}: ${reason}`)
    if (r.share48 !== null) {
      why.push(`niche share ${fmtPct(r.share48)} last ${c.nicheRecentH}h (${r.k48} videos) vs ${fmtPct(r.sharePrior)} prior ${c.nichePriorH / 24}d`)
    }
    if (r.perf.value !== null) why.push(`perf lift ${fmtX(r.perf.value)} (median outlier ratio, n=${r.perf.n})`)
    else why.push(`perf lift unknown (${r.perf.n} niche videos in 7d, need ${c.perfMinVideos})`)
    if (r.saturation > 0) why.push(`saturation ${r.saturation.toFixed(2)}`)
    if (f.original) why.push('original sound')
    if (f.staleH > cfg.report.staleSnapshotH) why.push(`last sound snapshot ${f.staleH.toFixed(1)}h old`)
    return {
      id: f.id,
      title: f.title,
      original: f.original,
      phase,
      score,
      recommend,
      evidence: f.snapshots > 0 ? 'snapshots' : 'usage-only',
      videoCount: f.videoCount,
      snapshots: f.snapshots,
      spanH: f.spanH,
      shortRatePerH: f.shortRatePerH,
      growth24: f.growth24,
      growth24Estimated: f.growth24Estimated,
      accel: f.accel,
      burst: f.burst,
      nicheVideos48h: r.k48,
      nicheShare48h: r.share48,
      nicheSharePrior: r.sharePrior,
      nicheLift: r.nicheLift,
      perfLift: r.perf.value,
      saturation: r.saturation,
      why,
    }
  })
  // Usage-only sounds get neutral percentiles for everything they lack, so they
  // never outrank a sound whose growth was actually observed.
  const evidenceRank = (s: SoundMomentum): number => (s.evidence === 'snapshots' ? 1 : 0)
  return out.sort((a, b) => evidenceRank(b) - evidenceRank(a) || b.score - a.score || a.id.localeCompare(b.id))
}

// ─── D. Hashtag momentum ────────────────────────────────────────────────────

/** Share of niche videos carrying at least one seed tag. */
export function seedCoverage(nicheVideos: readonly VideoSeries[], seedTags: readonly string[]): number {
  if (!nicheVideos.length) return 0
  const seeds = new Set(normalizeTags(seedTags))
  return nicheVideos.filter((v) => v.tags.some((t) => seeds.has(t))).length / nicheVideos.length
}

export interface HashtagMomentumOptions {
  outlierRatios?: ReadonlyMap<string, number>
  cfg?: RadarConfig
}

/**
 * D. Momentum, performance and niche relevance (PMI with the seed tags) for
 * every tag on the niche videos. Sorted by tag_score, best first.
 */
export function hashtagMomentum(nicheVideos: readonly VideoSeries[], seedTags: readonly string[], now: number, options: HashtagMomentumOptions = {}): TagScore[] {
  const cfg = options.cfg ?? RADAR_DEFAULTS
  const c = cfg.tags
  const nowS = toSeconds(now)
  const seeds = new Set(normalizeTags(seedTags))
  const N = nicheVideos.length
  if (!N) return []

  const counts = new Map<string, number>()
  for (const v of nicheVideos) for (const t of v.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  const seedCount = nicheVideos.filter((v) => v.tags.some((t) => seeds.has(t))).length

  const recentStart = nowS - c.recentH * HOUR
  const priorStart = recentStart - c.priorDays * 24 * HOUR
  const perfStart = nowS - c.perfWindowH * HOUR
  const bins = Math.max(1, Math.round((nowS - priorStart) / HOUR))
  const binOf = (ct: number): number => Math.floor((ct - priorStart) / HOUR)
  const totals = new Array<number>(bins).fill(0)
  for (const v of nicheVideos) {
    const b = binOf(v.createTime)
    if (b >= 0 && b < bins) totals[b]++
  }
  const recentBins = Math.min(bins, Math.round(c.recentH))

  const candidates = [...counts.entries()].filter(([tag, n]) => seeds.has(tag) || n >= c.minCount)
  const rows = candidates.map(([tag, count]) => {
    const carrying = nicheVideos.filter((v) => v.tags.includes(tag))
    const freq24 = carrying.filter((v) => v.createTime >= recentStart && v.createTime <= nowS).length
    const basePerDay = carrying.filter((v) => v.createTime >= priorStart && v.createTime < recentStart).length / c.priorDays
    const lift = (freq24 + 1) / (basePerDay + 1)
    const r = new Array<number>(bins).fill(0)
    for (const v of carrying) {
      const b = binOf(v.createTime)
      if (b >= 0 && b < bins) r[b]++
    }
    const states = burstStates(r, totals, c.burstRatio, c.burstGamma)
    const burst = states.slice(bins - recentBins).some((s) => s === 1)
    const perf = median7dRatios(carrying.filter((v) => v.createTime >= perfStart).map((v) => v.id), options.outlierRatios, c.perfMinVideos)
    const joint = carrying.filter((v) => v.tags.some((t) => seeds.has(t))).length
    const pmi = seedCount > 0 ? Math.log(((joint + c.pmiSmoothing) / N) / ((count / N) * (seedCount / N))) : 0
    const creators = new Set(carrying.map((v) => v.secUid || v.author)).size
    const generic = isGenericTag(tag, count / N, seeds.has(tag), cfg)
    return { tag, count, freq24, basePerDay, lift, burst, perf, pmi, joint, creators, generic }
  })

  const pLift = pctAmong(rows.map((r) => Math.log(r.lift)))
  const pPerf = pctAmong(rows.map((r) => safeLn(r.perf.value)))
  const pPmi = pctAmong(rows.map((r) => r.pmi))
  const w = c.weights
  const out = rows.map((r, i): TagScore => {
    const score = w.lift * pLift[i] + w.perf * pPerf[i] + w.pmi * pPmi[i] + w.burst * (r.burst ? 1 : 0)
    const why = [
      `${r.count} niche videos (${fmtPct(r.count / N)}), ${r.freq24} in last ${c.recentH}h vs ${fmtNum(r.basePerDay)}/day prior ${c.priorDays}d: lift ${fmtX(r.lift)}`,
      `PMI with seed ${fmtZ(r.pmi)} (${r.joint} co-occurrences), ${r.creators} creator${r.creators === 1 ? '' : 's'}`,
    ]
    if (r.generic) why.push('generic tag (platform-wide or on too much of the niche): broad role only')
    if (r.creators < c.minCreators) why.push(`only ${r.creators} creator: creator-private, not pickable`)
    if (r.burst) why.push(`bursting in the last ${c.recentH}h (Kleinberg high state)`)
    if (r.perf.value !== null) why.push(`perf ${fmtX(r.perf.value)} median outlier ratio (n=${r.perf.n})`)
    else why.push(`perf unknown (${r.perf.n} videos in 7d, need ${c.perfMinVideos})`)
    return {
      tag: r.tag,
      isSeed: seeds.has(r.tag),
      count: r.count,
      share: r.count / N,
      creators: r.creators,
      generic: r.generic,
      freq24: r.freq24,
      basePerDay: r.basePerDay,
      lift: r.lift,
      burst: r.burst,
      perf: r.perf.value,
      perfN: r.perf.n,
      pmi: r.pmi,
      score,
      why,
    }
  })
  return out.sort((a, b) => b.score - a.score || b.count - a.count || a.tag.localeCompare(b.tag))
}

/**
 * D. Picker: 2 core (highest PMI x ln(1 + creators), perf >= 1 when known), 1-2 momentum
 * (lift >= 2, PMI > 0), at most 1 broad (most frequent), topped up to 3 with the
 * best remaining; never more than 5; PMI < 0 is always rejected. Tags used by
 * fewer than `minCreators` creators are never picked (creator-private), and
 * generic tags (fyp, viral, ... or > `genericMaxShare` of the niche) may only
 * take the single broad slot.
 */
export function pickTags(scores: readonly TagScore[], cfg: RadarConfig = RADAR_DEFAULTS): PickedTag[] {
  const c = cfg.tags
  const generic = (s: TagScore): boolean => s.generic || isGenericTag(s.tag, s.share, s.isSeed, cfg)
  const eligible = scores.filter((s) => Number.isFinite(s.pmi) && s.pmi >= 0 && s.creators >= c.minCreators)
  const pool = eligible.filter((s) => !generic(s))
  const picked: PickedTag[] = []
  const taken = new Set<string>()
  const take = (s: TagScore, role: PickedTag['role'], reason: string): void => {
    if (picked.length >= c.maxPick || taken.has(s.tag)) return
    taken.add(s.tag)
    picked.push({ tag: s.tag, role, why: [reason, ...s.why] })
  }

  // PMI alone favours 2-video tags (the smoothing inflates small joints), so
  // core ranks by PMI x ln(1 + creators): niche-specific AND widely adopted.
  const coreRank = (s: TagScore): number => s.pmi * Math.log1p(s.creators)
  const core = pool
    .filter((s) => s.perf === null || s.perf >= 1)
    .sort((a, b) => coreRank(b) - coreRank(a) || b.count - a.count || a.tag.localeCompare(b.tag))
  for (const s of core.slice(0, c.coreCount)) take(s, 'core', `core: PMI ${fmtZ(s.pmi)} with niche seed across ${s.creators} creators`)

  const momentum = pool
    .filter((s) => !taken.has(s.tag) && s.lift >= c.momentumLift && s.pmi > 0)
    .sort((a, b) => b.score - a.score)
  for (const s of momentum.slice(0, c.maxMomentum)) take(s, 'momentum', `momentum: lift ${fmtX(s.lift)}, score ${s.score.toFixed(2)}, ${s.creators} creators`)

  const broad = eligible
    .filter((s) => !taken.has(s.tag) && (generic(s) || s.share >= c.broadMinShare))
    .sort((a, b) => b.share - a.share || a.tag.localeCompare(b.tag))
  for (const s of broad.slice(0, c.maxBroad)) take(s, 'broad', `broad: on ${fmtPct(s.share)} of niche videos${generic(s) ? ' (generic tag)' : ''}`)

  if (picked.length < c.minPick) {
    const fill = pool.filter((s) => !taken.has(s.tag)).sort((a, b) => b.score - a.score)
    for (const s of fill) {
      if (picked.length >= c.minPick) break
      take(s, 'fill', `fill: next best score ${s.score.toFixed(2)}`)
    }
  }
  return picked
}

// ─── E. Niche opportunity ───────────────────────────────────────────────────

export interface NicheOpportunityContext {
  now: number
  seedTags: readonly string[]
  breakouts: ReadonlyMap<string, VideoBreakout>
  outliers: ReadonlyMap<string, CreatorOutlier>
  sounds: readonly SoundMomentum[]
  tags: readonly TagScore[]
  cfg?: RadarConfig
}

function creatorKey(v: VideoSeries): string {
  return v.secUid || v.author
}

/** Keeps list order, taking at most `maxPerCreator` items per creator and `limit` items overall. */
function capPerCreator<T>(items: readonly T[], keyOf: (item: T) => string, maxPerCreator: number, limit: number): T[] {
  const perCreator = new Map<string, number>()
  const out: T[] = []
  for (const item of items) {
    if (out.length >= limit) break
    const key = keyOf(item)
    const n = perCreator.get(key) ?? 0
    if (n >= maxPerCreator) continue
    perCreator.set(key, n + 1)
    out.push(item)
  }
  return out
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let root = this.parent.get(x) ?? x
    if (root !== x) {
      root = this.find(root)
      this.parent.set(x, root)
    }
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
  }
}

interface ClusterDef {
  id: string
  kind: 'sound' | 'tags'
  label: string
  member: (v: VideoSeries) => boolean
  soundId: string | null
  tagSet: Set<string> | null
}

function bestByRate<K extends string | number>(videos: readonly VideoSeries[], keyOf: (v: VideoSeries) => K, isHit: (v: VideoSeries) => boolean, smoothing: number): K | null {
  const hits = videos.filter(isHit).length
  if (!hits || !videos.length) return null
  const p = hits / videos.length
  const groups = new Map<K, { n: number; k: number }>()
  for (const v of videos) {
    const key = keyOf(v)
    const g = groups.get(key) ?? { n: 0, k: 0 }
    g.n++
    if (isHit(v)) g.k++
    groups.set(key, g)
  }
  let best: K | null = null
  let bestRate = -Infinity
  let bestN = 0
  for (const [key, g] of groups) {
    const rate = (g.k + smoothing * p) / (g.n + smoothing)
    if (rate > bestRate || (rate === bestRate && g.n > bestN)) {
      best = key
      bestRate = rate
      bestN = g.n
    }
  }
  return best
}

/**
 * E. Clusters niche videos from the last 48 h by sound and by hashtag
 * co-occurrence component (seed, generic and creator-private tags excluded so
 * they do not merge everything), then ranks the clusters by opportunity. Tag
 * cluster labels show the top 3 tags only.
 */
export function nicheOpportunity(nicheVideos: readonly VideoSeries[], ctx: NicheOpportunityContext): OpportunityCluster[] {
  const cfg = ctx.cfg ?? RADAR_DEFAULTS
  const c = cfg.opportunity
  const now = toSeconds(ctx.now)
  const seeds = new Set(normalizeTags([...ctx.seedTags]))
  const windowStart = now - c.windowH * HOUR
  const windowVideos = nicheVideos.filter((v) => v.createTime >= windowStart && v.createTime <= now)
  if (!windowVideos.length) return []

  const isHit = (v: VideoSeries): boolean => ctx.outliers.get(v.id)?.flagged === true || ctx.breakouts.get(v.id)?.flag === 'BREAKOUT'
  const soundById = new Map(ctx.sounds.map((s) => [s.id, s]))
  const tagByName = new Map(ctx.tags.map((t) => [t.tag, t]))

  const defs: ClusterDef[] = []
  const soundCounts = new Map<string, number>()
  for (const v of windowVideos) if (v.music) soundCounts.set(v.music.id, (soundCounts.get(v.music.id) ?? 0) + 1)
  for (const [soundId, n] of soundCounts) {
    if (n < c.minClusterVideos) continue
    const title = soundById.get(soundId)?.title || windowVideos.find((v) => v.music?.id === soundId)?.music?.title || soundId
    defs.push({ id: `sound:${soundId}`, kind: 'sound', label: `sound: ${title}`, member: (v) => v.music?.id === soundId, soundId, tagSet: null })
  }

  // Only non-generic, multi-creator tags may form clusters: generic tags (fyp,
  // viral, or on > genericMaxShare of the niche) chain everything into one
  // giant component, and creator-private tags are one account's signature.
  const tagCounts = new Map<string, number>()
  const tagCreators = new Map<string, Set<string>>()
  for (const v of windowVideos) {
    for (const t of v.tags) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
      const set = tagCreators.get(t) ?? new Set<string>()
      set.add(v.secUid || v.author)
      tagCreators.set(t, set)
    }
  }
  const nicheTagCounts = new Map<string, number>()
  for (const v of nicheVideos) for (const t of v.tags) nicheTagCounts.set(t, (nicheTagCounts.get(t) ?? 0) + 1)
  const usable = new Set(
    [...tagCounts.entries()]
      .filter(([t, n]) =>
        !seeds.has(t) &&
        n >= c.minClusterVideos &&
        n / windowVideos.length <= c.maxTagShare &&
        (tagCreators.get(t)?.size ?? 0) >= cfg.tags.minCreators &&
        !tagByName.get(t)?.generic &&
        !isGenericTag(t, (nicheTagCounts.get(t) ?? 0) / nicheVideos.length, false, cfg),
      )
      .map(([t]) => t),
  )
  const edges = new Map<string, number>()
  for (const v of windowVideos) {
    const ts = v.tags.filter((t) => usable.has(t)).sort()
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const key = `${ts[i]}\u0000${ts[j]}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
  }
  const uf = new UnionFind()
  for (const [key, weight] of edges) {
    if (weight < c.minEdgeWeight) continue
    const [a, b] = key.split('\u0000')
    uf.union(a, b)
  }
  const components = new Map<string, Set<string>>()
  for (const t of usable) {
    const root = uf.find(t)
    const set = components.get(root) ?? new Set<string>()
    set.add(t)
    components.set(root, set)
  }
  for (const set of components.values()) {
    const tagsSorted = [...set].sort((a, b) => (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0) || a.localeCompare(b))
    const member = (v: VideoSeries): boolean => v.tags.some((t) => set.has(t))
    if (windowVideos.filter(member).length < c.minClusterVideos) continue
    defs.push({
      id: `tags:${tagsSorted.slice(0, 3).join('+')}`,
      kind: 'tags',
      label: `#${tagsSorted.slice(0, 3).join(' #')}`,
      member,
      soundId: null,
      tagSet: set,
    })
  }
  if (!defs.length) return []

  const supplyRecentStart = now - c.supplyRecentH * HOUR
  const supplyPriorStart = supplyRecentStart - c.supplyPriorDays * 24 * HOUR
  const phaseRank: Record<SoundPhase, number> = { EARLY: 3, PEAKING: 2, UNKNOWN: 1, SATURATED: 0 }

  const raw = defs.map((def) => {
    const vids = windowVideos.filter(def.member)
    const hits = vids.filter(isHit)
    const ratios = vids.map((v) => ctx.outliers.get(v.id)?.ratio).filter((r): r is number => r !== undefined && Number.isFinite(r) && r > 0)
    const demand = ratios.length ? median(ratios) : 1
    const hot = vids.filter((v) => (ctx.breakouts.get(v.id)?.score ?? 0) >= c.hotScore).length / vids.length

    const clusterSoundIds = def.soundId ? [def.soundId] : [...new Set(vids.map((v) => v.music?.id).filter((id): id is string => !!id))]
    const soundScores = clusterSoundIds.map((id) => soundById.get(id)?.score).filter((s): s is number => s !== undefined)
    const clusterTags = def.tagSet ? [...def.tagSet] : [...new Set(vids.flatMap((v) => v.tags))]
    const tagScores = clusterTags.map((t) => tagByName.get(t)?.score).filter((s): s is number => s !== undefined).sort((a, b) => b - a).slice(0, 3)
    const tagMomentum = tagScores.length ? tagScores.reduce((a, b) => a + b, 0) / tagScores.length : null
    const soundMomentumMax = soundScores.length ? Math.max(...soundScores) : null
    const momentum = Math.max(soundMomentumMax ?? -Infinity, tagMomentum ?? -Infinity, 0)

    const posts24 = nicheVideos.filter((v) => def.member(v) && v.createTime >= supplyRecentStart && v.createTime <= now).length
    const priorDaily = nicheVideos.filter((v) => def.member(v) && v.createTime >= supplyPriorStart && v.createTime < supplyRecentStart).length / c.supplyPriorDays
    const supply = Math.log((posts24 + 1) / (priorDaily + 1))

    const firstHit = hits.length ? Math.min(...hits.map((v) => v.createTime)) : null
    const freshness = firstHit === null ? 0 : Math.exp(-Math.max(0, now - firstHit) / HOUR / c.freshnessTauH)
    const smallOk = hits.length ? hits.filter((v) => v.followers < c.smallCreatorFollowers).length / hits.length : 0
    const outlierCreators = new Set(hits.map((v) => v.secUid || v.author)).size

    // Idea: best non-anomalous outlier, else the best by ratio.
    const ranked = vids
      .map((v) => ({ v, o: ctx.outliers.get(v.id) }))
      .sort((a, b) => {
        const ah = isHit(a.v) && !a.o?.downweight ? 1 : 0
        const bh = isHit(b.v) && !b.o?.downweight ? 1 : 0
        return bh - ah || (b.o?.ratio ?? 0) - (a.o?.ratio ?? 0)
      })
    const top = ranked[0]
    const toIdea = (x: { v: VideoSeries; o: CreatorOutlier | undefined }): OpportunityIdea => ({ videoId: x.v.id, author: x.v.author, desc: x.v.desc, ratio: x.o?.ratio ?? 0 })
    const idea: OpportunityIdea | null = top ? toIdea(top) : null
    const examples = capPerCreator(ranked, (x) => creatorKey(x.v), cfg.report.maxPerCreator, c.maxExamples).map(toIdea)

    let soundId = def.soundId
    if (!soundId) {
      const pool = hits.length ? hits : vids
      const freq = new Map<string, number>()
      for (const v of pool) if (v.music) freq.set(v.music.id, (freq.get(v.music.id) ?? 0) + 1)
      soundId = [...freq.entries()].sort((a, b) => b[1] - a[1] || (phaseRank[soundById.get(b[0])?.phase ?? 'UNKNOWN'] - phaseRank[soundById.get(a[0])?.phase ?? 'UNKNOWN']))[0]?.[0] ?? null
    }
    const sm = soundId ? soundById.get(soundId) : undefined
    const music = soundId ? vids.find((v) => v.music?.id === soundId)?.music ?? null : null
    const sound = soundId
      ? { id: soundId, title: sm?.title || music?.title || '', phase: sm?.phase ?? 'UNKNOWN' as SoundPhase, original: sm?.original ?? music?.original ?? false }
      : null

    const tagsInCluster = new Set(vids.flatMap((v) => v.tags))
    const picked = pickTags(ctx.tags.filter((t) => tagsInCluster.has(t.tag)), cfg)
    const bestHour = bestByRate(vids, (v) => new Date(v.createTime * 1000).getUTCHours(), isHit, c.rateSmoothing)
    const lengthBucket = bestByRate(vids, (v) => durationBucket(v.duration, cfg), isHit, c.rateSmoothing)

    return { def, vids, demand, hot, momentum, supply, freshness, smallOk, outlierCreators, idea, examples, sound, picked, bestHour, lengthBucket, hits: hits.length }
  })

  const pDemand = pctAmong(raw.map((r) => Math.log(r.demand)))
  const pHot = pctAmong(raw.map((r) => r.hot))
  const pSmall = pctAmong(raw.map((r) => r.smallOk))
  const w = c.weights

  const out = raw.map((r, i): OpportunityCluster => {
    const supplyPenalty = clip(r.supply - Math.log(3), 0, 1)
    const opportunity =
      w.demand * pDemand[i] + w.hot * pHot[i] + w.momentum * r.momentum + w.freshness * r.freshness + w.smallOk * pSmall[i] - w.supply * supplyPenalty
    const phaseOk = r.sound !== null && (r.sound.phase === 'EARLY' || r.sound.phase === 'PEAKING')
    const recommend = opportunity >= c.minScore && r.hot >= c.minHot && r.outlierCreators >= c.minOutlierCreators && phaseOk
    const why = [
      `${r.vids.length} videos in last ${c.windowH}h, ${r.hits} outliers from ${r.outlierCreators} creators`,
      `demand ${fmtX(r.demand)} median creator ratio, hot ${fmtPct(r.hot)}, momentum ${r.momentum.toFixed(2)}`,
      `supply ${fmtZ(r.supply)} (ln posts 24h vs prior daily)${supplyPenalty > 0 ? ': flooding' : ''}, freshness ${r.freshness.toFixed(2)}, small creators ${fmtPct(r.smallOk)}`,
    ]
    if (recommend) {
      why.push(
        `recommended: score ${opportunity.toFixed(2)} >= ${c.minScore}, hot ${fmtPct(r.hot)} >= ${fmtPct(c.minHot)}, ` +
          `${r.outlierCreators} independent outlier creators >= ${c.minOutlierCreators}, sound ${r.sound?.phase ?? 'n/a'}`,
      )
    } else {
      const missing: string[] = []
      if (opportunity < c.minScore) missing.push(`score < ${c.minScore}`)
      if (r.hot < c.minHot) missing.push(`hot < ${fmtPct(c.minHot)}`)
      if (r.outlierCreators < c.minOutlierCreators) missing.push(`< ${c.minOutlierCreators} outlier creators`)
      if (!phaseOk) missing.push('no EARLY/PEAKING sound')
      why.push(`not recommended: ${missing.join(', ')}`)
    }
    return {
      id: r.def.id,
      kind: r.def.kind,
      label: r.def.label,
      videos: r.vids.length,
      opportunity,
      recommend,
      demand: r.demand,
      hot: r.hot,
      momentum: r.momentum,
      supply: r.supply,
      freshness: r.freshness,
      smallOk: r.smallOk,
      outlierCreators: r.outlierCreators,
      idea: r.idea,
      examples: r.examples,
      sound: r.sound,
      tags: r.picked,
      bestHour: r.bestHour,
      lengthBucket: r.lengthBucket,
      why,
    }
  })
  return out.sort((a, b) => Number(b.recommend) - Number(a.recommend) || b.opportunity - a.opportunity || a.id.localeCompare(b.id))
}

// ─── Report ─────────────────────────────────────────────────────────────────

/**
 * Niche relevance for every series, computing each video's own signal once and
 * each creator's relevant share once. Same result as nicheRelevance per video.
 */
export function nicheRelevanceMap(allSeries: readonly VideoSeries[], seedTags: readonly string[], seedKeywords: readonly string[], cfg: RadarConfig = RADAR_DEFAULTS): Map<string, number> {
  const r = cfg.relevance
  const seeds = new Set(normalizeTags([...seedTags]))
  const keywords = normalizeKeywords([...seedKeywords])
  const out = new Map<string, number>()
  if (!seeds.size && !keywords.length) {
    for (const s of allSeries) out.set(s.id, 1)
    return out
  }
  const own = new Map(allSeries.map((s) => [s.id, ownRelevance(s, seeds, keywords, cfg)]))
  const byCreator = new Map<string, { n: number; k: number }>()
  for (const s of allSeries) {
    const key = s.secUid || s.author
    const g = byCreator.get(key) ?? { n: 0, k: 0 }
    g.n++
    if ((own.get(s.id) ?? 0) >= r.min) g.k++
    byCreator.set(key, g)
  }
  for (const s of allSeries) {
    const g = byCreator.get(s.secUid || s.author) ?? { n: 1, k: 0 }
    out.set(s.id, clip(r.ownWeight * (own.get(s.id) ?? 0) + r.creatorWeight * (g.k / Math.max(1, g.n)), 0, 1))
  }
  return out
}

function rateOf(x: number, views: number): number | null {
  return views > 0 ? x / views : null
}

function fmtRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return 'n/a'
  const pct = rate * 100
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`
}

function fmtAge(ageH: number): string {
  return ageH < 1 ? `${Math.round(ageH * 60)}min` : `${ageH.toFixed(1)}h`
}

/** One compact human line for a top video. */
function evidenceLine(s: VideoSeries, b: VideoBreakout, o: CreatorOutlier, relevance: number, cohortShare: number | null, cohortSave: number | null): string {
  const last = latestPoint(s)
  const share = last ? rateOf(last.shares, last.plays) : null
  const save = last ? rateOf(last.saves, last.plays) : null
  const vs = (rate: number | null, base: number | null): string => (rate !== null && base !== null && base > 0 ? ` (${fmtX(rate / base)} cohort)` : '')
  const baseline = o.method === 'creator' ? 'creator median' : 'niche median, no creator history'
  return [
    `${fmtNum(b.views)} views in ${fmtAge(b.ageH)}`,
    `${fmtNum(b.vphNow)} views/h`,
    `${fmtX(o.ratio)} ${baseline}${o.projected ? ' (projected 24h)' : ''}`,
    `share ${fmtRate(share)}${vs(share, cohortShare)}`,
    `save ${fmtRate(save)}${vs(save, cohortSave)}`,
    `relevance ${relevance.toFixed(2)}`,
  ].join(' · ')
}

/**
 * Top-video selection: flagged videos by rank, at most `maxPerCreator` per
 * creator. If the first `diversityWindow` then show fewer than `minCreatorsTop`
 * creators (and at least one video is flagged and `minCreatorsTop` relevant
 * fresh creators exist), the best-ranked video of each missing creator (from all relevant
 * fresh videos, flagged or not) is added, by rank, until the minimum is met or
 * no other creator is left. When the window is full, the lowest-ranked video
 * of its most repeated creator makes room.
 */
function diversifyTop<T extends { rank: number; fill: boolean }>(flagged: readonly T[], all: readonly T[], keyOf: (item: T) => string, cfg: RadarConfig): T[] {
  const r = cfg.report
  const selected = capPerCreator(flagged, keyOf, r.maxPerCreator, r.topVideosLimit)
  const win = Math.min(r.diversityWindow, r.topVideosLimit)
  const head = selected.slice(0, win)
  const rest = selected.slice(win)
  const creators = new Set(head.map(keyOf))
  // Nothing flagged, or too few relevant creators to reach the minimum: no padding.
  if (!head.length || creators.size >= r.minCreatorsTop || new Set(all.map(keyOf)).size < r.minCreatorsTop) return selected
  const chosen = new Set<T>(selected)
  for (const item of all) {
    if (creators.size >= r.minCreatorsTop) break
    const key = keyOf(item)
    if (creators.has(key) || chosen.has(item)) continue
    if (head.length >= win) {
      const counts = new Map<string, number>()
      for (const h of head) counts.set(keyOf(h), (counts.get(keyOf(h)) ?? 0) + 1)
      let drop = -1
      for (let i = head.length - 1; i >= 0; i--) {
        if ((counts.get(keyOf(head[i])) ?? 0) > 1 && (drop === -1 || (counts.get(keyOf(head[i])) ?? 0) > (counts.get(keyOf(head[drop])) ?? 0))) drop = i
      }
      if (drop === -1) break
      rest.unshift(head.splice(drop, 1)[0])
    }
    head.push({ ...item, fill: true })
    chosen.add(item)
    creators.add(key)
  }
  head.sort((x, y) => y.rank - x.rank)
  rest.sort((x, y) => y.rank - x.rank)
  return [...head, ...rest].slice(0, r.topVideosLimit)
}

/**
 * Runs A-E over raw snapshots and states honestly where the data is too thin
 * for the numbers to mean much. Off-niche videos (relevance below
 * `relevance.min`) are dropped from top videos, tags, sounds and opportunities
 * and serve only as creator baselines.
 */
export function radarReport(
  videoSnapshots: readonly VideoSnapshot[],
  soundSnapshots: readonly SoundSnapshot[],
  options: RadarReportOptions & { cfg?: RadarConfig },
): RadarReport {
  const cfg = options.cfg ?? RADAR_DEFAULTS
  const now = toSeconds(options.now)
  const hours = Number.isFinite(options.hours) && options.hours > 0 ? options.hours : 24
  const seedTags = normalizeTags(options.seedTags)
  const seedKeywords = normalizeKeywords(Array.isArray(options.seedKeywords) ? options.seedKeywords : seedTags)
  const series = buildVideoSeries(videoSnapshots ?? [])

  const relevance = nicheRelevanceMap(series, seedTags, seedKeywords, cfg)
  const relevanceOf = (s: VideoSeries): number => relevance.get(s.id) ?? 0
  const niche = series.filter((s) => relevanceOf(s) >= cfg.relevance.min)
  const nicheIds = new Set(niche.map((s) => s.id))

  const breakouts = new Map<string, VideoBreakout>()
  for (const s of niche) breakouts.set(s.id, videoBreakout(s, niche, now, { cfg }))

  // Creator baselines use every video of the creator, on-niche or not.
  const byCreator = new Map<string, VideoSeries[]>()
  for (const s of series) {
    const key = s.secUid || s.author
    const list = byCreator.get(key)
    if (list) list.push(s)
    else byCreator.set(key, [s])
  }
  const outliers = new Map<string, CreatorOutlier>()
  for (const s of niche) {
    outliers.set(
      s.id,
      creatorOutlier(s, byCreator.get(s.secUid || s.author) ?? [], {
        now,
        cohort: niche,
        projectedViews: breakouts.get(s.id)?.projection?.views24h,
        cfg,
      }),
    )
  }
  const outlierRatios = new Map([...outliers].map(([id, o]) => [id, o.ratio]))

  const sounds = soundMomentum(soundSnapshots ?? [], niche, now, { outlierRatios, cfg })
  const tagScores = hashtagMomentum(niche, seedTags, now, { outlierRatios, cfg })
  const picked = pickTags(tagScores, cfg)
  const opportunities = nicheOpportunity(niche, { now, seedTags, breakouts, outliers, sounds, tags: tagScores, cfg })

  const freshStart = now - hours * HOUR
  const fresh = series.filter((s) => s.createTime >= freshStart && s.createTime <= now)
  const nicheFresh = fresh.filter((s) => nicheIds.has(s.id))
  const cohortRate = (pick: (p: VideoPoint) => number): number | null => {
    const rates = niche
      .map((s) => latestPoint(s))
      .filter((p): p is VideoPoint => p !== null && p.plays > 0)
      .map((p) => pick(p) / p.plays)
    return rates.length ? median(rates) : null
  }
  const cohortShare = cohortRate((p) => p.shares)
  const cohortSave = cohortRate((p) => p.saves)
  const rc = cfg.report.rankClip
  const ranked = nicheFresh
    .map((s) => {
      const b = breakouts.get(s.id) as VideoBreakout
      const o = outliers.get(s.id) as CreatorOutlier
      return { s, b, o, rank: clip(b.score, -rc, rc) + clip(o.robustZ, -rc, rc), fill: false }
    })
    .sort((x, y) => y.rank - x.rank || y.o.ratio - x.o.ratio || x.s.id.localeCompare(y.s.id))
  const picks = diversifyTop(ranked.filter(({ b, o }) => b.flag !== 'NONE' || o.flagged), ranked, (x) => creatorKey(x.s), cfg)
  const topVideos: RadarTopVideo[] = picks
    .map(({ s, b, o, rank, fill }) => {
      const rel = relevanceOf(s)
      const clipped = Math.abs(b.score) > rc || Math.abs(o.robustZ) > rc
      return {
        id: s.id,
        author: s.author,
        desc: s.desc,
        createTime: s.createTime,
        ageH: b.ageH,
        views: b.views,
        relevance: rel,
        rank,
        evidence: evidenceLine(s, b, o, rel, cohortShare, cohortSave),
        breakout: b,
        outlier: o,
        ...(fill ? { diversityFill: true } : {}),
        why: [
          ...(fill ? [`not flagged: listed to show at least ${cfg.report.minCreatorsTop} creators in the top ${cfg.report.diversityWindow}`] : []),
          `${b.flag === 'NONE' ? (fill ? 'unflagged' : 'outlier') : b.flag}${o.flagged ? ` + ${o.band} (${fmtX(o.ratio)} ${o.method === 'creator' ? 'creator' : 'cohort'} median)` : ''}`,
          `rank ${rank.toFixed(2)} = breakout ${b.score.toFixed(2)} + creator z ${fmtZ(o.robustZ)}${clipped ? ` (each clipped to +/-${rc})` : ''}`,
          `views/h ${fmtNum(b.vphNow)}, ${fmtX(b.cohortMultiple)} cohort median, niche relevance ${rel.toFixed(2)}`,
          ...b.why.slice(2),
          ...o.why,
        ],
      }
    })

  const times = [...new Set((videoSnapshots ?? []).map((s) => toSeconds(s?.t)).filter((t) => t > 0))].sort((a, b) => a - b)
  const spanMin = times.length ? (times[times.length - 1] - times[0]) / 60 : 0
  const offNiche = series.length - niche.length
  const stats = {
    videos: series.length,
    fresh: fresh.length,
    relevant: niche.length,
    relevantFresh: nicheFresh.length,
    offNiche,
    creators: new Set(series.map((s) => s.secUid || s.author)).size,
    snapshotSpanMin: Math.round(spanMin * 10) / 10,
    snapshotTimes: times.length,
  }

  const caveats: string[] = []
  const r = cfg.report
  if (!series.length) caveats.push('No video snapshots: nothing to score.')
  if (times.length < 2) {
    caveats.push('Only one snapshot: views/hour is each video\'s lifetime average, and acceleration and breakout flags cannot be measured yet.')
  } else if (spanMin < r.minSnapshotSpanMin) {
    caveats.push(`Snapshots span only ${Math.round(spanMin)} min (< ${r.minSnapshotSpanMin} min): velocity and acceleration are noisy.`)
  }
  if (offNiche > 0) {
    caveats.push(
      `${offNiche} of ${series.length} videos (${fmtPct(offNiche / series.length)}) scored below niche relevance ${cfg.relevance.min} ` +
        '(off-niche search/creator results): excluded from top videos, tags, sounds and opportunities; kept only as creator baselines.',
    )
  }
  if (series.length && series.length < r.minCohort) {
    caveats.push(`Only ${series.length} niche videos (< ${r.minCohort}): percentiles and robust z-scores are unreliable.`)
  } else if (niche.length) {
    const thin = [...breakouts.values()].filter((b) => b.cohortSize < r.minCohort).length
    if (thin > niche.length / 2) caveats.push(`${thin} of ${niche.length} relevant videos sit in age cohorts smaller than ${r.minCohort}: cohort comparisons are rough.`)
  }
  if (series.length && nicheFresh.length < r.minFresh) caveats.push(`Only ${nicheFresh.length} relevant videos posted in the last ${hours}h.`)
  const creatorBaselines = [...outliers.values()].filter((o) => o.method === 'creator').length
  if (series.length && creatorBaselines === 0) {
    caveats.push('No creator has 5+ videos older than 7 days in the sample: outliers are judged against the niche cohort, not creator baselines.')
  }
  const soundTimes = [...new Set((soundSnapshots ?? []).map((s) => toSeconds(s?.t)).filter((t) => t > 0))].sort((a, b) => a - b)
  const soundSpanH = soundTimes.length ? (soundTimes[soundTimes.length - 1] - soundTimes[0]) / HOUR : 0
  if (!soundTimes.length) caveats.push('No sound snapshots: sound phases are UNKNOWN; only niche usage is measured (every sound is usage-only evidence).')
  else if (soundTimes.length < 2 || soundSpanH < cfg.sound.minSpanH) caveats.push('Sound snapshots cover less than 1h: sound phases are UNKNOWN.')
  else if (soundSpanH < 24) caveats.push(`Sound snapshots span ${soundSpanH.toFixed(1)}h: 24h growth is extrapolated from that window.`)
  if (seedTags.length && niche.length && seedCoverage(niche, seedTags) >= cfg.tags.pmiDegenerateCoverage) {
    caveats.push('Nearly every video carries a seed tag (sampled by hashtag), so PMI with the seed says little about relevance.')
  }
  caveats.push('All weights and thresholds are uncalibrated research priors; recalibrate after ~2 weeks of labelled snapshots.')

  return {
    niche: options.niche,
    generatedAt: now,
    topVideos,
    sounds: sounds.slice(0, r.soundsLimit),
    tags: { scores: tagScores, picked },
    opportunities: opportunities.slice(0, r.opportunitiesLimit),
    stats,
    caveats,
  }
}
