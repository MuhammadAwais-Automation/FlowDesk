/**
 * Pinterest read requests and the mapping of their answers.
 *
 * Wire format captured from the page's own XHRs (probes/pin-05..07): every read
 * is GET /resource/<Name>/get/?source_url=…&data={"options":…,"context":{}}
 * with the X-App-Version / X-Pinterest-* headers the web app sends. Without
 * them Pinterest answers "Invalid Request". Answers are
 * { resource_response: { code, message, data, bookmark } }; a bookmark of
 * "-end-" (or none) means there is no next page.
 *
 * Signed out, profile/boards/pins/pin/related/typeahead all answer; search
 * comes back empty ("gated") until the account signs in.
 */

export interface ResourceCall {
  resource: string
  options: Record<string, unknown>
  sourceUrl: string
  handler: string
}

export interface ResourceAnswer {
  ok: boolean
  status: number
  code?: number | null
  message?: string | null
  data?: unknown
  bookmark?: string | null
  error?: string
}

const USERNAME = /^[A-Za-z0-9_.-]{1,64}$/
const PIN_ID = /^\d{1,25}$/
const BOARD_ID = /^\d{1,25}$/
const BOARD_URL = /^\/[A-Za-z0-9_.-]{1,64}\/[^/?#\s]{1,200}\/$/

export function checkUsername(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().replace(/^@/, '') : ''
  if (!USERNAME.test(s)) throw new Error(`invalid pinterest username "${String(v)}"`)
  return s
}

export function checkPinId(v: unknown): string {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  const fromUrl = s.match(/\/pin\/(\d{1,25})/)
  const id = fromUrl ? fromUrl[1] : s
  if (!PIN_ID.test(id)) throw new Error(`invalid pin id "${String(v)}" — use the number from a pin URL`)
  return id
}

/** "/user/board/" or a full board URL → "/user/board/". */
export function checkBoardUrl(v: unknown): string {
  let s = typeof v === 'string' ? v.trim() : ''
  try { if (/^https?:\/\//.test(s)) s = new URL(s).pathname } catch { /* checked below */ }
  if (s && !s.startsWith('/')) s = `/${s}`
  if (s && !s.endsWith('/')) s = `${s}/`
  if (!BOARD_URL.test(s) || s.startsWith('/pin/')) throw new Error(`invalid board url "${String(v)}" — expected /username/board-name/`)
  return s
}

export function checkBookmark(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || v.length > 2000 || !/^[A-Za-z0-9+/=_|*-]+$/.test(v)) throw new Error('invalid bookmark — pass the nextBookmark from the previous page unchanged')
  return v
}

export function checkBoardId(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!BOARD_ID.test(s)) throw new Error(`invalid board id "${String(v)}"`)
  return s
}

export function clampLimit(v: unknown, def = 25, max = 50): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && v !== undefined && v !== null && v !== '' ? Math.min(max, Math.max(1, Math.floor(n))) : def
}

export function nextBookmark(b: unknown): string | null {
  return typeof b === 'string' && b && b !== '-end-' ? b : null
}

/** The page script: one GET with the headers the web app itself sends. */
export function resourceGetScript(call: ResourceCall): string {
  return `(async () => {
  const call = ${JSON.stringify(call)}
  const html = document.documentElement.innerHTML
  const appVersion = (html.match(/"appVersion"\\s*:\\s*"([0-9a-f]{6,})"/) || [])[1] || ''
  const q = new URLSearchParams({ source_url: call.sourceUrl, data: JSON.stringify({ options: call.options, context: {} }), _: String(Date.now()) })
  try {
    const r = await fetch('/resource/' + call.resource + '/get/?' + q, { credentials: 'include', headers: {
      'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01',
      'X-App-Version': appVersion, 'X-Pinterest-AppState': 'active',
      'X-Pinterest-Source-Url': call.sourceUrl, 'X-Pinterest-PWS-Handler': call.handler } })
    const t = await r.text()
    let j = null
    try { j = JSON.parse(t) } catch { return { ok: false, status: r.status, error: 'pinterest answered ' + r.status + ': ' + t.slice(0, 80) } }
    const rr = (j && j.resource_response) || {}
    return { ok: r.ok && (rr.code === 0 || rr.code === undefined), status: r.status, code: rr.code ?? null, message: rr.message ?? null, data: rr.data ?? null, bookmark: rr.bookmark ?? null }
  } catch (e) { return { ok: false, status: 0, error: String(e) } }
})()`
}

