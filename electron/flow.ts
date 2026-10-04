/**
 * Main-process access to the Google Flow bridge. Same shared-call pattern as
 * facebook.ts/linkedin.ts: the agent tool layer goes through this so the
 * executeJavaScript string is built in exactly one place.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { app, session } from 'electron'
import type { WebContents } from 'electron'
import { findViewByUrl, findAnyViewByUrl, listViewUrls, ensureBackgroundView } from './sessions'
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

let googlePartitionGetter: (() => string | null) | null = null
let googleAccountsGetter: () => { email: string; partition: string }[] = () => []

export function setGooglePartitionGetter(getter: () => string | null): void {
  googlePartitionGetter = getter
}

/** Every signed-in Google account, for routing Flow work between them. */
export function setGoogleAccountsGetter(getter: () => { email: string; partition: string }[]): void {
  googleAccountsGetter = getter
}

/**
 * Which account owns a project. Projects and media ids belong to one Google
 * account, so a call about a project must run on that account's session —
 * learned whenever a listing, creation or generation reports project ids.
 */
const projectOwner = new Map<string, string>() // project and media ids -> partition

// Kept on disk: held only in memory, a restart sent every status, image-to-video
// and extend call about an earlier generation to the default account, where the
// media does not exist (seen live 2026-10-04: three finished videos read "unknown").
const OWNERS_CAP = 5000
const ownersFile = () => join(app.getPath('userData'), 'flow-owners.json')
let ownersLoaded = false
let ownersSave: ReturnType<typeof setTimeout> | null = null

function loadOwners() {
  if (ownersLoaded) return
  ownersLoaded = true
  try {
    const saved = JSON.parse(readFileSync(ownersFile(), 'utf8')) as Record<string, string>
    for (const [id, partition] of Object.entries(saved)) if (!projectOwner.has(id)) projectOwner.set(id, partition)
  } catch { /* first run */ }
}

function saveOwnersSoon() {
  if (ownersSave) return
  ownersSave = setTimeout(() => {
    ownersSave = null
    const entries = [...projectOwner.entries()].slice(-OWNERS_CAP)
    void writeFile(ownersFile(), JSON.stringify(Object.fromEntries(entries)), 'utf8').catch(() => {})
  }, 1_000)
}

function defaultPartition(): string | null {
  return googlePartitionGetter ? googlePartitionGetter() : null
}

/** An explicit account (email or partition) wins, then the project's owner, then the default. */
function resolvePartition(projectId?: string, account?: string | null): string | null {
  const want = String(account ?? '').trim().toLowerCase()
  if (want) {
    const hit = googleAccountsGetter().find(a => a.partition === want || a.email.toLowerCase().includes(want))
    if (hit) return hit.partition
  }
  loadOwners()
  if (projectId && projectOwner.has(projectId)) return projectOwner.get(projectId)!
  return defaultPartition()
}

/** A Flow page already open on screen, but only if it is signed in as `partition`. */
function findFlowWebContents(partition: string | null): WebContents | null {
  const wanted = partition ? session.fromPartition(`persist:${partition}`) : null
  for (const host of FLOW_HOSTS) {
    const v = typeof findAnyViewByUrl === 'function' ? findAnyViewByUrl(host) : findViewByUrl(host)
    if (v && v.webContents && !v.webContents.isDestroyed() && (!wanted || v.webContents.session === wanted)) return v.webContents
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

async function waitForFlowReady(wc: WebContents, timeoutMs = 25000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (!wc.isDestroyed()) {
        const ready = await wc.executeJavaScript(
          'Boolean(window.WIZ_global_data && window.WIZ_global_data.SNlM0e)'
        )
        if (ready) return true
      }
    } catch {
      // ignore navigation transitions
    }
    await new Promise(r => setTimeout(r, 400))
  }
  return false
}

