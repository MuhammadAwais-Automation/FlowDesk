/**
 * The Electron-free half of ChatGPT image generation: reading a conversation
 * for one turn's result, telling a quota refusal from any other refusal, and
 * choosing which signed-in account runs the next job.
 *
 * Shapes are from live captures, not guesses (probes/out/cg-10-quota-endpoints,
 * cg-11-conv-shape):
 *  - POST /backend-api/conversation/init answers `limits_progress` with an
 *    `image_gen` entry { remaining, reset_after } without spending anything.
 *  - A finished image is a `tool` message from the image tool
 *    (author name "t2uay3k.sj1i4kz") whose parts hold `image_asset_pointer`
 *    "sediment://file_…" with `metadata.generation`.
 *  - A refusal is an `assistant` text message with end_turn true and no image.
 */

export interface ConvNode {
  id: string
  parent: string | null
  role: string
  name: string | null
  recipient: string | null
  ctype: string | null
  status: string | null
  endTurn: boolean | null
  /** Epoch seconds from the message's create_time. */
  createTime?: number | null
  text: string
  images: { fileId: string; width?: number; height?: number; generated: boolean }[]
  title?: string | null
}

export interface TurnImage { fileId: string; width?: number; height?: number; title?: string | null }

export type TurnResult =
  | { state: 'pending'; images: TurnImage[] }
  | { state: 'done'; images: TurnImage[]; text: string }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The result of the turn that `prompt` started. The user message is matched by
 * its text (last match wins) and only its descendants are read, so earlier
 * images in a continued conversation are never returned as this turn's output.
 * `exclude` holds the node ids that existed before the send: the same prompt
 * sent twice in one chat must not resolve to the OLD turn before the new user
 * message is saved.
 */
export function readTurn(nodes: ConvNode[], prompt: string, exclude?: ReadonlySet<string>): TurnResult {
  const want = norm(prompt).slice(0, 80)
  const users = nodes.filter(n => n.role === 'user' && !exclude?.has(n.id) && norm(n.text).includes(want))
  const user = users[users.length - 1]
  if (!user) return { state: 'pending', images: [] }

  const children = new Map<string, ConvNode[]>()
  for (const n of nodes) {
    if (!n.parent) continue
    const list = children.get(n.parent) ?? []
    list.push(n)
    children.set(n.parent, list)
  }
  const below: ConvNode[] = []
  const stack = [...(children.get(user.id) ?? [])]
  while (stack.length) {
    const n = stack.pop()!
    below.push(n)
    stack.push(...(children.get(n.id) ?? []))
  }

  const images: TurnImage[] = below
    .filter(n => n.role === 'tool')
    .flatMap(n => n.images.filter(i => i.generated).map(i => ({ fileId: i.fileId, width: i.width, height: i.height, title: n.title ?? null })))
  const final = below.find(n => n.role === 'assistant' && n.endTurn === true && n.recipient === 'all')
  return final ? { state: 'done', images, text: final.text } : { state: 'pending', images }
}

export type Refusal = 'quota' | 'unavailable' | 'refused'

/**
 * Only a clear limit message counts as quota. "unavailable" is an account that
 * cannot draw right now although its quota reads fine (seen live 2026-10-04 on
 * a free account with 3 images left: "I wasn't able to generate the image due
 * to an error on my side." / "It looks like image creation is temporarily
 * unavailable.") — the job belongs on another account. Everything else
 * (content policy, a question back) is reported as-is.
 */
export function classifyRefusal(text: string): Refusal {
  if (/(hit|reached|exceeded)[^.]{0,60}\blimit\b|\blimit\b[^.]{0,40}\b(reset|resets)\b|image generation limit|too many (image )?requests|try again (in|after) \d/i.test(text)) return 'quota'
  if (/temporarily unavailable|error on my side|image (creation|generation) is (currently |temporarily )?(unavailable|down|disabled)|(wasn'?t|was not|couldn'?t|could not|am not|unable to)( able to)? (generate|create) (the |an |this )?image/i.test(text)) return 'unavailable'
  return 'refused'
}

