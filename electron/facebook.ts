/**
 * Main-process access to the Facebook feed bridge.
 *
 * Follows the same shared-call pattern as linkedin.ts and whatsapp.ts: the IPC
 * handlers and the agent tool layer both go through this so the executeJavaScript
 * string is built in exactly one place.
 */

import { session, type WebContents } from 'electron'
import { getViewById, ensureBackgroundView } from './sessions'
import { resolveSocialAccount, SOCIAL_HOME, type SocialAccount } from './socialAccounts'
import { feedScript, reactScript, commentScript, replyScript, shareScript, followScript, hideScript, type ReactionType, type SharePrivacy } from './facebookBridge'

export interface FacebookResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/** Which Facebook account a call means: id ("2"), partition or label. Omitted = account 1. */
export type FacebookAccountRef = string | number | null | undefined

const NOT_OPEN =
  'Facebook is not open. Open the Social page in FlowDesk, select Facebook and sign in, then retry.'

function onPartition(wc: WebContents, partition: string): boolean {
  try {
    return !wc.isDestroyed() && wc.session === session.fromPartition(`persist:${partition}`)
  } catch {
    return false
  }
}

// The account's own view only. This used to take ANY open facebook.com view
// first, which with two accounts reads (or posts from) the wrong one. The
// Social page tab and the background window both use the partition as tabId
// (account 1 = social-facebook), and a view is only used when its session is
// provably that partition. The MCP/agent path still works without the Social
// page ever being opened: no tab means a hidden background window.
async function getFacebookView(acc: SocialAccount): Promise<{ webContents: WebContents } | string> {
  let view: { webContents: WebContents } | null = getViewById(acc.partition)
  if (!view) {
    try {
      view = await ensureBackgroundView(acc.partition, acc.partition, SOCIAL_HOME.facebook)
    } catch {
      return NOT_OPEN
    }
  }
  if (!onPartition(view.webContents, acc.partition)) {
    return `the open view for facebook account "${acc.id}" is not on its partition ${acc.partition}; refusing to use it`
  }
  return view
}

/** The registry account, or an error result. Never falls back to another account. */
function facebookAccount(ref: FacebookAccountRef): SocialAccount | FacebookResult {
  const acc = resolveSocialAccount('facebook', ref)
  if (acc) return acc
  return { ok: false, error: `unknown facebook account "${ref}" — list them with social_accounts { platform: "facebook" }` }
}

async function call(script: string, ref?: FacebookAccountRef): Promise<FacebookResult> {
  const acc = facebookAccount(ref)
  if ('ok' in acc) return acc
  const view = await getFacebookView(acc)
  if (typeof view === 'string') return { ok: false, error: view, account: acc.id }
  try {
    const result = await view.webContents.executeJavaScript(script)
    if (result && typeof result === 'object') return { ...(result as FacebookResult), account: acc.id }
    return { ok: false, error: `bridge returned a non-object: ${String(result)}`, account: acc.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: acc.id }
  }
}

/** Refuses an explicit unknown account before any argument or page work. */
export function unknownFacebookAccount(ref: FacebookAccountRef): FacebookResult | null {
  const acc = facebookAccount(ref)
  return 'ok' in acc ? acc : null
}

const MAX_FEED_COUNT = 20
// Facebook answers the first feed page with ~4 units whatever count is asked
// (verified live 2026-10-04: count 5, 10 and 20 all returned 4), so the read
// follows nextCursor until count is reached. Bounded so one call stays short.
const MAX_FEED_PAGES = 5

/**
 * Reads the news feed. Read-only. May return a few more than `count` when the
 * last page overshoots; nothing is dropped, so nextCursor never skips items.
 */
export async function fbFeed(count?: number, cursor?: string | null, account?: FacebookAccountRef): Promise<FacebookResult> {
  const n = Math.min(Math.max(count ?? 5, 1), MAX_FEED_COUNT)
  const posts: unknown[] = []
  let next: string | null = cursor ?? null
  let hasNextPage: boolean | null = null
  let accountId: unknown
  let docIdFrom: unknown
  let pageDocIdFailed: unknown
  for (let page = 0; page < MAX_FEED_PAGES && posts.length < n; page++) {
    const res = await call(feedScript(n - posts.length, next), account)
    if (!res.ok) {
      if (page === 0) return res
      // Keep what was read; nextCursor still points at the page that failed.
      return { ok: true, count: posts.length, posts, nextCursor: next, hasNextPage, account: accountId, warning: `stopped early: ${res.error}` }
    }
    accountId = res.account
    docIdFrom ??= res.docIdFrom
    pageDocIdFailed ??= res.pageDocIdFailed ? { docId: res.pageDocIdFailed, error: res.pageDocIdError } : undefined
    const got = Array.isArray(res.posts) ? res.posts : []
    posts.push(...got)
    next = typeof res.nextCursor === 'string' && res.nextCursor ? res.nextCursor : null
    hasNextPage = typeof res.hasNextPage === 'boolean' ? res.hasNextPage : null
    if (!got.length || !next || hasNextPage === false) break
  }
  // docIdFrom: 'page' = the page's current doc_id answered; 'pinned' = our stored one (time to refresh it).
  return { ok: true, count: posts.length, posts, nextCursor: next, hasNextPage, account: accountId, docIdFrom, ...(pageDocIdFailed ? { pageDocIdFailed } : {}) }
}

