/**
 * Main-process access to the Google Flow bridge. Same shared-call pattern as
 * facebook.ts/linkedin.ts: the agent tool layer goes through this so the
 * executeJavaScript string is built in exactly one place.
 */

import { writeFile, mkdir, rename } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { app, session, webContents as electronWebContents } from 'electron'
import type { WebContents } from 'electron'
import { listViewUrls, ensureBackgroundView } from './sessions'
import { readLocalImage } from './localImageFile'
import { whileAwake } from './keepAwake'
import { holdFlowAccount, UNUSUAL_ACTIVITY } from './flowHolds'
import {
  createProjectScript, renameProjectScript, deleteProjectScript, listProjectsScript,
  listProjectMediaScript, uploadImageScript, fetchMediaUrlScript,
  generateImageScript, generateVideoScript, generateVideoFromImageScript,
  extendVideoScript, videoModelsScript, mediaStatusScript, getCreditsScript,
  FLOW_PAGE_MEDIA_HOSTS, FLOW_MEDIA_MAX_BYTES,
  type ImageModel,
} from './flowBridge'

export interface FlowResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/** A signed-in Google account Flow work can run on. */
export interface FlowAccount {
  email: string
  partition: string
  label?: string | null
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
let googleAccountsGetter: () => FlowAccount[] = () => []

export function setGooglePartitionGetter(getter: () => string | null): void {
  googlePartitionGetter = getter
}

/** Every signed-in Google account, for routing Flow work between them. */
export function setGoogleAccountsGetter(getter: () => FlowAccount[]): void {
  googleAccountsGetter = getter
}

/** The Google accounts added on the Accounts page (email + partition). */
export function getGoogleAccounts(): FlowAccount[] {
  return googleAccountsGetter()
}

// ── input validation (pure, exported for tests) ─────────────────────────────

/**
 * Project, media and scene ids are UUIDs on every live answer seen
 * (2026-10-05: listProjects, listProjectMedia, mediaStatus [mediaId,
 * projectId, sceneId]). They are spliced into `projects/<id>` paths and
 * navigation URLs, so only a plain token is accepted.
 */
export const FLOW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** null when `id` is usable; otherwise the refusal to return. */
export function flowIdError(id: string, what: string): string | null {
  return FLOW_ID_RE.test(id) ? null : `refusing: ${what} "${id.slice(0, 40)}" is not a valid Google Flow id`
}

const MAX_PROMPT_LENGTH = 4000
const MAX_TITLE_LENGTH = 200

function promptError(text: string, what: string): string | null {
  if (!text) return `refusing to ${what} without a prompt`
  if (text.length > MAX_PROMPT_LENGTH) return `the prompt is ${text.length} characters; keep it under ${MAX_PROMPT_LENGTH}`
  return null
}

const IMAGE_MODELS: readonly ImageModel[] = ['NANO_BANANA_PRO', 'NANO_BANANA_2']

/** Exact host, or a real dot-suffix when the entry starts with '.' (never a substring). */
export function flowHostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return allowed.some(a => a.startsWith('.') ? h.length > a.length && h.endsWith(a) : h === a)
}

/**
 * Media served without cookies. Verified 2026-10-05: an image and a video
 * URL from flow_media_status both answered 200 directly (image/jpeg,
 * video/mp4), with no redirect and no credentials sent.
 */
export const FLOW_DIRECT_MEDIA_HOSTS = ['flow-content.google'] as const

export type FlowMediaUrl = { ok: true; url: string; via: 'direct' | 'page' } | { ok: false; error: string }

/**
 * Sorts a media URL into the cookie-less Node fetch (flow-content.google
 * /image|/video), the signed-in page fetch (Flow's /asb/ links and lh3
 * thumbnails), or a refusal. https only, no userinfo, no port, exact hosts.
 */
