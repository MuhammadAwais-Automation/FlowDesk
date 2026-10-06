/**
 * Pin Factory niche score: one number per candidate niche, from what Pinterest
 * and Gumroad Discover show right now, with every part reported so the ranking
 * can be checked rather than trusted.
 *
 * The weights follow the usual Pinterest research method (demand from saves and
 * autocomplete breadth, buyer intent from outbound shop links, room for new
 * pins from how recent the ranking pins are, seasonal content published 4-10
 * weeks before its peak) and a digital-product view of the market (proof that
 * people buy, how crowded it is, what it sells for). It is a heuristic: a
 * ranking aid, not a forecast.
 */

export interface PinSide {
  keywords: string[]
  pinsScanned: number
  medianSaves: number | null
  withLinkShare: number | null
  topPins: { createdAt?: string | null }[]
  topDomains: { domain: string; pins: number }[]
  trendMatches: unknown[]
}

export interface MarketSide {
  total: number | null
  products: { price: number | null; ratings: number | null }[]
}

const SHOPS = /(^|\.)(etsy\.com|gumroad\.com|amazon\.[a-z.]+|amzn\.to|shopify\.com|myshopify\.com|teacherspayteachers\.com|creativemarket\.com|payhip\.com|stan\.store)$/

const clamp = (n: number) => Math.max(0, Math.min(1, n))
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Weeks from now until the next occurrence of the peak date (MM-DD, or a full YYYY-MM-DD). */
export function weeksUntil(peak: string, now: Date): number | null {
  const m = peak.match(/^(?:(\d{4})-)?(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = m[1] ? Number(m[1]) : now.getUTCFullYear()
  let d = Date.UTC(year, Number(m[2]) - 1, Number(m[3]))
  if (!m[1] && d < now.getTime()) d = Date.UTC(year + 1, Number(m[2]) - 1, Number(m[3]))
  return Math.round(((d - now.getTime()) / (7 * 864e5)) * 10) / 10
}

/** 1 inside the 4-10 week window before a peak, fading to 0 by 0 and by 20 weeks. */
export function timingFit(weeks: number | null): number | null {
  if (weeks === null) return null
  if (weeks < 0) return 0
  if (weeks < 4) return weeks / 4
  if (weeks <= 10) return 1
  return clamp(1 - (weeks - 10) / 10)
}

export interface NicheScore {
  score: number
  parts: Record<string, number>
  facts: Record<string, number | string | null>
}

export function scoreNiche(pin: PinSide, market: MarketSide | null, o: { now: Date; peak?: string | null }): NicheScore {
  const year = 365 * 864e5
  const recent = pin.topPins.filter(p => p.createdAt && o.now.getTime() - Date.parse(p.createdAt) < year).length
  const shopPins = pin.topDomains.filter(d => SHOPS.test(d.domain)).reduce((n, d) => n + d.pins, 0)
  const prices = (market?.products ?? []).map(p => p.price).filter((n): n is number => n !== null && n > 0)
  const ratings = (market?.products ?? []).reduce((n, p) => n + (p.ratings ?? 0), 0)
  const medPrice = median(prices)
  const weeks = o.peak ? weeksUntil(o.peak, o.now) : null
  const timing = timingFit(weeks)

  // Each part is 0..1 times its weight: 70 from Pinterest, 30 from the market, 10 for timing.
  const parts: Record<string, number> = {
    demand: 30 * clamp(Math.log10((pin.medianSaves ?? 0) + 1) / 4.5),
    breadth: 10 * clamp(pin.keywords.length / 12),
    buyerIntent: 15 * clamp(0.5 * (pin.withLinkShare ?? 0) + 0.5 * clamp((shopPins / Math.max(1, pin.pinsScanned)) * 5)),
    freshness: 10 * (pin.topPins.length ? recent / pin.topPins.length : 0),
    trending: pin.trendMatches.length ? 5 : 0,
  }
  if (market) {
    parts.marketProof = 15 * clamp(Math.log10(ratings + 1) / 3)
    parts.roomToEnter = 5 * (market.total === null ? 0.5 : 1 - clamp(Math.log10(market.total + 1) / 5))
    parts.price = 10 * clamp((medPrice ?? 0) / 20)
  }
  if (timing !== null) parts.timing = 10 * timing
  const max = 70 + (market ? 30 : 0) + (timing !== null ? 10 : 0)
  const raw = Object.values(parts).reduce((a, b) => a + b, 0)
  for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 10) / 10
  return {
    score: Math.round((raw / max) * 100),
    parts,
    facts: {
      medianSaves: pin.medianSaves, keywords: pin.keywords.length, linkShare: pin.withLinkShare,
      shopPinsShare: pin.pinsScanned ? Math.round((shopPins / pin.pinsScanned) * 100) / 100 : null,
      recentTopPins: `${recent}/${pin.topPins.length}`, trendMatches: pin.trendMatches.length,
      gumroadProducts: market?.total ?? null, gumroadMedianPrice: medPrice, gumroadRatings: market ? ratings : null,
      weeksToPeak: weeks,
    },
  }
}
