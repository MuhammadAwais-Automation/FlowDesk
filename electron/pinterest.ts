/**
 * Main-process access to Pinterest.
 *
 * Every call targets one account from the social registry (socialAccounts.ts)
 * and runs inside that account's own hidden window (`persist:<partition>`), so
 * requests carry the page's own cookies and CSRF token. An explicit account
 * that is not registered fails before any page is touched.
 */
import type { WebContents } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { ensureBackgroundView } from './sessions'
import { isSignedIn, resolveSocialAccount, type SocialAccount } from './socialAccounts'
import {
  HUB, IMAGE_TYPES, MAX_IMAGE_BYTES, TREND_TYPES, checkBoardId, checkBoardName, checkBoardUrl, checkBookmark, checkCountry,
  checkDescription, checkLink, checkPinId, checkPublishAt, checkText, checkTitle, checkTrendType, checkUsername,
  clampLimit, createPinScript, mapAudience, mapBoards, mapConversations, mapMe, mapPin, mapPins, mapScheduledPins,
  mapSuggestions, mapTrends, mapUser, matchTrends, nextBookmark, nicheReport, pinOutliers, resourceGetScript,
  resourcePostScript,
  type PinSummary, type ResourceAnswer, type ResourceCall, type TrendTerm, type TrendType, type WriteCall,
} from './pinterestBridge'

export interface PinterestResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export type PinterestAccountRef = string | number | null | undefined

const HOME = 'https://www.pinterest.com/'

export function pinterestAccount(ref?: PinterestAccountRef): SocialAccount | null {
  return resolveSocialAccount('pinterest', ref)
}

export function unknownPinterestAccount(ref: PinterestAccountRef): PinterestResult {
  return { ok: false, error: `unknown pinterest account "${ref}" — list them with social_accounts { platform: "pinterest" }` }
}

async function pinterestView(acc: SocialAccount): Promise<WebContents> {
  const view = await ensureBackgroundView(acc.id === '1' ? 'social-pinterest' : `social-pinterest-${acc.id}`, acc.partition, HOME)
  return view.webContents
}

/** Runs a self-contained page script as the account; the script returns a PinterestResult. */
export async function runPinterest(ref: PinterestAccountRef, script: string, timeoutMs = 45_000): Promise<PinterestResult> {
  const acc = pinterestAccount(ref)
  if (!acc) return unknownPinterestAccount(ref)
  const wc = await pinterestView(acc)
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<PinterestResult>(resolve => {
    timer = setTimeout(() => resolve({ ok: false, error: `pinterest page did not answer within ${timeoutMs / 1000}s` }), timeoutMs)
  })
  try {
    const out = await Promise.race([wc.executeJavaScript(script, true) as Promise<PinterestResult>, timeout])
    return { ...out, account: acc.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: acc.id }
  } finally {
    clearTimeout(timer)
  }
}

export async function pinterestStatus(ref?: PinterestAccountRef): Promise<PinterestResult> {
  const acc = pinterestAccount(ref)
  if (!acc) return unknownPinterestAccount(ref)
  const wc = await pinterestView(acc)
  const signedIn = await isSignedIn(acc)
  return { ok: true, account: acc.id, label: acc.label, partition: acc.partition, signedIn, url: wc.getURL() }
}

async function resource(ref: PinterestAccountRef, call: ResourceCall): Promise<ResourceAnswer & { account?: string }> {
  const out = await runPinterest(ref, resourceGetScript(call))
  return { status: 0, ...out, account: typeof out.account === 'string' ? out.account : undefined }
}

function failed(a: ResourceAnswer & { account?: string }, what: string): PinterestResult {
  if (a.status === 404) return { ok: false, error: `${what} not found on Pinterest`, account: a.account }
  return { ok: false, error: a.error ?? `${what}: pinterest answered ${a.status}${a.message ? ` (${a.message})` : ''}`, account: a.account }
}

/** Validation errors become ok:false results instead of thrown RPC errors. */
async function guarded(fn: () => Promise<PinterestResult>): Promise<PinterestResult> {
  try { return await fn() } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export interface PageOptions { limit?: unknown; bookmark?: unknown; account?: PinterestAccountRef }

export function pinterestUser(username: unknown, account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const u = checkUsername(username)
    const a = await resource(account, { resource: 'UserResource', options: { username: u, field_set_key: 'profile' }, sourceUrl: `/${u}/`, handler: 'www/[username].js' })
    if (!a.ok) return failed(a, `user "${u}"`)
    const user = mapUser(a.data)
    return user ? { ok: true, account: a.account, user } : { ok: false, error: `user "${u}" not found on Pinterest`, account: a.account }
  })
}