export function classifyFlowMediaUrl(raw: string): FlowMediaUrl {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, error: 'refusing: not a valid media URL' } }
  const refuse = { ok: false as const, error: `refusing to fetch a URL that is not a Google Flow media URL (${u.protocol}//${u.hostname})` }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return refuse
  if (flowHostAllowed(u.hostname, FLOW_DIRECT_MEDIA_HOSTS)) {
    return /^\/(image|video)\//.test(u.pathname) ? { ok: true, url: u.toString(), via: 'direct' } : refuse
  }
  if (flowHostAllowed(u.hostname, FLOW_PAGE_MEDIA_HOSTS)) {
    // On Flow's own origin only the /asb/ media links: anything else there is
    // an API (the session endpoint answers with an access token).
    if (flowHostAllowed(u.hostname, FLOW_HOSTS) && !u.pathname.startsWith('/asb/')) return refuse
    return { ok: true, url: u.toString(), via: 'page' }
  }
  return refuse
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

/**
 * null when `key` fits the call: text-to-video takes only a t2v key, and
 * image-to-video only an r2v/i2v key (an image key without an image, or the
 * reverse, would spend credits on a request Flow cannot do as asked).
 */
export function videoKeyError(key: string, mode: 'textToVideo' | 'imageToVideo'): string | null {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) return `refusing: "${key.slice(0, 40)}" is not a valid model key`
  if (!isGenerationKey(key)) return familyKeyError(key, VERIFIED_VIDEO_KEYS[mode])
  const fits = mode === 'textToVideo' ? /_t2v(_|$)/.test(key) : /_(r2v|i2v)(_|$)/.test(key)
  if (fits) return null
  return mode === 'textToVideo'
    ? `"${key}" is an image-to-video key; flow_generate_video needs a text-to-video key (${VERIFIED_VIDEO_KEYS.textToVideo.join(', ')}) — use flow_generate_video_from_image for ${key}`
    : `"${key}" is a text-to-video key; flow_generate_video_from_image needs an image-to-video key (${VERIFIED_VIDEO_KEYS.imageToVideo.join(', ')})`
}

export function maskAccount(email: string): string {
  const m = email.match(/([^\s()<>]+)@([^\s()<>]+)/)
  return m ? `${m[1].slice(0, 2)}***@${m[2]}` : '***'
}

/**
 * An explicit account: exact partition, email or label (case-insensitive),
 * or the masked form flow_accounts prints when that is unique. Anything else
 * is an error — silently running on the default account would spend the
 * wrong account's credits.
 */
export function matchFlowAccount(accounts: readonly FlowAccount[], account: string): { partition: string } | { error: string } {
  const want = account.trim()
  const lower = want.toLowerCase()
  const bare = want.replace(/^persist:/, '')
  const exact = accounts.filter(a =>
    a.partition === bare || a.email.toLowerCase() === lower || (!!a.label && a.label.trim().toLowerCase() === lower))
  const unique = [...new Set(exact.map(a => a.partition))]
  if (unique.length === 1) return { partition: unique[0] }
  const known = accounts.map(a => `${maskAccount(a.email)} (${a.partition})`).join(', ') || 'none signed in'
  if (unique.length === 0) {
    const masked = accounts.filter(a => maskAccount(a.email).toLowerCase() === lower)
    if (masked.length === 1) return { partition: masked[0].partition }
    if (masked.length === 0) return { error: `unknown Google account "${want.slice(0, 80)}" — pass an email or partition from flow_accounts. Known: ${known}` }
  }
  return { error: `account "${want.slice(0, 80)}" matches more than one Google account — pass the partition from flow_accounts. Known: ${known}` }
}

// ── project and media ownership ─────────────────────────────────────────────

/**
 * Which account owns a project. Projects and media ids belong to one Google
 * account, so a call about a project must run on that account's session —
 * learned whenever a listing, creation or generation reports project ids.
 */
const projectOwner = new Map<string, string>() // project and media ids -> partition

// Kept on disk: held only in memory, a restart sent every status, image-to-video
// and extend call about an earlier generation to the default account, where the
// media does not exist (seen live 2026-10-04: three finished videos read "unknown").
export const OWNERS_CAP = 5000
const PARTITION_RE = /^[A-Za-z0-9_-]{1,128}$/
const ownersFile = () => join(app.getPath('userData'), 'flow-owners.json')
let ownersLoaded = false
let ownersSave: ReturnType<typeof setTimeout> | null = null

/**
 * The owners file as entries, newest last. Not an object, or entries that are
 * not id -> partition strings, are dropped rather than trusted: the ids end up
 * in navigation URLs and the partitions pick a session.
 */
