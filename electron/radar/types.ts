/**
 * Data model for the TikTok niche radar.
 *
 * Snapshots are what the collector records each time it looks at the niche.
 * Counts are typed `Count` because TikTok's web payloads sometimes send them
 * as strings ("12345", occasionally "1.2K"); the scoring core normalises them.
 * Timestamps are unix seconds.
 */

export type Count = number | string

export interface SnapshotMusic {
  id: string
  title: string
  original: boolean
}

/** One observation of one video at wall-clock time `t`. */
export interface VideoSnapshot {
  t: number
  id: string
  createTime: number
  author: string
  secUid: string
  followers: Count
  /** Seconds. */
  duration: Count
  music: SnapshotMusic | null
  tags: string[]
  pinned: boolean
  plays: Count
  likes: Count
  comments: Count
  shares: Count
  saves: Count
  /** Caption. Optional: used only to describe the "idea" of an opportunity. */
  desc?: string
}

/** One observation of one sound's total video count at time `t`. */
export interface SoundSnapshot {
  t: number
  id: string
  title: string
  original: boolean
  videoCount: Count
}

export type AgeBucket = '0-1' | '1-2' | '2-4' | '4-8' | '8-24' | '24-48' | '48+'
export type DurationBucket = '<15' | '15-30' | '30-60' | '60-180' | '180+'

/** A normalised point of a video's time series. */
export interface VideoPoint {
  t: number
  ageH: number
  plays: number
  likes: number
  comments: number
  shares: number
  saves: number
}

/** A video with all its snapshots, sorted by `t`, one point per `t`. */
export interface VideoSeries {
  id: string
  createTime: number
  author: string
  secUid: string
  followers: number
  duration: number
  music: SnapshotMusic | null
  tags: string[]
  pinned: boolean
  desc: string
  points: VideoPoint[]
}

export type BreakoutFlag = 'BREAKOUT' | 'WATCH' | 'NONE'

/**
 * How views/hour was measured: 'interval' = over the last snapshot interval;
 * 'lifetime' = views / age hours (single snapshot, or last interval too short).
 */
export type VelocityBasis = 'interval' | 'lifetime'

export interface BreakoutProjection {
  /** Projected views at 24 h (S-H log-linear). */
  views24h: number
  low: number
  high: number
  /** How many past niche videos the beta was fitted on. */
  samples: number
}

/** A: video breakout score. */
export interface VideoBreakout {
  id: string
  author: string
  flag: BreakoutFlag
  score: number
  ageH: number
  ageBucket: AgeBucket
  durationBucket: DurationBucket
  views: number
  vphNow: number
  vphPrev: number
  accel: number
  snapshots: number
  components: {
    levelZ: number
    velZ: number
    shareZ: number
    saveZ: number
    likeZ: number
  }
  cohortSize: number
  cohortMedianViews: number
  /** views / cohort median views. */
  cohortMultiple: number
  projection: BreakoutProjection | null
  /** How the velocity z was measured; the cohort sample uses the same basis. */
  velocityBasis?: VelocityBasis
  /** Cohort videos in the velocity z sample (same basis as the video). */
  velocityCohortSize?: number
  why: string[]
}

export type OutlierBand = 'normal' | 'watch' | 'outlier' | 'strong' | 'major' | 'anomalous'

/** B: creator-relative outlier score. */
export interface CreatorOutlier {
  id: string
  author: string
  /** 'creator' = own history baseline; 'cohort' = niche cohort fallback. */
  method: 'creator' | 'cohort'
  views: number
  /** True when `views` is the S-H projected 24 h count, not the raw count. */
  projected: boolean
  baseline: number
  ratio: number
  robustZ: number
  band: OutlierBand
  flagged: boolean
  /** True for >= 20x: likely external/anomalous, down-weight when learning. */
  downweight: boolean
  historySize: number
  /** Percentile of views in the niche cohort (always computed when a cohort is given). */
  cohortPct: number | null
  /** Percentile of views/follower in the niche cohort. */
  viewsPerFollowerPct: number | null
  why: string[]
}

export type SoundPhase = 'EARLY' | 'PEAKING' | 'SATURATED' | 'UNKNOWN'