export interface AccountQuota {
  loggedIn: boolean
  plan?: string | null
  /** null = the account did not report an image limit. */
  remaining: number | null
  resetAfter: string | null
  checkedAt: number
  /** Set after a quota refusal; the account is skipped until then. */
  exhaustedUntil?: number | null
  error?: string | null
}

export interface PoolAccount { email: string; partition: string }

/** How long a quota reading is trusted before it is read again. */
export const QUOTA_TTL_MS = 10 * 60_000

export function isUsable(q: AccountQuota | undefined, now: number): boolean {
  if (!q) return true // unknown: worth a check
  if (!q.loggedIn) return false
  if (q.exhaustedUntil && q.exhaustedUntil > now) return false
  return q.remaining === null || q.remaining > 0
}

/**
 * The account for the next job: free, signed in, with quota left. Among those,
 * the preferred account first, then the one with the most images left, so
 * load spreads instead of draining one account to zero.
 */
export function pickAccount(
  accounts: PoolAccount[],
  quotas: Map<string, AccountQuota>,
  busy: Set<string>,
  now: number,
  preferred?: string | null,
): PoolAccount | null {
  const free = accounts.filter(a => !busy.has(a.partition) && isUsable(quotas.get(a.partition), now))
  if (free.length === 0) return null
  const pref = preferred ? free.find(a => a.partition === preferred || a.email.toLowerCase() === preferred.toLowerCase()) : undefined
  if (pref) return pref
  const left = (a: PoolAccount) => quotas.get(a.partition)?.remaining ?? Number.MAX_SAFE_INTEGER
  return [...free].sort((a, b) => left(b) - left(a))[0]
}

/** When a quota-refused account becomes worth trying again. */
export function exhaustedUntil(resetAfter: string | null, now: number): number {
  const t = resetAfter ? Date.parse(resetAfter) : NaN
  return Number.isFinite(t) && t > now ? t : now + 60 * 60_000
}

export function maskEmail(email: string | null | undefined): string {
  const m = String(email ?? '').match(/([^\s()<>]+)@([^\s()<>]+)/)
  return m ? `${m[1].slice(0, 2)}***@${m[2]}` : '***'
}

// ── input checks ────────────────────────────────────────────────────────────

/**
 * Conversation ids (UUIDs) and file ids (file_…/file-…) go into backend URL
 * paths. Anything else — a slash, "..", "?" — could turn a read into a request
 * to another endpoint, so only plain id characters pass.
 */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID.test(id)
}

export function assertSafeId(id: unknown, what: string): string {
  if (!isSafeId(id)) throw new Error(`invalid ${what}: expected letters, digits, "-" or "_"`)
  return id
}

/** A model slug as listed by GET /backend-api/models (e.g. "gpt-4o", "o4-mini", "gpt-5-1-thinking"). */
export function isModelSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(slug)
}

/** The pool account an explicit `account` (partition or email) names, or null. */
export function findAccount<T extends PoolAccount>(list: T[], ref: string | null | undefined): T | null {
  if (!ref) return null
  const r = ref.toLowerCase()
  return list.find(a => a.partition === ref || a.email.toLowerCase() === r) ?? null
}

/**
 * Accounts a job or an ask may run on. An explicitly named account is the ONLY
 * one: work the caller pinned to an account never moves to another. Without a
 * pin, every account not yet tried.
 */
export function candidateAccounts<T extends PoolAccount>(all: T[], pinned: T | null, tried: string[] = []): T[] {
  const pool = pinned ? all.filter(a => a.partition === pinned.partition) : all
  return pool.filter(a => !tried.includes(a.partition))
}

// ── time limits ─────────────────────────────────────────────────────────────

export class TimeoutError extends Error {}