type Raw = Record<string, unknown>
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export interface PinSummary {
  id: string
  url: string
  title: string | null
  description: string | null
  link: string | null
  image: string | null
  isVideo: boolean
  saves: number | null
  repins: number | null
  comments: number | null
  createdAt: string | null
  pinner: string | null
  board: { name: string | null; url: string | null } | null
}

function bestImage(images: unknown): string | null {
  const im = obj(images)
  for (const k of ['orig', '736x', '564x', '474x', '236x']) {
    const u = str(obj(im[k]).url)
    if (u) return u
  }
  return null
}

export function mapPin(raw: unknown): PinSummary | null {
  const p = obj(raw)
  const id = str(p.id)
  if (p.type !== 'pin' || !id) return null
  const stats = obj(obj(p.aggregated_pin_data).aggregated_stats)
  const board = obj(p.board)
  return {
    id,
    url: `https://www.pinterest.com/pin/${id}/`,
    title: str(p.title) ?? str(p.grid_title),
    description: str(p.description) ?? str(p.closeup_unified_description) ?? str(p.auto_alt_text),
    link: str(p.link),
    image: bestImage(p.images),
    isVideo: !!(p.videos || p.is_video || obj(p.story_pin_data).pages_preview),
    saves: num(stats.saves) ?? num(p.repin_count),
    repins: num(p.repin_count),
    comments: num(p.comment_count),
    createdAt: str(p.created_at),
    pinner: str(obj(p.pinner).username),
    board: Object.keys(board).length ? { name: str(board.name), url: str(board.url) } : null,
  }
}

export function mapPins(data: unknown): PinSummary[] {
  const arr = Array.isArray(data) ? data : Array.isArray(obj(data).results) ? obj(data).results as unknown[] : []
  return arr.map(mapPin).filter((p): p is PinSummary => p !== null)
}

export interface BoardSummary {
  id: string
  name: string | null
  url: string | null
  pinCount: number | null
  followers: number | null
  sections: number | null
  privacy: string | null
  owner: string | null
  cover: string | null
}

export function mapBoards(data: unknown): BoardSummary[] {
  const arr = Array.isArray(data) ? data : []
  return arr.map(b => obj(b)).filter(b => b.type === 'board' && str(b.id)).map(b => ({
    id: b.id as string,
    name: str(b.name),
    url: str(b.url) ? `https://www.pinterest.com${b.url}` : null,
    pinCount: num(b.pin_count),
    followers: num(b.follower_count),
    sections: num(b.section_count),
    privacy: str(b.privacy),
    owner: str(obj(b.owner).username),
    cover: str(b.image_cover_hd_url) ?? str(b.image_cover_url),
  }))
}

export interface UserSummary {
  id: string | null
  username: string | null
  fullName: string | null
  about: string | null
  website: string | null
  followers: number | null
  following: number | null
  pins: number | null
  boards: number | null
  monthlyViews: number | null
  isPrivate: boolean
  image: string | null
  url: string | null
}

export function mapUser(data: unknown): UserSummary | null {
  const u = obj(data)
  if (u.type !== 'user') return null
  const username = str(u.username)
  return {
    id: str(u.id),
    username,
    fullName: str(u.full_name),
    about: str(u.about),
    website: str(u.website_url) ?? str(u.domain_url),
    followers: num(u.follower_count),
    following: num(u.following_count),
    pins: num(u.pin_count),
    boards: num(u.board_count),
    monthlyViews: num(u.profile_views),
    isPrivate: u.is_private_profile === true,
    image: str(u.image_xlarge_url) ?? str(u.image_large_url) ?? str(u.image_medium_url),
    url: username ? `https://www.pinterest.com/${username}/` : null,
  }
}

