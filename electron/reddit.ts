/**
 * Main-process access to the Reddit bridge.
 *
 * Runs inside the authenticated Reddit webContents via executeJavaScript.
 * Does not require ahead-of-time injection: each call ships a self-contained
 * script that runs in the active page session partition.
 */

import type { WebContents } from 'electron'
import { findAnyViewByUrl, ensureBackgroundView, rememberedView } from './sessions'
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

async function getRedditView(): Promise<{ webContents: WebContents }> {
  const existing = findAnyViewByUrl('reddit.com')
  if (existing) return existing

  // The profile the Social page actually signed in with, not a fixed name.
  const { tabId, partition } = rememberedView('reddit') ?? { tabId: 'social-reddit', partition: 'social-reddit' }
  const bg = await ensureBackgroundView(tabId, partition, 'https://www.reddit.com')
  await new Promise(r => setTimeout(r, 3500))
  return bg
}

async function call(script: string, timeoutMs = 15000): Promise<RedditResult> {
  let view: { webContents: WebContents }
  try {
    view = await getRedditView()
  } catch (e) {
    return { ok: false, error: `Could not launch Reddit background view: ${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    const execPromise = view.webContents.executeJavaScript(script)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Reddit bridge execution timed out after ${timeoutMs}ms`)), timeoutMs),
    )
    const result = await Promise.race([execPromise, timeoutPromise])
    if (result && typeof result === 'object') return result as RedditResult
    return { ok: false, error: `bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function rdStatus(): Promise<RedditResult> {
  return call(redditStatusScript())
}

export function rdFeed(options: RedditFeedOptions = {}): Promise<RedditResult> {
  return call(redditFeedScript(options))
}

export function rdPostComments(subreddit: string, postId: string, limit?: number): Promise<RedditResult> {
  return call(redditPostCommentsScript(subreddit, postId, limit))
}

export function rdSearch(query: string, sort?: 'relevance' | 'hot' | 'top' | 'new', limit?: number, t?: RedditTimeFilter): Promise<RedditResult> {
  return call(redditSearchScript(query, sort, limit, t))
}

export function rdVotePost(postId: string, voteState: 'UP' | 'DOWN' | 'NONE'): Promise<RedditResult> {
  return call(redditVotePostScript(postId, voteState))
}

export function rdVoteComment(commentId: string, voteState: 'UP' | 'DOWN' | 'NONE'): Promise<RedditResult> {
  return call(redditVoteCommentScript(commentId, voteState))
}

export function rdCreateComment(postId: string, parentId: string, text: string): Promise<RedditResult> {
  return call(redditCreateCommentScript(postId, parentId, text))
}

export function rdCreatePost(subredditName: string, title: string, textContent?: string): Promise<RedditResult> {
  return call(redditCreatePostScript(subredditName, title, textContent))
}

export function rdSubscribe(subredditId: string, subscribeState: 'SUBSCRIBED' | 'UNSUBSCRIBED'): Promise<RedditResult> {
  return call(redditSubscribeScript(subredditId, subscribeState))
}

export function rdMarkRead(): Promise<RedditResult> {
  return call(redditMarkReadScript())
}

export function rdApiFeed(options: RedditApiFeedOptions = {}): Promise<RedditResult> {
  return call(redditApiFeedScript(options))
}

export function rdApiSearch(query: string, options: RedditApiSearchOptions = {}): Promise<RedditResult> {
  return call(redditApiSearchScript(query, options))
}

export function rdApiPostComments(postId: string, options?: { limit?: number } | number): Promise<RedditResult> {
  const limit = typeof options === 'number' ? options : options?.limit
  return call(redditApiPostCommentsScript(postId, limit))
}

export function rdApiOutlier(subreddit: string, minMultiplier?: number, options: RedditOutlierOptions = {}): Promise<RedditResult> {
  return call(redditOutlierScript(subreddit, minMultiplier, options))
}