/** Rejects with `message` if `p` has not settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(message)), ms) })
  return Promise.race([p, limit]).finally(() => clearTimeout(timer))
}

export interface Deadline { aborted: boolean; reason: string }

/**
 * Runs `fn` with a hard limit. On timeout the caller gets a rejection at once
 * (so the account is freed) and `deadline.aborted` is set, so the abandoned run
 * stops at its next step instead of typing into a window another job now owns.
 */
export function runWithDeadline<T>(ms: number, message: string, fn: (d: Deadline) => Promise<T>): Promise<T> {
  const d: Deadline = { aborted: false, reason: message }
  return withTimeout(fn(d), ms, message).catch((e: unknown) => {
    if (e instanceof TimeoutError) d.aborted = true
    throw e
  })
}

export function checkDeadline(d: Deadline | undefined): void {
  if (d?.aborted) throw new TimeoutError(d.reason)
}

/**
 * Whether a run of failed conversation reads should end the wait. A read the
 * server refuses outright (not found, forbidden, signed out) fails after a
 * minute of refusals; other errors (network, page reloading) after three.
 */
export function readFailureFatal(failingSince: number | null, now: number, error: string | undefined): boolean {
  if (failingSince === null) return false
  const hard = /HTTP 40[134]\b|signed out/i.test(error ?? '')
  return now - failingSince > (hard ? 60_000 : 3 * 60_000)
}

/** Keyed one-at-a-time runner: a later call on a key waits for the earlier one to settle. */
export function createSerial() {
  const tails = new Map<string, Promise<unknown>>()
  return function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
    const tail = run.catch(() => {})
    tails.set(key, tail)
    // Drop the entry once this run is the last one, so the map does not grow.
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key) })
    return run
  }
}

// ── quota ledger ────────────────────────────────────────────────────────────

/**
 * Adds quota entries read from disk without overwriting readings made since the
 * app started (the file is older than anything in memory). Malformed entries
 * are dropped.
 */
export function mergeQuotas(target: Map<string, AccountQuota>, raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  for (const [p, q] of Object.entries(raw as Record<string, unknown>)) {
    if (target.has(p) || !q || typeof q !== 'object') continue
    const e = q as Record<string, unknown>
    if (typeof e.loggedIn !== 'boolean' || typeof e.checkedAt !== 'number') continue
    target.set(p, {
      loggedIn: e.loggedIn,
      plan: typeof e.plan === 'string' ? e.plan : null,
      remaining: typeof e.remaining === 'number' ? e.remaining : null,
      resetAfter: typeof e.resetAfter === 'string' ? e.resetAfter : null,
      checkedAt: e.checkedAt,
      exhaustedUntil: typeof e.exhaustedUntil === 'number' ? e.exhaustedUntil : null,
      error: typeof e.error === 'string' ? e.error : null,
    })
  }
}

// ── job results ─────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

/**
 * What a batch of image jobs adds up to. `ok` means "nothing went wrong yet":
 * true when at least one image is done or jobs are still queued/running, false
 * only when every job failed. `state` says which.
 */
export function summarizeJobs(statuses: JobStatus[]): {
  ok: boolean
  state: 'done' | 'partial' | 'running' | 'failed'
  progress: { total: number; done: number; running: number; queued: number; failed: number }
} {
  const count = (s: JobStatus) => statuses.filter(x => x === s).length
  const progress = { total: statuses.length, done: count('done'), running: count('running'), queued: count('queued'), failed: count('failed') }
  const pending = progress.running + progress.queued
  const state = pending > 0 ? 'running'
    : progress.total > 0 && progress.done === progress.total ? 'done'
      : progress.done > 0 ? 'partial'
        : 'failed'
  return { ok: state !== 'failed', state, progress }
}

/** Finished jobs beyond the newest `keep` are forgotten, so the job list cannot grow without bound. */
export function jobsToPrune<J extends { id: string; status: JobStatus; createdAt: number }>(all: J[], keep: number): string[] {
  const finished = all.filter(j => j.status === 'done' || j.status === 'failed').sort((a, b) => b.createdAt - a.createdAt)
  return finished.slice(keep).map(j => j.id)
}
