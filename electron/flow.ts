/**
 * Main-process access to the Google Flow bridge. Same shared-call pattern as
 * facebook.ts/linkedin.ts: the agent tool layer goes through this so the
 * executeJavaScript string is built in exactly one place.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { app } from 'electron'
import { findViewByUrl, listViewUrls } from './sessions'
import {
  createProjectScript, renameProjectScript, listProjectsScript, listProjectMediaScript,
  uploadImageScript, generateImageScript, generateVideoScript, videoModelsScript,
  mediaStatusScript, getCreditsScript,
  type ImageModel,
} from './flowBridge'

export interface FlowResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/**
 * Hosts Google Flow has lived on. `flow.google.com` is where it is now;
 * `labs.google` is kept because an older session can still be sitting on the
 * previous path, and a view on either one is a usable Flow session.
 *
 * This list existing at all is the bug that hid for weeks: every check was a
 * literal 'labs.google', so after Google moved the app, a Flow page open on
 * screen reported "Google Flow is not open" and the discovery recorder never
 * attached to it either.
 */
const FLOW_HOSTS = ['flow.google.com', 'labs.google'] as const

function findFlowView() {
  for (const host of FLOW_HOSTS) {
    const view = findViewByUrl(host)
    if (view) return view
  }
  return null
}

const NOT_OPEN =
  'Google Flow is not open. Open the Studio page in FlowDesk, select Google Flow, choose a Google account, and open a project, then retry.'

/**
 * Says what is open when Flow is not, because "not open" alone is
 * undiagnosable: a Google sign-in redirect, a still-loading tab and a genuinely
 * closed Studio all produce the same sentence, and the owner reporting "it IS
 * open" has no way to show otherwise.
 */
function openUrlSummary(): string {
  const urls = listViewUrls()
    .map(url => { try { return new URL(url).host } catch { return url } })
    .filter(host => host.length > 0)
  return urls.length > 0 ? ` Open right now: ${[...new Set(urls)].join(', ')}.` : ' No browser views are open at all.'
}

async function call(script: string): Promise<FlowResult> {
  const view = findFlowView()
  if (!view) return { ok: false, error: NOT_OPEN + openUrlSummary() }
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
 * Generates one image in an existing project. `projectId` comes from
 * `flowListProjects` or `flowCreateProject`.
 *
 * Aspect ratio is no longer a parameter: the retired API took an explicit enum
 * and the captured request on the current API has no visible slot for one, so
 * offering the choice would be offering something unproven.
 */
export function flowGenerateImage(prompt: string, projectId: string, imageModel?: ImageModel): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to generate an image without a prompt' })
  if (text.length > MAX_PROMPT_LENGTH) {
    return Promise.resolve({ ok: false, error: `the prompt is ${text.length} characters; keep it under ${MAX_PROMPT_LENGTH}` })
  }
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  return call(generateImageScript(text, id, imageModel ?? 'NANO_BANANA_2'))
}

export function flowListProjects(): Promise<FlowResult> {
  return call(listProjectsScript())
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
  const view = findFlowView()
  if (!view) return { ok: false, error: NOT_OPEN }

  // Origin comes from the view rather than a constant: Flow moved from
  // labs.google to flow.google.com, and a hardcoded origin here would fetch
  // with cookies for a host the session is no longer on.
  let origin: string
  try {
    origin = new URL(view.webContents.getURL()).origin
  } catch {
    return { ok: false, error: NOT_OPEN }
  }

  const cookies = await view.webContents.session.cookies.get({ url: origin })
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const url = `${origin}/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}&mediaUrlType=MEDIA_URL_TYPE_THUMBNAIL`

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
 * Generates one video. `modelKey` is passed through verbatim — call
 * `flowVideoModels` for the keys Flow itself accepts, rather than trusting a
 * table; this bridge's own history records one being wrong.
 */
export function flowGenerateVideo(prompt: string, projectId: string, modelKey: string): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to generate a video without a prompt' })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  const model = String(modelKey ?? '').trim()
  if (!model) return Promise.resolve({ ok: false, error: 'refusing to generate without a model key — call flowVideoModels first' })
  return call(generateVideoScript(text, id, model))
}

export function flowGetCredits(): Promise<FlowResult> {
  return call(getCreditsScript())
}

/** Looks up one media item by the id a generation returned. */
export function flowMediaStatus(mediaId: string): Promise<FlowResult> {
  const id = String(mediaId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to look up without a mediaId' })
  return call(mediaStatusScript(id))
}

/** Renames an existing project. New capability: the retired API had none. */
export function flowRenameProject(projectId: string, projectTitle: string): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  const title = String(projectTitle ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to rename without a projectId' })
  if (!title) return Promise.resolve({ ok: false, error: 'refusing to rename to an empty title' })
  return call(renameProjectScript(id, title))
}

/** Lists the media already inside a project. */
export function flowListProjectMedia(projectId: string): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to list media without a projectId' })
  return call(listProjectMediaScript(id))
}

/** The video model keys Flow accepts, read from Flow rather than hardcoded. */
export function flowVideoModels(): Promise<FlowResult> {
  return call(videoModelsScript())
}

