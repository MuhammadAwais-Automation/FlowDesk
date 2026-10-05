/**
 * Main-process access to Pinterest.
 *
 * Every call targets one account from the social registry (socialAccounts.ts)
 * and runs inside that account's own hidden window (`persist:<partition>`), so
 * requests carry the page's own cookies and CSRF token. An explicit account
 * that is not registered fails before any page is touched.
 */
import type { WebContents } from 'electron'
import { ensureBackgroundView } from './sessions'
import { isSignedIn, resolveSocialAccount, type SocialAccount } from './socialAccounts'
import {
  checkBoardId, checkBoardUrl, checkBookmark, checkPinId, checkUsername, clampLimit, mapBoards, mapPin, mapPins,
  mapSuggestions, mapUser, nextBookmark, pinOutliers, resourceGetScript,
  type PinSummary, type ResourceAnswer, type ResourceCall,
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
