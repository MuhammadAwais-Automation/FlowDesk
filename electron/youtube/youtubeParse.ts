/**
 * Pure helpers for YouTube's page text: counts, ages, lengths, the search
 * filter parameter, and the outlier arithmetic. No Electron, so all testable.
 */

/** "620,461 views", "620K", "1.2M views", "516", "No views" -> a number; null when unreadable. */
export function parseCount(text: unknown): number | null {
  const s = String(text ?? '').replace(/ /g, ' ').trim()
  if (!s) return null
  if (/^no\b/i.test(s)) return 0
  const m = s.match(/([\d][\d,.]*)\s*([KMB])?/i)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return Math.round(n * mult)
}

const AGE_UNITS: [RegExp, number][] = [
  [/^(s|sec|secs|second|seconds)$/, 1],
  [/^(m|min|mins|minute|minutes)$/, 60],
  [/^(h|hr|hrs|hour|hours)$/, 3600],
  [/^(d|day|days)$/, 86400],
  [/^(w|wk|wks|week|weeks)$/, 7 * 86400],
  [/^(mo|mos|month|months)$/, 30 * 86400],
  [/^(y|yr|yrs|year|years)$/, 365 * 86400],
]

/** "2d ago", "1mo ago", "3 weeks ago", "Streamed 1 year ago" -> seconds; null when unreadable. */
export function parseAgo(text: unknown): number | null {
  const m = String(text ?? '').toLowerCase().match(/(\d+)\s*([a-z]+)\s+ago/)
  if (!m) return null
  const unit = AGE_UNITS.find(([re]) => re.test(m[2]))
  return unit ? Number(m[1]) * unit[1] : null
}

/** "9:29" -> 569, "1:02:03" -> 3723; null when unreadable. */
export function parseLength(text: unknown): number | null {
  const s = String(text ?? '').trim()
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return null
  return s.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
}

export const SEARCH_TYPES = { video: 1, channel: 2, playlist: 3, short: 9 } as const
export const SEARCH_UPLOADED = { hour: 1, today: 2, week: 3, month: 4, year: 5 } as const
export const SEARCH_DURATIONS = { under3: 4, '3to20': 5, over20: 2 } as const
export const SEARCH_SORTS = { relevance: 0, popularity: 3 } as const

export interface SearchFilters {
  type?: keyof typeof SEARCH_TYPES
  uploaded?: keyof typeof SEARCH_UPLOADED
  duration?: keyof typeof SEARCH_DURATIONS
  sort?: keyof typeof SEARCH_SORTS
}

/**
 * The `sp` search parameter. It is a small protobuf: field 1 = sort, field 2 =
 * a message of filters (1 = upload date, 2 = type, 3 = duration). Every value
 * here was read off YouTube's own filter menu (2026-10-16): "Videos" is
 * EgIQAQ==, "This week" EgIIAw==, "Under 3 minutes" EgIYBA==, "Popularity" CAM=.
 */
export function encodeSearchParams(f: SearchFilters): string | null {
  const inner: number[] = []
  if (f.uploaded) inner.push(0x08, SEARCH_UPLOADED[f.uploaded])
  if (f.type) inner.push(0x10, SEARCH_TYPES[f.type])
  if (f.duration) inner.push(0x18, SEARCH_DURATIONS[f.duration])
  const bytes: number[] = []
  const sort = f.sort ? SEARCH_SORTS[f.sort] : 0
  if (sort) bytes.push(0x08, sort)
  if (inner.length) bytes.push(0x12, inner.length, ...inner)
  if (!bytes.length) return null
  return Buffer.from(bytes).toString('base64')
}

export function median(values: number[]): number | null {
  const v = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** How many times a channel's typical (median) views a video got, to one decimal. */
export function outlierScore(views: number | null, channelMedian: number | null): number | null {
  if (views == null || !channelMedian) return null
  return Math.round((views / channelMedian) * 10) / 10
}

/** Views per day since upload, for comparing old and new videos fairly. */
export function viewsPerDay(views: number | null, ageSeconds: number | null): number | null {
  if (views == null || ageSeconds == null) return null
  return Math.round(views / Math.max(ageSeconds / 86400, 1))
}

/** "@handle", "https://www.youtube.com/@handle/videos", ".../channel/UC…", "UC…" -> the channel's base URL. */
export function channelBaseUrl(input: string): string | null {
  const s = String(input ?? '').trim()
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return `https://www.youtube.com/channel/${s}`
  if (/^@[\w.-]{3,}$/.test(s)) return `https://www.youtube.com/${s}`
  try {
    const u = new URL(s)
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null
    const m = u.pathname.match(/^\/(@[^/]+|channel\/UC[A-Za-z0-9_-]{22}|c\/[^/]+|user\/[^/]+)/)
    return m ? `https://www.youtube.com/${decodeURIComponent(m[1])}` : null
  } catch {
    return null
  }
}
