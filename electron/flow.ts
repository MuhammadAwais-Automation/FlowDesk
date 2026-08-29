/**
 * Main-process access to the Google Flow bridge. Same shared-call pattern as
 * facebook.ts/linkedin.ts: the agent tool layer goes through this so the
 * executeJavaScript string is built in exactly one place.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { app } from 'electron'
import { findViewByUrl } from './sessions'
import {
  generateImageScript, createProjectScript, uploadImageScript,
  generateVideoScript, getVideoStatusScript, getCreditsScript,
  type ImageAspectRatio, type ImageModel, type VideoMode, type VideoModel,
} from './flowBridge'

export interface FlowResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

const NOT_OPEN =
  'Google Flow is not open. Open the Studio page in FlowDesk, select Google Flow, choose a Google account, and open a project, then retry.'

async function call(script: string): Promise<FlowResult> {
  const view = findViewByUrl('labs.google')
  if (!view) return { ok: false, error: NOT_OPEN }
  try {
    const result = await view.webContents.executeJavaScript(script)
    if (result && typeof result === 'object') return result as FlowResult
    return { ok: false, error: `bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const MAX_PROMPT_LENGTH = 4000

/**
 * Generates one image in an existing Flow project. `projectId` comes from
 * the project's own URL (labs.google/fx/tools/flow/project/<projectId>).
 */
export function flowGenerateImage(
  prompt: string,
  projectId: string,
  aspectRatio?: ImageAspectRatio,
  imageModel?: ImageModel,
  referenceMediaIds?: string[],
): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to generate an image without a prompt' })
  if (text.length > MAX_PROMPT_LENGTH) {
    return Promise.resolve({ ok: false, error: `the prompt is ${text.length} characters; keep it under ${MAX_PROMPT_LENGTH}` })
  }
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  return call(generateImageScript(text, id, aspectRatio ?? 'LANDSCAPE', imageModel ?? 'NANO_BANANA_PRO', referenceMediaIds ?? []))
}

/** Creates a new Flow project. Returns the new projectId, for use with flowGenerateImage. */
export function flowCreateProject(projectTitle: string): Promise<FlowResult> {
  const title = String(projectTitle ?? '').trim() || new Date().toLocaleString()
  return call(createProjectScript(title))
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
}

/**
 * Uploads a local image file so it can be used as a reference in
 * flowGenerateImage or as a video's start frame. Returns a mediaId.
 */
export async function flowUploadImage(localFilePath: string, projectId: string): Promise<FlowResult> {
  const path = String(localFilePath ?? '').trim()
  if (!path) return { ok: false, error: 'refusing to upload without a local file path' }
  const id = String(projectId ?? '').trim()
  if (!id) return { ok: false, error: 'refusing to upload without a projectId' }

  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (e) {
    return { ok: false, error: `could not read ${path}: ${e instanceof Error ? e.message : String(e)}` }
  }
  const mimeType = MIME_BY_EXT[extname(path).toLowerCase()] ?? 'image/jpeg'
  return call(uploadImageScript(bytes.toString('base64'), id, mimeType, path.split(/[\\/]/).pop() ?? 'image.jpg'))
}

export interface MediaBytesResult {
  ok: boolean
  error?: string
  bytes?: Buffer
  contentType?: string
}

/**
 * Fetches the real bytes of a Flow media item (generated or uploaded),
 * shared by `flowDownloadImage` (saves to disk) and `flowViewImage` (hands
 * the bytes to the agent so it can actually see the image, not just a
 * mediaId).
 *
 * `getMediaScript`'s endpoint (the reference kit's `/v1/media/{id}` REST
 * call) returned HTTP 400 INVALID_ARGUMENT against a real live test — the
 * kit's shape was wrong for this build, same lesson as the video model key.
 * The fix uses the SAME `media.getMediaUrlRedirect` tRPC endpoint already
 * confirmed working for image generation's `viewUrl`, live-tested again
 * here against a freshly uploaded image (loaded correctly, real pixel
 * dimensions back).
 *
 * That endpoint needs the browser's own session cookies (NextAuth,
 * same-origin) — a page-context `fetch()` to it fails with a CORS error the
 * instant it redirects to a different origin CDN, even though an `<img>` tag
 * in that same page loads it fine (images aren't CORS-checked the way fetch
 * is). Node's fetch has no such restriction, so the fix is to read the real
 * session cookies via Electron's cookie API and attach them manually here,
 * rather than trying to extract bytes from inside the page at all.
 */
