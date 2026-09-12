/**
 * Source-relative trend derivation for the Intelligence Trends tab.
 *
 * -- Why "source-relative" is the whole point --
 *
 * A LinkedIn reach metric counts in thousands; a WhatsApp unread metric counts
 * in single digits. Ranking those against each other by raw value would make
 * the Trends tab a leaderboard of which platform uses bigger numbers. So a
 * metric is only ever compared with its OWN history, and what gets ranked is
 * the resulting normalized position -- never a raw cross-platform value.
 *
 * -- Why the latest observation, not every row --
 *
 * `source_metrics` accumulates one row per observation. Rendering all of them
 * put an eleven-week-old spike at the top of the board while today's row was
 * buried, and made a metric that had been collapsing for a month still display
 * as the strongest trend, because only its historical peak was ranked. A trend
 * is a property of a series, so each platform+metric series collapses to one
 * card describing where it stands now.
 */

// Relative, not the '@' alias: this module is compiled by tsconfig.node.json
// too (the main process re-exports percentileMomentum), and that project has
// no '@' path mapping.
import type { BrainSourceMetric } from '../types/brain'

/** The default Trends window. Named so the UI can say what it applied. */
export const TREND_WINDOW_DAYS = 30

/** The ISO instant `days` before `now` -- the `since` bound for a metrics read. */
export function windowStart(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

export interface SourceTrend {
  id: string
  platform: string
  metric: string
  /** The latest observation in the window. */
  value: number
  percentile: number
  observedAt: string
  /** Where the latest value ranks inside its own series, 0..1. */
  momentum: number
  /** Percentile change across the window; negative means collapsing. */
  delta: number
  observations: number
}

/**
 * Where `value` sits within its peer cohort, 0..1.
 *
 * Shared with the capture processor (`electron/brain/intelligence.ts`
 * re-exports this) so the Trends tab ranks by the same formula that wrote the
 * stored percentiles, rather than inventing a second definition of momentum.
 */
export function percentileMomentum(value: number, peerValues: number[]) {
  const normalized = Math.max(0, Number.isFinite(value) ? value : 0)
  const peers = peerValues.map(peer => Math.max(0, Number.isFinite(peer) ? peer : 0))
  if (normalized === 0 || peers.length < 2 || peers.every(peer => peer === 0)) return 0

  // Percentiles from a two-item cohort are weak evidence. Scale rank confidence
  // up to a five-item cohort so one reaction beside one zero cannot become 100%.
  const below = peers.filter(peer => peer < normalized).length
  const ties = peers.filter(peer => peer === normalized).length
  const rank = (below + Math.max(0, ties - 1) / 2) / Math.max(1, peers.length - 1)
  const cohortConfidence = Math.min(1, (peers.length - 1) / 4)
  return Math.max(0, Math.min(1, rank * cohortConfidence))
}

/**
 * Collapses windowed observations into one ranked trend per platform+metric.
 *
 * The caller owns the window itself (`listSourceMetrics`'s `since`); this only
 * summarises what the window returned, so a metric with a single observation
 * reports zero momentum and zero delta rather than a flattering rank derived
 * from a cohort of one.
 */
export function summarizeTrends(metrics: BrainSourceMetric[]): SourceTrend[] {
  const series = new Map<string, BrainSourceMetric[]>()
  for (const metric of metrics) {
    // JSON rather than a delimiter: platform and metric are free-form strings,
    // so any separator character could appear inside one of them and collide.
    const key = JSON.stringify([metric.platform, metric.metric])
    const bucket = series.get(key)
    if (bucket) bucket.push(metric)
    else series.set(key, [metric])
  }

  return [...series.values()]
    .map(observations => {
      const ordered = [...observations].sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      const latest = ordered[ordered.length - 1]
      const earliest = ordered[0]
      const values = ordered.map(observation => observation.value)
      return {
        id: latest.id,
        platform: latest.platform,
        metric: latest.metric,
        value: latest.value,
        percentile: latest.percentile,
        observedAt: latest.observedAt,
        momentum: percentileMomentum(latest.value, values),
        delta: ordered.length > 1 ? latest.percentile - earliest.percentile : 0,
        observations: ordered.length,
      }
    })
    .sort((left, right) => right.momentum - left.momentum
      || right.delta - left.delta
      || right.observedAt.localeCompare(left.observedAt))
}