export function parseOwnersFile(text: string): [string, string][] {
  let saved: unknown
  try { saved = JSON.parse(text) } catch { return [] }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return []
  const out: [string, string][] = []
  for (const [id, partition] of Object.entries(saved as Record<string, unknown>)) {
    if (FLOW_ID_RE.test(id) && typeof partition === 'string' && PARTITION_RE.test(partition)) out.push([id, partition])
  }
  return out.slice(-OWNERS_CAP)
}

function loadOwners() {
  if (ownersLoaded) return
  ownersLoaded = true
  let text: string
  try { text = readFileSync(ownersFile(), 'utf8') } catch { return /* first run */ }
  for (const [id, partition] of parseOwnersFile(text)) if (!projectOwner.has(id)) projectOwner.set(id, partition)
}

function saveOwnersSoon() {
  if (ownersSave) return
  ownersSave = setTimeout(() => {
    ownersSave = null
    const entries = [...projectOwner.entries()].slice(-OWNERS_CAP)
    const file = ownersFile()
    const tmp = `${file}.${process.pid}.tmp`
    // tmp + rename: a crash mid-write leaves the previous file whole.
    void writeFile(tmp, JSON.stringify(Object.fromEntries(entries)), 'utf8')
      .then(() => rename(tmp, file))
      .catch(() => {})
  }, 1_000)
}

function defaultPartition(): string | null {
  return googlePartitionGetter ? googlePartitionGetter() : null
}

type Resolved = { partition: string | null } | { error: string }

/** An explicit account wins (and must exist), then the id's owner, then the default. */
function resolvePartition(ownerId?: string, account?: string | null): Resolved {
  const want = String(account ?? '').trim()
  if (want) return matchFlowAccount(googleAccountsGetter(), want)
  loadOwners()
  if (ownerId && projectOwner.has(ownerId)) return { partition: projectOwner.get(ownerId)! }
  return { partition: defaultPartition() }
}

// ── the Flow page for one account ───────────────────────────────────────────

function isFlowUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && flowHostAllowed(u.hostname, FLOW_HOSTS)
  } catch {
    return false
  }
}

/**
 * A Flow page already open (visible tab or hidden window) and signed in as
 * `partition`. Every web contents is checked, not just the first Flow one:
 * the Studio's view can be on another account, and taking it ran calls with
 * that account's credits and projects.
 */