async function ensureFlowWebContents(targetProjectId?: string, partitionIn?: string | null): Promise<WebContents | null> {
  const partition = partitionIn ?? defaultPartition()
  let wc = findFlowWebContents(partition)

  if (!wc) {
    if (!partition) return null
    const targetUrl = targetProjectId
      ? `https://flow.google.com/project/${targetProjectId}`
      : 'https://flow.google.com/'

    try {
      // The default account keeps the 'flow-worker' id the Studio page uses, so
      // an open Studio view is reused rather than doubled.
      const tabId = partition === defaultPartition() ? 'flow-worker' : `flow-worker-${partition}`
      const bg = await ensureBackgroundView(tabId, partition, targetUrl)
      wc = bg.webContents
      await waitForFlowReady(wc)
      return wc
    } catch (e) {
      console.warn('[FlowDesk flow] Failed to ensure background view:', e)
      return null
    }
  }

  if (targetProjectId && wc) {
    const currentUrl = wc.getURL()
    if (!currentUrl.includes(targetProjectId)) {
      try {
        await wc.loadURL(`https://flow.google.com/project/${targetProjectId}`)
        await waitForFlowReady(wc)
      } catch (e) {
        console.warn(`[FlowDesk flow] Failed to navigate to project ${targetProjectId}:`, e)
      }
    }
  }

  return wc
}

