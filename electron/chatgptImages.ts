/**
 * ChatGPT image generation across every signed-in account.
 *
 * Each account (an Electron partition signed in to chatgpt.com) gets one
 * hidden worker window. A job opens a fresh "Create image" chat
 * (?hints=picture_v2), types its prompt, and is then followed over the API —
 * GET /backend-api/conversation/{id} — rather than through the global SSE
 * capture, which correlates by provider name and so cannot tell two
 * concurrent ChatGPT turns apart. That is what makes jobs on different
 * accounts safe to run at the same time.
 *
 * Quota is read before a job, never guessed: POST /backend-api/conversation/init
 * reports image_gen { remaining, reset_after } without generating anything.
 * An account that refuses on quota is parked until its reset and the job moves
 * to the next account; any other refusal is reported, not retried.
 *
 * Text goes in with CDP Input.insertText, not the clipboard paste the chat
 * injector uses: the clipboard is one per machine, and two jobs pasting at
 * once would swap prompts.
 */
import { app, BrowserWindow, session, type WebContents } from 'electron'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureBackgroundView } from './sessions'
import { generatedImagesDir, parseSavedImageRef } from './savedImages'
import {
  classifyRefusal, exhaustedUntil, isUsable, maskEmail, pickAccount, readTurn, QUOTA_TTL_MS,
  type AccountQuota, type ConvNode, type PoolAccount,
} from './chatgptImageCore'

const NEW_IMAGE_CHAT = 'https://chatgpt.com/?hints=picture_v2'
const COMPOSER = 'div.ProseMirror[contenteditable="true"], #prompt-textarea'
const SUBMIT_TIMEOUT_MS = 90_000
const TURN_TIMEOUT_MS = 15 * 60_000
const POLL_MS = 4_000
const NUDGE = 'Please create the image now.'

export interface SavedImage { url: string; path: string; width?: number; height?: number; title?: string | null }

export interface ImageJob {
  id: string
  kind: 'generate' | 'edit'
  prompt: string
  /** Local files attached to the message (edit by upload). */
  files: string[]
  /** Edit inside the conversation that made the source image — same account only. */
  continueIn?: { partition: string; conversationId: string }
  preferred?: string | null
  status: 'queued' | 'running' | 'done' | 'failed'
  /** What a running job is doing right now, for progress display. */
  stage?: string
  account?: string
  partition?: string
  conversationId?: string
  images: SavedImage[]
  text?: string
  error?: string
  /** Partitions that refused this job on quota or login. */
  tried: string[]
  createdAt: number
  finishedAt?: number
}

// ── configuration ───────────────────────────────────────────────────────────

let getAccounts: () => PoolAccount[] = () => []
let getPreferred: () => string | null = () => null

export function configureChatgptImages(opts: { getAccounts: () => PoolAccount[]; getPreferred?: () => string | null }) {
  getAccounts = opts.getAccounts
  if (opts.getPreferred) getPreferred = opts.getPreferred
}

export function poolAccounts(): PoolAccount[] {
  const list = getAccounts()
  return list.length > 0 ? list : [{ email: 'default', partition: 'default' }]
}

// ── quota ledger (persisted so a parked account stays parked across restarts) ─

const quotas = new Map<string, AccountQuota>()
const chatgptEmail = new Map<string, string>()
let quotaLoaded = false
const quotaFile = () => join(app.getPath('userData'), 'chatgpt-image-quota.json')

async function loadQuotas() {
  if (quotaLoaded) return
  quotaLoaded = true
  try {
    const raw = JSON.parse(await readFile(quotaFile(), 'utf8')) as Record<string, AccountQuota>
    for (const [p, q] of Object.entries(raw)) quotas.set(p, q)
  } catch { /* first run */ }
}

async function saveQuotas() {
  await writeFile(quotaFile(), JSON.stringify(Object.fromEntries(quotas), null, 2), 'utf8').catch(() => {})
}

// ── page scripts ────────────────────────────────────────────────────────────

export const SESSION_JS = `var __s = await fetch('/api/auth/session').then(function (r) { return r.json() }).catch(function () { return null });`