function findFlowWebContents(partition: string | null): WebContents | null {
  const wanted = partition ? session.fromPartition(`persist:${partition}`) : null
  const all = typeof electronWebContents?.getAllWebContents === 'function' ? electronWebContents.getAllWebContents() : []
  for (const wc of all) {
    try {
      if (wc.isDestroyed() || !isFlowUrl(wc.getURL())) continue
      if (!wanted || wc.session === wanted) return wc
    } catch { /* destroyed mid-check */ }
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

/** True when the page is already on `projectId`'s page, so no navigation is needed. */
function onProjectPage(url: string, projectId: string): boolean {
  try { return new URL(url).pathname.split('/').includes(projectId) } catch { return false }
}

async function ensureFlowWebContents(projectId: string | undefined, partition: string | null): Promise<WebContents | null> {
  let wc = findFlowWebContents(partition)
  const projectUrl = projectId ? `https://flow.google.com/project/${encodeURIComponent(projectId)}` : 'https://flow.google.com/'

  if (!wc) {
    if (!partition) return null
    try {
      // Each account has its own hidden window. The Studio's 'flow-worker' view
      // follows whichever account the Studio has selected, so it is only used
      // when findFlowWebContents saw it on this very session.
      const bg = await ensureBackgroundView(`flow-worker-${partition}`, partition, projectUrl)
      wc = bg.webContents
      if (!isFlowUrl(wc.getURL())) await wc.loadURL(projectUrl)
      await waitForFlowReady(wc)
      return wc
    } catch (e) {
      console.warn('[FlowDesk flow] Failed to ensure background view:', e instanceof Error ? e.message : String(e))
      return null
    }
  }

  if (projectId && !onProjectPage(wc.getURL(), projectId)) {
    try {
      await wc.loadURL(projectUrl)
      await waitForFlowReady(wc)
    } catch (e) {
      console.warn('[FlowDesk flow] Failed to navigate to a project:', e instanceof Error ? e.message : String(e))
    }
  }

  return wc
}

/**
 * One call at a time per account. A poll that navigated the shared page while
 * a generation script was still running there killed that script mid-call.
 */
const partitionQueue = new Map<string, Promise<unknown>>()

function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = partitionQueue.get(key) ?? Promise.resolve()
  const next = prev.then(run, run)
  const settled = next.catch(() => {})
  partitionQueue.set(key, settled)
  void settled.then(() => { if (partitionQueue.get(key) === settled) partitionQueue.delete(key) })
  return next
}

interface CallOptions {
  /** Id whose owner picks the account (a project or media id). */
  owner?: string
  /** Project page to be on. Omitted for API reads that work from any Flow page. */
  project?: string
  account?: string | null
}

async function call(script: string, opts: CallOptions = {}): Promise<FlowResult> {
  const resolved = resolvePartition(opts.owner, opts.account)
  if ('error' in resolved) return { ok: false, error: resolved.error }
  const partition = resolved.partition
  return serialized(partition ?? '', async () => {
    const wc = await ensureFlowWebContents(opts.project, partition)
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
  })
}

/**
 * Runs `fn` with the account's Flow page open on `projectId`, inside the same
 * one-at-a-time queue as every other call on that account (so a poll cannot
 * navigate the page away mid-run). For flowUi, which drives the page itself.
 */
export async function withFlowPage(
  projectId: string,
  account: string | null | undefined,
  fn: (wc: WebContents, partition: string | null) => Promise<FlowResult>,
): Promise<FlowResult> {
  const resolved = resolvePartition(projectId, account)
  if ('error' in resolved) return { ok: false, error: resolved.error }
  const partition = resolved.partition
  return serialized(partition ?? '', async () => {
    const wc = await ensureFlowWebContents(projectId, partition)
    if (!wc) return { ok: false, error: NOT_OPEN + openUrlSummary() }
    try {
      // Flow's page stops painting when its view is hidden (another FlowDesk
      // section is open), and its menus then never open: keep it awake.
      const r = await whileAwake(wc, () => fn(wc, partition))
      if (partition) learnOwners(r, partition)
      return r
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
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

/** Every Google account's Flow sign-in and credit balance. */
export async function flowAccounts(): Promise<FlowResult> {
  const accounts = googleAccountsGetter()
  const rows: Record<string, unknown>[] = []
  for (const a of accounts) {
    const r = await call(getCreditsScript(), { account: a.partition })
    rows.push({ account: maskAccount(a.email), partition: a.partition, isDefault: a.partition === defaultPartition(), signedIn: r.ok, credits: creditsOf(r), error: r.ok ? null : r.error })
  }
  return { ok: true, accounts: rows }
}

/** A project to generate into on `partition`: the one titled "FlowDesk", made if missing. */
async function autoProject(partition: string): Promise<string | null> {
  const list = await call(listProjectsScript(), { account: partition })
  const hit = (Array.isArray(list.projects) ? list.projects as { projectId?: string; title?: string }[] : []).find(p => p.title === 'FlowDesk')
  if (hit?.projectId && FLOW_ID_RE.test(hit.projectId)) return hit.projectId
  const made = await call(createProjectScript('FlowDesk'), { account: partition })
  return typeof made.projectId === 'string' && FLOW_ID_RE.test(made.projectId) ? made.projectId : null
}

/**
 * Runs a generation on the project's account and, when that account is out of
 * credits, on the next account with credits — in that account's own "FlowDesk"
 * project, since projects do not cross accounts. The result says where it ran.
 */
async function generateRouted(projectId: string, account: string | null | undefined, script: (projectId: string) => string): Promise<FlowResult> {
  const resolved = resolvePartition(projectId, account)
  if ('error' in resolved) return { ok: false, error: resolved.error }
  const first = resolved.partition
  const accounts = googleAccountsGetter()
  const label = (p: string | null) => maskAccount(accounts.find(a => a.partition === p)?.email ?? '')
  const on = (p: string | null) => p ? { account: p } : {}

  const firstCredits = first ? creditsOf(await call(getCreditsScript(), on(first))) : null
  let firstError: string | null = null
  if (firstCredits === null || firstCredits > 0) {
    const r = await call(script(projectId), { ...on(first), project: projectId })
    if (!isFlowQuotaFailure(r)) return { ...r, account: label(first), projectId: r.projectId ?? projectId }
    firstError = String(r.error ?? 'quota')
  } else {
    firstError = `no credits left (${firstCredits})`
  }

  const tried: string[] = [`${label(first)}: ${firstError}`]
  for (const a of accounts.filter(x => x.partition !== first)) {
    const credits = creditsOf(await call(getCreditsScript(), { account: a.partition }))
    if (credits === null || credits <= 0) { tried.push(`${maskAccount(a.email)}: ${credits === null ? 'not signed in to Flow' : 'no credits left'}`); continue }
    const pid = await autoProject(a.partition)
    if (!pid) { tried.push(`${maskAccount(a.email)}: could not open a project`); continue }
    const r = await call(script(pid), { account: a.partition, project: pid })
    if (r.ok) return { ...r, account: maskAccount(a.email), projectId: pid, switchedAccount: true, switchedBecause: firstError }
    if (!isFlowQuotaFailure(r)) return { ...r, account: maskAccount(a.email), projectId: pid }
    tried.push(`${maskAccount(a.email)}: ${r.error}`)
  }
  return { ok: false, error: `no Google account could run this on Flow — ${tried.join('; ')}` }
}

export function flowEval(script: string, account?: string | null): Promise<FlowResult> {
  return call(script, { account })
}

/**
 * Generates one image in an existing project. `projectId` comes from
 * `flowListProjects` or `flowCreateProject`.
 *
 * Aspect ratio is no longer a parameter: the retired API took an explicit enum
 * and the captured request on the current API has no visible slot for one, so
 * offering the choice would be offering something unproven.
 */
export function flowGenerateImage(prompt: string, projectId: string, imageModel?: ImageModel | string, account?: string | null): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  const bad = promptError(text, 'generate an image')
  if (bad) return Promise.resolve({ ok: false, error: bad })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  const badId = flowIdError(id, 'projectId')
  if (badId) return Promise.resolve({ ok: false, error: badId })
  const model = imageModel ? String(imageModel) : 'NANO_BANANA_2'
  if (!(IMAGE_MODELS as readonly string[]).includes(model)) {
    return Promise.resolve({ ok: false, error: `unknown imageModel "${model.slice(0, 40)}" — use one of: ${IMAGE_MODELS.join(', ')}` })
  }
  return generateRouted(id, account, pid => generateImageScript(text, pid, model as ImageModel))
}

export function flowListProjects(account?: string | null): Promise<FlowResult> {
  return call(listProjectsScript(), { account })
}

/** Creates a new Flow project. Returns the new projectId, for use with flowGenerateImage. */
export function flowCreateProject(projectTitle: string, account?: string | null): Promise<FlowResult> {
  const title = String(projectTitle ?? '').trim() || new Date().toLocaleString()
  if (title.length > MAX_TITLE_LENGTH) return Promise.resolve({ ok: false, error: `the title is ${title.length} characters; keep it under ${MAX_TITLE_LENGTH}` })
  return call(createProjectScript(title), { account })
}

export interface MediaBytesResult {
  ok: boolean
  error?: string
  bytes?: Buffer
  contentType?: string
}

export function flowGenerateVideo(prompt: string, projectId: string, modelKey: string, account?: string | null): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  const bad = promptError(text, 'generate a video')
  if (bad) return Promise.resolve({ ok: false, error: bad })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  const badId = flowIdError(id, 'projectId')
  if (badId) return Promise.resolve({ ok: false, error: badId })
  const model = String(modelKey ?? '').trim()
  if (!model) return Promise.resolve({ ok: false, error: 'refusing to generate without a model key — call flowVideoModels first' })
  const badKey = videoKeyError(model, 'textToVideo')
  if (badKey) return Promise.resolve({ ok: false, error: badKey })
  return generateRouted(id, account, pid => generateVideoScript(text, pid, model))
}

export function flowGetCredits(account?: string | null): Promise<FlowResult> {
  return call(getCreditsScript(), { account })
}

/**
 * Looks up one media item by the id a generation returned. A read through
 * Flow's API, so it runs on whatever Flow page the account already has open
 * rather than navigating it (it used to load /project/<mediaId> on every poll).
 */
/**
 * A clip Flow accepted can still fail later with "unusual activity"; the
 * account that made it is parked then too (flowHolds.ts), not only at submit.
 */
function parkIfFlagged(r: FlowResult, mediaId: string, account?: string | null): FlowResult {
  if (!UNUSUAL_ACTIVITY.test(JSON.stringify(r))) return r
  const resolved = resolvePartition(mediaId, account)
  if (!('partition' in resolved) || !resolved.partition) return r
  const until = holdFlowAccount(resolved.partition, 'a generation failed with unusual activity')
  return { ...r, heldUntil: until, note: 'Flow flagged this account; FlowDesk parks it and will not generate on it until heldUntil.' }
}

export async function flowMediaStatus(mediaId: string, account?: string | null): Promise<FlowResult> {
  const id = String(mediaId ?? '').trim()
  if (!id) return { ok: false, error: 'refusing to look up without a mediaId' }
  const badId = flowIdError(id, 'mediaId')
  if (badId) return { ok: false, error: badId }
  // A media id routes to the account that made it, like a project id does.
  const first = parkIfFlagged(await call(mediaStatusScript(id), { owner: id, account }), id, account)
  if (first.ok || account || !(first as { notFound?: boolean }).notFound) return first
  // Not on the account it was routed to (an id never seen, or made outside
  // FlowDesk): look on the others; the one that has it becomes its owner.
  const tried = resolvePartition(id, null)
  const triedPartition = 'partition' in tried ? tried.partition : null
  for (const acc of googleAccountsGetter().filter(a => a.partition !== triedPartition)) {
    const r = await call(mediaStatusScript(id), { owner: id, account: acc.partition })
    if (r.ok) return r
  }
  return first
}

/** Renames an existing project. New capability: the retired API had none. */
export function flowRenameProject(projectId: string, projectTitle: string, account?: string | null): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  const title = String(projectTitle ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to rename without a projectId' })
  if (!title) return Promise.resolve({ ok: false, error: 'refusing to rename to an empty title' })
  const badId = flowIdError(id, 'projectId')
  if (badId) return Promise.resolve({ ok: false, error: badId })
  if (title.length > MAX_TITLE_LENGTH) return Promise.resolve({ ok: false, error: `the title is ${title.length} characters; keep it under ${MAX_TITLE_LENGTH}` })
  return call(renameProjectScript(id, title), { owner: id, account })
}

/** Lists the media already inside a project. */
export function flowListProjectMedia(projectId: string, account?: string | null): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to list media without a projectId' })
  const badId = flowIdError(id, 'projectId')
  if (badId) return Promise.resolve({ ok: false, error: badId })
  return call(listProjectMediaScript(id), { owner: id, project: id, account })
}

/** Flow's model families plus the generation keys verified to work. */
export async function flowVideoModels(account?: string | null): Promise<FlowResult> {
  const r = await call(videoModelsScript(), { account }) as FlowResult & { models?: string[] }
  return { ...r, families: r.models ?? [], verifiedModelKeys: VERIFIED_VIDEO_KEYS, note: 'Pass a verifiedModelKeys entry as modelKey. Family names are not accepted by the generate calls.' }
}

/** Deletes a project. Flow answers with nothing, so this reports the request. */
export function flowDeleteProject(projectId: string, account?: string | null): Promise<FlowResult> {
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to delete without a projectId' })
  const badId = flowIdError(id, 'projectId')
  if (badId) return Promise.resolve({ ok: false, error: badId })
  return call(deleteProjectScript(id), { owner: id, account })
}

/** The image types the captured upload (maseQ) has been seen carrying. */
const UPLOAD_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Uploads a local image into a project and returns its media id. */
export async function flowUploadImage(localFilePath: string, projectId: string, account?: string | null): Promise<FlowResult> {
  const path = String(localFilePath ?? '').trim()
  if (!path) return { ok: false, error: 'refusing to upload without a local file path' }
  const id = String(projectId ?? '').trim()
  if (!id) return { ok: false, error: 'refusing to upload without a projectId' }
  const badId = flowIdError(id, 'projectId')
  if (badId) return { ok: false, error: badId }

  let image: { bytes: Buffer; mime: string; name: string }
  try {
    // Absolute local paths only, image extensions, 25 MB cap, real image bytes.
    image = await readLocalImage(path)
  } catch (e) {
    return { ok: false, error: `could not read the image: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!UPLOAD_MIMES.has(image.mime)) return { ok: false, error: `Google Flow upload takes PNG, JPEG or WebP; this file is ${image.mime}` }
  return call(uploadImageScript(image.bytes.toString('base64'), id, image.mime, image.name), { owner: id, project: id, account })
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm',
}

/**
 * Cookie-less fetch of a flow-content.google URL. Redirects are followed by
 * hand so every hop is checked against the same allowlist, the body is read
 * against a size cap, and only an image or video answer is accepted.
 */
async function fetchDirectMedia(url: string, maxBytes = FLOW_MEDIA_MAX_BYTES): Promise<MediaBytesResult> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(current, { redirect: 'manual', credentials: 'omit' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      void res.body?.cancel().catch(() => {})
      if (!location) return { ok: false, error: `media fetch failed: HTTP ${res.status} without a location` }
      let next: string
      try { next = new URL(location, current).toString() } catch { return { ok: false, error: 'media fetch redirected to an invalid URL' } }
      const check = classifyFlowMediaUrl(next)
      if (!check.ok || check.via !== 'direct') return { ok: false, error: 'media fetch redirected off Google Flow — refused' }
      current = check.url
      continue
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => {})
      return { ok: false, error: `fetch failed: HTTP ${res.status} — Flow media URLs expire, so get a fresh one from flow_media_status` }
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!/^(image|video)\//.test(type)) {
      void res.body?.cancel().catch(() => {})
      return { ok: false, error: `the media URL did not answer with an image or video (${type || 'no type'})` }
    }
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > maxBytes) {
      void res.body?.cancel().catch(() => {})
      return { ok: false, error: `media is too large (${declared} bytes, max ${maxBytes})` }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = res.body?.getReader()
    if (!reader) return { ok: false, error: 'media fetch returned no body' }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        void reader.cancel().catch(() => {})
        return { ok: false, error: `media is too large (over ${maxBytes} bytes)` }
      }
      chunks.push(value)
    }
    return { ok: true, bytes: Buffer.concat(chunks), contentType: type }
  }
  return { ok: false, error: 'media fetch redirected too many times' }
}

/**
 * Fetches one media item's bytes from its Flow URL.
 *
 * The URL has to come from a listing rather than be built from a media id: the
 * token in it is opaque, and Flow's own download is a Blob save with no
 * network request to copy.
 */
async function fetchMediaBytes(mediaUrl: string, account?: string | null): Promise<MediaBytesResult> {
  const target = classifyFlowMediaUrl(mediaUrl)
  if (!target.ok) return { ok: false, error: target.error }
  if (target.via === 'direct') {
    try {
      return await fetchDirectMedia(target.url)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  const fetched = await call(fetchMediaUrlScript(target.url), { account })
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
export async function flowDownloadMedia(mediaUrl: string, account?: string | null, save: { outputDir?: string; fileName?: string } = {}): Promise<FlowResult> {
  const target = String(mediaUrl ?? '').trim()
  if (!target) return { ok: false, error: 'refusing to download without a media URL or mediaId' }
  const outputDir = String(save.outputDir ?? '').trim()
  if (outputDir && !isAbsolute(outputDir)) return { ok: false, error: 'outputDir must be an absolute folder path' }
  // A bare name only: no folders, nothing Windows refuses in a file name.
  const fileName = String(save.fileName ?? '').trim().replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120)
  // The file name carries the media id (asked for 2026-10-18: 20 clips named only by time could not be told apart).
  const mediaId = /^[a-z][a-z0-9+.-]*:/i.test(target)
    ? target.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null
    : target

  let downloadUrl = target
  // A media id: its signed URL comes from a status lookup on its own account.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    const status = await flowMediaStatus(target, account)
    if (!status.ok) return { ok: false, error: `could not get media status for ${target.slice(0, 64)}: ${status.error}` }
    const vUrl = typeof status.videoUrl === 'string' && status.videoUrl ? status.videoUrl
      : typeof status.imageUrl === 'string' && status.imageUrl ? status.imageUrl : null
    if (!vUrl) return { ok: false, error: `media ${target} is not ready or has no download URL yet (status: ${String(status.status)})` }
    downloadUrl = vUrl
  }

  const fetched = await fetchMediaBytes(downloadUrl, account)
  if (!fetched.ok || !fetched.bytes) return { ok: false, error: fetched.error }

  const type = (fetched.contentType ?? '').split(';')[0].trim().toLowerCase()
  const ext = EXT_BY_TYPE[type] ?? (type.startsWith('video/') ? 'mp4' : 'jpg')
  try {
    const dir = outputDir || join(app.getPath('downloads'), 'FlowDesk Studio')
    await mkdir(dir, { recursive: true })
    const base = fileName || (mediaId ? `flow-${mediaId.replace(/[^0-9a-z-]/gi, '_').slice(0, 64)}-${Date.now()}` : `flow-${Date.now()}`)
    const filePath = join(dir, `${base}.${ext}`)
    await writeFile(filePath, fetched.bytes)
    return { ok: true, downloaded: true, filePath, byteSize: fetched.bytes.length, mediaId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Hands the raw bytes back, so the agent can actually look at the image. */
export function flowViewMedia(mediaUrl: string, account?: string | null): Promise<MediaBytesResult> {
  const url = String(mediaUrl ?? '').trim()
  if (!url) return Promise.resolve({ ok: false, error: 'refusing to view without a media URL' })
  return fetchMediaBytes(url, account)
}

/** Generates a video using an existing image as its first frame. */
export function flowGenerateVideoFromImage(prompt: string, projectId: string, mediaId: string, modelKey: string, account?: string | null): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  const bad = promptError(text, 'generate a video')
  if (bad) return Promise.resolve({ ok: false, error: bad })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to generate without a projectId' })
  const media = String(mediaId ?? '').trim()
  if (!media) return Promise.resolve({ ok: false, error: 'refusing to generate without a source mediaId' })
  const badId = flowIdError(id, 'projectId') ?? flowIdError(media, 'mediaId')
  if (badId) return Promise.resolve({ ok: false, error: badId })
  const model = String(modelKey ?? '').trim()
  if (!model) return Promise.resolve({ ok: false, error: 'refusing to generate without a model key -- call flowVideoModels first' })
  const badKey = videoKeyError(model, 'imageToVideo')
  if (badKey) return Promise.resolve({ ok: false, error: badKey })
  return call(generateVideoFromImageScript(text, id, media, model), { owner: id, project: id, account })
}

/** Extends an existing video from its first 240 frames -- the only range captured. */
export function flowExtendVideo(prompt: string, projectId: string, sourceVideoId: string, sceneId: string, account?: string | null): Promise<FlowResult> {
  const text = String(prompt ?? '').trim()
  if (!text) return Promise.resolve({ ok: false, error: 'refusing to extend without a prompt' })
  if (text.length > MAX_PROMPT_LENGTH) return Promise.resolve({ ok: false, error: `the prompt is ${text.length} characters; keep it under ${MAX_PROMPT_LENGTH}` })
  const id = String(projectId ?? '').trim()
  if (!id) return Promise.resolve({ ok: false, error: 'refusing to extend without a projectId' })
  const source = String(sourceVideoId ?? '').trim()
  if (!source) return Promise.resolve({ ok: false, error: 'refusing to extend without a source video id' })
  const scene = String(sceneId ?? '').trim()
  if (!scene) return Promise.resolve({ ok: false, error: 'refusing to extend without a scene id' })
  const badId = flowIdError(id, 'projectId') ?? flowIdError(source, 'sourceVideoId') ?? flowIdError(scene, 'sceneId')
  if (badId) return Promise.resolve({ ok: false, error: badId })
  return call(extendVideoScript(text, id, source, scene), { owner: id, project: id, account })
}