/**
 * Reacts to a post. `feedbackId` comes from a facebook_feed result, not the
 * post id — the mutation rejects a bare post id.
 */
export function fbReact(feedbackId: string, reactionType: ReactionType, account?: FacebookAccountRef): Promise<FacebookResult> {
  const bad = unknownFacebookAccount(account)
  if (bad) return Promise.resolve(bad)
  return call(reactScript(feedbackId, reactionType), account)
}

const MAX_COMMENT_LENGTH = 8000

/**
 * Comments on a post. `feedbackId` comes from a facebook_feed result.
 * `groupId` is only needed when the post lives inside a group — confirmed
 * live that a plain feed post accepts groupID: null.
 */
export function fbComment(feedbackId: string, text: string, groupId?: string | null, account?: FacebookAccountRef): Promise<FacebookResult> {
  const bad = unknownFacebookAccount(account)
  if (bad) return Promise.resolve(bad)
  const body = String(text ?? '').trim()
  if (!body) return Promise.resolve({ ok: false, error: 'refusing to submit an empty comment' })
  if (body.length > MAX_COMMENT_LENGTH) {
    return Promise.resolve({ ok: false, error: `the comment is ${body.length} characters; keep it under ${MAX_COMMENT_LENGTH}` })
  }
  return call(commentScript(feedbackId, body, groupId ?? null), account)
}

/**
 * Replies to a comment, addressed by the post's id and the comment's own id
 * (both numeric, both from a comments-reading tool once one exists).
 */
export function fbReply(postId: string, commentId: string, text: string, groupId?: string | null, account?: FacebookAccountRef): Promise<FacebookResult> {
  const bad = unknownFacebookAccount(account)
  if (bad) return Promise.resolve(bad)
  const body = String(text ?? '').trim()
  if (!body) return Promise.resolve({ ok: false, error: 'refusing to submit an empty reply' })
  if (body.length > MAX_COMMENT_LENGTH) {
    return Promise.resolve({ ok: false, error: `the reply is ${body.length} characters; keep it under ${MAX_COMMENT_LENGTH}` })
  }
  return call(replyScript(postId, commentId, body, groupId ?? null), account)
}

/**
 * Shares (reposts) a post to the feed. `permalink` comes from a facebook_feed
 * result. `privacy` defaults to 'FRIENDS' — the only value confirmed live;
 * 'SELF'/'EVERYONE' are Facebook's stable Graph API vocabulary but unverified
 * against this specific mutation.
 */
export function fbShare(permalink: string, message?: string, privacy?: SharePrivacy, account?: FacebookAccountRef): Promise<FacebookResult> {
  const bad = unknownFacebookAccount(account)
  if (bad) return Promise.resolve(bad)
  const link = String(permalink ?? '').trim()
  if (!link) return Promise.resolve({ ok: false, error: 'refusing to share without a permalink' })
  return call(shareScript(link, message ?? '', privacy ?? 'FRIENDS'), account)
}

/**
 * Follows a profile. `authorId` comes from a facebook_feed result. Only the
 * follow direction is supported — unfollow uses a different, not-yet-captured
 * mutation.
 */
export function fbFollow(authorId: string, account?: FacebookAccountRef): Promise<FacebookResult> {
  const bad = unknownFacebookAccount(account)
  if (bad) return Promise.resolve(bad)
  const id = String(authorId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to follow without an authorId' })
  return call(followScript(id), account)
}

/**
 * Hides a post ("See fewer posts like this"). `nodeId` comes from a
 * facebook_feed result. Only hiding a single post is supported — snooze and
 * unfollow-via-this-menu are not, since neither has been captured live yet.
 */
export function fbHide(nodeId: string, account?: FacebookAccountRef): Promise<FacebookResult> {
  const bad = unknownFacebookAccount(account)
  if (bad) return Promise.resolve(bad)
  const id = String(nodeId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to hide without a nodeId' })
  return call(hideScript(id), account)
}