export function mapSuggestions(data: unknown): { query: string; type: string | null }[] {
  const items = obj(data).items
  return (Array.isArray(items) ? items : []).map(i => obj(i))
    .map(i => ({ query: str(i.query) ?? str(i.label) ?? '', type: str(i.type) }))
    .filter(i => i.query)
}

/** Pins with at least `minMultiplier`× the median saves of the set — what took off. */
export function pinOutliers(pins: PinSummary[], minMultiplier: number): (PinSummary & { multiplier: number })[] {
  const saves = pins.map(p => p.saves).filter((n): n is number => n !== null).sort((a, b) => a - b)
  if (!saves.length) return []
  const mid = Math.floor(saves.length / 2)
  const median = saves.length % 2 ? saves[mid] : (saves[mid - 1] + saves[mid]) / 2
  const base = Math.max(1, median)
  return pins
    .filter(p => p.saves !== null && p.saves / base >= minMultiplier)
    .map(p => ({ ...p, multiplier: Math.round(((p.saves as number) / base) * 10) / 10 }))
    .sort((a, b) => b.multiplier - a.multiplier)
}

// ── Signed-in reads (probes/pin-40..42, business hub, 2026-10-05) ────────────
// All go through ApiResource (a proxy to Pinterest's /v3 API) or a named
// resource, with the business hub as source page.

export const HUB = { sourceUrl: '/business/hub/', handler: 'www/business/hub.js' } as const

/** Pinterest Trends' four lists, in the order of its own dropdown. */
export const TREND_TYPES = { monthly: 1, yearly: 2, growing: 3, seasonal: 4 } as const
export type TrendType = keyof typeof TREND_TYPES

export function checkTrendType(v: unknown): TrendType {
  if (v === undefined || v === null || v === '') return 'monthly'
  if (typeof v === 'string' && v in TREND_TYPES) return v as TrendType
  throw new Error(`invalid trend type — use one of ${Object.keys(TREND_TYPES).join(', ')}`)
}

export function checkCountry(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'US'
  if (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim())) return v.trim().toUpperCase()
  throw new Error('invalid country — use a two-letter code such as US or GB')
}

export interface TrendTerm {
  term: string
  /** Search volume relative to the top term of the list (100). */
  volume: number | null
  /** % change week/month/year over; 10001 means the term is new. */
  weekChange: number | null
  monthChange: number | null
  yearChange: number | null
  seasonality: number | null
}

export function mapTrends(data: unknown): { date: string | null; terms: TrendTerm[] } {
  const d = obj(data)
  const values = Array.isArray(d.values) ? d.values : []
  const pct = (v: unknown) => num(obj(v).roundedPercentChange)
  return {
    date: str(d.date),
    terms: values.map(v => obj(v)).filter(v => str(v.term)).map(v => ({
      term: v.term as string,
      volume: num(v.normalizedCount),
      weekChange: pct(v.wow_change),
      monthChange: pct(v.mom_change),
      yearChange: pct(v.yoy_change),
      seasonality: num(v.seasonality_score),
    })),
  }
}

export interface MeSummary { id: string | null; username: string | null; isBusiness: boolean; followers: number | null; pins: number | null; boards: number | null }

export function mapMe(data: unknown): MeSummary | null {
  const u = obj(data)
  if (!str(u.id)) return null
  return { id: str(u.id), username: str(u.username), isBusiness: u.is_partner === true, followers: num(u.follower_count), pins: num(u.pin_count), boards: num(u.board_count) }
}

const named = (v: unknown) => (Array.isArray(v) ? v : []).map(x => obj(x))
  .filter(x => str(x.name)).map(x => ({ name: x.name as string, value: num(x.value) }))
  .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
const numbers = (v: unknown) => Object.fromEntries(Object.entries(obj(v)).filter(([, n]) => num(n) !== null))

export function mapAudience(data: unknown) {
  const a = obj(Array.isArray(data) ? data[0] : data)
  if (!Object.keys(a).length) return null
  const interests = Object.entries(obj(a.interestsMap)).flatMap(([category, list]) =>
    named(list).map(i => ({ category, ...i }))).sort((x, y) => (y.value ?? 0) - (x.value ?? 0))
  return {
    scope: str(a.targetAudienceScope),
    type: str(a.targetAudienceType),
    size: num(obj(a.pinnerCount).value),
    ages: numbers(a.ages),
    genders: numbers(a.genders),
    devices: numbers(a.devices),
    categories: named(a.categories),
    metros: named(a.metros),
    countries: named(a.countries),
    topInterests: interests.slice(0, 25),
  }
}