function quotaScript(): string {
  return `(async function () {
    try {
      ${SESSION_JS}
      if (!__s || !__s.accessToken) return { loggedIn: false }
      var r = await fetch('/backend-api/conversation/init', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + __s.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gizmo_id: null, requested_default_model: null, conversation_id: null, timezone_offset_min: new Date().getTimezoneOffset() }),
      })
      var base = { loggedIn: true, email: __s.user && __s.user.email, plan: __s.account && __s.account.planType }
      if (!r.ok) return Object.assign(base, { error: 'conversation/init HTTP ' + r.status })
      var j = await r.json()
      var g = (j.limits_progress || []).find(function (l) { return l.feature_name === 'image_gen' })
      return Object.assign(base, { remaining: g ? g.remaining : null, resetAfter: g ? g.reset_after : null })
    } catch (e) { return { loggedIn: false, error: String(e && e.message || e) } }
  })()`
}

export function conversationScript(conversationId: string): string {
  return `(async function () {
    try {
      ${SESSION_JS}
      if (!__s || !__s.accessToken) return { ok: false, error: 'signed out' }
      var r = await fetch('/backend-api/conversation/' + ${JSON.stringify(conversationId)}, { headers: { Authorization: 'Bearer ' + __s.accessToken } })
      if (!r.ok) return { ok: false, error: 'conversation HTTP ' + r.status }
      var c = await r.json()
      var nodes = Object.values(c.mapping || {}).filter(function (n) { return n.message }).map(function (n) {
        var m = n.message, parts = (m.content && m.content.parts) || []
        return {
          id: m.id, parent: n.parent || null, role: m.author && m.author.role, name: (m.author && m.author.name) || null,
          recipient: m.recipient || null, ctype: m.content && m.content.content_type, status: m.status || null,
          endTurn: m.end_turn === undefined ? null : m.end_turn,
          createTime: m.create_time || null,
          text: parts.filter(function (p) { return typeof p === 'string' }).join('\\n'),
          images: parts.filter(function (p) { return p && p.content_type === 'image_asset_pointer' && typeof p.asset_pointer === 'string' }).map(function (p) {
            return { fileId: p.asset_pointer.replace(/^[a-z]+:\\/\\//, ''), width: p.width, height: p.height, generated: !!(p.metadata && p.metadata.generation) }
          }),
          title: (m.metadata && m.metadata.image_gen_title) || null,
        }
      })
      return { ok: true, nodes: nodes }
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
  })()`
}

function downloadUrlScript(fileId: string, conversationId: string): string {
  const path = `/backend-api/files/download/${fileId}?conversation_id=${encodeURIComponent(conversationId)}&inline=false`
  return `(async function () {
    try {
      ${SESSION_JS}
      var r = await fetch(${JSON.stringify(path)}, { headers: { Authorization: 'Bearer ' + __s.accessToken } })
      if (!r.ok) return null
      var j = await r.json()
      return j && j.download_url ? j.download_url : null
    } catch (e) { return null }
  })()`
}

// ── worker window + composer ────────────────────────────────────────────────

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function workerFor(partition: string, url: string, prefix = 'cgimg'): Promise<WebContents> {
  const tabId = `${prefix}-${partition}`
  const { webContents } = await ensureBackgroundView(tabId, partition, url)
  if (webContents.getURL() !== url) await webContents.loadURL(url).catch(() => {})
  return webContents
}

async function withCdp<T>(wc: WebContents, fn: (send: (m: string, p?: object) => Promise<any>) => Promise<T>): Promise<T> {
  const wasAttached = wc.debugger.isAttached()
  if (!wasAttached) wc.debugger.attach('1.3')
  const send = (m: string, p?: object) => wc.debugger.sendCommand(m, p)
  try {
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    return await fn(send)
  } finally {
    if (!wasAttached) { try { wc.debugger.detach() } catch { /* gone */ } }
  }
}

const composerText = (wc: WebContents) => wc.executeJavaScript(
  `(function () { var el = document.querySelector(${JSON.stringify(COMPOSER)}); return el ? (el.value !== undefined ? el.value : el.textContent || '') : null })()`,
) as Promise<string | null>

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, stepMs = 300): Promise<T | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const v = await fn().catch(() => null)
    if (v) return v as T
    await sleep(stepMs)
  }
  return null
}