async function fetchMediaBytes(mediaId: string): Promise<MediaBytesResult> {
  const view = findViewByUrl('labs.google')
  if (!view) return { ok: false, error: NOT_OPEN }

  const cookies = await view.webContents.session.cookies.get({ url: 'https://labs.google' })
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL`

  let res: Response
  try {
    res = await fetch(url, { headers: { Cookie: cookieHeader } })
  } catch (e) {
    return { ok: false, error: `download request failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) return { ok: false, error: `download failed (HTTP ${res.status})` }

  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  return { ok: true, bytes: Buffer.from(await res.arrayBuffer()), contentType }
}

/**
 * Downloads a generated (or uploaded) image to disk. `mediaId` comes from a
 * flowGenerateImage or flowUploadImage result.
 */
export async function flowDownloadImage(mediaId: string): Promise<FlowResult> {
  const id = String(mediaId ?? '').trim()
  if (!id) return { ok: false, error: 'refusing to download without a mediaId' }

  const fetched = await fetchMediaBytes(id)
  if (!fetched.ok || !fetched.bytes) return { ok: false, error: fetched.error }

  const ext = fetched.contentType?.includes('png') ? 'png' : fetched.contentType?.includes('webp') ? 'webp' : 'jpg'
  const dir = join(app.getPath('downloads'), 'FlowDesk Studio')
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `${id}.${ext}`)
  await writeFile(filePath, fetched.bytes)
  return { ok: true, downloaded: true, filePath }
}

/**
 * Fetches a generated (or uploaded) image's real bytes so the agent tool
 * layer can attach them as an image content block — the agent actually
 * SEES the image this way, rather than only getting a mediaId/URL back in
 * text. `mediaId` comes from a flowGenerateImage or flowUploadImage result.
 */
export async function flowViewImage(mediaId: string): Promise<MediaBytesResult> {
  const id = String(mediaId ?? '').trim()
  if (!id) return { ok: false, error: 'refusing to view without a mediaId' }
  return fetchMediaBytes(id)
}

/**
 * Generates a short video, Portrait only. `mode: 'INGREDIENTS'` uses one or
 * more reference images (`mediaIds`); `mode: 'FRAMES'` animates a single
 * start image (only `mediaIds[0]` is used — no end frame is offered; Omni
 * Flash's own API rejected one outright, and Veo 3.1 Lite + FRAMES has no
 * confirmed model key yet). `mediaIds` come from a flowGenerateImage or
 * flowUploadImage result. Submission only — poll with flowGetVideoStatus
 * for the finished video.
 */
export async function flowGenerateVideo(
  mode: VideoMode,
  model: VideoModel,
  mediaIds: string[],
  prompt: string,
  projectId: string,
): Promise<FlowResult> {
  const ids = (mediaIds ?? []).map(id => String(id).trim()).filter(Boolean)
  if (!ids.length) return { ok: false, error: 'refusing to generate a video without at least one mediaId' }
  const text = String(prompt ?? '').trim()
  if (!text) return { ok: false, error: 'refusing to generate a video without a prompt' }
  const id = String(projectId ?? '').trim()
  if (!id) return { ok: false, error: 'refusing to generate without a projectId' }

  const credits = await call(getCreditsScript())
  const tier = typeof credits.tier === 'string' ? credits.tier : 'PAYGATE_TIER_ONE'
  return call(generateVideoScript(mode, model, ids, text, id, tier))
}

/** Reads the account's real Flow tier and remaining VIDEO credits (image generation has a separate, unexposed daily limit — see flowBridge.ts). */
export function flowGetCredits(): Promise<FlowResult> {
  return call(getCreditsScript())
}

/** Polls a submitted video's status. `mediaId` comes from a flowGenerateVideo result. */
export function flowGetVideoStatus(mediaId: string, projectId: string): Promise<FlowResult> {
  const id = String(mediaId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to check status without a mediaId' })
  const pid = String(projectId ?? '').trim()
  if (!pid) return Promise.resolve({ ok: false, error: 'refusing to check status without a projectId' })
  return call(getVideoStatusScript(id, pid))
}