export function pinterestUserBoards(username: unknown, o: PageOptions = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const u = checkUsername(username)
    const bookmark = checkBookmark(o.bookmark)
    const a = await resource(o.account, { resource: 'BoardsFeedResource', options: {
      username: u, field_set_key: 'profile_grid_item', sort: 'last_pinned_to', filter_stories: false,
      page_size: clampLimit(o.limit), ...(bookmark ? { bookmarks: [bookmark] } : {}),
    }, sourceUrl: `/${u}/`, handler: 'www/[username].js' })
    if (!a.ok) return failed(a, `boards of "${u}"`)
    return { ok: true, account: a.account, boards: mapBoards(a.data), nextBookmark: nextBookmark(a.bookmark) }
  })
}

export function pinterestUserPins(username: unknown, o: PageOptions = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const u = checkUsername(username)
    const bookmark = checkBookmark(o.bookmark)
    const a = await resource(o.account, { resource: 'UserActivityPinsResource', options: {
      username: u, field_set_key: 'grid_item', is_own_profile_pins: false,
      page_size: clampLimit(o.limit), ...(bookmark ? { bookmarks: [bookmark] } : {}),
    }, sourceUrl: `/${u}/_created/`, handler: 'www/[username]/_created.js' })
    if (!a.ok) return failed(a, `pins of "${u}"`)
    return { ok: true, account: a.account, pins: mapPins(a.data), nextBookmark: nextBookmark(a.bookmark) }
  })
}

export function pinterestBoardPins(board: { boardUrl?: unknown; boardId?: unknown }, o: PageOptions = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const url = checkBoardUrl(board.boardUrl)
    const bookmark = checkBookmark(o.bookmark)
    let id = board.boardId === undefined || board.boardId === null || board.boardId === '' ? null : checkBoardId(board.boardId)
    if (!id) {
      const [, username, slug] = url.split('/')
      const meta = await resource(o.account, { resource: 'BoardResource', options: { username, slug, field_set_key: 'detailed' }, sourceUrl: url, handler: 'www/[username]/[slug].js' })
      if (!meta.ok) return failed(meta, `board ${url}`)
      const d = meta.data && typeof meta.data === 'object' ? meta.data as { id?: unknown } : {}
      if (typeof d.id !== 'string') return { ok: false, error: `board ${url} not found on Pinterest`, account: meta.account }
      id = d.id
    }
    const a = await resource(o.account, { resource: 'BoardFeedResource', options: {
      board_id: id, board_url: url, page_size: clampLimit(o.limit), field_set_key: 'react_grid_pin',
      filter_section_pins: true, layout: 'default', sort: 'default', ...(bookmark ? { bookmarks: [bookmark] } : {}),
    }, sourceUrl: url, handler: 'www/[username]/[slug].js' })
    if (!a.ok) return failed(a, `board ${url}`)
    return { ok: true, account: a.account, boardId: id, pins: mapPins(a.data), nextBookmark: nextBookmark(a.bookmark) }
  })
}

export function pinterestPin(pinId: unknown, account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const id = checkPinId(pinId)
    const a = await resource(account, { resource: 'PinResource', options: { id, field_set_key: 'detailed' }, sourceUrl: `/pin/${id}/`, handler: 'www/pin/[id].js' })
    if (!a.ok) return failed(a, `pin ${id}`)
    const pin = mapPin(a.data)
    return pin ? { ok: true, account: a.account, pin } : { ok: false, error: `pin ${id} not found on Pinterest`, account: a.account }
  })
}

export function pinterestRelated(pinId: unknown, o: PageOptions = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const id = checkPinId(pinId)
    const bookmark = checkBookmark(o.bookmark)
    const a = await resource(o.account, { resource: 'RelatedModulesResource', options: {
      pin_id: id, context_pin_ids: [], search_query: '', source: 'deep_linking', top_level_source: 'deep_linking',
      top_level_source_depth: 1, is_pdp: false, page_size: clampLimit(o.limit), ...(bookmark ? { bookmarks: [bookmark] } : {}),
    }, sourceUrl: `/pin/${id}/`, handler: 'www/pin/[id].js' })
    if (!a.ok) return failed(a, `related pins of ${id}`)
    return { ok: true, account: a.account, pins: mapPins(a.data), nextBookmark: nextBookmark(a.bookmark) }
  })
}

