/**
 * Pin Factory, research stage: ranks candidate niches by running Pinterest
 * niche research and a Gumroad Discover search for each, then scoring them
 * (pinFactoryScore.ts). Read-only on both sites.
 */
import { gumroadSearch } from './gumroad'
import { pinterestNicheResearch } from './pinterest'
import { scoreNiche, type MarketSide, type PinSide } from './pinFactoryScore'

export interface NicheCandidate {
  niche: string
  /** Next seasonal peak, MM-DD or YYYY-MM-DD (e.g. "12-25"). */
  peak?: string | null
  /** What to search on Gumroad when it differs from the niche phrase. */
  productQuery?: string | null
}

const MAX_CANDIDATES = 12

function checkCandidates(v: unknown): NicheCandidate[] {
  if (!Array.isArray(v) || !v.length) throw new Error('candidates must be a non-empty list of niches')
  if (v.length > MAX_CANDIDATES) throw new Error(`at most ${MAX_CANDIDATES} candidates per scan`)
  return v.map(c => {
    const o = typeof c === 'string' ? { niche: c } : (c && typeof c === 'object' ? c as Record<string, unknown> : {})
    const niche = typeof o.niche === 'string' ? o.niche.trim().slice(0, 100) : ''
    if (!niche) throw new Error('every candidate needs a niche')
    const peak = typeof o.peak === 'string' && o.peak.trim() ? o.peak.trim() : null
    if (peak && !/^(\d{4}-)?\d{2}-\d{2}$/.test(peak)) throw new Error(`invalid peak "${peak}" — MM-DD or YYYY-MM-DD`)
    const productQuery = typeof o.productQuery === 'string' && o.productQuery.trim() ? o.productQuery.trim().slice(0, 100) : null
    return { niche, peak, productQuery }
  })
}

export async function pinFactoryNicheScan(o: {
  candidates?: unknown; country?: unknown; account?: string; gumroadAccount?: string
} = {}): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  let candidates: NicheCandidate[]
  try { candidates = checkCandidates(o.candidates) } catch (e) { return { ok: false, error: (e as Error).message } }
  const now = new Date()
  const ranked: { score: number; [k: string]: unknown }[] = []
  const failed: { niche: string; error: string }[] = []
  for (const c of candidates) {
    const pin = await pinterestNicheResearch({ niche: c.niche, country: o.country, queries: 2, account: o.account })
    if (!pin.ok) {
      failed.push({ niche: c.niche, error: String(pin.error) })
      // Every candidate would fail the same way (signed out, bad country): stop early.
      if (/sign|country|Trends has no data/i.test(String(pin.error))) break
      continue
    }
    const gum = await gumroadSearch({ query: c.productQuery ?? c.niche, limit: 20, account: o.gumroadAccount })
    const market: MarketSide | null = gum.ok ? { total: gum.total as number | null, products: gum.products as MarketSide['products'] } : null
    const s = scoreNiche(pin as unknown as PinSide, market, { now, peak: c.peak })
    const top = (pin.outliers as { url?: string; title?: string | null; saves?: number | null }[] | undefined)?.[0]
    ranked.push({
      niche: c.niche, ...s,
      keywords: (pin.keywords as string[]).slice(0, 8),
      gumroadTopTags: gum.ok ? (gum.topTags as { tag: string }[]).slice(0, 6).map(t => t.tag) : [],
      topOutlier: top ? { url: top.url, title: top.title ?? null, saves: top.saves ?? null } : null,
      ...(gum.ok ? {} : { gumroadError: gum.error }),
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return { ok: ranked.length > 0, ...(ranked.length ? {} : { error: failed[0]?.error ?? 'nothing scanned' }), country: o.country ?? 'US', ranked, failed }
}