async function attachFiles(wc: WebContents, files: string[]): Promise<void> {
  await withCdp(wc, async send => {
    const { root } = await send('DOM.getDocument', { depth: 1 })
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"][accept="image/*"]' })
    if (!nodeId) throw new Error('ChatGPT has no image upload input on this page')
    await send('DOM.setFileInputFiles', { nodeId, files })
  })
  // The thumbnails appear at once; the upload behind them finishes later and
  // keeps Send disabled until it does, which the submit step waits out.
  const shown = await waitFor(() => wc.executeJavaScript(
    `(function () { var c = document.querySelector(${JSON.stringify(COMPOSER)}); var f = c && c.closest('form'); return f ? f.querySelectorAll('img').length >= ${files.length} : false })()`,
  ), 30_000)
  if (!shown) throw new Error('the image did not attach to the ChatGPT message')
}

export async function typeAndSend(wc: WebContents, prompt: string): Promise<void> {
  const focused = await waitFor(() => wc.executeJavaScript(
    `(function () { var el = document.querySelector(${JSON.stringify(COMPOSER)}); if (!el) return false; el.focus(); return document.activeElement === el || el.contains(document.activeElement) })()`,
  ), 20_000)
  if (!focused) throw new Error('ChatGPT composer not found — the page may be signed out or still loading')

  await withCdp(wc, async send => {
    const mod = process.platform === 'darwin' ? 8 : 2
    const key = (k: object) => Promise.all([send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }), send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })])
    await key({ windowsVirtualKeyCode: 65, key: 'a', code: 'KeyA', modifiers: mod })
    await key({ windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' })
    await send('Input.insertText', { text: prompt })
  })
  const want = prompt.replace(/\s+/g, ' ').trim().slice(0, 40)
  const landed = await waitFor(async () => {
    const t = await composerText(wc)
    return t && t.replace(/\s+/g, ' ').includes(want)
  }, 5_000, 100)
  if (!landed) throw new Error('the prompt did not land in the ChatGPT composer')

  // Send stays disabled while an attachment is still uploading.
  const clicked = await waitFor(() => wc.executeJavaScript(`(function () {
    var c = document.querySelector(${JSON.stringify(COMPOSER)}); var f = c && c.closest('form'); if (!f) return false
    var b = f.querySelector('[data-testid="send-button"], #composer-submit-button') ||
      Array.from(f.querySelectorAll('button')).find(function (x) { return /^send( prompt| message)?$/i.test((x.getAttribute('aria-label') || '').trim()) })
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false
    b.click(); return true
  })()`), 60_000, 500)
  if (!clicked) throw new Error('ChatGPT never enabled Send (upload stuck or composer changed)')
}

// ── results ─────────────────────────────────────────────────────────────────

const originsFile = () => join(generatedImagesDir(), '_chatgpt-origins.jsonl')

export async function saveImage(wc: WebContents, partition: string, conversationId: string, img: { fileId: string; width?: number; height?: number; title?: string | null }): Promise<SavedImage> {
  // The signed link has answered 500 right after a turn ends (live, 2026-09-28)
  // while working a few seconds later, so ask for a fresh link and retry.
  let res: Response | null = null
  let lastError = ''
  for (let attempt = 0; attempt < 4 && !res; attempt++) {
    if (attempt) await sleep(3_000 * attempt)
    const url = await wc.executeJavaScript(downloadUrlScript(img.fileId, conversationId)).catch(() => null) as string | null
    if (!url) { lastError = 'no download link'; continue }
    const r = await session.fromPartition(`persist:${partition}`).fetch(url).catch(() => null)
    if (r?.ok) res = r
    else lastError = `HTTP ${r?.status ?? 'network error'}`
  }
  if (!res) throw new Error(`image ${img.fileId} did not download (${lastError}); it is still in conversation ${conversationId}`)
  const type = (res.headers.get('content-type') || 'image/png').split(';')[0].trim()
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
  const fileName = `chatgpt-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
  const dir = generatedImagesDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, fileName)
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  await appendFile(originsFile(), JSON.stringify({ file: fileName, partition, conversationId, fileId: img.fileId }) + '\n', 'utf8').catch(() => {})
  return { url: `flowdesk-image://${fileName}`, path, width: img.width, height: img.height, title: img.title }
}

async function originOf(fileName: string): Promise<{ partition: string; conversationId: string } | null> {
  try {
    const lines = (await readFile(originsFile(), 'utf8')).trim().split('\n').reverse()
    for (const l of lines) {
      const o = JSON.parse(l) as { file: string; partition: string; conversationId: string }
      if (o.file === fileName) return { partition: o.partition, conversationId: o.conversationId }
    }
  } catch { /* none recorded */ }
  return null
}

// ── one job on one account ──────────────────────────────────────────────────

class AccountRefused extends Error {
  constructor(public reason: 'quota' | 'login', message: string) { super(message) }
}

async function execute(job: ImageJob, acc: PoolAccount): Promise<void> {
  const cont = job.continueIn && job.continueIn.partition === acc.partition ? job.continueIn : null
  job.stage = 'opening ChatGPT'
  const wc = await workerFor(acc.partition, cont ? `https://chatgpt.com/c/${cont.conversationId}` : NEW_IMAGE_CHAT)

  job.stage = 'checking the image limit'
  const q = await readQuota(acc, wc)
  if (!q.loggedIn) throw new AccountRefused('login', 'not signed in to ChatGPT')
  if (!isUsable(q, Date.now())) throw new AccountRefused('quota', 'no image generations left')

  if (!cont && job.files.length) { job.stage = 'uploading the source image'; await attachFiles(wc, job.files) }
  job.stage = 'sending the prompt'
  await typeAndSend(wc, job.prompt)
  job.stage = 'ChatGPT is generating'

  const conversationId = cont?.conversationId ?? await waitFor(async () => {
    const m = wc.getURL().match(/\/c\/([0-9a-f-]{36})/)
    return m ? m[1] : null
  }, SUBMIT_TIMEOUT_MS, 500)
  if (!conversationId) throw new Error('ChatGPT did not start a conversation for the prompt')
  job.conversationId = conversationId

  // Poll the conversation. A turn is over at the assistant's end_turn message;
  // images already present but no end_turn yet are waited on a little in case
  // more are coming, then accepted.
  const end = Date.now() + TURN_TIMEOUT_MS
  let lastCount = -1
  let stableSince = 0
  // A prompt that reads like a caption ("a red boat, flat illustration") can be
  // answered with text alone (seen live, 2026-10-04). One follow-up in the same
  // chat asks for the picture; a second text-only answer is reported as it is.
  let awaiting = job.prompt
  let nudged = false
  while (Date.now() < end) {
    await sleep(POLL_MS)
    const conv = await wc.executeJavaScript(conversationScript(conversationId)).catch(() => null) as { ok: boolean; nodes?: ConvNode[]; error?: string } | null
    if (!conv?.ok || !conv.nodes) continue
    const turn = readTurn(conv.nodes, awaiting)
    if (turn.images.length !== lastCount) { lastCount = turn.images.length; stableSince = Date.now() }
    const settled = turn.state === 'done' || (turn.images.length > 0 && Date.now() - stableSince > 20_000)
    if (!settled) continue

    if (turn.images.length === 0) {
      const text = turn.state === 'done' ? turn.text : ''
      if (classifyRefusal(text) === 'quota') throw new AccountRefused('quota', text.slice(0, 300))
      if (!nudged) {
        nudged = true
        awaiting = NUDGE
        job.stage = 'ChatGPT answered in text, asking it to draw'
        await typeAndSend(wc, NUDGE)
        lastCount = -1
        continue
      }
      throw new Error(`ChatGPT answered without an image: ${text.slice(0, 400)}`)
    }
    job.stage = `saving ${turn.images.length} image${turn.images.length === 1 ? '' : 's'}`
    for (const img of turn.images) job.images.push(await saveImage(wc, acc.partition, conversationId, img))
    job.text = turn.state === 'done' ? turn.text : undefined
    return
  }
  throw new Error(`no image after ${TURN_TIMEOUT_MS / 60_000} minutes (conversation ${conversationId})`)
}

async function readQuota(acc: PoolAccount, wc?: WebContents): Promise<AccountQuota> {
  await loadQuotas()
  const prev = quotas.get(acc.partition)
  const w = wc ?? await workerFor(acc.partition, 'https://chatgpt.com/')
  // Wait out the page's first load: the session endpoint needs its cookies.
  const r = await waitFor(() => w.executeJavaScript(quotaScript()) as Promise<{ loggedIn: boolean; email?: string; plan?: string; remaining?: number | null; resetAfter?: string | null; error?: string }>, 15_000, 1_000)
    ?? { loggedIn: false, error: 'could not read the ChatGPT session' }
  if (r.email) chatgptEmail.set(acc.partition, r.email)
  const q: AccountQuota = {
    loggedIn: r.loggedIn,
    plan: r.plan ?? null,
    remaining: r.remaining ?? null,
    resetAfter: r.resetAfter ?? null,
    checkedAt: Date.now(),
    // A parked account stays parked until its reset even if init still shows images.
    exhaustedUntil: prev?.exhaustedUntil && prev.exhaustedUntil > Date.now() ? prev.exhaustedUntil : null,
    error: r.error ?? null,
  }
  quotas.set(acc.partition, q)
  await saveQuotas()
  return q
}

// ── queue ───────────────────────────────────────────────────────────────────

const jobs = new Map<string, ImageJob>()
const waiters = new Map<string, ((j: ImageJob) => void)[]>()
const busy = new Set<string>()

function finish(job: ImageJob, status: 'done' | 'failed', error?: string) {
  job.status = status
  job.error = error
  job.finishedAt = Date.now()
  for (const w of waiters.get(job.id) ?? []) w(job)
  waiters.delete(job.id)
}

export function label(acc: PoolAccount): string {
  return maskEmail(chatgptEmail.get(acc.partition) ?? acc.email)
}

function pump() {
  const now = Date.now()
  const all = poolAccounts()
  for (const job of jobs.values()) {
    if (job.status !== 'queued') continue
    let pool = all.filter(a => !job.tried.includes(a.partition))
    // An edit in its own conversation must run on that conversation's account.
    if (job.continueIn) {
      const own = pool.find(a => a.partition === job.continueIn!.partition)
      if (own && isUsable(quotas.get(own.partition), now)) pool = [own]
      else if (job.files.length) job.continueIn = undefined // fall back to uploading the image elsewhere
      else { finish(job, 'failed', 'the account that made this image is out of quota or signed out, and the image file is missing'); continue }
    }
    const acc = pickAccount(pool, quotas, busy, now, job.preferred ?? getPreferred())
    if (!acc) {
      const anyLeft = pool.some(a => isUsable(quotas.get(a.partition), now))
      if (!anyLeft) finish(job, 'failed', `no ChatGPT account can generate right now: ${describeAccounts(all)}`)
      continue
    }
    run(job, acc)
  }
}

function run(job: ImageJob, acc: PoolAccount) {
  busy.add(acc.partition)
  job.status = 'running'
  job.partition = acc.partition
  job.account = label(acc)
  execute(job, acc)
    .then(() => finish(job, 'done'))
    .catch(async (e: unknown) => {
      if (e instanceof AccountRefused) {
        const q = await readQuota(acc).catch(() => quotas.get(acc.partition))
        if (q) {
          if (e.reason === 'quota') q.exhaustedUntil = exhaustedUntil(q.resetAfter, Date.now())
          if (e.reason === 'login') q.loggedIn = false
          quotas.set(acc.partition, q)
          await saveQuotas()
        }
        job.tried.push(acc.partition)
        job.status = 'queued'
        job.images = []
        return
      }
      finish(job, 'failed', e instanceof Error ? e.message : String(e))
    })
    .finally(() => {
      busy.delete(acc.partition)
      // Refresh the count this job spent, then hand the account the next job.
      if (job.status === 'done') void readQuota(acc).catch(() => {}).finally(pump)
      else pump()
    })
}

function describeAccounts(all: PoolAccount[]): string {
  return all.map(a => {
    const q = quotas.get(a.partition)
    if (!q) return `${label(a)} (not checked)`
    if (!q.loggedIn) return `${label(a)} (signed out of ChatGPT)`
    const until = q.exhaustedUntil && q.exhaustedUntil > Date.now() ? q.exhaustedUntil : q.remaining === 0 && q.resetAfter ? Date.parse(q.resetAfter) : null
    return until ? `${label(a)} (limit reached, resets ${new Date(until).toISOString()})` : `${label(a)} (${q.remaining ?? '?'} left)`
  }).join(', ')
}

export interface ImageRequest {
  prompt: string
  /** How many separate images (one job each; spread across accounts). */
  count?: number
  /** For edits: a flowdesk-image:// reference, a saved file name, or a local path. */
  image?: string
  account?: string | null
}

async function resolveImageFile(ref: string): Promise<{ path: string; origin: { partition: string; conversationId: string } | null }> {
  if (isAbsolute(ref) && existsSync(ref)) return { path: ref, origin: null }
  const name = parseSavedImageRef(ref)
  const path = name ? join(generatedImagesDir(), name) : ''
  if (!name || !existsSync(path)) throw new Error(`image not found: ${ref.slice(0, 120)}`)
  return { path, origin: await originOf(name) }
}

export async function enqueueImages(req: ImageRequest): Promise<ImageJob[]> {
  await loadQuotas()
  const prompt = String(req.prompt ?? '').trim()
  if (!prompt) throw new Error('prompt is required')
  if (prompt.length > 4000) throw new Error('prompt is over 4000 characters')
  const count = Math.max(1, Math.min(20, Math.floor(req.count ?? 1)))
  const source = req.image ? await resolveImageFile(req.image) : null
  const created: ImageJob[] = []
  for (let i = 0; i < count; i++) {
    const job: ImageJob = {
      id: randomUUID().slice(0, 8),
      kind: source ? 'edit' : 'generate',
      prompt,
      files: source ? [source.path] : [],
      continueIn: source?.origin ?? undefined,
      preferred: req.account ?? null,
      status: 'queued',
      images: [],
      tried: [],
      createdAt: Date.now(),
    }
    jobs.set(job.id, job)
    created.push(job)
  }
  pump()
  return created
}

export function waitForJob(job: ImageJob, timeoutMs: number): Promise<ImageJob> {
  if (job.status === 'done' || job.status === 'failed') return Promise.resolve(job)
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(job), timeoutMs)
    const list = waiters.get(job.id) ?? []
    list.push(j => { clearTimeout(timer); resolve(j) })
    waiters.set(job.id, list)
  })
}

