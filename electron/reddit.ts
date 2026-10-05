/**
 * Main-process access to the Reddit bridge.
 *
 * Runs inside the authenticated Reddit webContents via executeJavaScript.
 * Does not require ahead-of-time injection: each call ships a self-contained
 * script that runs in the active page session partition.
 *
 * Every call targets one account from the social registry (socialAccounts.ts).
 * No account = account 1, the profile the Social page signed Reddit in with.
 * An explicit account that is not registered fails before any page is touched:
 * reading or writing as the wrong account is worse than an error.
 */

import { session, type WebContents } from 'electron'
import { findAnyViewByUrl, ensureBackgroundView, rememberedView, getViewById } from './sessions'
import { resolveSocialAccount } from './socialAccounts'
import {
  redditStatusScript,
  redditFeedScript,
  redditPostCommentsScript,
  redditVotePostScript,
  redditVoteCommentScript,
  redditCreateCommentScript,
  redditCreatePostScript,
  redditSubscribeScript,
  redditSearchScript,
  redditMarkReadScript,
  redditApiFeedScript,
  redditApiSearchScript,
  redditApiPostCommentsScript,
  redditOutlierScript,
  type RedditFeedOptions,
  type RedditApiFeedOptions,
  type RedditApiSearchOptions,
  type RedditTimeFilter,
  type RedditOutlierOptions,
} from './redditBridge'

export interface RedditResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export type RedditAccountRef = string | number | null | undefined

export interface RedditTarget { accountId: string; label: string; tabId: string; partition: string }

/** Which view an account's calls run in. Null = no such registered account. */
export function redditTarget(ref?: RedditAccountRef): RedditTarget | null {
  const acc = resolveSocialAccount('reddit', ref)
  if (!acc) return null
  // Account 1 keeps the tab the Social page opened (its partition comes from
  // the same rememberedView); account N gets its own numbered tab.
  const tabId = acc.id === '1' ? (rememberedView('reddit')?.tabId ?? 'social-reddit') : `social-reddit-${acc.id}`
  return { accountId: acc.id, label: acc.label, tabId, partition: acc.partition }
}

export function unknownAccountError(ref: RedditAccountRef): RedditResult {
  return { ok: false, error: `unknown reddit account "${ref}" — list them with social_accounts {platform:"reddit"}` }
}

/** True only when the view provably runs in the partition (same session). */
function onPartition(view: { webContents: WebContents }, partition: string): boolean {
  try {
    if (view.webContents.isDestroyed()) return false
    const own = view.webContents.session
    const want = session.fromPartition(`persist:${partition}`)
    if (own === want) return true
    return Boolean(own.storagePath && want.storagePath && own.storagePath === want.storagePath)
  } catch {
    return false
  }
}

async function getRedditView(target: RedditTarget): Promise<{ webContents: WebContents }> {
  // Reuse an open reddit.com view only when it is this account's profile; any
  // other open Reddit view may be signed in as someone else.
  const existing = findAnyViewByUrl('reddit.com')
  if (existing && onPartition(existing, target.partition)) return existing

  const fresh = !getViewById(target.tabId)
  const view = await ensureBackgroundView(target.tabId, target.partition, 'https://www.reddit.com')
  if (!onPartition(view, target.partition)) {
    throw new Error(`view ${target.tabId} is not on account ${target.accountId}'s partition`)
  }
  if (fresh) await new Promise(r => setTimeout(r, 3500))
  return view
}

