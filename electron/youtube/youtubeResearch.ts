/**
 * YouTube research tools, read through YouTube's own page in the hidden
 * `social-youtube` view (see youtube.ts). Every request here is one the page
 * itself sends, captured 2026-10-16:
 *   - search: /results?search_query=&sp= renders ytInitialData (videoRenderer,
 *     shortsLockupViewModel); more results with POST /youtubei/v1/search {continuation}
 *   - channel: /@handle/videos|shorts renders lockupViewModel / shortsLockupViewModel;
 *     the Latest/Popular/Oldest chips and further pages are POST /youtubei/v1/browse {continuation}
 *   - comments, Most Replayed, live view count: POST /youtubei/v1/next {videoId}
 *     (frameworkUpdates carries commentEntityPayload and the MARKER_TYPE_HEATMAP list)
 *   - autocomplete: suggestqueries.google.com with ds=yt (no session needed)
 * Views on search results are exact ("620,461 views"); on channel pages they
 * are rounded ("620K"), which each video reports as `viewsApprox`.
 */
import { app, type WebContents } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getYouTubeView, parseVideoId, serialized, sleep, videoDetailOn, type YouTubeResult } from './youtube'
import { whileAwake } from '../keepAwake'
import {
  channelBaseUrl, encodeSearchParams, median, outlierScore, parseAgo, parseCount, parseLength, viewsPerDay,
  SEARCH_DURATIONS, SEARCH_SORTS, SEARCH_TYPES, SEARCH_UPLOADED, type SearchFilters,
} from './youtubeParse'

const HOME = 'https://www.youtube.com/'
const MAX_PAGES = 12

/** Helpers defined inside the page for every script below (raw: regexes keep their backslashes). */
const PAGE = String.raw`
const __H = () => ({ 'content-type': 'application/json', 'x-youtube-client-name': '1', 'x-youtube-client-version': ytcfg.get('INNERTUBE_CLIENT_VERSION') })
const __post = (path, body) => fetch(path + '?prettyPrint=false', { method: 'POST', credentials: 'include', headers: __H(), body: JSON.stringify(Object.assign({ context: ytcfg.get('INNERTUBE_CONTEXT') }, body)) })
  .then(r => { if (!r.ok) throw new Error('YouTube answered ' + r.status + ' for ' + path); return r.json() })
const __t = x => x == null ? null : typeof x === 'string' ? x : (x.simpleText || x.content || (x.runs || []).map(r => r.text).join('') || null)
const __all = (obj, key) => { const out = []; JSON.parse(JSON.stringify(obj || {}), (k, v) => { if (k === key && v && typeof v === 'object') out.push(v); return v }); return out }
const __lastToken = obj => { const m = [...JSON.stringify(obj || {}).matchAll(/"continuationCommand":\{"token":"([^"]+)"/g)]; return m.length ? m[m.length - 1][1] : null }
const __video = v => {
  const run = ((v.ownerText || v.longBylineText || {}).runs || [])[0] || {}
  const be = (run.navigationEndpoint || {}).browseEndpoint || {}
  return { videoId: v.videoId, title: __t(v.title), channel: run.text || null, channelId: be.browseId || null, channelHandle: (be.canonicalBaseUrl || '').replace(/^\//, '') || null,
    viewsText: __t(v.viewCountText), publishedText: __t(v.publishedTimeText), lengthText: __t(v.lengthText),
    snippet: __t(((v.detailedMetadataSnippets || [])[0] || {}).snippetText), isShort: !!(v.navigationEndpoint || {}).reelWatchEndpoint }
}
const __short = v => ({ videoId: ((((v.onTap || {}).innertubeCommand || {}).reelWatchEndpoint) || {}).videoId || null,
  title: ((v.overlayMetadata || {}).primaryText || {}).content || null, viewsText: ((v.overlayMetadata || {}).secondaryText || {}).content || null, isShort: true })
const __lockup = L => {
  const m = (L.metadata || {}).lockupMetadataViewModel || {}
  const rows = ((((m.metadata || {}).contentMetadataViewModel) || {}).metadataRows || []).map(r => (r.metadataParts || []).map(p => (p.text || {}).content))
  const badges = __all(L.contentImage, 'thumbnailBadgeViewModel').map(b => b.text)
  return { videoId: L.contentId, title: (m.title || {}).content || null, viewsText: (rows[0] || [])[0] || null, publishedText: (rows[0] || [])[1] || null, lengthText: badges[0] || null, isShort: false }
}
`

async function run<T>(wc: WebContents, body: string): Promise<T> {
  // Electron reports a page exception only as "Script failed to execute"; carry the real message out.
  const r = await wc.executeJavaScript(`(async () => { try { ${PAGE}\n return { __ok: await (async () => { ${body} })() } } catch (e) { return { __error: String(e && e.message || e) } } })()`, true) as { __ok?: T; __error?: string }
  if (r && typeof r.__error === 'string') throw new Error(`YouTube page: ${r.__error}`)
  return r.__ok as T
}

async function openPage(wc: WebContents, url: string): Promise<boolean> {
  await wc.loadURL(url).catch(() => {})
  for (let i = 0; i < 48; i++) {
    const ready = await wc.executeJavaScript(`!!(window.ytInitialData && window.ytcfg && window.ytcfg.get && ytcfg.get('INNERTUBE_CONTEXT'))`).catch(() => false)
    if (ready) return true
    await sleep(250)
  }
  return false
}

