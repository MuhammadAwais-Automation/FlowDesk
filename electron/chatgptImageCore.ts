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
 * its text (last match wins, so a repeated prompt resolves to the newest turn)
 * and only its descendants are read, so earlier images in a continued
 * conversation are never returned as this turn's output.
 */
export function readTurn(nodes: ConvNode[], prompt: string): TurnResult {
  const want = norm(prompt).slice(0, 80)
  const users = nodes.filter(n => n.role === 'user' && norm(n.text).includes(want))
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