async function call(script: string, account?: RedditAccountRef, timeoutMs = 15000): Promise<RedditResult> {
  const target = redditTarget(account)
  if (!target) return unknownAccountError(account)
  let view: { webContents: WebContents }
  try {
    view = await getRedditView(target)
  } catch (e) {
    return { ok: false, error: `Could not launch Reddit background view: ${e instanceof Error ? e.message : String(e)}` }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const execPromise = view.webContents.executeJavaScript(script)
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Reddit bridge execution timed out after ${timeoutMs}ms`)), timeoutMs)
    })
    const result = await Promise.race([execPromise, timeoutPromise])
    if (result && typeof result === 'object') return result as RedditResult
    return { ok: false, error: `bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const bad = (error: string): Promise<RedditResult> => Promise.resolve({ ok: false, error })
const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '' || v.trim() === 'r/'
const LISTING_SORTS = ['hot', 'new', 'top', 'rising']
const VOTES = ['UP', 'DOWN', 'NONE']

export function rdStatus(account?: RedditAccountRef): Promise<RedditResult> {
  return call(redditStatusScript(), account)
}

export function rdFeed(options: RedditFeedOptions = {}, account?: RedditAccountRef): Promise<RedditResult> {
  if (options.sort !== undefined && !LISTING_SORTS.includes(options.sort)) return bad(`sort must be one of ${LISTING_SORTS.join(', ')}`)
  return call(redditFeedScript(options), account)
}

export function rdPostComments(subreddit: string, postId: string, limit?: number, account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(postId)) return bad('postId is required')
  return call(redditPostCommentsScript(subreddit, postId, limit), account)
}

export function rdSearch(query: string, sort?: 'relevance' | 'hot' | 'top' | 'new', limit?: number, t?: RedditTimeFilter, account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(query)) return bad('query is required')
  return call(redditSearchScript(query, sort, limit, t), account)
}

export function rdVotePost(postId: string, voteState: 'UP' | 'DOWN' | 'NONE', account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(postId)) return bad('postId is required')
  if (!VOTES.includes(voteState)) return bad('voteState must be UP, DOWN or NONE')
  return call(redditVotePostScript(postId, voteState), account)
}

export function rdVoteComment(commentId: string, voteState: 'UP' | 'DOWN' | 'NONE', account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(commentId)) return bad('commentId is required')
  if (!VOTES.includes(voteState)) return bad('voteState must be UP, DOWN or NONE')
  return call(redditVoteCommentScript(commentId, voteState), account)
}

export function rdCreateComment(postId: string, parentId: string, text: string, account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(postId) || blank(parentId) || blank(text)) return bad('postId, parentId and text are required')
  return call(redditCreateCommentScript(postId, parentId, text), account)
}

export function rdCreatePost(subredditName: string, title: string, textContent?: string, account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(subredditName) || blank(title)) return bad('subreddit and title are required')
  return call(redditCreatePostScript(subredditName, title, textContent), account)
}

export function rdSubscribe(subredditId: string, subscribeState: 'SUBSCRIBED' | 'UNSUBSCRIBED', account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(subredditId)) return bad('subredditId is required')
  if (subscribeState !== 'SUBSCRIBED' && subscribeState !== 'UNSUBSCRIBED') return bad('subscribeState must be SUBSCRIBED or UNSUBSCRIBED')
  return call(redditSubscribeScript(subredditId, subscribeState), account)
}

export function rdMarkRead(account?: RedditAccountRef): Promise<RedditResult> {
  return call(redditMarkReadScript(), account)
}

export function rdApiFeed(options: RedditApiFeedOptions = {}, account?: RedditAccountRef): Promise<RedditResult> {
  if (options.sort !== undefined && !LISTING_SORTS.includes(options.sort)) return bad(`sort must be one of ${LISTING_SORTS.join(', ')}`)
  return call(redditApiFeedScript(options), account)
}

export function rdApiSearch(query: string, options: RedditApiSearchOptions = {}, account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(query)) return bad('query is required')
  return call(redditApiSearchScript(query, options), account)
}

export function rdApiPostComments(postId: string, options?: { limit?: number } | number, account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(postId)) return bad('postId is required')
  const limit = typeof options === 'number' ? options : options?.limit
  return call(redditApiPostCommentsScript(postId, limit), account)
}

export function rdApiOutlier(subreddit: string, minMultiplier?: number, options: RedditOutlierOptions = {}, account?: RedditAccountRef): Promise<RedditResult> {
  if (blank(subreddit)) return bad('subreddit is required')
  return call(redditOutlierScript(subreddit, minMultiplier, options), account)
}