export function pinterestSuggest(term: unknown, account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const t = typeof term === 'string' ? term.trim().slice(0, 100) : ''
    if (!t) return { ok: false, error: 'term is empty' }
    const a = await resource(account, { resource: 'AdvancedTypeaheadResource', options: { term: t, pin_scope: 'pins', count: 10 }, sourceUrl: '/', handler: 'www/index.js' })
    if (!a.ok) return failed(a, 'suggestions')
    return { ok: true, account: a.account, suggestions: mapSuggestions(a.data) }
  })
}

export function pinterestSearch(query: unknown, o: PageOptions = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const q = typeof query === 'string' ? query.trim().slice(0, 200) : ''
    if (!q) return { ok: false, error: 'query is empty' }
    const bookmark = checkBookmark(o.bookmark)
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(q)}&rs=typed`
    const a = await resource(o.account, { resource: 'BaseSearchResource', options: {
      query: q, scope: 'pins', page_size: clampLimit(o.limit), rs: 'typed', source_url: sourceUrl,
      ...(bookmark ? { bookmarks: [bookmark] } : {}),
    }, sourceUrl, handler: 'www/search/[scope].js' })
    if (!a.ok) return failed(a, 'search')
    const pins = mapPins(a.data)
    if (!pins.length && !bookmark) {
      const acc = pinterestAccount(o.account)
      if (acc && (await isSignedIn(acc)) !== true) {
        return { ok: false, account: a.account, error: `Pinterest only returns search results to signed-in accounts — account ${acc.id} is signed out. Sign in once with social_open_login { platform: "pinterest" }, or use pinterest_suggest / pinterest_user_pins / pinterest_related_pins, which work signed out.` }
      }
    }
    return { ok: true, account: a.account, pins, nextBookmark: nextBookmark(a.bookmark) }
  })
}

/** Pins of a user or board that got ≥ minMultiplier× the median saves of that set. */
export function pinterestOutlier(source: { username?: unknown; boardUrl?: unknown }, o: PageOptions & { minMultiplier?: unknown } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const m = typeof o.minMultiplier === 'number' && o.minMultiplier > 0 ? o.minMultiplier : 3
    const page = source.boardUrl
      ? await pinterestBoardPins({ boardUrl: source.boardUrl }, { ...o, limit: o.limit ?? 50 })
      : await pinterestUserPins(source.username, { ...o, limit: o.limit ?? 50 })
    if (!page.ok) return page
    const pins = page.pins as PinSummary[]
    return { ok: true, account: page.account, scanned: pins.length, minMultiplier: m, outliers: pinOutliers(pins, m) }
  })
}

// ── Signed-in reads ──────────────────────────────────────────────────────────

const api = (url: string, data: Record<string, unknown>): ResourceCall => ({ resource: 'ApiResource', options: { url, data }, ...HUB })

/** Signed-out accounts get errors or empty answers here; say why instead. */
async function needsSignIn(account: PinterestAccountRef, what: string): Promise<PinterestResult | null> {
  const acc = pinterestAccount(account)
  if (!acc) return unknownPinterestAccount(account)
  if ((await isSignedIn(acc)) === true) return null
  return { ok: false, account: acc.id, error: `${what} needs a signed-in Pinterest account — account ${acc.id} is signed out. Sign in once with social_open_login { platform: "pinterest" }.` }
}

async function myProfile(account: PinterestAccountRef) {
  const a = await resource(account, api('/v3/users/me/', { fields: 'user.id,user.username,user.is_partner,user.follower_count,user.pin_count,user.board_count' }))
  return { a, me: a.ok ? mapMe(a.data) : null }
}

export function pinterestMe(account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const gate = await needsSignIn(account, 'pinterest_me')
    if (gate) return gate
    const { a, me } = await myProfile(account)
    if (!me) return failed(a, 'own profile')
    return { ok: true, account: a.account, me }
  })
}

async function trendList(account: PinterestAccountRef, country: string, type: TrendType, count: number) {
  const date = await resource(account, api('/v3/trends/latest_available_date/', {}))
  if (!date.ok) return { a: date, terms: [] as TrendTerm[], date: null }
  const a = await resource(account, api('/v3/trends/top/search_query/', {
    country, end_date: mapTrends(date.data).date ?? '', num_terms_to_return: count, trends_preset: TREND_TYPES[type],
  }))
  const t = mapTrends(a.data)
  return { a, terms: t.terms, date: t.date }
}

/** Pinterest Trends: the top search terms of a country, with week/month/year change. */
export function pinterestTrends(o: { country?: unknown; type?: unknown; limit?: unknown; account?: PinterestAccountRef } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const country = checkCountry(o.country)
    const type = checkTrendType(o.type)
    const gate = await needsSignIn(o.account, 'pinterest_trends')
    if (gate) return gate
    const { a, terms, date } = await trendList(o.account, country, type, clampLimit(o.limit, 25, 50))
    if (!a.ok) {
      if (a.status === 400) return { ok: false, account: a.account, error: `Pinterest Trends has no data for country "${country}" — try US, GB, CA, AU, DE or FR` }
      return failed(a, 'trends')
    }
    return { ok: true, account: a.account, country, type, date, terms }
  })
}

/** Audience insights from the business hub: ages, genders, devices, metros, interests. */
export function pinterestAudience(account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const gate = await needsSignIn(account, 'pinterest_audience')
    if (gate) return gate
    const { a: m, me } = await myProfile(account)
    if (!me?.id) return failed(m, 'own profile')
    const a = await resource(account, { resource: 'AudienceInsightsDataResource', options: {
      business_id: me.id, audience_business_id: '0', audience_type: 'NC_IMPRESSION_PLUS_ENGAGEMENT_30d', audience_id: '0',
      advertiser_id: '0', should_return_comparison_audience: false, is_comparison_tab: false,
    }, ...HUB })
    if (!a.ok) return failed(a, 'audience insights')
    const audience = mapAudience(a.data)
    return audience ? { ok: true, account: a.account, audience } : { ok: false, account: a.account, error: 'no audience insights — they need a business account' }
  })
}

/** The account's own boards, secret ones included. */
export function pinterestMyBoards(o: PageOptions = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const bookmark = checkBookmark(o.bookmark)
    const gate = await needsSignIn(o.account, 'pinterest_my_boards')
    if (gate) return gate
    const { a: m, me } = await myProfile(o.account)
    if (!me?.username) return failed(m, 'own profile')
    const a = await resource(o.account, { resource: 'BoardsResource', options: {
      username: me.username, page_size: clampLimit(o.limit), privacy_filter: 'all', sort: 'last_pinned_to', field_set_key: 'detailed',
      ...(bookmark ? { bookmarks: [bookmark] } : {}),
    }, ...HUB })
    if (!a.ok) return failed(a, 'own boards')
    return { ok: true, account: a.account, username: me.username, boards: mapBoards(a.data), nextBookmark: nextBookmark(a.bookmark) }
  })
}

/** Direct-message conversations: who, unread count, last message. */
export function pinterestInbox(account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const gate = await needsSignIn(account, 'pinterest_inbox')
    if (gate) return gate
    const a = await resource(account, { resource: 'ConversationsResource', options: { field_set_key: 'default' }, ...HUB })
    if (!a.ok) return failed(a, 'inbox')
    return { ok: true, account: a.account, conversations: mapConversations(a.data) }
  })
}

/** Unread counts: notifications, unseen conversations, unread comments on own pins. */
export function pinterestNotifications(account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const gate = await needsSignIn(account, 'pinterest_notifications')
    if (gate) return gate
    const badge = await resource(account, { resource: 'NewsHubBadgeResource', options: {}, ...HUB })
    if (!badge.ok) return failed(badge, 'notifications')
    const b = (badge.data ?? {}) as Record<string, unknown>
    const { me } = await myProfile(account)
    const inter = me?.id ? await resource(account, api(`/v3/interactions/users/${me.id}/`, { page_size: 10 })) : null
    // news_hub_count comes as a number, interactions' unread as a string ("0").
    const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null)
    return {
      ok: true, account: badge.account,
      notifications: n(b.news_hub_count),
      unseenConversations: n(b.conversations_unseen_count),
      unreadComments: n((inter?.data as { unread?: unknown } | null | undefined)?.unread),
    }
  })
}

/**
 * Niche research in one call: Pinterest's autocomplete for the niche, the
 * country's four trend lists matched against it, then signed-in search on the
 * best phrases, rolled up into top pins, outliers, creators, outbound domains
 * and the words winning pins use. Read-only; about 12 requests, one at a time.
 */
export function pinterestNicheResearch(o: { niche?: unknown; country?: unknown; queries?: unknown; account?: PinterestAccountRef } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const niche = typeof o.niche === 'string' ? o.niche.trim().slice(0, 100) : ''
    if (!niche) return { ok: false, error: 'niche is empty' }
    const country = checkCountry(o.country)
    const queries = typeof o.queries === 'number' && o.queries >= 1 ? Math.min(5, Math.floor(o.queries)) : 3
    const gate = await needsSignIn(o.account, 'pinterest_niche_research')
    if (gate) return gate
    const sug = await pinterestSuggest(niche, o.account)
    const keywords = sug.ok ? (sug.suggestions as { query: string }[]).map(s => s.query) : []
    const lists: Partial<Record<TrendType, TrendTerm[]>> = {}
    let trendNote: string | null = null
    for (const type of Object.keys(TREND_TYPES) as TrendType[]) {
      const { a, terms } = await trendList(o.account, country, type, 50)
      if (!a.ok) { trendNote = a.status === 400 ? `no Pinterest Trends data for ${country}` : `trends failed (${a.status})`; break }
      lists[type] = terms
    }
    const phrases = [niche, ...keywords.filter(k => k.toLowerCase() !== niche.toLowerCase())].slice(0, queries)
    const pins: PinSummary[] = []
    const searched: { query: string; pins: number; error?: string }[] = []
    for (const q of phrases) {
      const r = await pinterestSearch(q, { account: o.account, limit: 50 })
      const got = r.ok ? (r.pins as PinSummary[]) : []
      searched.push({ query: q, pins: got.length, ...(r.ok ? {} : { error: r.error }) })
      pins.push(...got)
    }
    return {
      ok: true,
      account: pinterestAccount(o.account)?.id,
      niche,
      country,
      keywords,
      trendMatches: matchTrends(niche, lists),
      trendNote,
      searched,
      ...nicheReport(pins),
    }
  })
}

// ── Writes ───────────────────────────────────────────────────────────────────
// Wire format captured from the web app itself (see pinterestBridge.ts). Each
// call is one real action on the account: callers must have the user's yes.

type WriteAnswer = ResourceAnswer & { account?: string; endpoint?: string | null; step?: string }

async function write(account: PinterestAccountRef, call: WriteCall, timeoutMs?: number): Promise<WriteAnswer> {
  const out = await runPinterest(account, resourcePostScript(call), timeoutMs)
  return { status: 0, ...out, account: typeof out.account === 'string' ? out.account : undefined }
}

function writeFailed(a: WriteAnswer, what: string): PinterestResult {
  const why = a.error ?? (a.message ? `${a.message}` : `pinterest answered ${a.status}${a.code ? ` (code ${a.code})` : ''}`)
  return { ok: false, account: a.account, error: `${what} failed: ${why}`, ...(a.step ? { step: a.step } : {}) }
}

const idOf = (data: unknown): string | null => {
  const id = (data as { id?: unknown } | null)?.id
  return typeof id === 'string' && id ? id : null
}

/** A new board on the account; secret unless `secret: false`. */
export function pinterestCreateBoard(o: { name?: unknown; description?: unknown; secret?: unknown; account?: PinterestAccountRef } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const name = checkBoardName(o.name)
    const description = checkDescription(o.description)
    const gate = await needsSignIn(o.account, 'pinterest_create_board')
    if (gate) return gate
    const { a: m, me } = await myProfile(o.account)
    if (!me?.username) return failed(m, 'own profile')
    const privacy = o.secret === false ? 'public' : 'secret'
    const a = await write(o.account, { resource: 'BoardResource', action: 'create', options: {
      name, description, privacy, collab_board_email: true, aux_data: { source: 'profile' },
    }, sourceUrl: `/${me.username}/_saved/`, handler: 'www/[username]/_saved.js' })
    if (!a.ok) return writeFailed(a, 'create board')
    const d = (a.data ?? {}) as { url?: unknown }
    return { ok: true, account: a.account, board: { id: idOf(a.data), name, privacy, url: typeof d.url === 'string' ? `https://www.pinterest.com${d.url}` : null } }
  })
}