async function call(script: string, projectId?: string, account?: string | null): Promise<FlowResult> {
  const partition = resolvePartition(projectId, account)
  const wc = await ensureFlowWebContents(projectId, partition)
  if (!wc) return { ok: false, error: NOT_OPEN + openUrlSummary() }
  try {
    const result = await wc.executeJavaScript(script)
    if (result && typeof result === 'object') {
      const r = result as FlowResult
      if (partition) learnOwners(r, partition)
      return r
    }
    return { ok: false, error: `bridge returned a non-object: ${String(result)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Every project and media id in a result belongs to the account it came from. */
function learnOwners(r: FlowResult, partition: string) {
  if (!r.ok) return
  loadOwners()
  const text = JSON.stringify(r)
  let learned = false
  for (const id of text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []) {
    if (projectOwner.get(id) !== partition) { projectOwner.delete(id); projectOwner.set(id, partition); learned = true }
  }
  if (learned) saveOwnersSoon()
}

// ── account routing ─────────────────────────────────────────────────────────

/**
 * A refusal that another account could get past. The exact out-of-credits
 * answer has not been captured yet (no account has run dry under a recorder),
 * so this matches the general quota vocabulary Google APIs use plus HTTP 429.
 */
export function isFlowQuotaFailure(r: FlowResult): boolean {
  if (r.ok) return false
  return /RESOURCE_EXHAUSTED|quota|credit|insufficient|rate.?limit|HTTP 429/i.test(`${r.error ?? ''} ${r.detail ?? ''}`)
}

/** The credit balance: the first number of the nzlxg answer (959 on a live account). */
function creditsOf(r: FlowResult): number | null {
  const raw = r.raw
  return r.ok && Array.isArray(raw) && typeof raw[0] === 'number' ? raw[0] : null
}

function maskAccount(email: string): string {
  const m = email.match(/([^\s()<>]+)@([^\s()<>]+)/)
  return m ? `${m[1].slice(0, 2)}***@${m[2]}` : '***'
}

/** Every Google account's Flow sign-in and credit balance. */
export async function flowAccounts(): Promise<FlowResult> {
  const accounts = googleAccountsGetter()
  const rows: Record<string, unknown>[] = []
  for (const a of accounts) {
    const r = await call(getCreditsScript(), undefined, a.partition)
    rows.push({ account: maskAccount(a.email), partition: a.partition, isDefault: a.partition === defaultPartition(), signedIn: r.ok, credits: creditsOf(r), error: r.ok ? null : r.error })
  }
  return { ok: true, accounts: rows }
}

/** A project to generate into on `partition`: the one titled "FlowDesk", made if missing. */
async function autoProject(partition: string): Promise<string | null> {
  const list = await call(listProjectsScript(), undefined, partition)
  const hit = (Array.isArray(list.projects) ? list.projects as { projectId?: string; title?: string }[] : []).find(p => p.title === 'FlowDesk')
  if (hit?.projectId) return hit.projectId
  const made = await call(createProjectScript('FlowDesk'), undefined, partition)
  return typeof made.projectId === 'string' ? made.projectId : null
}

/**
 * Runs a generation on the project's account and, when that account is out of
 * credits, on the next account with credits — in that account's own "FlowDesk"
 * project, since projects do not cross accounts. The result says where it ran.
 */
async function generateRouted(projectId: string, account: string | null | undefined, script: (projectId: string) => string): Promise<FlowResult> {
  const first = resolvePartition(projectId, account)
  const accounts = googleAccountsGetter()
  const label = (p: string | null) => maskAccount(accounts.find(a => a.partition === p)?.email ?? '')

  const firstCredits = first ? creditsOf(await call(getCreditsScript(), undefined, first)) : null
  let firstError: string | null = null
  if (firstCredits === null || firstCredits > 0) {
    const r = await call(script(projectId), projectId, first)
    if (!isFlowQuotaFailure(r)) return { ...r, account: label(first), projectId: r.projectId ?? projectId }
    firstError = String(r.error ?? 'quota')
  } else {
    firstError = `no credits left (${firstCredits})`
  }

  const tried: string[] = [`${label(first)}: ${firstError}`]
  for (const a of accounts.filter(x => x.partition !== first)) {
    const credits = creditsOf(await call(getCreditsScript(), undefined, a.partition))
    if (credits === null || credits <= 0) { tried.push(`${maskAccount(a.email)}: ${credits === null ? 'not signed in to Flow' : 'no credits left'}`); continue }
    const pid = await autoProject(a.partition)
    if (!pid) { tried.push(`${maskAccount(a.email)}: could not open a project`); continue }
    const r = await call(script(pid), pid, a.partition)
    if (r.ok) return { ...r, account: maskAccount(a.email), projectId: pid, switchedAccount: true, switchedBecause: firstError }
    if (!isFlowQuotaFailure(r)) return { ...r, account: maskAccount(a.email), projectId: pid }
    tried.push(`${maskAccount(a.email)}: ${r.error}`)
  }
  return { ok: false, error: `no Google account could run this on Flow — ${tried.join('; ')}` }
}

export function flowEval(script: string, account?: string | null): Promise<FlowResult> {
  return call(script, undefined, account)
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
export function flowGenerateImage(prompt: string, projectId: string, imageModel?: ImageModel, account?: string | null): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to generate an image without a prompt' })
  if (text.length > MAX_PROMPT_LENGTH) {
    return Promise.resolve({ ok: false, error: `the prompt is ${text.length} characters; keep it under ${MAX_PROMPT_LENGTH}` })
  }
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  return generateRouted(id, account, pid => generateImageScript(text, pid, imageModel ?? 'NANO_BANANA_2'))
}

export function flowListProjects(account?: string | null): Promise<FlowResult> {
  return call(listProjectsScript(), undefined, account)
}

/** Creates a new Flow project. Returns the new projectId, for use with flowGenerateImage. */
export function flowCreateProject(projectTitle: string, account?: string | null): Promise<FlowResult> {
  const title = String(projectTitle ?? '').trim() || new Date().toLocaleString()
  return call(createProjectScript(title), undefined, account)
}

export interface MediaBytesResult {
  ok: boolean
  error?: string
  bytes?: Buffer
  contentType?: string
}

export function flowGenerateVideo(prompt: string, projectId: string, modelKey: string, account?: string | null): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to generate a video without a prompt' })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  const model = String(modelKey ?? '').trim()
  if (!model) return Promise.resolve({ ok: false, error: 'refusing to generate without a model key — call flowVideoModels first' })
  if (!isGenerationKey(model)) return Promise.resolve({ ok: false, error: familyKeyError(model, VERIFIED_VIDEO_KEYS.textToVideo) })
  return generateRouted(id, account, pid => generateVideoScript(text, pid, model))
}

export function flowGetCredits(account?: string | null): Promise<FlowResult> {
  return call(getCreditsScript(), undefined, account)
}

/** Looks up one media item by the id a generation returned. */
export async function flowMediaStatus(mediaId: string, account?: string | null): Promise<FlowResult> {
  const id = String(mediaId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to look up without a mediaId' })
  // A media id routes to the account that made it, like a project id does.
  const first = await call(mediaStatusScript(id), id, account)
  if (first.ok || account || !(first as { notFound?: boolean }).notFound) return first
  // Not on the account it was routed to (an id never seen, or made outside
  // FlowDesk): look on the others; the one that has it becomes its owner.
  const tried = resolvePartition(id, null)
  for (const acc of googleAccountsGetter().filter(a => a.partition !== tried)) {
    const r = await call(mediaStatusScript(id), id, acc.partition)
    if (r.ok) return r
  }
  return first
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
  return call(listProjectMediaScript(id), id)
}

/**
 * Generation keys proven by a real generation (2026-10-04, live). Flow's own
 * model list (yBhWQ) names model FAMILIES (veo_3_1_lite, abra, …); sending a
 * family as the key makes Flow answer a bare error [5]. A key names model,
 * mode and length: t2v = text-to-video, r2v = from a reference image.
 */
export const VERIFIED_VIDEO_KEYS = {
  textToVideo: ['abra_t2v_8s'],
  imageToVideo: ['veo_3_1_r2v_lite'],
  extend: ['abra_edit'],
} as const

const isGenerationKey = (key: string) => /_(t2v|r2v|i2v)(_|$)/.test(key)
const familyKeyError = (key: string, use: readonly string[]) =>
  `"${key}" is a model family, not a generation key (Flow rejects it). Use one of: ${use.join(', ')} — see flow_video_models`

/** Flow's model families plus the generation keys verified to work. */
export async function flowVideoModels(): Promise<FlowResult> {
  const r = await call(videoModelsScript()) as FlowResult & { models?: string[] }
  return { ...r, families: r.models ?? [], verifiedModelKeys: VERIFIED_VIDEO_KEYS, note: 'Pass a verifiedModelKeys entry as modelKey. Family names are not accepted by the generate calls.' }
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
  return call(uploadImageScript(bytes.toString('base64'), id, mimeType, fileName), id)
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

/** Saves one media item to disk, given its URL from a listing or direct mediaId. */
export async function flowDownloadMedia(mediaUrl: string): Promise<FlowResult> {
  const target = String(mediaUrl ?? '').trim()
  if (!target) return { ok: false, error: 'refusing to download without a media URL or mediaId' }

  let downloadUrl = target

  // If a UUID / mediaId is passed, look up its direct signed CDN URL via API
  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    const status = await flowMediaStatus(target)
    if (!status.ok) return { ok: false, error: `could not get media status for ${target}: ${status.error}` }
    const vUrl = (status as any).videoUrl || (status as any).imageUrl
    if (!vUrl) return { ok: false, error: `media ${target} is not ready or has no download URL yet (status: ${(status as any).status})` }
    downloadUrl = vUrl
  }

  // Direct fast CDN fetch via Node
  if (downloadUrl.startsWith('https://flow-content.google/') || downloadUrl.startsWith('https://lh3.googleusercontent.com/')) {
    try {
      const res = await fetch(downloadUrl)
      if (!res.ok) return { ok: false, error: `fetch failed: HTTP ${res.status}` }
      const bytes = Buffer.from(await res.arrayBuffer())
      const isMp4 = downloadUrl.includes('/video/') || res.headers.get('content-type')?.includes('mp4')
      const ext = isMp4 ? 'mp4' : 'jpg'
      const dir = join(app.getPath('downloads'), 'FlowDesk Studio')
      await mkdir(dir, { recursive: true })
      const filePath = join(dir, `flow-${Date.now()}.${ext}`)
      await writeFile(filePath, bytes)
      return { ok: true, downloaded: true, filePath, byteSize: bytes.length, url: downloadUrl }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const fetched = await fetchMediaBytes(downloadUrl)
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
  if (!isGenerationKey(model)) return Promise.resolve({ ok: false, error: familyKeyError(model, VERIFIED_VIDEO_KEYS.imageToVideo) })
  return call(generateVideoFromImageScript(text, id, media, model), id)
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
  return call(extendVideoScript(text, id, source, scene), id)
}

