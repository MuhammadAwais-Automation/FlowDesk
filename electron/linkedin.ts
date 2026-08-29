/**
 * Main-process access to the LinkedIn messaging bridge.
 *
 * Shared by the IPC handlers and the Agent tool layer for the same reason
 * whatsapp.ts is: two callers building their own executeJavaScript strings
 * means two places to fix when the bridge changes, and one of them quietly
 * drifting out of step.
 *
 * Unlike WhatsApp, nothing is injected ahead of time — see linkedinBridge.ts.
 * Each call ships its own self-contained script, so navigation, reloads and
 * LinkedIn's own redirects cannot leave a stale bridge behind.
 */

import { findViewByUrl } from './sessions'
import {
  statusScript,
  listChatsScript,
  listMessagesScript,
  unreadScript,
  findPeopleScript,
  sendScript,
  markReadScript,
} from './linkedinBridge'
import {
  feedScript,
  myPostsScript,
  notificationsScript,
  postCommentsScript,
  searchScript,
} from './linkedinReadBridge'
import { linkedInWatchStatus } from './linkedinRealtimeWatch'

export interface LinkedInResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

/**
 * The failure every call shares is the view not being open, reported as a
 * normal result rather than a thrown error: the usual caller is an agent
 * deciding what to do next, and "not open" is a state to act on, not an
 * exception to propagate.
 */
async function call(script: string): Promise<LinkedInResult> {
  const view = findViewByUrl('linkedin.com')
  if (!view) return { ok: false, error: NOT_OPEN }
  try {
    const result = await view.webContents.executeJavaScript(script)
    if (result && typeof result === 'object') return result as LinkedInResult
    return { ok: false, error: `bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function liStatus(): Promise<LinkedInResult> {
  return call(statusScript())
}

export function liListChats(options: { limit?: number; cursor?: string; onlyUnread?: boolean } = {}): Promise<LinkedInResult> {
  return call(listChatsScript(options))
}

export function liListMessages(conversationUrn: string, limit?: number, before?: number): Promise<LinkedInResult> {
  return call(listMessagesScript({ conversationUrn, limit, before }))
}

export function liUnread(): Promise<LinkedInResult> {
  return call(unreadScript())
}

/**
 * Finds someone you already have a conversation with, and returns the
 * conversationUrn that liSend needs. Does not search all of LinkedIn — see
 * findPeopleScript for why that is the right boundary here.
 */
export function liFindPeople(query: string, pages?: number): Promise<LinkedInResult> {
  return call(findPeopleScript(query, pages))
}

/**
 * Sending is a user-approved action. This function does NOT ask — approval is
 * obtained in the tool layer, which is the only place that knows who is asking
 * and can show the recipient and text before anything is sent. Callers that
 * skip that step are the bug.
 */
export function liSend(conversationUrn: string, text: string): Promise<LinkedInResult> {
  return call(sendScript(conversationUrn, text))
}

/**
 * Whether the realtime push channel is being watched right now. Answers the
 * question an empty event list cannot: nothing happened, or nothing was
 * listening?
 */
export function liWatchStatus(): LinkedInResult {
  // `error: null` is meaningful here — "checked, nothing wrong" — but
  // LinkedInResult reserves `error` for a failed call, and conflating the two
  // would make a healthy watcher look like a broken one. It is reported under
  // its own name instead.
  const { error, ...watch } = linkedInWatchStatus()
  return { ok: true, ...watch, watcherError: error }
}

export function liMarkRead(): Promise<LinkedInResult> {
  return call(markReadScript())
}

// ── Read surfaces beyond messaging ───────────────────────────────────
//
// All read-only. See linkedinReadBridge.ts for which of these ride on legacy
// routes the current LinkedIn client no longer uses — those are the ones most
// likely to stop working without notice.

export function liFeed(limit?: number, start?: number, sortBy?: string): Promise<LinkedInResult> {
  return call(feedScript({ limit, start, sortBy }))
}

export function liPostComments(activityId: string, limit?: number): Promise<LinkedInResult> {
  return call(postCommentsScript({ activityId, limit }))
}

export function liSearch(query: string, resultType?: string, limit?: number): Promise<LinkedInResult> {
  return call(searchScript({ query, resultType, limit }))
}

export function liMyPosts(limit?: number, start?: number): Promise<LinkedInResult> {
  return call(myPostsScript({ limit, start }))
}

export function liNotifications(limit?: number, onlyUnread?: boolean): Promise<LinkedInResult> {
  return call(notificationsScript({ limit, onlyUnread }))
}