/** Any YouTube page will do for the fetch-only tools: they need the page's session and client context. */
async function ensureYouTube(wc: WebContents): Promise<void> {
  const ok = wc.getURL().startsWith(HOME) && await wc.executeJavaScript(`!!(window.ytcfg && ytcfg.get && ytcfg.get('INNERTUBE_CONTEXT'))`).catch(() => false)
  if (!ok && !(await openPage(wc, HOME))) throw new Error('YouTube did not load in FlowDesk (offline, or youtube.com is blocked?)')
}

/** One request at a time on the one page; errors come back as { ok: false }. */
function withView(fn: (wc: WebContents) => Promise<YouTubeResult>): Promise<YouTubeResult> {
  return serialized(async () => {
    try {
      return await fn(await getYouTubeView())
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

interface RawItem { videoId: string | null; title: string | null; channel?: string | null; channelId?: string | null; channelHandle?: string | null; viewsText: string | null; publishedText?: string | null; lengthText?: string | null; snippet?: string | null; isShort: boolean }

export interface YtVideo {
  videoId: string
  url: string
  title: string | null
  channel?: string | null
  channelId?: string | null
  channelHandle?: string | null
  views: number | null
  viewsApprox: boolean
  published: string | null
  ageDays: number | null
  lengthSeconds: number | null
  isShort: boolean
  snippet?: string | null
  viewsPerDay: number | null
  outlierScore?: number | null
}

function normalize(r: RawItem): YtVideo | null {
  if (!r.videoId) return null
  const views = parseCount(r.viewsText)
  const age = parseAgo(r.publishedText)
  return {
    videoId: r.videoId,
    url: r.isShort ? `https://www.youtube.com/shorts/${r.videoId}` : `https://www.youtube.com/watch?v=${r.videoId}`,
    title: r.title,
    ...(r.channel !== undefined ? { channel: r.channel, channelId: r.channelId ?? null, channelHandle: r.channelHandle ?? null } : {}),
    views,
    viewsApprox: /[KMB]/i.test(String(r.viewsText ?? '')),
    published: r.publishedText ?? null,
    ageDays: age == null ? null : Math.round((age / 86400) * 10) / 10,
    lengthSeconds: parseLength(r.lengthText),
    isShort: r.isShort,
    ...(r.snippet ? { snippet: r.snippet } : {}),
    viewsPerDay: viewsPerDay(views, age),
  }
}

function addUnique(into: Map<string, YtVideo>, raws: RawItem[]): void {
  for (const r of raws) {
    const v = normalize(r)
    if (v && !into.has(v.videoId)) into.set(v.videoId, v)
  }
}

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def
}

function pickEnum<T extends Record<string, unknown>>(table: T, value: unknown, name: string): keyof T | undefined {
  if (value == null || value === '') return undefined
  if (!(String(value) in table)) throw new Error(`${name} must be one of ${Object.keys(table).join(', ')}`)
  return String(value) as keyof T
}

// ─── search ───────────────────────────────────────────────────────────────────

export interface SearchOptions { query: string; type?: string; uploaded?: string; duration?: string; sort?: string; limit?: number }

async function searchOn(wc: WebContents, o: SearchOptions): Promise<YouTubeResult> {
  const query = String(o.query ?? '').trim()
  if (!query) return { ok: false, error: 'query is empty' }
  const f: SearchFilters = {
    type: pickEnum(SEARCH_TYPES, o.type, 'type') as SearchFilters['type'],
    uploaded: pickEnum(SEARCH_UPLOADED, o.uploaded, 'uploaded') as SearchFilters['uploaded'],
    duration: pickEnum(SEARCH_DURATIONS, o.duration, 'duration') as SearchFilters['duration'],
    sort: pickEnum(SEARCH_SORTS, o.sort, 'sort') as SearchFilters['sort'],
  }
  if (f.type === 'channel' || f.type === 'playlist') return { ok: false, error: 'youtube_search returns videos; type must be video or short' }
  const limit = clampInt(o.limit, 40, 1, 200)
  const sp = encodeSearchParams(f)
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${sp ? `&sp=${encodeURIComponent(sp)}` : ''}`
  if (!(await openPage(wc, url))) return { ok: false, error: 'the YouTube search page did not load' }
  const first = await run<{ videos: RawItem[]; shorts: RawItem[]; applied: string[]; estimated: string | null; token: string | null }>(wc, `
    const d = window.ytInitialData
    return { videos: __all(d, 'videoRenderer').map(__video), shorts: __all(d, 'shortsLockupViewModel').map(__short),
      applied: __all(d, 'searchFilterRenderer').filter(x => x.status === 'FILTER_STATUS_SELECTED').map(x => __t(x.label)),
      estimated: d.estimatedResults || null, token: __lastToken(d) }`)
  const found = new Map<string, YtVideo>()
  addUnique(found, first.videos)
  if (f.type !== 'video') addUnique(found, first.shorts)
  let token = first.token
  for (let page = 0; token && found.size < limit && page < MAX_PAGES; page++) {
    await sleep(500 + Math.random() * 500)
    const next = await run<{ videos: RawItem[]; shorts: RawItem[]; token: string | null }>(wc, `
      const r = await __post('/youtubei/v1/search', { continuation: ${JSON.stringify(token)} })
      return { videos: __all(r, 'videoRenderer').map(__video), shorts: __all(r, 'shortsLockupViewModel').map(__short), token: __lastToken(r) }`)
    const before = found.size
    addUnique(found, next.videos)
    if (f.type !== 'video') addUnique(found, next.shorts)
    token = next.token
    if (found.size === before) break
  }
  const videos = [...found.values()].slice(0, limit)
  // With the Shorts filter every result is a Short, even those YouTube lists as an ordinary video row.
  if (f.type === 'short') for (const v of videos) { v.isShort = true; v.url = `https://www.youtube.com/shorts/${v.videoId}` }
  return {
    ok: true, query, filters: f, filtersApplied: first.applied, estimatedResults: parseCount(first.estimated),
    count: videos.length, videos,
    note: 'views are exact for search results; Shorts from the Shorts shelf carry rounded views (viewsApprox)',
  }
}

export function ytSearch(o: SearchOptions): Promise<YouTubeResult> {
  return withView(wc => searchOn(wc, o))
}

// ─── channel ──────────────────────────────────────────────────────────────────

export interface ChannelOptions { channel: string; tab?: string; sort?: string; limit?: number }

interface ChannelHeader { title: string | null; channelId: string | null; handle: string | null; description: string | null; keywords: string | null; subscribersText: string | null; videosText: string | null }

async function channelOn(wc: WebContents, o: ChannelOptions): Promise<YouTubeResult> {
  const base = channelBaseUrl(o.channel)
  if (!base) return { ok: false, error: `"${o.channel}" is not a YouTube channel (use @handle, a channel link or a UC… id)` }
  const tab = o.tab === 'shorts' ? 'shorts' : 'videos'
  const sort = o.sort === 'popular' || o.sort === 'oldest' ? o.sort : 'latest'
  const limit = clampInt(o.limit, 30, 1, 500)
  if (!(await openPage(wc, `${base}/${tab}`))) return { ok: false, error: `the channel page ${base} did not load` }
  const first = await run<{ header: ChannelHeader; items: RawItem[]; chips: { text: string; token: string | null }[]; token: string | null }>(wc, `
    const d = window.ytInitialData
    const meta = ((d.metadata || {}).channelMetadataRenderer) || {}
    const hs = JSON.stringify(d.header || {})
    const pick = re => (hs.match(re) || [])[1] || null
    const items = ${tab === 'shorts' ? `__all(d, 'shortsLockupViewModel').map(__short)` : `__all(d, 'lockupViewModel').filter(l => l.contentId).map(__lockup)`}
    const chips = __all(d, 'chipViewModel').map(c => ({ text: c.text, token: (JSON.stringify(c).match(/"token":"([^"]+)"/) || [])[1] || null }))
    return { header: { title: meta.title || null, channelId: meta.externalId || null, handle: (meta.vanityChannelUrl || '').split('/').pop() || null,
        description: meta.description || null, keywords: meta.keywords || null,
        subscribersText: pick(/"content":"([^"]*subscribers?)"/), videosText: pick(/"content":"([^"]*videos?)"/) },
      items, chips, token: __lastToken(d) }`)
  if (!first.header.channelId) return { ok: false, error: `${base} is not a channel page YouTube recognises` }
  const found = new Map<string, YtVideo>()
  let token = first.token
  if (sort === 'latest') {
    addUnique(found, first.items)
  } else {
    const chip = first.chips.find(c => c.text.toLowerCase() === sort)
    if (!chip?.token) return { ok: false, error: `this channel page offers no "${sort}" sort (it shows: ${first.chips.map(c => c.text).join(', ') || 'none'})` }
    token = chip.token
  }
  const fetchKind = tab === 'shorts' ? `__all(r, 'shortsLockupViewModel').map(__short)` : `__all(r, 'lockupViewModel').filter(l => l.contentId).map(__lockup)`
  for (let page = 0; token && found.size < limit && page < MAX_PAGES * 2; page++) {
    await sleep(400 + Math.random() * 400)
    const next = await run<{ items: RawItem[]; token: string | null }>(wc, `
      const r = await __post('/youtubei/v1/browse', { continuation: ${JSON.stringify(token)} })
      return { items: ${fetchKind}, token: __lastToken(r) }`)
    const before = found.size
    addUnique(found, next.items)
    token = next.token
    if (found.size === before) break
  }
  const videos = [...found.values()].slice(0, limit)
  const med = median(videos.map(v => v.views).filter((n): n is number => n != null))
  for (const v of videos) v.outlierScore = outlierScore(v.views, med)
  const h = first.header
  return {
    ok: true,
    channel: {
      title: h.title, channelId: h.channelId, handle: h.handle, url: base,
      subscribers: parseCount(h.subscribersText), subscribersText: h.subscribersText,
      videoCount: parseCount(h.videosText), description: h.description, keywords: h.keywords,
    },
    tab, sort, count: videos.length, medianViews: med, videos,
    note: `views on channel pages are rounded by YouTube; outlierScore = views ÷ the median of these ${videos.length} ${tab}${sort === 'latest' ? '' : ` (sorted ${sort}, so the median is not the channel's typical video)`}`,
  }
}

export function ytChannel(o: ChannelOptions): Promise<YouTubeResult> {
  return withView(wc => channelOn(wc, o))
}

// ─── outliers ─────────────────────────────────────────────────────────────────

export interface OutlierOptions {
  query?: string; channel?: string; type?: string; uploaded?: string; duration?: string
  limit?: number; minScore?: number; channels?: number; baseline?: number
}

interface Baseline { channel: string | null; channelId: string; handle: string | null; subscribers: number | null; medianViews: number | null; sampled: number }

async function baselineOn(wc: WebContents, channelId: string, tab: 'videos' | 'shorts', sample: number): Promise<Baseline | null> {
  const r = await channelOn(wc, { channel: channelId, tab, limit: sample })
  if (!r.ok) return null
  const c = r.channel as { title: string | null; handle: string | null; subscribers: number | null }
  return { channel: c.title, channelId, handle: c.handle, subscribers: c.subscribers, medianViews: r.medianViews as number | null, sampled: r.count as number }
}

async function outliersOn(wc: WebContents, o: OutlierOptions): Promise<YouTubeResult> {
  const minScore = typeof o.minScore === 'number' && o.minScore > 0 ? o.minScore : 2
  const limit = clampInt(o.limit, 20, 1, 100)
  const sample = clampInt(o.baseline, 30, 10, 100)
  if (o.channel) {
    const tab = o.type === 'short' ? 'shorts' : 'videos'
    const r = await channelOn(wc, { channel: o.channel, tab, limit: sample })
    if (!r.ok) return r
    const videos = (r.videos as YtVideo[]).filter(v => (v.outlierScore ?? 0) >= minScore).sort((a, b) => (b.outlierScore ?? 0) - (a.outlierScore ?? 0)).slice(0, limit)
    return { ok: true, mode: 'channel', channel: r.channel, medianViews: r.medianViews, sampled: r.count, minScore, count: videos.length, outliers: videos,
      note: `a ${tab === 'shorts' ? 'Short' : 'video'} is an outlier when its views are at least ${minScore}× the channel's median of its last ${r.count}` }
  }
  const query = String(o.query ?? '').trim()
  if (!query) return { ok: false, error: 'give a query (topic) or a channel' }
  const s = await searchOn(wc, { query, type: o.type ?? 'video', uploaded: o.uploaded, duration: o.duration, sort: 'popularity', limit: 60 })
  if (!s.ok) return s
  const found = s.videos as YtVideo[]
  const order: string[] = []
  for (const v of found) if (v.channelId && !order.includes(v.channelId)) order.push(v.channelId)
  const maxChannels = clampInt(o.channels, 8, 1, 20)
  const tab = o.type === 'short' ? 'shorts' : 'videos'
  const baselines = new Map<string, Baseline>()
  for (const id of order.slice(0, maxChannels)) {
    await sleep(600 + Math.random() * 600)
    const b = await baselineOn(wc, id, tab, sample)
    if (b) baselines.set(id, b)
  }
  const scored = found
    .filter(v => v.channelId && baselines.has(v.channelId))
    .map(v => ({ ...v, outlierScore: outlierScore(v.views, baselines.get(v.channelId!)!.medianViews), channelMedianViews: baselines.get(v.channelId!)!.medianViews, channelSubscribers: baselines.get(v.channelId!)!.subscribers }))
  const outliers = scored.filter(v => (v.outlierScore ?? 0) >= minScore).sort((a, b) => (b.outlierScore ?? 0) - (a.outlierScore ?? 0)).slice(0, limit)
  return {
    ok: true, mode: 'topic', query, minScore, searched: found.length, channelsChecked: baselines.size,
    channels: [...baselines.values()], count: outliers.length, outliers,
    note: `search sorted by popularity, then each of the first ${baselines.size} channels' median over its last ${sample} ${tab}; outlierScore = views ÷ that median`,
  }
}

export function ytOutliers(o: OutlierOptions): Promise<YouTubeResult> {
  return withView(wc => outliersOn(wc, o))
}

// ─── autocomplete ─────────────────────────────────────────────────────────────

export interface SuggestOptions { seed: string; expand?: boolean; language?: string; country?: string }

async function suggestOnce(q: string, hl: string, gl: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`autocomplete answered ${r.status}`)
  const j = await r.json() as [string, string[]]
  return Array.isArray(j?.[1]) ? j[1] : []
}

/** What people type into YouTube's search box, starting with `seed`. */
export async function ytSuggest(o: SuggestOptions): Promise<YouTubeResult> {
  const seed = String(o.seed ?? '').trim()
  if (!seed) return { ok: false, error: 'seed is empty' }
  const hl = /^[a-z]{2}(-[A-Z]{2})?$/.test(String(o.language ?? '')) ? String(o.language) : 'en'
  const gl = /^[A-Za-z]{2}$/.test(String(o.country ?? '')) ? String(o.country).toUpperCase() : 'US'
  try {
    const base = await suggestOnce(seed, hl, gl)
    const all = new Map<string, string>(base.map(s => [s, '']))
    if (o.expand) {
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        await sleep(120)
        for (const s of await suggestOnce(`${seed} ${letter}`, hl, gl)) if (!all.has(s)) all.set(s, letter)
      }
    }
    return { ok: true, seed, language: hl, country: gl, count: all.size, suggestions: [...all.keys()],
      note: 'autocomplete shows what people search, in the order YouTube suggests it; it carries no search volumes' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── comments ─────────────────────────────────────────────────────────────────

export interface CommentsOptions { video: string; sort?: string; limit?: number }

interface RawComment { id: string | null; text: string | null; published: string | null; author: string | null; authorChannelId: string | null; isCreator: boolean; likes: string | null; replies: string | null; replyLevel: number }

const commentScript = String.raw`
const __comments = r => __all(r, 'commentEntityPayload').map(c => ({
  id: (c.properties || {}).commentId || null, text: (((c.properties || {}).content) || {}).content || null,
  published: (c.properties || {}).publishedTime || null, author: (c.author || {}).displayName || null,
  authorChannelId: (c.author || {}).channelId || null, isCreator: !!(c.author || {}).isCreator,
  likes: (c.toolbar || {}).likeCountNotliked || null, replies: (c.toolbar || {}).replyCount || null,
  replyLevel: (c.properties || {}).replyLevel || 0 }))
`

async function commentsOn(wc: WebContents, o: CommentsOptions): Promise<YouTubeResult> {
  const id = parseVideoId(o.video)
  if (!id) return { ok: false, error: `"${o.video}" is not a YouTube video link or id` }
  const newest = o.sort === 'newest'
  const limit = clampInt(o.limit, 50, 1, 500)
  await ensureYouTube(wc)
  const first = await run<{ comments: RawComment[]; total: string | null; newestToken: string | null; token: string | null; disabled: boolean }>(wc, `${commentScript}
    const n = await __post('/youtubei/v1/next', { videoId: ${JSON.stringify(id)} })
    const tokens = [...JSON.stringify(n).matchAll(/"continuationCommand":\\{"token":"([^"]+)","request":"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"/g)].map(m => m[1])
    for (const t of tokens.slice(0, 8)) {
      const r = await __post('/youtubei/v1/next', { continuation: t })
      const s = JSON.stringify(r)
      if (s.indexOf('commentEntityPayload') < 0 && s.indexOf('commentsHeaderRenderer') < 0) continue
      const sub = __all(r, 'sortFilterSubMenuRenderer')[0]
      const item = sub && (sub.subMenuItems || []).find(i => /newest/i.test(i.title || ''))
      return { comments: __comments(r), total: (s.match(/"countText":\\{"runs":\\[\\{"text":"([^"]+)"/) || [])[1] || null,
        newestToken: item ? ((item.serviceEndpoint || {}).continuationCommand || {}).token || null : null, token: __lastToken(r), disabled: false }
    }
    return { comments: [], total: null, newestToken: null, token: null, disabled: /comments are turned off/i.test(JSON.stringify(n)) }`)
  if (first.disabled) return { ok: true, videoId: id, totalComments: 0, count: 0, comments: [], note: 'comments are turned off for this video' }
  let raws = first.comments
  let token = first.token
  if (newest) {
    if (!first.newestToken) return { ok: false, error: 'YouTube offered no "Newest first" order for this video' }
    const r = await run<{ comments: RawComment[]; token: string | null }>(wc, `${commentScript}
      const r = await __post('/youtubei/v1/next', { continuation: ${JSON.stringify(first.newestToken)} })
      return { comments: __comments(r), token: __lastToken(r) }`)
    raws = r.comments
    token = r.token
  }
  const seen = new Set<string>()
  const comments: Record<string, unknown>[] = []
  const take = (list: RawComment[]) => {
    for (const c of list) {
      if (c.replyLevel > 0 || !c.id || seen.has(c.id) || comments.length >= limit) continue
      seen.add(c.id)
      comments.push({ text: c.text, likes: parseCount(c.likes) ?? 0, replies: parseCount(c.replies) ?? 0, published: c.published, author: c.author, isCreator: c.isCreator })
    }
  }
  take(raws)
  for (let page = 0; token && comments.length < limit && page < MAX_PAGES * 2; page++) {
    await sleep(400 + Math.random() * 400)
    const r = await run<{ comments: RawComment[]; token: string | null }>(wc, `${commentScript}
      const r = await __post('/youtubei/v1/next', { continuation: ${JSON.stringify(token)} })
      return { comments: __comments(r), token: __lastToken(r) }`)
    const before = comments.length
    take(r.comments)
    token = r.token
    if (comments.length === before) break
  }
  return { ok: true, videoId: id, totalComments: parseCount(first.total), sort: newest ? 'newest' : 'top', count: comments.length, comments }
}

export function ytComments(o: CommentsOptions): Promise<YouTubeResult> {
  return withView(wc => commentsOn(wc, o))
}

// ─── Most Replayed ────────────────────────────────────────────────────────────

interface HeatPoint { startSeconds: number; endSeconds: number; intensity: number }

/** The strongest moments, at least `gap` seconds apart, so one long peak is not listed five times. */
export function heatPeaks(points: HeatPoint[], count = 5, gap = 20): HeatPoint[] {
  const out: HeatPoint[] = []
  for (const p of [...points].sort((a, b) => b.intensity - a.intensity)) {
    if (out.length >= count) break
    if (out.some(q => Math.abs(q.startSeconds - p.startSeconds) < gap)) continue
    out.push(p)
  }
  return out.sort((a, b) => a.startSeconds - b.startSeconds)
}

async function mostReplayedOn(wc: WebContents, input: string): Promise<YouTubeResult> {
  const id = parseVideoId(input)
  if (!id) return { ok: false, error: `"${input}" is not a YouTube video link or id` }
  await ensureYouTube(wc)
  const r = await run<{ markers: { startMillis: string; durationMillis: string; intensityScoreNormalized: number }[] | null; title: string | null }>(wc, `
    const n = await __post('/youtubei/v1/next', { videoId: ${JSON.stringify(id)} })
    const list = __all(n, 'macroMarkersListEntity').map(e => e.markersList || {}).find(m => m.markerType === 'MARKER_TYPE_HEATMAP')
    return { markers: list ? list.markers || [] : null, title: (JSON.stringify(n).match(/"videoPrimaryInfoRenderer":\\{"title":\\{"runs":\\[\\{"text":"([^"]+)"/) || [])[1] || null }`)
  if (!r.markers?.length) return { ok: true, videoId: id, title: r.title, heatmap: null, note: 'YouTube shows no Most Replayed graph for this video (it needs enough views)' }
  const points: HeatPoint[] = r.markers.map(m => ({
    startSeconds: Math.round(Number(m.startMillis) / 1000),
    endSeconds: Math.round((Number(m.startMillis) + Number(m.durationMillis)) / 1000),
    intensity: Math.round(m.intensityScoreNormalized * 100) / 100,
  }))
  return { ok: true, videoId: id, title: r.title, peaks: heatPeaks(points), points,
    note: 'intensity 0-1 is how much each part is replayed compared with the rest of the video (YouTube\'s Most Replayed graph)' }
}

export function ytMostReplayed(input: string): Promise<YouTubeResult> {
  return withView(wc => mostReplayedOn(wc, input))
}

// ─── breakdown ────────────────────────────────────────────────────────────────

const TITLE_STOP = new Set(['the', 'and', 'for', 'you', 'with', 'this', 'that', 'how', 'what', 'from', 'your', 'are', 'was', 'his', 'her'])

/** Facts about a title that packaging analysis keeps asking for. */
export function titleFacts(title: string): Record<string, unknown> {
  const words = title.split(/\s+/).filter(Boolean)
  return {
    characters: title.length,
    words: words.length,
    hasNumber: /\d/.test(title),
    isQuestion: /\?/.test(title),
    capsWords: words.filter(w => w.length > 1 && /^[A-Z0-9!?']+$/.test(w) && /[A-Z]/.test(w)),
    hasEmoji: /\p{Extended_Pictographic}/u.test(title),
    brackets: (title.match(/[([][^)\]]+[)\]]/g) || []),
    keyWords: words.map(w => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(w => w.length > 2 && !TITLE_STOP.has(w)),
  }
}

async function breakdownOn(wc: WebContents, input: string, includeTranscript: boolean): Promise<YouTubeResult> {
  const id = parseVideoId(input)
  if (!id) return { ok: false, error: `"${input}" is not a YouTube video link or id` }
  const d = await whileAwake(wc, () => videoDetailOn(wc, id, { transcript: true }))
  if (!d.ok) return d
  const lines = ((d.transcript as { lines?: { startSeconds: number; text: string }[] } | null)?.lines) ?? []
  const said = (from: number, to: number) => lines.filter(l => l.startSeconds >= from && l.startSeconds < to).map(l => l.text).join(' ') || null
  await sleep(500)
  const heat = await mostReplayedOn(wc, id)
  const peaks = (heat.ok && Array.isArray(heat.peaks) ? heat.peaks as HeatPoint[] : []).map(p => ({ ...p, said: said(Math.max(p.startSeconds - 3, 0), p.endSeconds + 2) }))
  await sleep(500)
  const com = await commentsOn(wc, { video: id, limit: 40 })
  const topComments = com.ok ? (com.comments as { likes: number }[]).sort((a, b) => b.likes - a.likes).slice(0, 15) : []
  let channel: Baseline | null = null
  if (typeof d.channelId === 'string') {
    await sleep(500)
    channel = await baselineOn(wc, d.channelId, d.isShort ? 'shorts' : 'videos', 30)
  }
  const views = typeof d.views === 'number' ? d.views : null
  const publishedAt = typeof d.publishedAt === 'string' ? Date.parse(d.publishedAt) : NaN
  const ageSeconds = Number.isFinite(publishedAt) ? (Date.now() - publishedAt) / 1000 : null
  const { transcript: _t, description, ...core } = d as Record<string, unknown>
  return {
    ok: true,
    video: { ...core, description },
    performance: {
      views, likes: d.likes ?? null,
      likesPerThousandViews: views && typeof d.likes === 'number' ? Math.round((d.likes / views) * 10000) / 10 : null,
      ageDays: ageSeconds == null ? null : Math.round(ageSeconds / 86400),
      viewsPerDay: viewsPerDay(views, ageSeconds),
      channelMedianViews: channel?.medianViews ?? null,
      outlierScore: outlierScore(views, channel?.medianViews ?? null),
      channelSubscribers: channel?.subscribers ?? null,
    },
    packaging: { title: titleFacts(String(d.title ?? '')), thumbnail: d.thumbnail ?? null, lengthSeconds: d.lengthSeconds ?? null, chapters: d.chapters ?? [] },
    hook: { first15s: said(0, 15), first30s: said(0, 30) },
    mostReplayed: peaks.length ? peaks : null,
    transcriptInfo: d.transcript ? { language: (d.transcript as { language: string }).language, lines: lines.length, words: lines.map(l => l.text).join(' ').split(/\s+/).length } : { error: d.transcriptError ?? 'no transcript' },
    ...(includeTranscript ? { transcript: lines } : {}),
    topComments,
    totalComments: com.ok ? com.totalComments : null,
    ...(com.ok && com.note ? { commentsNote: com.note } : {}),
    note: 'raw facts for judging why the video worked: packaging (title, thumbnail), hook, what was said at the most replayed moments, audience reaction, and how it did against the channel\'s typical video',
  }
}

export function ytBreakdown(input: string, includeTranscript = false): Promise<YouTubeResult> {
  return withView(wc => breakdownOn(wc, input, includeTranscript))
}

// ─── niche scan ───────────────────────────────────────────────────────────────

export interface NicheOptions { topic: string; type?: string; uploaded?: string; channels?: number; language?: string; country?: string }

async function nicheOn(wc: WebContents, o: NicheOptions): Promise<YouTubeResult> {
  const topic = String(o.topic ?? '').trim()
  if (!topic) return { ok: false, error: 'topic is empty' }
  const demand = await ytSuggest({ seed: topic, expand: true, language: o.language, country: o.country })
  const out = await outliersOn(wc, { query: topic, type: o.type, uploaded: o.uploaded ?? 'year', channels: o.channels ?? 10, minScore: 1.5, limit: 40 })
  if (!out.ok) return out
  const outliers = out.outliers as (YtVideo & { outlierScore: number | null })[]
  const words = new Map<string, number>()
  for (const v of outliers) for (const w of new Set(titleFacts(String(v.title ?? '')).keyWords as string[])) words.set(w, (words.get(w) ?? 0) + 1)
  const lengths = outliers.map(v => v.lengthSeconds).filter((n): n is number => n != null)
  return {
    ok: true, topic,
    searchDemand: demand.ok ? demand.suggestions : [],
    channels: out.channels,
    outliers,
    patterns: {
      commonTitleWords: [...words.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([word, videos]) => ({ word, videos })),
      medianLengthSeconds: median(lengths),
      shortsShare: outliers.length ? Math.round((outliers.filter(v => v.isShort).length / outliers.length) * 100) : null,
      medianAgeDays: median(outliers.map(v => v.ageDays).filter((n): n is number => n != null)),
    },
    note: 'searchDemand = what people type (autocomplete); outliers = videos beating their own channel\'s median 1.5× or more; patterns are counted over those outliers',
  }
}

export function ytNicheScan(o: NicheOptions): Promise<YouTubeResult> {
  return withView(wc => nicheOn(wc, o))
}

// ─── watchlist (views over time) ──────────────────────────────────────────────

interface Snapshot { at: string; views: number | null; likes: number | null }
interface WatchEntry { title: string | null; channel: string | null; addedAt: string; snapshots: Snapshot[] }
type WatchFile = { videos: Record<string, WatchEntry> }

const watchFile = () => join(app.getPath('userData'), 'youtube', 'watchlist.json')

async function loadWatch(): Promise<WatchFile> {
  try {
    const j = JSON.parse(await readFile(watchFile(), 'utf8')) as WatchFile
    return j && typeof j.videos === 'object' ? j : { videos: {} }
  } catch {
    return { videos: {} }
  }
}

async function saveWatch(w: WatchFile): Promise<void> {
  await mkdir(join(app.getPath('userData'), 'youtube'), { recursive: true })
  await writeFile(watchFile(), JSON.stringify(w, null, 2))
}

async function snapshotOn(wc: WebContents, id: string): Promise<{ title: string | null; channel: string | null; views: number | null; likes: number | null }> {
  const r = await run<{ title: string | null; channel: string | null; views: string | null; likes: string | null }>(wc, `
    const s = JSON.stringify(await __post('/youtubei/v1/next', { videoId: ${JSON.stringify(id)} }))
    const pick = re => (s.match(re) || [])[1] || null
    return { title: pick(/"videoPrimaryInfoRenderer":\\{"title":\\{"runs":\\[\\{"text":"([^"]+)"/),
      channel: pick(/"videoOwnerRenderer":\\{"thumbnail":.*?"title":\\{"runs":\\[\\{"text":"([^"]+)"/),
      views: pick(/"originalViewCount":"(\\d+)"/), likes: pick(/"accessibilityText":"like this video along with ([\\d,]+) other/) }`)
  return { title: r.title, channel: r.channel, views: parseCount(r.views), likes: parseCount(r.likes) }
}

/** Views gained per hour between two snapshots. */
export function velocity(a: Snapshot | undefined, b: Snapshot | undefined): number | null {
  if (!a || !b || a.views == null || b.views == null) return null
  const hours = (Date.parse(b.at) - Date.parse(a.at)) / 3_600_000
  return hours > 0 ? Math.round((b.views - a.views) / hours) : null
}

function watchReport(w: WatchFile) {
  return Object.entries(w.videos).map(([videoId, e]) => {
    const s = e.snapshots
    const last = s[s.length - 1]
    return {
      videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: e.title, channel: e.channel, addedAt: e.addedAt,
      views: last?.views ?? null, likes: last?.likes ?? null, lastChecked: last?.at ?? null, snapshots: s.length,
      viewsPerHourRecent: velocity(s[s.length - 2], last),
      viewsPerHourSinceAdded: velocity(s[0], last),
    }
  }).sort((a, b) => (b.viewsPerHourRecent ?? -1) - (a.viewsPerHourRecent ?? -1))
}

export interface WatchOptions { action: string; videos?: string[] }

export function ytWatch(o: WatchOptions): Promise<YouTubeResult> {
  const action = String(o.action ?? '')
  if (!['add', 'remove', 'list', 'refresh'].includes(action)) return Promise.resolve({ ok: false, error: 'action must be add, remove, list or refresh' })
  const ids = (o.videos ?? []).map(v => parseVideoId(v))
  if ((action === 'add' || action === 'remove') && (!ids.length || ids.some(id => !id))) return Promise.resolve({ ok: false, error: 'videos must list YouTube links or ids' })
  return withView(async wc => {
    const w = await loadWatch()
    if (action === 'remove') for (const id of ids) delete w.videos[id!]
    if (action === 'add' || action === 'refresh') {
      const targets = action === 'add' ? ids as string[] : Object.keys(w.videos).slice(0, 200)
      if (targets.length) await ensureYouTube(wc)
      for (const id of targets) {
        const snap = await snapshotOn(wc, id)
        const entry = w.videos[id] ?? { title: snap.title, channel: snap.channel, addedAt: new Date().toISOString(), snapshots: [] }
        entry.title = snap.title ?? entry.title
        entry.channel = snap.channel ?? entry.channel
        entry.snapshots.push({ at: new Date().toISOString(), views: snap.views, likes: snap.likes })
        if (entry.snapshots.length > 500) entry.snapshots.splice(0, entry.snapshots.length - 500)
        w.videos[id] = entry
        await sleep(400 + Math.random() * 400)
      }
    }
    if (action !== 'list') await saveWatch(w)
    const videos = watchReport(w)
    return { ok: true, action, count: videos.length, videos,
      note: 'each add/refresh stores the live view count; viewsPerHourRecent compares the last two checks, viewsPerHourSinceAdded the first and the last' }
  })
}

// ─── monetization and earnings estimate ───────────────────────────────────────

/**
 * Creator earnings per 1000 views (USD), as ranges creators commonly report.
 * These are assumptions, not measurements: YouTube does not publish another
 * channel's earnings, and every result says so.
 */
export const RPM_BANDS = {
  madeForKids: [0.1, 0.5],
  short: [0.03, 0.1],
  southAsian: [0.3, 1.2],
  english: [2, 6],
  other: [0.5, 2],
} as const

/** Which band a channel's videos fall in, from its spoken language and format. */
export function rpmBand(spoken: string | null, madeForKids: boolean, shorts: boolean): keyof typeof RPM_BANDS {
  if (madeForKids) return 'madeForKids'
  if (shorts) return 'short'
  const lang = String(spoken ?? '').toLowerCase().split('-')[0]
  if (['hi', 'ur', 'bn', 'pa', 'ta', 'te', 'mr', 'gu', 'ne'].includes(lang)) return 'southAsian'
  if (lang === 'en') return 'english'
  return 'other'
}

interface AdSignals { videoId: string; ads: number; madeForKids: boolean; spoken: string | null }

async function adSignalsOn(wc: WebContents, id: string): Promise<AdSignals | null> {
  if (!(await openPage(wc, `https://www.youtube.com/watch?v=${id}`))) return null
  const r = await run<{ id: string | null; ads: number; kids: boolean; spoken: string | null }>(wc, `
    const pr = window.ytInitialPlayerResponse || {}
    const list = ((pr.captions || {}).playerCaptionsTracklistRenderer) || {}
    const tracks = list.captionTracks || []
    // Dubbed videos carry auto captions for every dub; the original audio track's own is the spoken language.
    const audio = (list.audioTracks || [])[list.defaultAudioTrackIndex || 0] || {}
    const own = (audio.captionTrackIndices || []).map(i => tracks[i]).filter(Boolean)
    const asr = own.find(t => t.kind === 'asr') || (tracks.length && !list.audioTracks ? tracks.find(t => t.kind === 'asr') : null)
    const audioLang = typeof audio.audioTrackId === 'string' ? audio.audioTrackId.split('.')[0] : null
    return { id: (pr.videoDetails || {}).videoId || null, ads: (pr.adPlacements || []).length + (pr.playerAds || []).length,
      kids: /"isMadeForKids":true|made for kids/i.test(JSON.stringify(pr)), spoken: audioLang || (asr ? asr.languageCode : null) }`)
  return r.id === id ? { videoId: id, ads: r.ads, madeForKids: r.kids, spoken: r.spoken } : null
}

export interface MonetizationOptions { channel: string; sample?: number }

async function monetizationOn(wc: WebContents, o: MonetizationOptions): Promise<YouTubeResult> {
  const ch = await channelOn(wc, { channel: o.channel, limit: 40 })
  if (!ch.ok) return ch
  const videos = ch.videos as YtVideo[]
  const sample = clampInt(o.sample, 3, 1, 6)
  // Recent, but not brand new: ads can start a little after upload.
  const picks = videos.filter(v => (v.ageDays ?? 0) >= 2).slice(0, sample)
  const checked: AdSignals[] = []
  for (const v of picks) {
    await sleep(500 + Math.random() * 500)
    const s = await adSignalsOn(wc, v.videoId)
    if (s) checked.push(s)
  }
  const withAds = checked.filter(s => s.ads > 0).length
  const kids = checked.length > 0 && checked.every(s => s.madeForKids)
  const spoken = checked.map(s => s.spoken).find(Boolean) ?? null
  const status = withAds > 0 ? 'monetized (ads seen)' : kids ? 'made for kids (no ads seen)' : 'no ads seen'
  const recent = videos.filter(v => v.ageDays != null && v.ageDays <= 30)
  const recentViews = recent.reduce((n, v) => n + (v.views ?? 0), 0)
  const band = rpmBand(spoken, kids, false)
  const [lo, hi] = RPM_BANDS[band]
  const earning = withAds > 0
    ? { usdLow: Math.round(recentViews * lo / 1000), usdHigh: Math.round(recentViews * hi / 1000), rpmBand: band, rpmUsd: [lo, hi] }
    : null
  return {
    ok: true,
    channel: ch.channel,
    status,
    videosChecked: checked.map(s => ({ ...s, url: `https://www.youtube.com/watch?v=${s.videoId}` })),
    spokenLanguage: spoken,
    last30Days: { uploads: recent.length, views: recentViews },
    estimatedEarningsLast30DaysUploads: earning,
    note: 'Monetization is read from whether YouTube served ads on the sampled videos to a signed-out viewer here; no ads on a few videos is a strong sign, not proof. Earnings = views of videos uploaded in the last 30 days (rounded counts) × an assumed RPM range for the spoken language and format; YouTube does not publish real figures.',
  }
}

export function ytMonetization(o: MonetizationOptions): Promise<YouTubeResult> {
  return withView(wc => monetizationOn(wc, o))
}
