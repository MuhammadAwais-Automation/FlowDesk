import { describe, expect, it } from 'vitest'
import { scoreNiche, timingFit, weeksUntil, type PinSide } from './pinFactoryScore'

const now = new Date('2026-10-06T00:00:00Z')
const pin = (o: Partial<PinSide> = {}): PinSide => ({
  keywords: Array.from({ length: 12 }, (_, i) => `k${i}`), pinsScanned: 100, medianSaves: 1000, withLinkShare: 0.5,
  topPins: [{ createdAt: '2026-08-01T00:00:00Z' }, { createdAt: '2020-01-01T00:00:00Z' }],
  topDomains: [{ domain: 'etsy.com', pins: 10 }, { domain: 'example.com', pins: 5 }], trendMatches: [], ...o,
})

describe('weeksUntil / timingFit', () => {
  it('counts to the next occurrence of a month-day peak', () => {
    expect(weeksUntil('12-25', now)).toBeCloseTo(11.4, 1)
    expect(weeksUntil('02-14', now)).toBeGreaterThan(18)
    expect(weeksUntil('2026-10-20', now)).toBe(2)
    expect(weeksUntil('Dec 25', now)).toBeNull()
  })
  it('prefers 4-10 weeks ahead', () => {
    expect(timingFit(6)).toBe(1)
    expect(timingFit(2)).toBe(0.5)
    expect(timingFit(15)).toBe(0.5)
    expect(timingFit(30)).toBe(0)
    expect(timingFit(null)).toBeNull()
  })
})

describe('scoreNiche', () => {
  it('rewards demand, shop links and buyer proof', () => {
    const weak = scoreNiche(pin({ medianSaves: 10, withLinkShare: 0, topDomains: [] }), { total: 90000, products: [{ price: 2, ratings: 0 }] }, { now })
    const strong = scoreNiche(pin({ medianSaves: 20000 }), { total: 400, products: [{ price: 15, ratings: 300 }, { price: 9, ratings: 50 }] }, { now })
    expect(strong.score).toBeGreaterThan(weak.score)
    expect(strong.score).toBeLessThanOrEqual(100)
    expect(strong.facts).toMatchObject({ gumroadProducts: 400, gumroadMedianPrice: 12, gumroadRatings: 350, recentTopPins: '1/2', shopPinsShare: 0.1 })
  })
  it('scores without market data or a peak on the parts it has', () => {
    const s = scoreNiche(pin(), null, { now })
    expect(s.parts).not.toHaveProperty('price')
    expect(s.parts).not.toHaveProperty('timing')
    expect(s.score).toBeGreaterThan(0)
  })
  it('adds timing only when a peak is given', () => {
    const s = scoreNiche(pin(), null, { now, peak: '11-26' })
    expect(s.parts.timing).toBe(10)
    expect(s.facts.weeksToPeak).toBeCloseTo(7.3, 1)
  })
})