/** Saves (repins) an existing pin to one of the account's boards. */
export function pinterestSavePin(o: { pinId?: unknown; boardId?: unknown; account?: PinterestAccountRef } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const pinId = checkPinId(o.pinId)
    const boardId = checkBoardId(o.boardId)
    const gate = await needsSignIn(o.account, 'pinterest_save_pin')
    if (gate) return gate
    const a = await write(o.account, { resource: 'RepinResource', action: 'create', options: {
      board_id: boardId, pin_id: pinId, description: ' ', title: '', link: null, image_url: '', image_base64: '',
      is_buyable_pin: false, is_removable: false, media_upload_id: '',
    }, sourceUrl: `/pin/${pinId}/`, handler: 'www/pin/[id].js' })
    if (!a.ok) return writeFailed(a, 'save pin')
    const id = idOf(a.data)
    return { ok: true, account: a.account, savedPin: { id, url: id ? `https://www.pinterest.com/pin/${id}/` : null, boardId } }
  })
}

async function loadImage(path: unknown): Promise<{ base64: string; mime: string; name: string }> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('imagePath must be an absolute path to a .png, .jpg, .jpeg or .webp file')
  const mime = IMAGE_TYPES[extname(path).toLowerCase()]
  if (!mime) throw new Error('imagePath must be a .png, .jpg, .jpeg or .webp file')
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new Error(`image not found: ${path}`)
  if (info.size > MAX_IMAGE_BYTES) throw new Error('image is larger than 20 MB')
  return { base64: (await readFile(path)).toString('base64'), mime, name: basename(path) }
}

