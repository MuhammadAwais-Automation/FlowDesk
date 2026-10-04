/**
 * Creating a LinkedIn post.
 *
 * ── Why this is not a UI-driving tool, unlike liking and commenting ──
 *
 * The first version of this file drove the real composer: find the share box,
 * send a trusted CDP click, wait for the composer, type, submit. That was built
 * because liking and commenting had to be done that way — both are Server-Driven
 * UI, and their requests carry binding keys derived from a page load rather
 * than any data, so there is nothing to replay.
 *
 * Posting turned out not to be like that at all, and the way to find out was
 * cheap: publish one post by hand with the CDP recorder running, then read what
 * went over the wire. The text was there in plain sight:
 *
 *   POST /voyager/api/graphql?action=execute&queryId=voyagerContentcreationDashShares.<hash>
 *   {"variables":{"post":{...,"commentary":{"text":"<the post>","attributesV2":[]}}}}
 *   -> 200, "*entity":"urn:li:fsd_share:urn:li:share:7497263200586039296"
 *
 * So the whole UI path was deleted. What it cost to keep would have been real:
 * a visible tab navigation on every post, a click at coordinates that move
 * whenever the feed layout changes, a composer whose internals could not be
 * read without opening it, and a submit control that had to be told apart from
 * a button of the same name. None of that is needed to send one request.
 *
 * The lesson is the one this project keeps relearning: check what the app
 * actually does before building around what it appears to do.
 */

import { getLinkedInView } from './linkedin'
import { readFile } from 'node:fs/promises'
import { createPostScript, deletePostScript, deleteCommentScript, type PostVisibility, type CreatePostOptions } from './linkedinBridge'
import type { LinkedInResult } from './linkedin'

export const MAX_POST_LENGTH = 3000

const NOT_OPEN =
  'LinkedIn is not open. Open the Social page in FlowDesk, select LinkedIn and sign in, then retry.'

/**
 * Publishes one post.
 *
 * Approval happens in the tool layer above this — the only place that can show
 * the user the exact wording and who will see it, and get a real answer.
 */
export interface CreatePostArgs {
  visibility?: PostVisibility
  asDraft?: boolean
  /** Epoch ms to publish at; makes it a scheduled post. Must be in the future. */
  scheduledAt?: number | null
  /** Local path to a PNG/JPEG to attach. Read here and passed as base64. */
  imagePath?: string | null
  imageAltText?: string
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export async function liCreatePost(text: string, args: CreatePostArgs = {}): Promise<LinkedInResult> {
  const body = String(text ?? '').trim()
  if (!body && !args.imagePath) return { ok: false, error: 'refusing to create an empty post' }
  if (body.length > MAX_POST_LENGTH) {
    return { ok: false, error: `the post is ${body.length} characters; the LinkedIn limit is ${MAX_POST_LENGTH}` }
  }
  if (args.scheduledAt != null) {
    if (!Number.isFinite(args.scheduledAt)) return { ok: false, error: 'scheduledAt must be epoch milliseconds' }
    if (args.scheduledAt <= Date.now()) return { ok: false, error: 'scheduledAt must be in the future' }
    if (args.asDraft) return { ok: false, error: 'a post cannot be both a draft and scheduled — choose one' }
  }

  const options: CreatePostOptions = {
    visibility: args.visibility,
    asDraft: args.asDraft,
    scheduledAt: args.scheduledAt ?? null,
  }

  // The image is read here, in the main process, not in the page: the page has
  // no access to the filesystem, and reading it here also lets an oversized or
  // missing file fail with a clear message before any network call is made.
  if (args.imagePath) {
    let bytes: Buffer
    try {
      bytes = await readFile(args.imagePath)
    } catch (e) {
      return { ok: false, error: `could not read the image at ${args.imagePath}: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, error: `the image is ${(bytes.length / 1024 / 1024).toFixed(1)}MB; keep it under 8MB` }
    }
    options.image = { base64: bytes.toString('base64'), altText: args.imageAltText ?? '' }
  }

  const view = await getLinkedInView().catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }

  try {
    const result = await view.webContents.executeJavaScript(createPostScript(body, options))
    if (result && typeof result === 'object') return result as LinkedInResult
    return { ok: false, error: `the bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Deletes one of the user's own posts, addressed by its activity id.
 *
 * There is no undo. Approval happens in the tool layer above this, which is the
 * only place that can show the user WHICH post — and for a delete, showing the
 * post's own text is the only description they can actually check.
 */
export async function liDeletePost(activityId: string): Promise<LinkedInResult> {
  if (!/^[0-9]+$/.test(String(activityId))) {
    return { ok: false, error: `activityId must be the numeric id from linkedin_my_posts — got: ${activityId}` }
  }

  const view = await getLinkedInView().catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }

  try {
    const result = await view.webContents.executeJavaScript(deletePostScript(activityId))
    if (result && typeof result === 'object') return result as LinkedInResult
    return { ok: false, error: `the bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Deletes one of the user's own comments.
 *
 * Addressed by the post's activity id and the comment id. There is no undo, so
 * approval happens in the tool layer above — showing the comment's own text is
 * the only description the user can actually check.
 */
export async function liDeleteComment(activityId: string, commentId: string): Promise<LinkedInResult> {
  if (!/^[0-9]+$/.test(String(activityId))) {
    return { ok: false, error: `activityId must be numeric — got: ${activityId}` }
  }
  if (!/^[0-9]+$/.test(String(commentId))) {
    return { ok: false, error: `commentId must be numeric — got: ${commentId}` }
  }

  const view = await getLinkedInView().catch(() => null)
  if (!view) return { ok: false, error: NOT_OPEN }

  try {
    const result = await view.webContents.executeJavaScript(deleteCommentScript(activityId, commentId))
    if (result && typeof result === 'object') return result as LinkedInResult
    return { ok: false, error: `the bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
