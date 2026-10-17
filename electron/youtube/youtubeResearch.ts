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
import { getYouTubeView, parseVideoId, quiet, serialized, sleep, videoDetailOn, type YouTubeResult } from './youtube'
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
// Recommendations follow what this page has watched, even signed out: ask as a fresh visitor.
const __postAnon = (path, body) => { const ctx = JSON.parse(JSON.stringify(ytcfg.get('INNERTUBE_CONTEXT'))); delete ctx.client.visitorData
  return fetch(path + '?prettyPrint=false', { method: 'POST', credentials: 'omit', headers: __H(), body: JSON.stringify(Object.assign({ context: ctx }, body)) })
    .then(r => { if (!r.ok) throw new Error('YouTube answered ' + r.status + ' for ' + path); return r.json() }) }
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
    const wc = await getYouTubeView()
    try {
      return await fn(wc)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      await quiet(wc)
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

// ─── watchlist (views, subscribers and titles over time) ──────────────────────

interface Snapshot { at: string; views: number | null; likes: number | null }
interface TitleChange { at: string; from: string | null; to: string }
interface WatchEntry { title: string | null; channel: string | null; addedAt: string; snapshots: Snapshot[]; titleChanges?: TitleChange[] }
interface ChannelSnapshot { at: string; subscribers: number | null; videoCount: number | null }
interface ChannelEntry { title: string | null; addedAt: string; snapshots: ChannelSnapshot[] }
type WatchFile = { videos: Record<string, WatchEntry>; channels?: Record<string, ChannelEntry> }

const watchFile = () => join(app.getPath('userData'), 'youtube', 'watchlist.json')

async function loadWatch(): Promise<WatchFile> {
  try {
    const j = JSON.parse(await readFile(watchFile(), 'utf8')) as WatchFile
    return j && typeof j.videos === 'object' ? { videos: j.videos, channels: j.channels ?? {} } : { videos: {}, channels: {} }
  } catch {
    return { videos: {}, channels: {} }
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

/** Subscribers gained per day between two channel snapshots. */
export function subsPerDay(a: ChannelSnapshot | undefined, b: ChannelSnapshot | undefined): number | null {
  if (!a || !b || a.subscribers == null || b.subscribers == null) return null
  const days = (Date.parse(b.at) - Date.parse(a.at)) / 86_400_000
  return days > 0 ? Math.round((b.subscribers - a.subscribers) / days) : null
}

function watchReport(w: WatchFile) {
  const videos = Object.entries(w.videos).map(([videoId, e]) => {
    const s = e.snapshots
    const last = s[s.length - 1]
    return {
      videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: e.title, channel: e.channel, addedAt: e.addedAt,
      views: last?.views ?? null, likes: last?.likes ?? null, lastChecked: last?.at ?? null, snapshots: s.length,
      viewsPerHourRecent: velocity(s[s.length - 2], last),
      viewsPerHourSinceAdded: velocity(s[0], last),
      ...(e.titleChanges?.length ? { titleChanges: e.titleChanges } : {}),
      history: s.slice(-30),
    }
  }).sort((a, b) => (b.viewsPerHourRecent ?? -1) - (a.viewsPerHourRecent ?? -1))
  const channels = Object.entries(w.channels ?? {}).map(([channel, e]) => {
    const s = e.snapshots
    const last = s[s.length - 1]
    return {
      channel, url: channelBaseUrl(channel), title: e.title, addedAt: e.addedAt,
      subscribers: last?.subscribers ?? null, videoCount: last?.videoCount ?? null, lastChecked: last?.at ?? null,
      subscribersPerDayRecent: subsPerDay(s[s.length - 2], last),
      subscribersPerDaySinceAdded: subsPerDay(s[0], last),
      history: s.slice(-30),
    }
  })
  return { videos, channels }
}

export interface WatchOptions { action: string; videos?: string[]; channels?: string[] }

export function ytWatch(o: WatchOptions): Promise<YouTubeResult> {
  const action = String(o.action ?? '')
  if (!['add', 'remove', 'list', 'refresh'].includes(action)) return Promise.resolve({ ok: false, error: 'action must be add, remove, list or refresh' })
  const ids = (o.videos ?? []).map(v => parseVideoId(v))
  const chans = (o.channels ?? []).map(c => String(c).trim())
  if (ids.some(id => !id)) return Promise.resolve({ ok: false, error: 'videos must list YouTube links or ids' })
  if (chans.some(c => !channelBaseUrl(c))) return Promise.resolve({ ok: false, error: 'channels must list @handles, channel links or UC… ids' })
  if ((action === 'add' || action === 'remove') && !ids.length && !chans.length) return Promise.resolve({ ok: false, error: 'give videos and/or channels to ' + action })
  return withView(async wc => {
    const w = await loadWatch()
    w.channels ??= {}
    if (action === 'remove') {
      for (const id of ids) delete w.videos[id!]
      for (const c of chans) delete w.channels[c]
    }
    if (action === 'add' || action === 'refresh') {
      const videoTargets = action === 'add' ? ids as string[] : Object.keys(w.videos).slice(0, 200)
      const channelTargets = action === 'add' ? chans : Object.keys(w.channels).slice(0, 50)
      if (videoTargets.length) await ensureYouTube(wc)
      const now = () => new Date().toISOString()
      for (const id of videoTargets) {
        const snap = await snapshotOn(wc, id)
        const entry = w.videos[id] ?? { title: snap.title, channel: snap.channel, addedAt: now(), snapshots: [] }
        // A creator re-titling a video is a packaging test worth knowing about.
        if (snap.title && entry.title && snap.title !== entry.title) (entry.titleChanges ??= []).push({ at: now(), from: entry.title, to: snap.title })
        entry.title = snap.title ?? entry.title
        entry.channel = snap.channel ?? entry.channel
        entry.snapshots.push({ at: now(), views: snap.views, likes: snap.likes })
        if (entry.snapshots.length > 500) entry.snapshots.splice(0, entry.snapshots.length - 500)
        w.videos[id] = entry
        await sleep(400 + Math.random() * 400)
      }
      for (const c of channelTargets) {
        const r = await channelOn(wc, { channel: c, limit: 1 })
        if (!r.ok) continue
        const info = r.channel as { title: string | null; subscribers: number | null; videoCount: number | null }
        const entry = w.channels[c] ?? { title: info.title, addedAt: now(), snapshots: [] }
        entry.title = info.title ?? entry.title
        entry.snapshots.push({ at: now(), subscribers: info.subscribers, videoCount: info.videoCount })
        if (entry.snapshots.length > 500) entry.snapshots.splice(0, entry.snapshots.length - 500)
        w.channels[c] = entry
        await sleep(400 + Math.random() * 400)
      }
    }
    if (action !== 'list') await saveWatch(w)
    const report = watchReport(w)
    return { ok: true, action, videoCount: report.videos.length, channelCount: report.channels.length, ...report,
      note: 'each add/refresh stores live numbers. Videos: viewsPerHourRecent compares the last two checks; titleChanges lists re-titles seen between checks. Channels: subscribers per day (YouTube rounds subscriber counts, so small channels move in steps). History starts on the day a video or channel is added.' }
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

// ─── related videos (what YouTube recommends next to a video) ─────────────────

const relatedScript = String.raw`
const __related = r => {
  const sec = ((r.contents || {}).twoColumnWatchNextResults || {}).secondaryResults || r.onResponseReceivedEndpoints || r
  return __all(sec, 'lockupViewModel').filter(l => l.contentId && l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO').map(L => {
    const m = (L.metadata || {}).lockupMetadataViewModel || {}
    const rows = ((((m.metadata || {}).contentMetadataViewModel) || {}).metadataRows || []).map(x => (x.metadataParts || []).map(p => (p.text || {}).content))
    const badges = __all(L.contentImage, 'thumbnailBadgeViewModel').map(b => b.text)
    const ch = (JSON.stringify(m.image || {}).match(/"browseId":"(UC[^"]+)"/) || [])[1] || null
    return { videoId: L.contentId, title: (m.title || {}).content || null, channel: (rows[0] || [])[0] || null, channelId: ch, channelHandle: null,
      viewsText: (rows[1] || [])[0] || null, publishedText: (rows[1] || [])[1] || null, lengthText: badges[0] || null, isShort: false }
  })
}
`

export interface RelatedOptions { video: string; limit?: number }

async function relatedOn(wc: WebContents, o: RelatedOptions): Promise<YouTubeResult> {
  const id = parseVideoId(o.video)
  if (!id) return { ok: false, error: `"${o.video}" is not a YouTube video link or id` }
  const limit = clampInt(o.limit, 20, 1, 100)
  await ensureYouTube(wc)
  const first = await run<{ items: RawItem[]; token: string | null }>(wc, `${relatedScript}
    const r = await __postAnon('/youtubei/v1/next', { videoId: ${JSON.stringify(id)} })
    const sec = ((r.contents || {}).twoColumnWatchNextResults || {}).secondaryResults || {}
    return { items: __related(r), token: __lastToken(sec) }`)
  const found = new Map<string, YtVideo>()
  addUnique(found, first.items.filter(x => x.videoId !== id))
  let token = first.token
  for (let page = 0; token && found.size < limit && page < 5; page++) {
    await sleep(400 + Math.random() * 400)
    const next = await run<{ items: RawItem[]; token: string | null }>(wc, `${relatedScript}
      const r = await __postAnon('/youtubei/v1/next', { continuation: ${JSON.stringify(token)} })
      return { items: __related(r), token: __lastToken(r) }`)
    const before = found.size
    addUnique(found, next.items.filter(x => x.videoId !== id))
    token = next.token
    if (found.size === before) break
  }
  const videos = [...found.values()].slice(0, limit)
  return { ok: true, videoId: id, count: videos.length, videos,
    note: 'the videos YouTube recommends next to this one (signed out, so not personalised); related videos show which topics and channels YouTube groups with it' }
}

export function ytRelated(o: RelatedOptions): Promise<YouTubeResult> {
  return withView(wc => relatedOn(wc, o))
}

// ─── channel search ───────────────────────────────────────────────────────────

export interface ChannelSearchOptions { query: string; limit?: number }

async function channelSearchOn(wc: WebContents, o: ChannelSearchOptions): Promise<YouTubeResult> {
  const query = String(o.query ?? '').trim()
  if (!query) return { ok: false, error: 'query is empty' }
  const limit = clampInt(o.limit, 20, 1, 100)
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${encodeURIComponent(encodeSearchParams({ type: 'channel' })!)}`
  if (!(await openPage(wc, url))) return { ok: false, error: 'the YouTube search page did not load' }
  type RawChannel = { channelId: string; title: string | null; handle: string | null; texts: (string | null)[]; description: string | null }
  const script = (src: string) => `
    const pick = c => ({ channelId: c.channelId, title: __t(c.title), handle: (((c.navigationEndpoint || {}).browseEndpoint || {}).canonicalBaseUrl || '').replace(/^\\//, '') || null,
      texts: [__t(c.subscriberCountText), __t(c.videoCountText)], description: __t(c.descriptionSnippet) })
    const src = ${src}
    return { items: __all(src, 'channelRenderer').filter(c => c.channelId).map(pick), token: __lastToken(src) }`
  const out = new Map<string, RawChannel>()
  let r = await run<{ items: RawChannel[]; token: string | null }>(wc, script('window.ytInitialData'))
  for (const c of r.items) out.set(c.channelId, c)
  for (let page = 0; r.token && out.size < limit && page < 5; page++) {
    await sleep(500 + Math.random() * 400)
    r = await run<{ items: RawChannel[]; token: string | null }>(wc, script(`await __post('/youtubei/v1/search', { continuation: ${JSON.stringify(r.token)} })`))
    const before = out.size
    for (const c of r.items) out.set(c.channelId, c)
    if (out.size === before) break
  }
  // The search page shows the handle where the subscriber count used to be, and the
  // subscriber count where the video count was: read each by what it says.
  const channels = [...out.values()].slice(0, limit).map(c => {
    const subs = c.texts.find(t => /subscriber/i.test(t ?? ''))
    const vids = c.texts.find(t => /video/i.test(t ?? ''))
    const handle = c.handle || c.texts.find(t => /^@/.test(t ?? '')) || null
    return { channelId: c.channelId, title: c.title, handle, url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${c.channelId}`,
      subscribers: parseCount(subs), videoCount: parseCount(vids), description: c.description }
  })
  return { ok: true, query, count: channels.length, channels }
}

export function ytChannelSearch(o: ChannelSearchOptions): Promise<YouTubeResult> {
  return withView(wc => channelSearchOn(wc, o))
}

// ─── trending (fastest views per hour on a topic) ─────────────────────────────

export interface TrendingOptions { topic: string; window?: string; type?: string; limit?: number }

async function trendingOn(wc: WebContents, o: TrendingOptions): Promise<YouTubeResult> {
  const topic = String(o.topic ?? '').trim()
  if (!topic) return { ok: false, error: 'topic is empty (trending is per topic; YouTube no longer has one public trending list)' }
  const window = o.window === 'today' ? 'today' : o.window === 'month' ? 'month' : 'week'
  const limit = clampInt(o.limit, 20, 1, 100)
  const s = await searchOn(wc, { query: topic, type: o.type === 'short' ? 'short' : 'video', uploaded: window, sort: 'popularity', limit: 80 })
  if (!s.ok) return s
  const videos = (s.videos as YtVideo[])
    .map(v => {
      const ageHours = v.ageDays == null ? null : Math.max(v.ageDays * 24, 1)
      return { ...v, viewsPerHour: v.views != null && ageHours ? Math.round(v.views / ageHours) : null }
    })
    .filter(v => v.viewsPerHour != null)
    .sort((a, b) => (b.viewsPerHour ?? 0) - (a.viewsPerHour ?? 0))
    .slice(0, limit)
  return { ok: true, topic, window, count: videos.length, videos,
    note: 'views per hour since upload (upload age is YouTube\'s "N hours/days ago", so it is approximate); the fastest absolute growers on this topic, whatever the channel size. For growth against the channel\'s normal, use youtube_outliers.' }
}

export function ytTrending(o: TrendingOptions): Promise<YouTubeResult> {
  return withView(wc => trendingOn(wc, o))
}

// ─── keyword research (demand and competition signals) ────────────────────────

export interface KeywordOptions { keyword: string; language?: string; country?: string }

async function keywordOn(wc: WebContents, o: KeywordOptions): Promise<YouTubeResult> {
  const keyword = String(o.keyword ?? '').trim()
  if (!keyword) return { ok: false, error: 'keyword is empty' }
  const demand = await ytSuggest({ seed: keyword, expand: true, language: o.language, country: o.country })
  const s = await searchOn(wc, { query: keyword, type: 'video', limit: 20 })
  if (!s.ok) return s
  const top = s.videos as YtVideo[]
  const views = top.map(v => v.views).filter((n): n is number => n != null)
  const ages = top.map(v => v.ageDays).filter((n): n is number => n != null)
  const kw = keyword.toLowerCase()
  const exact = top.filter(v => String(v.title ?? '').toLowerCase().includes(kw)).length
  const recent = top.filter(v => (v.ageDays ?? 9999) <= 90).length
  const suggestions = demand.ok ? (demand.suggestions as string[]) : []
  return {
    ok: true, keyword,
    demand: { autocompleteSuggestions: suggestions.length, keywordIsSuggested: suggestions.some(x => x.toLowerCase() === kw), longTail: suggestions.slice(0, 40) },
    competition: {
      estimatedResults: s.estimatedResults ?? null,
      top20MedianViews: median(views),
      top20MedianAgeDays: median(ages),
      top20WithExactKeywordInTitle: exact,
      top20UploadedLast90Days: recent,
    },
    top: top.slice(0, 10).map(v => ({ title: v.title, url: v.url, views: v.views, ageDays: v.ageDays, channel: v.channel })),
    note: 'YouTube does not publish search volume, so there is no monthly-search number here. Read it this way: many autocomplete suggestions = people search it; a high top-20 median view count = the topic pulls views; many recent videos in the top 20 = YouTube still rewards new uploads (an opening); exact-keyword titles everywhere = crowded.',
  }
}

export function ytKeyword(o: KeywordOptions): Promise<YouTubeResult> {
  return withView(wc => keywordOn(wc, o))
}

// ─── niche-wide comment insights ──────────────────────────────────────────────

const INTENTS: [string, RegExp][] = [
  ['request', /part\s*2|part\s*two|next (part|video|episode)|please make|make (a|more|one)|agl[ai] (part|video|episode)|aur (video|banao|banaiye)|banao|bana(?:iye|ye|na)\b|plz|pls/i],
  ['question', /\?|\b(how|why|what|which|when|kaise|kyun|kya|kab|kaun|kitn[ae])\b/i],
  ['complaint', /\b(boring|worst|fake|bad|hate|waste|stop|clickbait|bakwas|bekar|ghatiya)\b|👎/i],
  ['praise', /\b(love|best|amazing|great|awesome|nice|beautiful|wow|zabardast|bahut accha|bohat acha|mast)\b|❤|😍|🔥/i],
]

/** The first intent a comment's words match, in order of how useful it is for ideas. */
export function commentIntent(text: string): string {
  for (const [name, re] of INTENTS) if (re.test(text)) return name
  return 'other'
}

export interface CommentInsightOptions { topic: string; videos?: number; perVideo?: number }

async function commentInsightsOn(wc: WebContents, o: CommentInsightOptions): Promise<YouTubeResult> {
  const topic = String(o.topic ?? '').trim()
  if (!topic) return { ok: false, error: 'topic is empty' }
  const n = clampInt(o.videos, 6, 1, 15)
  const per = clampInt(o.perVideo, 40, 10, 100)
  const s = await searchOn(wc, { query: topic, type: 'video', uploaded: 'year', limit: n })
  if (!s.ok) return s
  const all: { intent: string; text: string; likes: number; video: string; videoTitle: string | null }[] = []
  const sampled: { title: string | null; url: string; comments: number }[] = []
  for (const v of (s.videos as YtVideo[]).slice(0, n)) {
    await sleep(500 + Math.random() * 500)
    const c = await commentsOn(wc, { video: v.videoId, limit: per })
    if (!c.ok) continue
    const list = c.comments as { text: string | null; likes: number }[]
    sampled.push({ title: v.title, url: v.url, comments: list.length })
    for (const x of list) if (x.text) all.push({ intent: commentIntent(x.text), text: x.text.slice(0, 300), likes: x.likes, video: v.url, videoTitle: v.title })
  }
  const groups: Record<string, typeof all> = {}
  for (const x of all) (groups[x.intent] ??= []).push(x)
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => b.likes - a.likes)
  return {
    ok: true, topic, videosSampled: sampled, commentsRead: all.length,
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    requests: (groups.request ?? []).slice(0, 25),
    questions: (groups.question ?? []).slice(0, 25),
    complaints: (groups.complaint ?? []).slice(0, 15),
    praise: (groups.praise ?? []).slice(0, 10),
    note: 'top comments from the most relevant videos of the last year on this topic, sorted by likes and grouped by simple word rules (request / question / complaint / praise). The groups are a first sort, not a verdict: read the requests and questions for video ideas and count how many different videos say the same thing.',
  }
}

export function ytCommentInsights(o: CommentInsightOptions): Promise<YouTubeResult> {
  return withView(wc => commentInsightsOn(wc, o))
}

// ─── one video's earnings estimate ────────────────────────────────────────────

async function videoEarningsOn(wc: WebContents, input: string): Promise<YouTubeResult> {
  const id = parseVideoId(input)
  if (!id) return { ok: false, error: `"${input}" is not a YouTube video link or id` }
  const signals = await adSignalsOn(wc, id)
  if (!signals) return { ok: false, error: `YouTube did not show video ${id}` }
  const info = await run<{ views: string | null; lengthSeconds: string | null; title: string | null }>(wc, `
    const pr = window.ytInitialPlayerResponse || {}
    const vd = pr.videoDetails || {}
    return { views: vd.viewCount || null, lengthSeconds: vd.lengthSeconds || null, title: vd.title || null }`)
  const views = parseCount(info.views)
  const isShort = Number(info.lengthSeconds) > 0 && Number(info.lengthSeconds) <= 60
  const band = rpmBand(signals.spoken, signals.madeForKids, isShort)
  const [lo, hi] = RPM_BANDS[band]
  return {
    ok: true, videoId: id, title: info.title, views, spokenLanguage: signals.spoken, madeForKids: signals.madeForKids,
    adsSeen: signals.ads,
    estimatedEarnings: signals.ads > 0 && views != null ? { usdLow: Math.round(views * lo / 1000), usdHigh: Math.round(views * hi / 1000), rpmBand: band, rpmUsd: [lo, hi] } : null,
    note: signals.ads > 0 ? 'lifetime views × an assumed RPM range for the language and format; an estimate, not the creator\'s real earnings' : 'no ads were served on this video here, so no earnings are estimated (it may not be monetized)',
  }
}

export function ytVideoEarnings(input: string): Promise<YouTubeResult> {
  return withView(wc => videoEarningsOn(wc, input))
}

// ─── niche compare (score cards) and mashup (combining niches) ────────────────

/** Flow credits for one 8-second 720p clip, as Flow quoted it live (2026-10-16). */
export const CREDITS_PER_CLIP = 12
const CLIP_SECONDS = 8

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)
const scale = (v: number, lo: number, hi: number) => Math.round(clamp01((v - lo) / (hi - lo)) * 100)

const BAND_WEIGHT: Record<keyof typeof RPM_BANDS, number> = { english: 1, other: 0.6, southAsian: 0.35, short: 0.2, madeForKids: 0.1 }

export interface NicheFacts {
  suggestions: number
  top20MedianViews: number | null
  recentShare: number
  estimatedResults: number | null
  channelsChecked: number
  smallChannelOutliers: number
  monetizedShare: number | null
  rpmBand: keyof typeof RPM_BANDS | null
}

/**
 * 0-100 scores for one niche, each from numbers the tools measured:
 *   demand      = 60% top-20 median views (1K → 3M on a log scale) + 40% autocomplete depth (10 → 200)
 *   opportunity = outliers from channels under 100K subscribers, per channel checked (0 → 1.5)
 *   freshness   = share of the top 20 uploaded in the last 90 days
 *   earning     = share of checked channels with ads × the language/format RPM weight
 *   competition = YouTube's estimated result count, 100K → 100M on a log scale (higher = more crowded)
 *   overall     = 30% demand + 25% opportunity + 15% freshness + 20% earning (50 when unknown) + 10% (100 − competition)
 */
export function nicheScores(f: NicheFacts) {
  const demand = Math.round(0.6 * scale(Math.log10(f.top20MedianViews || 1), 3, 6.5) + 0.4 * scale(f.suggestions, 10, 200))
  const opportunity = scale(f.smallChannelOutliers / Math.max(f.channelsChecked, 1), 0, 1.5)
  const freshness = Math.round(clamp01(f.recentShare) * 100)
  const competition = scale(Math.log10(f.estimatedResults || 1), 5, 8)
  const earning = f.monetizedShare == null ? null : Math.round(clamp01(f.monetizedShare) * 100 * (f.rpmBand ? BAND_WEIGHT[f.rpmBand] : 0.5))
  const overall = Math.round(0.3 * demand + 0.25 * opportunity + 0.15 * freshness + 0.2 * (earning ?? 50) + 0.1 * (100 - competition))
  return { overall, demand, opportunity, freshness, earning, competition }
}

interface TopicFacts { suggestions: string[]; top: YtVideo[]; estimatedResults: number | null }

async function topicFactsOn(wc: WebContents, topic: string, type: string, cache: Map<string, TopicFacts>, language?: string, country?: string): Promise<TopicFacts> {
  const key = `${type}:${topic.toLowerCase()}`
  const hit = cache.get(key)
  if (hit) return hit
  const demand = await ytSuggest({ seed: topic, expand: true, language, country })
  const s = await searchOn(wc, { query: topic, type, limit: 20 })
  const facts: TopicFacts = {
    suggestions: demand.ok ? demand.suggestions as string[] : [],
    top: s.ok ? s.videos as YtVideo[] : [],
    estimatedResults: s.ok ? (s.estimatedResults as number | null) : null,
  }
  cache.set(key, facts)
  return facts
}

/** The most frequent title words across videos, for spotting what a niche's titles lean on. */
function titleWords(videos: YtVideo[], n = 12): { word: string; videos: number }[] {
  const counts = new Map<string, number>()
  for (const v of videos) for (const w of new Set(titleFacts(String(v.title ?? '')).keyWords as string[])) counts.set(w, (counts.get(w) ?? 0) + 1)
  return [...counts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, n).map(([word, c]) => ({ word, videos: c }))
}

export interface NicheCompareOptions { topics: string[]; type?: string; channels?: number; language?: string; country?: string }

async function nicheCompareOn(wc: WebContents, o: NicheCompareOptions): Promise<YouTubeResult> {
  const topics = [...new Set((o.topics ?? []).map(t => String(t).trim()).filter(Boolean))]
  if (topics.length < 2 || topics.length > 6) return { ok: false, error: 'give 2 to 6 niches to compare' }
  const type = o.type === 'short' ? 'short' : 'video'
  const cache = new Map<string, TopicFacts>()
  const cards: { topic: string; scores: ReturnType<typeof nicheScores>; evidence: Record<string, unknown> }[] = []
  for (const topic of topics) {
    const facts = await topicFactsOn(wc, topic, type, cache, o.language, o.country)
    const out = await outliersOn(wc, { query: topic, type, uploaded: 'year', channels: clampInt(o.channels, 4, 2, 8), minScore: 2, limit: 15 })
    const outliers = out.ok ? out.outliers as (YtVideo & { channelSubscribers?: number | null })[] : []
    const baselines = out.ok ? out.channels as Baseline[] : []
    // Monetization, lightly: one recent video per channel, for up to three channels.
    let monetized = 0, checked = 0
    let spoken: string | null = null, kidsVideos = 0
    for (const b of baselines.slice(0, 3)) {
      const ch = await channelOn(wc, { channel: b.channelId, tab: type === 'short' ? 'shorts' : 'videos', limit: 4 })
      const pick = ch.ok ? (ch.videos as YtVideo[]).find(v => (v.ageDays ?? 0) >= 2) ?? (ch.videos as YtVideo[])[0] : null
      if (!pick) continue
      await sleep(400 + Math.random() * 400)
      const sig = await adSignalsOn(wc, pick.videoId)
      if (!sig) continue
      checked++
      if (sig.ads > 0) monetized++
      spoken ??= sig.spoken
      if (sig.madeForKids) kidsVideos++
    }
    const views = facts.top.map(v => v.views).filter((n): n is number => n != null)
    const recentShare = facts.top.length ? facts.top.filter(v => (v.ageDays ?? 9999) <= 90).length / facts.top.length : 0
    const smallChannelOutliers = outliers.filter(v => (v.channelSubscribers ?? Infinity) < 100_000).length
    // Made for kids only when most checked channels are, not because one of them is.
    const band = checked ? rpmBand(spoken, kidsVideos > checked / 2, type === 'short') : null
    const nf: NicheFacts = {
      suggestions: facts.suggestions.length, top20MedianViews: median(views), recentShare,
      estimatedResults: facts.estimatedResults, channelsChecked: baselines.length, smallChannelOutliers,
      monetizedShare: checked ? monetized / checked : null, rpmBand: band,
    }
    const lengthSec = median(outliers.map(v => v.lengthSeconds).filter((n): n is number => n != null))
    cards.push({
      topic,
      scores: nicheScores(nf),
      evidence: {
        ...nf,
        monetizedChannels: `${monetized}/${checked}`,
        spokenLanguage: spoken,
        outliers: outliers.length,
        medianOutlierLengthMinutes: lengthSec == null ? null : Math.round(lengthSec / 6) / 10,
        flowCreditsPerVideo: lengthSec == null || type === 'short' ? null : Math.ceil(lengthSec / CLIP_SECONDS) * CREDITS_PER_CLIP,
        titleWords: titleWords(outliers.length ? outliers : facts.top),
        topOutliers: outliers.slice(0, 3).map(v => ({ title: v.title, url: v.url, outlierScore: v.outlierScore, views: v.views, channel: v.channel, channelSubscribers: v.channelSubscribers ?? null })),
      },
    })
    await sleep(500)
  }
  cards.sort((a, b) => b.scores.overall - a.scores.overall)
  return {
    ok: true, type, ranking: cards.map(c => ({ topic: c.topic, overall: c.scores.overall })), niches: cards,
    note: 'scores are 0-100 from measured numbers (see each niche\'s evidence): demand = top-20 views + autocomplete depth; opportunity = outliers from channels under 100K subscribers; freshness = recent videos in the top 20; earning = channels with ads × language RPM weight; competition = result count (higher = more crowded). Overall = 30% demand, 25% opportunity, 15% freshness, 20% earning, 10% low competition. flowCreditsPerVideo assumes every second is an 8-second Flow clip at 12 credits.',
  }
}

export function ytNicheCompare(o: NicheCompareOptions): Promise<YouTubeResult> {
  return withView(wc => nicheCompareOn(wc, o))
}

const MASHUP_STOP = new Set(['the', 'and', 'for', 'with', 'story', 'stories', 'video', 'videos', 'ki', 'ka', 'ke', 'aur', 'hindi', 'urdu'])

/** Lower-cased words of a topic that identify it in a title. */
export function topicTerms(topic: string): string[] {
  return topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !MASHUP_STOP.has(w))
}

/** Whether a title mentions both niches (at least one identifying word of each). */
export function mentionsBoth(title: string, a: string[], b: string[]): boolean {
  const t = title.toLowerCase()
  return a.some(w => t.includes(w)) && b.some(w => t.includes(w))
}

export interface MashupOptions { base: string; others: string[]; type?: string; language?: string; country?: string }

async function nicheMashupOn(wc: WebContents, o: MashupOptions): Promise<YouTubeResult> {
  const base = String(o.base ?? '').trim()
  const others = [...new Set((o.others ?? []).map(t => String(t).trim()).filter(Boolean))]
  if (!base || !others.length || others.length > 5) return { ok: false, error: 'give a base niche and 1 to 5 other niches' }
  const type = o.type === 'short' ? 'short' : 'video'
  const cache = new Map<string, TopicFacts>()
  const baseF = await topicFactsOn(wc, base, type, cache, o.language, o.country)
  const baseTerms = topicTerms(base)
  const demandOf = (f: TopicFacts) => Math.round(0.6 * scale(Math.log10(median(f.top.map(v => v.views).filter((n): n is number => n != null)) || 1), 3, 6.5) + 0.4 * scale(f.suggestions.length, 10, 200))
  const results: ({ score: number } & Record<string, unknown>)[] = []
  for (const other of others) {
    const otherF = await topicFactsOn(wc, other, type, cache, o.language, o.country)
    const combined = `${base} ${other}`
    await sleep(400)
    const s = await searchOn(wc, { query: combined, type, limit: 20 })
    const comboSuggest = await ytSuggest({ seed: combined, language: o.language, country: o.country })
    const otherTerms = topicTerms(other)
    const matches = (s.ok ? s.videos as YtVideo[] : []).filter(v => mentionsBoth(String(v.title ?? ''), baseTerms, otherTerms))
    const matchViews = median(matches.map(v => v.views).filter((n): n is number => n != null))
    const demandBase = demandOf(baseF), demandOther = demandOf(otherF)
    const weakest = Math.min(demandBase, demandOther)
    const verdict = weakest < 35 ? 'weak demand'
      : matches.length <= 3 ? 'gap'
        : (matchViews ?? 0) < 10_000 ? 'tried, low views'
          : matches.length <= 8 && (matchViews ?? 0) >= 100_000 ? 'proven and still open'
            : 'crowded'
    // Strong demand on both sides, few videos that already combine them, and people already typing the combination.
    const score = Math.round(0.45 * weakest + 0.4 * Math.max(0, 100 - matches.length * 9) + 0.15 * ((comboSuggest.ok && (comboSuggest.suggestions as string[]).length) ? 100 : 30))
    results.push({
      mashup: combined, verdict, score,
      demand: { [base]: demandBase, [other]: demandOther },
      peopleSearchCombination: comboSuggest.ok ? (comboSuggest.suggestions as string[]).slice(0, 10) : [],
      existingVideosCombiningBoth: matches.length,
      theirMedianViews: matchViews,
      examples: matches.slice(0, 5).map(v => ({ title: v.title, url: v.url, views: v.views, ageDays: v.ageDays, channel: v.channel })),
      titleWords: { [base]: titleWords(baseF.top, 8), [other]: titleWords(otherF.top, 8) },
    })
  }
  results.sort((a, b) => b.score - a.score)
  return {
    ok: true, base, mashups: results,
    note: 'verdict: gap = both niches have demand and almost nobody combines them yet; proven and still open = a few combined videos already get 100K+ views; tried, low views = several combine them but their median is under 10K views (people are not watching that combination); crowded = many already combine them; weak demand = one side is too small. score = 45% the weaker side\'s demand + 40% how few videos already combine them + 15% whether people already type the combination. Use titleWords from both sides to write titles; a gap is an opening, not proof the combination will be watched — test it with a few videos.',
  }
}

export function ytNicheMashup(o: MashupOptions): Promise<YouTubeResult> {
  return withView(wc => nicheMashupOn(wc, o))
}
