import { describe, expect, it } from 'vitest'
import type { BrainSourceMetric } from '@/types/brain'
import { summarizeTrends, TREND_WINDOW_DAYS, windowStart } from './sourceTrends'

function metric(platform: string, name: string, value: number, percentile: number, day: string): BrainSourceMetric {
  return { id: `${platform}-${name}-${day}`, scopeId: 'client-a', platform, metric: name, value, percentile, observedAt: `${day}T00:00:00.000Z` }
}

describe('summarizeTrends', () => {
  it('collapses a repeated metric to its latest observation', () => {
    // The reviewed bug: a metric recorded daily rendered one card per day, so
    // an 11-week-old spike sat at the top of "Source-relative momentum".
    const series = Array.from({ length: 90 }, (_, index) =>
      metric('linkedin', 'support momentum', index === 0 ? 100 : 1, index === 0 ? 1 : 0.05, `2026-06-${String((index % 28) + 1).padStart(2, '0')}`))
    const trends = summarizeTrends(series)
    expect(trends).toHaveLength(1)
    expect(trends[0].observations).toBeGreaterThan(1)
  })

  it('ranks a rising metric above a collapsing one', () => {
    const rising = [
      metric('linkedin', 'rising', 1, 0.1, '2026-08-01'),
      metric('linkedin', 'rising', 5, 0.5, '2026-08-15'),
      metric('linkedin', 'rising', 20, 0.9, '2026-09-05'),
    ]
    const collapsing = [
      metric('whatsapp', 'collapsing', 20, 0.9, '2026-08-01'),
      metric('whatsapp', 'collapsing', 5, 0.5, '2026-08-15'),
      metric('whatsapp', 'collapsing', 1, 0.1, '2026-09-05'),
    ]
    const trends = summarizeTrends([...collapsing, ...rising])
    expect(trends.map(trend => trend.metric)).toEqual(['rising', 'collapsing'])
    expect(trends[0].delta).toBeGreaterThan(0)
    expect(trends[1].delta).toBeLessThan(0)
    // Momentum is the latest value's rank inside its OWN series, never a raw
    // cross-platform comparison: both series span the same values.
    expect(trends[0].momentum).toBeGreaterThan(trends[1].momentum)
  })

  it('never compares values across platforms', () => {
    // A tiny WhatsApp series at the top of its own range must not be buried by
    // a large LinkedIn series that happens to use bigger raw numbers.
    const trends = summarizeTrends([
      metric('whatsapp', 'unread', 1, 0.2, '2026-08-01'),
      metric('whatsapp', 'unread', 9, 0.9, '2026-09-05'),
      metric('linkedin', 'reach', 5000, 0.9, '2026-08-01'),
      metric('linkedin', 'reach', 1000, 0.2, '2026-09-05'),
    ])
    expect(trends[0].platform).toBe('whatsapp')
  })

  it('keeps a single observation honest', () => {
    const trends = summarizeTrends([metric('linkedin', 'solo', 7, 0.7, '2026-09-05')])
    expect(trends).toEqual([expect.objectContaining({ observations: 1, momentum: 0, delta: 0, percentile: 0.7 })])
  })

  it('reports an empty window as no trends', () => {
    expect(summarizeTrends([])).toEqual([])
  })
})

describe('windowStart', () => {
  it('is an ISO instant TREND_WINDOW_DAYS before now', () => {
    const start = Date.parse(windowStart(TREND_WINDOW_DAYS, new Date('2026-09-12T00:00:00.000Z')))
    expect(new Date(start).toISOString()).toBe('2026-08-13T00:00:00.000Z')
  })
})
