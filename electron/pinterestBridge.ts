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