/**
 * A new pin from a local image on one of the account's boards, published now
 * or — with publishAt — scheduled (business accounts).
 */
export function pinterestCreatePin(o: {
  imagePath?: unknown; boardId?: unknown; title?: unknown; description?: unknown; link?: unknown; altText?: unknown
  publishAt?: unknown; account?: PinterestAccountRef
} = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const boardId = checkBoardId(o.boardId)
    const title = checkTitle(o.title, true)
    const description = checkDescription(o.description)
    const link = checkLink(o.link)
    const altText = checkText(o.altText, 'altText', 500)
    const publishAt = o.publishAt === undefined || o.publishAt === null || o.publishAt === '' ? null : checkPublishAt(o.publishAt)
    const image = await loadImage(o.imagePath)
    const gate = await needsSignIn(o.account, 'pinterest_create_pin')
    if (gate) return gate
    const out = await runPinterest(o.account, createPinScript({ boardId, title, description, link, altText, publishAt, image }), 120_000)
    const a: WriteAnswer = { status: 0, ...out, account: typeof out.account === 'string' ? out.account : undefined }
    if (!a.ok) return writeFailed(a, publishAt ? 'schedule pin' : 'create pin')
    const id = idOf(a.data)
    return publishAt
      ? { ok: true, account: a.account, scheduledPin: { id, publishAt: new Date(publishAt * 1000).toISOString(), boardId, title } }
      : { ok: true, account: a.account, pin: { id, url: id ? `https://www.pinterest.com/pin/${id}/` : null, boardId, title } }
  })
}