export interface ConversationSummary {
  id: string
  unread: number | null
  with: string[]
  lastMessage: { text: string | null; from: string | null; at: string | null } | null
}

export function mapConversations(data: unknown): ConversationSummary[] {
  return records(data).filter(c => c.type === 'conversation' && str(c.id)).map(c => {
    const m = obj(c.last_message)
    return {
      id: c.id as string,
      unread: num(c.unread),
      with: records(c.users).map(u => str(u.username)).filter((u): u is string => !!u),
      lastMessage: Object.keys(m).length ? { text: str(m.text), from: str(obj(m.sender).username), at: str(m.created_at) } : null,
    }
  })
}
function records(v: unknown): Raw[] { return (Array.isArray(v) ? v : []).map(x => obj(x)) }

// ── Niche research ───────────────────────────────────────────────────────────

const STOP = new Set('a an and are as at be by for from how i in is it its my of on or our the this to with you your diy ideas idea'.split(' '))

export function words(text: string | null): string[] {
  return (text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
}

function domainOf(link: string | null): string | null {
  if (!link) return null
  try { return new URL(link).hostname.replace(/^www\./, '') } catch { return null }
}

function median(ns: number[]): number | null {
  if (!ns.length) return null
  const s = [...ns].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const top = <T>(m: Map<string, T>, score: (v: T) => number, n: number) =>
  [...m.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, n)

/** Trend terms that contain every word of the niche (keywords add noise: "aesthetic" matched "fall aesthetic"). */
export function matchTrends(niche: string, lists: Partial<Record<string, TrendTerm[]>>) {
  const want = words(niche)
  return Object.entries(lists).flatMap(([list, terms]) =>
    (terms ?? []).filter(t => { const have = new Set(words(t.term)); return want.length > 0 && want.every(w => have.has(w)) }).map(t => ({ list, ...t })))
}

export function nicheReport(pins: PinSummary[]) {
  const seen = new Set<string>()
  const uniq = pins.filter(p => !seen.has(p.id) && seen.add(p.id))
  const saves = uniq.map(p => p.saves).filter((n): n is number => n !== null)
  const creators = new Map<string, { pins: number; saves: number }>()
  const domains = new Map<string, { pins: number; saves: number }>()
  const terms = new Map<string, number>()
  for (const p of uniq) {
    const s = p.saves ?? 0
    if (p.pinner) { const c = creators.get(p.pinner) ?? { pins: 0, saves: 0 }; c.pins++; c.saves += s; creators.set(p.pinner, c) }
    const d = domainOf(p.link)
    if (d && d !== 'pinterest.com') { const c = domains.get(d) ?? { pins: 0, saves: 0 }; c.pins++; c.saves += s; domains.set(d, c) }
    for (const w of new Set(words(`${p.title ?? ''} ${p.description ?? ''}`))) terms.set(w, (terms.get(w) ?? 0) + 1)
  }
  return {
    pinsScanned: uniq.length,
    medianSaves: median(saves),
    videoShare: uniq.length ? Math.round((uniq.filter(p => p.isVideo).length / uniq.length) * 100) / 100 : null,
    withLinkShare: uniq.length ? Math.round((uniq.filter(p => domainOf(p.link)).length / uniq.length) * 100) / 100 : null,
    topPins: [...uniq].sort((a, b) => (b.saves ?? 0) - (a.saves ?? 0)).slice(0, 10),
    outliers: pinOutliers(uniq, 3).slice(0, 10),
    topCreators: top(creators, c => c.saves, 10).map(([username, c]) => ({ username, ...c })),
    topDomains: top(domains, c => c.pins, 10).map(([domain, c]) => ({ domain, ...c })),
    topWords: top(terms, n => n, 25).map(([word, pins]) => ({ word, pins })),
  }
}

// ── Writes (captured 2026-10-05: probes/out/_network-pinterest-com.json) ─────
// POST /resource/<Name>/<create|update|delete>/ with a form body of
// source_url + data={"options":…,"context":{}} and the page's csrftoken cookie
// as X-CSRFToken. Every write needs the user's explicit yes before it runs.

export type WriteAction = 'create' | 'update' | 'delete'
export interface WriteCall extends ResourceCall { action: WriteAction }

const PAGE_HELPERS = String.raw`
  const html = document.documentElement.innerHTML
  const appVersion = (html.match(/"appVersion"\s*:\s*"([0-9a-f]{6,})"/) || [])[1] || ''
  const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || ''
  const headers = (src, handler) => ({
    'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01',
    'X-App-Version': appVersion, 'X-Pinterest-AppState': 'active', 'X-CSRFToken': csrf,
    'X-Pinterest-Source-Url': src, 'X-Pinterest-PWS-Handler': handler })
  const answer = async r => {
    const t = await r.text()
    let j = null
    try { j = JSON.parse(t) } catch { return { ok: false, status: r.status, error: 'pinterest answered ' + r.status + ': ' + t.slice(0, 80) } }
    const rr = (j && j.resource_response) || {}
    const err = rr.error || {}
    return { ok: r.ok && rr.code === 0, status: r.status, code: rr.code ?? null, message: err.message || rr.message || null, endpoint: rr.endpoint_name || null, data: rr.data ?? null }
  }
  const post = async c => {
    const body = new URLSearchParams({ source_url: c.sourceUrl, data: JSON.stringify({ options: c.options, context: {} }) })
    const r = await fetch('/resource/' + c.resource + '/' + c.action + '/', { method: 'POST', credentials: 'include',
      headers: { ...headers(c.sourceUrl, c.handler), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body })
    return answer(r)
  }
  const get = async c => {
    const q = new URLSearchParams({ source_url: c.sourceUrl, data: JSON.stringify({ options: c.options, context: {} }), _: String(Date.now()) })
    return answer(await fetch('/resource/' + c.resource + '/get/?' + q, { credentials: 'include', headers: headers(c.sourceUrl, c.handler) }))
  }
`

export function resourcePostScript(call: WriteCall): string {
  return `(async () => {
  ${PAGE_HELPERS}
  try { return await post(${JSON.stringify(call)}) } catch (e) { return { ok: false, status: 0, error: String(e) } }
})()`
}

const MAX_TITLE = 100
const MAX_DESCRIPTION = 500
const MAX_BOARD_NAME = 50

export function checkText(v: unknown, what: string, max: number, required = false): string {
  const s = typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').trim() : ''
  if (required && !s) throw new Error(`${what} is empty`)
  if (s.length > max) throw new Error(`${what} is longer than ${max} characters`)
  return s
}

export const checkTitle = (v: unknown, required = false) => checkText(v, 'title', MAX_TITLE, required)
export const checkDescription = (v: unknown) => checkText(v, 'description', MAX_DESCRIPTION)
export const checkBoardName = (v: unknown) => checkText(v, 'board name', MAX_BOARD_NAME, true)

export function checkLink(v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v !== 'string') throw new Error('link must be a URL')
  let u: URL
  try { u = new URL(v.trim()) } catch { throw new Error(`invalid link "${v}"`) }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('link must start with http:// or https://')
  return u.toString()
}

/** Unix seconds of a future time; accepts an ISO date string or seconds/ms since 1970. */
export function checkPublishAt(v: unknown, now = Date.now()): number {
  const ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN
  if (!Number.isFinite(ms)) throw new Error('publishAt must be an ISO date (e.g. 2026-10-07T12:00:00Z) or unix time')
  if (ms < now + 15 * 60_000) throw new Error('publishAt must be at least 15 minutes in the future')
  return Math.floor(ms / 1000)
}

export const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface CreatePinPlan {
  boardId: string
  title: string
  description: string
  link: string
  altText: string
  /** Unix seconds; set = scheduled pin instead of publishing now. */
  publishAt: number | null
  image: { base64: string; mime: string; name: string }
}

/**
 * The pin builder's own sequence: register the upload, POST the file to the
 * storage URL Pinterest hands back, wait for /v3/media/uploads/ to report the
 * image signature, then create (/v3/storypins/) or schedule (/v3/scheduledpins/).
 */
export function createPinScript(p: CreatePinPlan): string {
  return `(async () => {
  ${PAGE_HELPERS}
  const p = ${JSON.stringify(p)}
  const src = '/pin-creation-tool/', handler = 'www/pin-creation-tool.js'
  const api = (action, url, data) => post({ resource: 'ApiResource', action, options: { url, data }, sourceUrl: src, handler })
  try {
    const bytes = Uint8Array.from(atob(p.image.base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: p.image.mime })
    const bmp = await createImageBitmap(blob)
    const width = bmp.width, height = bmp.height
    bmp.close()
    const localId = crypto.randomUUID()
    const reg = await api('create', '/v3/media/uploads/register/batch/', { media_info_list: JSON.stringify([{ id: localId, media_type: 'image-story-pin' }]) })
    const slot = reg.ok && reg.data && reg.data[localId]
    if (!slot || !slot.upload_url) return { ...reg, ok: false, step: 'register upload' }
    const form = new FormData()
    for (const [k, v] of Object.entries(slot.upload_parameters || {})) form.append(k, v)
    form.append('file', blob, p.image.name)
    const up = await fetch(slot.upload_url, { method: 'POST', body: form })
    if (!up.ok) return { ok: false, status: up.status, step: 'upload image', error: 'image upload answered ' + up.status }
    let signature = null
    for (let i = 0; i < 20 && !signature; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const st = await get({ resource: 'ApiResource', options: { url: '/v3/media/uploads/', data: { upload_ids: [slot.upload_id] } }, sourceUrl: src, handler })
      const item = st.ok && st.data && st.data[slot.upload_id]
      if (item && item.status === 'failed') return { ok: false, step: 'process image', error: 'pinterest could not process the image (' + (item.failure_code || 'failed') + ')' }
      signature = item && item.signature
    }
    if (!signature) return { ok: false, step: 'process image', error: 'pinterest did not finish processing the image within 30s' }
    const trackingId = String(Date.now()) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
    const storyPin = JSON.stringify({
      metadata: { pin_title: p.title, pin_image_signature: signature, canvas_aspect_ratio: width / height },
      pages: [{ blocks: [{ block_style: { height: 100, width: 100, x_coord: 0, y_coord: 0 }, image_signature: signature, tracking_id: trackingId, type: 2 }],
        clips: [{ clip_type: 0, end_time_ms: -1, is_converted_from_image: false, source_media_height: height, source_media_width: width, start_time_ms: -1 }],
        layout: 0, style: { background_color: '#ffffff' } }],
    })
    if (p.publishAt) {
      const r = await api('update', '/v3/scheduledpins/', { board_id: p.boardId, description: p.description, image_signature: signature,
        is_comments_allowed: true, is_unified_builder: true, source_url: p.link, scheduled_ts: p.publishAt, story_pin: storyPin,
        title: p.title, user_mention_tags: '[]' })
      return { ...r, step: 'schedule pin' }
    }
    const r = await api('create', '/v3/storypins/', { alt_text: p.altText, allow_shopping_rec: true, board_id: p.boardId, description: p.description,
      fields: ['pin.id', 'pin.image_signature', 'pin.image_square_url', 'pin.story_pin_data_id'], is_comments_allowed: true,
      is_unified_builder: true, link: p.link, method: 'uploaded', story_pin: storyPin, user_mention_tags: '[]' })
    return { ...r, step: 'create pin' }
  } catch (e) { return { ok: false, status: 0, error: String(e) } }
})()`
}

export function mapScheduledPins(data: unknown) {
  return (Array.isArray(data) ? data : []).map(x => obj(x)).filter(x => str(x.id)).map(x => ({
    id: x.id as string,
    title: str(x.title),
    description: str(x.description),
    link: str(x.link),
    board: str(obj(x.board).name),
    publishAt: num(x.scheduled_ts) !== null ? new Date((x.scheduled_ts as number) * 1000).toISOString() : null,
  }))
}