/** 'snapshots' = the sound's own video count was observed; 'usage-only' = seen only on niche videos. */
export type SoundEvidence = 'usage-only' | 'snapshots'

/** C: sound momentum. */
export interface SoundMomentum {
  id: string
  title: string
  original: boolean
  phase: SoundPhase
  score: number
  recommend: boolean
  evidence: SoundEvidence
  videoCount: number | null
  snapshots: number
  spanH: number
  /** New videos per hour over the whole available snapshot span. */
  shortRatePerH: number | null
  growth24: number | null
  /** True when growth24 is extrapolated from a span shorter than 24 h. */
  growth24Estimated: boolean
  accel: number | null
  burst: number | null
  nicheVideos48h: number
  nicheShare48h: number | null
  nicheSharePrior: number | null
  nicheLift: number | null
  perfLift: number | null
  saturation: number
  why: string[]
}

/** D: hashtag momentum. */
export interface TagScore {
  tag: string
  isSeed: boolean
  /** Niche videos carrying the tag. */
  count: number
  /** count / niche videos. */
  share: number
  /** Distinct creators among the niche videos carrying the tag. */
  creators: number
  /** Platform-wide tag (fyp, viral, ...) or on too large a share of the niche: broad role only. */
  generic: boolean
  freq24: number
  basePerDay: number
  lift: number
  burst: boolean
  perf: number | null
  perfN: number
  pmi: number
  score: number
  why: string[]
}

export type TagRole = 'core' | 'momentum' | 'broad' | 'fill'

export interface PickedTag {
  tag: string
  role: TagRole
  why: string[]
}

export interface OpportunityIdea {
  videoId: string
  author: string
  desc: string
  ratio: number
}

/** E: a topic cluster and how worth making it is right now. */
export interface OpportunityCluster {
  id: string
  kind: 'sound' | 'tags'
  label: string
  videos: number
  opportunity: number
  recommend: boolean
  demand: number
  hot: number
  momentum: number
  supply: number
  freshness: number
  smallOk: number
  outlierCreators: number
  idea: OpportunityIdea | null
  /** Best example videos (idea first), at most `report.maxPerCreator` per creator. */
  examples?: OpportunityIdea[]
  sound: { id: string; title: string; phase: SoundPhase; original: boolean } | null
  tags: PickedTag[]
  /** UTC hour 0-23 with the best smoothed outlier rate, or null without outliers. */
  bestHour: number | null
  lengthBucket: DurationBucket | null
  why: string[]
}

export interface RadarTopVideo {
  id: string
  author: string
  desc: string
  createTime: number
  ageH: number
  views: number
  /** Niche relevance 0..1 (see nicheRelevance). */
  relevance: number
  /** Combined rank: breakout score + creator outlier robust z (each clipped). */
  rank: number
  /** One compact human line: views, age, views/h, x creator median, share/save vs cohort. */
  evidence: string
  breakout: VideoBreakout
  outlier: CreatorOutlier
  /** True when listed only to reach the creator-diversity minimum, not because it was flagged. */
  diversityFill?: boolean
  why: string[]
}

export interface RadarReportOptions {
  niche: string
  seedTags: string[]
  /** Words matched in captions for niche relevance. Defaults to the seed tags. */
  seedKeywords?: string[]
  /** Unix seconds. */
  now: number
  /** Only videos created within the last `hours` are listed in topVideos. */
  hours: number
}

export interface RadarReport {
  niche: string
  generatedAt: number
  topVideos: RadarTopVideo[]
  sounds: SoundMomentum[]
  tags: { scores: TagScore[]; picked: PickedTag[] }
  opportunities: OpportunityCluster[]
  stats: {
    /** All videos in the sample, relevant or not. */
    videos: number
    /** All videos posted within `hours`. */
    fresh: number
    /** Videos at or above the niche relevance threshold. */
    relevant: number
    /** Relevant videos posted within `hours`. */
    relevantFresh: number
    /** Videos below the relevance threshold: used only as creator baselines. */
    offNiche: number
    creators: number
    snapshotSpanMin: number
    snapshotTimes: number
  }
  caveats: string[]
}
