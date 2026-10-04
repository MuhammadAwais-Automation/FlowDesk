/**
 * Main-process access to the Facebook feed bridge.
 *
 * Follows the same shared-call pattern as linkedin.ts and whatsapp.ts: the IPC
 * handlers and the agent tool layer both go through this so the executeJavaScript
 * string is built in exactly one place.
 */

import type { WebContents } from 'electron'
import { findAnyViewByUrl, ensureBackgroundView } from './sessions'
import { feedScript, reactScript, commentScript, replyScript, shareScript, followScript, hideScript, type ReactionType, type SharePrivacy } from './facebookBridge'

export interface FacebookResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

const NOT_OPEN =
  'Facebook is not open. Open the Social page in FlowDesk, select Facebook and sign in, then retry.'

// Visible tab first, else the hidden background window — the MCP/agent path
// must work without the Social page ever being opened.
async function getFacebookView(): Promise<{ webContents: WebContents } | null> {
  const existing = findAnyViewByUrl('facebook.com')
  if (existing) return existing
  try {
    return await ensureBackgroundView('social-facebook', 'social-facebook', 'https://www.facebook.com')
  } catch {
    return null
  }
}

async function call(script: string): Promise<FacebookResult> {
  const view = await getFacebookView()
  if (!view) return { ok: false, error: NOT_OPEN }
  try {
    const result = await view.webContents.executeJavaScript(script)
    if (result && typeof result === 'object') return result as FacebookResult
    return { ok: false, error: `bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const MAX_FEED_COUNT = 20

/**
 * Reads the news feed. Read-only.
 */
export function fbFeed(count?: number, cursor?: string | null): Promise<FacebookResult> {
  const n = Math.min(Math.max(count ?? 5, 1), MAX_FEED_COUNT)
  return call(feedScript(n, cursor ?? null))
}

/**
 * Reacts to a post. `feedbackId` comes from a facebook_feed result, not the
 * post id — the mutation rejects a bare post id.
 */
export function fbReact(feedbackId: string, reactionType: ReactionType): Promise<FacebookResult> {
  return call(reactScript(feedbackId, reactionType))
}

const MAX_COMMENT_LENGTH = 8000

/**
 * Comments on a post. `feedbackId` comes from a facebook_feed result.
 * `groupId` is only needed when the post lives inside a group — confirmed
 * live that a plain feed post accepts groupID: null.
 */
export function fbComment(feedbackId: string, text: string, groupId?: string | null): Promise<FacebookResult> {
  const body = String(text ?? '').trim()
  if (!body) return Promise.resolve({ ok: false, error: 'refusing to submit an empty comment' })
  if (body.length > MAX_COMMENT_LENGTH) {
    return Promise.resolve({ ok: false, error: `the comment is ${body.length} characters; keep it under ${MAX_COMMENT_LENGTH}` })
  }
  return call(commentScript(feedbackId, body, groupId ?? null))
}

/**
 * Replies to a comment, addressed by the post's id and the comment's own id
 * (both numeric, both from a comments-reading tool once one exists).
 */
export function fbReply(postId: string, commentId: string, text: string, groupId?: string | null): Promise<FacebookResult> {
  const body = String(text ?? '').trim()
  if (!body) return Promise.resolve({ ok: false, error: 'refusing to submit an empty reply' })
  if (body.length > MAX_COMMENT_LENGTH) {
    return Promise.resolve({ ok: false, error: `the reply is ${body.length} characters; keep it under ${MAX_COMMENT_LENGTH}` })
  }
  return call(replyScript(postId, commentId, body, groupId ?? null))
}

/**
 * Shares (reposts) a post to the feed. `permalink` comes from a facebook_feed
 * result. `privacy` defaults to 'FRIENDS' — the only value confirmed live;
 * 'SELF'/'EVERYONE' are Facebook's stable Graph API vocabulary but unverified
 * against this specific mutation.
 */
export function fbShare(permalink: string, message?: string, privacy?: SharePrivacy): Promise<FacebookResult> {
  const link = String(permalink ?? '').trim()
  if (!link) return Promise.resolve({ ok: false, error: 'refusing to share without a permalink' })
  return call(shareScript(link, message ?? '', privacy ?? 'FRIENDS'))
}

/**
 * Follows a profile. `authorId` comes from a facebook_feed result. Only the
 * follow direction is supported — unfollow uses a different, not-yet-captured
 * mutation.
 */
export function fbFollow(authorId: string): Promise<FacebookResult> {
  const id = String(authorId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to follow without an authorId' })
  return call(followScript(id))
}

/**
 * Hides a post ("See fewer posts like this"). `nodeId` comes from a
 * facebook_feed result. Only hiding a single post is supported — snooze and
 * unfollow-via-this-menu are not, since neither has been captured live yet.
 */
export function fbHide(nodeId: string): Promise<FacebookResult> {
  const id = String(nodeId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to hide without a nodeId' })
  return call(hideScript(id))
}