export function listJobs(id?: string): ImageJob[] {
  const all = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
  return id ? all.filter(j => j.id === id) : all.slice(0, 50)
}

/** Every account's ChatGPT sign-in and image quota. `refresh` re-reads stale ones. */
export async function imageAccounts(refresh = true) {
  await loadQuotas()
  const all = poolAccounts()
  if (refresh) {
    await Promise.all(all.filter(a => !busy.has(a.partition)).map(a => {
      const q = quotas.get(a.partition)
      return !q || Date.now() - q.checkedAt > QUOTA_TTL_MS / 10 ? readQuota(a).catch(() => null) : null
    }))
  }
  const now = Date.now()
  return all.map(a => {
    const q = quotas.get(a.partition)
    return {
      account: maskEmail(a.email),
      chatgpt: chatgptEmail.has(a.partition) ? maskEmail(chatgptEmail.get(a.partition)) : null,
      partition: a.partition,
      signedIn: q?.loggedIn ?? null,
      plan: q?.plan ?? null,
      imagesLeft: q?.remaining ?? null,
      resetsAt: q?.resetAfter ?? null,
      parkedUntil: q?.exhaustedUntil && q.exhaustedUntil > now ? new Date(q.exhaustedUntil).toISOString() : null,
      usable: isUsable(q, now),
      busy: busy.has(a.partition),
      error: q?.error ?? null,
    }
  })
}