/**
 * Edits the account's own pin. Pinterest's edit replaces every field, so the
 * pin is read first and only the given fields change.
 */
export function pinterestEditPin(o: {
  pinId?: unknown; title?: unknown; description?: unknown; link?: unknown; altText?: unknown; boardId?: unknown; account?: PinterestAccountRef
} = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const id = checkPinId(o.pinId)
    const changes = {
      ...(o.title !== undefined ? { title: checkTitle(o.title) } : {}),
      ...(o.description !== undefined ? { description: checkDescription(o.description) } : {}),
      ...(o.link !== undefined ? { link: checkLink(o.link) } : {}),
      ...(o.altText !== undefined ? { alt_text: checkText(o.altText, 'altText', 500) } : {}),
      ...(o.boardId !== undefined ? { board_id: checkBoardId(o.boardId) } : {}),
    }
    if (!Object.keys(changes).length) return { ok: false, error: 'nothing to change — give title, description, link, altText or boardId' }
    const gate = await needsSignIn(o.account, 'pinterest_edit_pin')
    if (gate) return gate
    const cur = await resource(o.account, { resource: 'PinResource', options: { id, field_set_key: 'detailed' }, sourceUrl: `/pin/${id}/`, handler: 'www/pin/[id].js' })
    if (!cur.ok) return failed(cur, `pin ${id}`)
    const p = (cur.data ?? {}) as Record<string, unknown>
    const s = (v: unknown) => (typeof v === 'string' ? v : '')
    const a = await write(o.account, { resource: 'PinResource', action: 'update', options: {
      id, title: s(p.title), description: s(p.description), link: s(p.link), alt_text: s(p.alt_text),
      board_id: s((p.board as { id?: unknown } | undefined)?.id), board_section_id: null, pin_additional_note: '',
      disable_comments: false, disable_did_it: false, is_shuffle_remixable: false, shopping_rec_disabled: false,
      user_mention_tags: '[]', product_pins: [], idea_pin_details_template_type: null,
      ...changes,
    }, sourceUrl: `/pin/${id}/`, handler: 'www/pin/[id].js' })
    if (!a.ok) return writeFailed(a, 'edit pin')
    return { ok: true, account: a.account, pin: { id, url: `https://www.pinterest.com/pin/${id}/`, changed: Object.keys(changes) } }
  })
}

