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
  createProjectScript, renameProjectScript, deleteProjectScript, listProjectsScript,
  listProjectMediaScript, uploadImageScript, fetchMediaUrlScript,
  generateImageScript, generateVideoScript, generateVideoFromImageScript,
  extendVideoScript, videoModelsScript, mediaStatusScript, getCreditsScript,
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

export interface MediaBytesResult {
  ok: boolean
  error?: string
  bytes?: Buffer
  contentType?: string
}

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

/** Deletes a project. Flow answers with nothing, so this reports the request. */
export function flowDeleteProject(projectId: string): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to delete without a projectId' })
  return call(deleteProjectScript(id))
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
}

/** Uploads a local image into a project and returns its media id. */
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
  const fileName = path.split(/[\/]/).pop() ?? 'image.jpg'
  return call(uploadImageScript(bytes.toString('base64'), id, mimeType, fileName))
}

export interface MediaBytesResult {
  ok: boolean
  error?: string
  bytes?: Buffer
  contentType?: string
}

/**
 * Fetches one media item's bytes from its Flow URL.
 *
 * The URL has to come from a listing rather than be built from a media id: the
 * token in it is opaque, and Flow's own download is a Blob save with no
 * network request to copy.
 */
async function fetchMediaBytes(mediaUrl: string): Promise<MediaBytesResult> {
  const fetched = await call(fetchMediaUrlScript(mediaUrl))
  if (!fetched.ok || typeof fetched.base64 !== 'string') {
    return { ok: false, error: typeof fetched.error === 'string' ? fetched.error : 'media fetch failed' }
  }
  return {
    ok: true,
    bytes: Buffer.from(fetched.base64, 'base64'),
    contentType: typeof fetched.contentType === 'string' ? fetched.contentType : 'image/webp',
  }
}

/** Saves one media item to disk, given its URL from a listing. */
export async function flowDownloadMedia(mediaUrl: string): Promise<FlowResult> {
  const url = String(mediaUrl ?? '').trim()
  if (!url) return { ok: false, error: 'refusing to download without a media URL' }

  const fetched = await fetchMediaBytes(url)
  if (!fetched.ok || !fetched.bytes) return { ok: false, error: fetched.error }

  const ext = fetched.contentType?.includes('png') ? 'png'
    : fetched.contentType?.includes('webp') ? 'webp'
    : fetched.contentType?.includes('mp4') ? 'mp4' : 'jpg'
  const dir = join(app.getPath('downloads'), 'FlowDesk Studio')
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, `flow-${Date.now()}.${ext}`)
  await writeFile(filePath, fetched.bytes)
  return { ok: true, downloaded: true, filePath, byteSize: fetched.bytes.length }
}

/** Hands the raw bytes back, so the agent can actually look at the image. */
export function flowViewMedia(mediaUrl: string): Promise<MediaBytesResult> {
  const url = String(mediaUrl ?? '').trim()
  if (!url) return Promise.resolve({ ok: false, error: 'refusing to view without a media URL' })
  return fetchMediaBytes(url)
}

/** Generates a video using an existing image as its first frame. */
export function flowGenerateVideoFromImage(prompt: string, projectId: string, mediaId: string, modelKey: string): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to generate a video without a prompt' })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  const media = String(mediaId ?? '').trim()
  if (!media) return Promise.resolve({ ok: false, error: 'refusing to generate without a source mediaId' })
  const model = String(modelKey ?? '').trim()
  if (!model) return Promise.resolve({ ok: false, error: 'refusing to generate without a model key -- call flowVideoModels first' })
  return call(generateVideoFromImageScript(text, id, media, model))
}

/** Extends an existing video from its first 240 frames -- the only range captured. */
export function flowExtendVideo(prompt: string, projectId: string, sourceVideoId: string, sceneId: string): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to extend without a prompt' })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to extend without a projectId' })
  const source = String(sourceVideoId ?? '').trim()
  if (!source) return Promise.resolve({ ok: false, error: 'refusing to extend without a source video id' })
  const scene = String(sceneId ?? '').trim()
  if (!scene) return Promise.resolve({ ok: false, error: 'refusing to extend without a scene id' })
  return call(extendVideoScript(text, id, source, scene))
}