/** Opens a visible window on an account's partition so the user can sign in to ChatGPT once. */
export function openChatgptLogin(partition: string): { ok: boolean; error?: string } {
  const acc = poolAccounts().find(a => a.partition === partition)
  if (!acc) return { ok: false, error: 'unknown account partition — list them with chatgpt.imageAccounts' }
  const win = new BrowserWindow({
    width: 1000, height: 800, title: `ChatGPT sign-in — ${maskEmail(acc.email)}`,
    webPreferences: { session: session.fromPartition(`persist:${partition}`), nodeIntegration: false, contextIsolation: true },
  })
  void win.loadURL('https://chatgpt.com/auth/login')
  win.on('closed', () => { quotas.delete(partition); void saveQuotas() })
  return { ok: true }
}

/** Shape returned to callers: no partitions of other accounts, no raw emails. */
export function publicJob(j: ImageJob) {
  return {
    id: j.id, kind: j.kind, status: j.status,
    stage: j.status === 'queued' ? 'waiting for a free account' : j.status === 'running' ? (j.stage ?? 'starting') : null,
    account: j.account ?? null,
    conversationId: j.conversationId ?? null,
    images: j.images, text: j.text ? j.text.slice(0, 600) : null, error: j.error ?? null,
    retriedOn: j.tried.length, seconds: Math.round(((j.finishedAt ?? Date.now()) - j.createdAt) / 1000),
  }
}