/** Deletes one of the account's own pins. Cannot be undone. */
export function pinterestDeletePin(o: { pinId?: unknown; account?: PinterestAccountRef } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const id = checkPinId(o.pinId)
    const gate = await needsSignIn(o.account, 'pinterest_delete_pin')
    if (gate) return gate
    const a = await write(o.account, { resource: 'PinResource', action: 'delete', options: { id }, sourceUrl: `/pin/${id}/`, handler: 'www/pin/[id].js' })
    if (!a.ok) return writeFailed(a, 'delete pin')
    return { ok: true, account: a.account, deletedPin: id }
  })
}

/** Deletes one of the account's boards and every pin on it. Cannot be undone. */
export function pinterestDeleteBoard(o: { boardId?: unknown; account?: PinterestAccountRef } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const boardId = checkBoardId(o.boardId)
    const gate = await needsSignIn(o.account, 'pinterest_delete_board')
    if (gate) return gate
    const { a: m, me } = await myProfile(o.account)
    if (!me?.username) return failed(m, 'own profile')
    const a = await write(o.account, { resource: 'BoardResource', action: 'delete', options: { board_id: boardId },
      sourceUrl: `/${me.username}/_saved/`, handler: 'www/[username]/_saved.js' })
    if (!a.ok) return writeFailed(a, 'delete board')
    return { ok: true, account: a.account, deletedBoard: boardId }
  })
}

/** Pins waiting to be published (business accounts). */
export function pinterestScheduledPins(account?: PinterestAccountRef): Promise<PinterestResult> {
  return guarded(async () => {
    const gate = await needsSignIn(account, 'pinterest_scheduled_pins')
    if (gate) return gate
    const a = await resource(account, { resource: 'ScheduledPinsResource', options: { field_set_key: 'default' }, ...HUB })
    if (!a.ok) return failed(a, 'scheduled pins')
    return { ok: true, account: a.account, scheduledPins: mapScheduledPins(a.data) }
  })
}

/** Cancels a scheduled pin before it publishes. */
export function pinterestDeleteScheduledPin(o: { scheduledPinId?: unknown; account?: PinterestAccountRef } = {}): Promise<PinterestResult> {
  return guarded(async () => {
    const id = checkPinId(o.scheduledPinId)
    const gate = await needsSignIn(o.account, 'pinterest_delete_scheduled_pin')
    if (gate) return gate
    const { a: m, me } = await myProfile(o.account)
    if (!me?.username) return failed(m, 'own profile')
    const a = await write(o.account, { resource: 'ApiResource', action: 'delete', options: { url: `/v3/scheduledpins/${id}/`, data: {} },
      sourceUrl: `/${me.username}/scheduled-pin/${id}/`, handler: 'www/[username]/scheduled-pin/[scheduled_pin_id].js' })
    if (!a.ok) return writeFailed(a, 'delete scheduled pin')
    return { ok: true, account: a.account, deletedScheduledPin: id }
  })
}
