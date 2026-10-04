/**
 * ChatGPT chats the way a person uses them: list the latest chats, read one,
 * send a message in a new chat or inside an existing one — on a chosen account,
 * or on whichever account is free.
 *
 * Reads go over the API (GET /backend-api/conversations, /conversation/{id})
 * from a worker window of their own ("cgapi"), so a read never navigates a
 * window that is busy answering. Sends use a second worker ("cgchat") per
 * account and follow the reply over the API instead of the global SSE capture,
 * which tells concurrent turns apart only by provider name. One send at a time
 * per account; different accounts run in parallel.
 *
 * A limit refusal on text has never been captured live: the check below is the
 * same wording match the image path uses, applied only to short replies, and
 * is marked unverified until a real refusal is seen.
 */
import type { WebContents } from 'electron'
import { classifyRefusal, readTurn, type ConvNode, type PoolAccount } from './chatgptImageCore'
import { mapChatList, mapChatSearch, mapImageLibrary, planAsk, toMessages, type ChatHit, type ChatMessage, type ChatSummary, type LibraryImage } from './chatgptChatCore'
import { SESSION_JS, conversationScript, label, poolAccounts, saveImage, sleep, typeAndSend, waitFor, workerFor, type SavedImage } from './chatgptImages'

const HOME = 'https://chatgpt.com/'
const API_WORKER = 'cgapi'
const CHAT_WORKER = 'cgchat'
const POLL_MS = 3_000
const TURN_TIMEOUT_MS = 10 * 60_000
const SUBMIT_TIMEOUT_MS = 60_000
const PARK_MS = 60 * 60_000

export function resolveAccount(ref?: string | null): PoolAccount | null {
  if (!ref) return null
  const r = ref.toLowerCase()
  return poolAccounts().find(a => a.partition === ref || a.email.toLowerCase() === r) ?? null
}

const apiWorker = (a: PoolAccount) => workerFor(a.partition, HOME, API_WORKER)

/** A read-only GET against the account's own backend API, from inside its signed-in page. */
function getScript(path: string): string {
  return `(async function () {
    try {
      ${SESSION_JS}
      if (!__s || !__s.accessToken) return { ok: false, error: 'signed out' }
      var r = await fetch(${JSON.stringify(path)}, { headers: { Authorization: 'Bearer ' + __s.accessToken } })
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status }
      return { ok: true, body: await r.json() }
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
  })()`
}

type Got = { ok: boolean; body?: unknown; error?: string }
const apiGet = async (acc: PoolAccount, path: string): Promise<Got> =>
  (await waitFor(async () => (await apiWorker(acc)).executeJavaScript(getScript(path)) as Promise<Got>, 15_000, 1_000)) ?? { ok: false, error: 'no answer' }

const SESSION_CHECK = `(async function () {
  try { ${SESSION_JS}; return !!(__s && __s.accessToken) } catch (e) { return false }
})()`

type Conv = { ok: boolean; nodes?: ConvNode[]; error?: string }

export interface ChatListItem extends ChatSummary { account: string; partition: string }

/** Latest chats, newest first — on one account, or merged across all of them. */
export async function listChats(opts: { account?: string | null; limit?: number }): Promise<{ ok: boolean; chats: ChatListItem[]; errors: string[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50)
  const picked = resolveAccount(opts.account)
  if (opts.account && !picked) return { ok: false, chats: [], errors: [`unknown account "${opts.account}" — list them with chatgpt_image_accounts`] }
  const targets = picked ? [picked] : poolAccounts()
  const errors: string[] = []
  const per = await Promise.all(targets.map(async acc => {
    try {
      const res = await apiGet(acc, `/backend-api/conversations?offset=0&limit=${limit}&order=updated`)
      if (!res.ok) { errors.push(`${label(acc)}: ${res.error}`); return [] }
      return mapChatList(res.body).map(c => ({ ...c, account: label(acc), partition: acc.partition }))
    } catch (e) {
      errors.push(`${label(acc)}: ${e instanceof Error ? e.message : String(e)}`)
      return []
    }
  }))
  const chats = per.flat().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, limit)
  return { ok: chats.length > 0 || errors.length === 0, chats, errors }
}

async function readNodes(wc: WebContents, chatId: string): Promise<Conv | null> {
  return wc.executeJavaScript(conversationScript(chatId)).catch(() => null) as Promise<Conv | null>
}

/** Which account holds this chat: the named one, else the first that can open it. */
async function ownerOf(chatId: string, ref?: string | null): Promise<{ acc: PoolAccount; nodes: ConvNode[] } | { error: string }> {
  const picked = resolveAccount(ref)
  if (ref && !picked) return { error: `unknown account "${ref}"` }
  for (const acc of picked ? [picked] : poolAccounts()) {
    const conv = await readNodes(await apiWorker(acc), chatId)
    if (conv?.ok && conv.nodes) return { acc, nodes: conv.nodes }
  }
  return { error: picked ? `chat ${chatId} was not found on ${label(picked)}` : `chat ${chatId} was not found on any account` }
}

export async function readChat(opts: { chatId: string; account?: string | null; lastN?: number }): Promise<{ ok: boolean; account?: string; chatId: string; messages: ChatMessage[]; error?: string }> {
  const found = await ownerOf(opts.chatId, opts.account)
  if ('error' in found) return { ok: false, chatId: opts.chatId, messages: [], error: found.error }
  return { ok: true, account: label(found.acc), chatId: opts.chatId, messages: toMessages(found.nodes, opts.lastN) }
}

// ── ask ─────────────────────────────────────────────────────────────────────

class Refused extends Error {
  constructor(public reason: 'quota' | 'login', message: string) { super(message) }
}

const parkedUntil = new Map<string, number>()
const tails = new Map<string, Promise<unknown>>()

/** One send at a time per account; queued sends wait their turn. */
function serial<T>(partition: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(partition) ?? Promise.resolve()).catch(() => {}).then(fn)
  tails.set(partition, run.catch(() => {}))
  return run
}

export interface AskResult {
  ok: boolean
  account?: string
  chatId?: string
  text?: string
  /** Images ChatGPT drew in this turn, already saved to disk. */
  images?: SavedImage[]
  triedFirst?: string[]
  error?: string
}

async function sendOn(acc: PoolAccount, prompt: string, chatId: string | null): Promise<{ chatId: string; text: string; images: SavedImage[] }> {
  const wc = await workerFor(acc.partition, chatId ? `${HOME}c/${chatId}` : HOME, CHAT_WORKER)
  const signedIn = await waitFor(() => wc.executeJavaScript(SESSION_CHECK) as Promise<boolean>, 15_000, 1_000)
  if (!signedIn) throw new Refused('login', 'not signed in to ChatGPT')

  await typeAndSend(wc, prompt)
  const id = chatId ?? await waitFor(async () => wc.getURL().match(/\/c\/([0-9a-f-]{36})/)?.[1] ?? null, SUBMIT_TIMEOUT_MS, 500)
  if (!id) throw new Error('ChatGPT did not start a conversation for the prompt')

  const end = Date.now() + TURN_TIMEOUT_MS
  while (Date.now() < end) {
    await sleep(POLL_MS)
    const conv = await readNodes(wc, id)
    if (!conv?.ok || !conv.nodes) continue
    const turn = readTurn(conv.nodes, prompt)
    if (turn.state !== 'done') continue
    // unverified: a text-limit refusal has not been captured live
    if (turn.images.length === 0 && turn.text.length < 400 && classifyRefusal(turn.text) === 'quota') throw new Refused('quota', turn.text)
    const images: SavedImage[] = []
    for (const img of turn.images) images.push(await saveImage(wc, acc.partition, id, img))
    return { chatId: id, text: turn.text, images }
  }
  throw new Error(`no answer after ${TURN_TIMEOUT_MS / 60_000} minutes (chat ${id})`)
}

/**
 * Send `prompt` to ChatGPT. A new chat by default; `chatId` continues an
 * existing one on the account that owns it. Without `account`, the first
 * signed-in account that is not parked for a limit answers, and a limit or
 * sign-out moves the send to the next one.
 */
export async function askChat(opts: { prompt: string; account?: string | null; chatId?: string | null }): Promise<AskResult> {
  const chatId = opts.chatId || null
  let candidates: PoolAccount[]
  if (chatId) {
    const found = await ownerOf(chatId, opts.account)
    if ('error' in found) return { ok: false, error: found.error }
    candidates = [found.acc] // a chat lives on one account; it cannot move
  } else {
    const picked = resolveAccount(opts.account)
    if (opts.account && !picked) return { ok: false, error: `unknown account "${opts.account}" — list them with chatgpt_image_accounts` }
    const all = poolAccounts()
    candidates = picked ? [picked, ...all.filter(a => a !== picked)] : all
  }

  const plan = planAsk(candidates, null, parkedUntil, Date.now())
  const live = plan.live
  const parked = plan.parked.map(a => `${label(a)} (parked after a limit)`)
  const failures: string[] = []
  for (const acc of live) {
    try {
      const r = await serial(acc.partition, () => sendOn(acc, opts.prompt, chatId))
      return { ok: true, account: label(acc), chatId: r.chatId, text: r.text, ...(r.images.length ? { images: r.images } : {}), ...(failures.length ? { triedFirst: failures } : {}) }
    } catch (e) {
      if (e instanceof Refused) {
        if (e.reason === 'quota') parkedUntil.set(acc.partition, Date.now() + PARK_MS)
        failures.push(`${label(acc)} (${e.reason === 'quota' ? 'limit reached' : 'signed out'})`)
        continue
      }
      return { ok: false, account: label(acc), error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: false, error: `no ChatGPT account could answer: ${[...failures, ...parked].join(', ') || 'none configured'}` }
}

/**
 * What the old `ask_chatgpt` returned: plain text. Any image ChatGPT drew is
 * saved and listed as flowdesk-image:// links after the answer. A failure
 * throws, as the old path did.
 */
export async function askChatgptText(prompt: string): Promise<string> {
  const r = await askChat({ prompt })
  if (!r.ok) throw new Error(r.error ?? 'ChatGPT did not answer')
  const links = (r.images ?? []).map(i => i.url)
  return [r.text ?? '', links.length ? `Images:\n${links.join('\n')}` : '', r.chatId ? `(chat ${r.chatId} on ${r.account})` : ''].filter(Boolean).join('\n\n')
}

// ── library, search, download ───────────────────────────────────────────────

const oneAccount = (ref?: string | null): PoolAccount | { error: string } => {
  const picked = resolveAccount(ref)
  if (ref && !picked) return { error: `unknown account "${ref}" — list them with chatgpt_image_accounts` }
  return picked ?? poolAccounts()[0] ?? { error: 'no ChatGPT account configured' }
}

/**
 * Every image this account ever generated, newest first, across all chats —
 * without opening a single chat. `cursor` from one page fetches the next.
 */
export async function imageLibrary(opts: { account?: string | null; limit?: number; cursor?: string | null }): Promise<{ ok: boolean; account?: string; images: LibraryImage[]; cursor: string | null; error?: string }> {
  const acc = oneAccount(opts.account)
  if ('error' in acc) return { ok: false, images: [], cursor: null, error: acc.error }
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100)
  const res = await apiGet(acc, `/backend-api/my/recent/image_gen?limit=${limit}${opts.cursor ? `&after=${encodeURIComponent(opts.cursor)}` : ''}`)
  if (!res.ok) return { ok: false, account: label(acc), images: [], cursor: null, error: res.error }
  return { ok: true, account: label(acc), ...mapImageLibrary(res.body) }
}

/** Full-text search over chat titles and messages, with the matching snippet. */
export async function searchChats(opts: { query: string; account?: string | null; limit?: number }): Promise<{ ok: boolean; hits: (ChatHit & { account: string })[]; errors: string[] }> {
  const picked = resolveAccount(opts.account)
  if (opts.account && !picked) return { ok: false, hits: [], errors: [`unknown account "${opts.account}"`] }
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50)
  const errors: string[] = []
  const per = await Promise.all((picked ? [picked] : poolAccounts()).map(async acc => {
    const res = await apiGet(acc, `/backend-api/conversations/search?query=${encodeURIComponent(opts.query)}&limit=${limit}`)
    if (!res.ok) { errors.push(`${label(acc)}: ${res.error}`); return [] }
    return mapChatSearch(res.body).map(h => ({ ...h, account: label(acc) }))
  }))
  return { ok: errors.length === 0 || per.some(p => p.length > 0), hits: per.flat().slice(0, limit), errors }
}

function patchScript(chatId: string, body: object): string {
  return `(async function () {
    try {
      ${SESSION_JS}
      if (!__s || !__s.accessToken) return { ok: false, error: 'signed out' }
      var r = await fetch('/backend-api/conversation/' + ${JSON.stringify(chatId)}, { method: 'PATCH', headers: { Authorization: 'Bearer ' + __s.accessToken, 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })
      return r.ok ? { ok: true } : { ok: false, error: 'HTTP ' + r.status }
    } catch (e) { return { ok: false, error: String(e && e.message || e) } }
  })()`
}

/**
 * Rename and/or archive a chat (PATCH /backend-api/conversation/{id}, captured
 * 2026-10-04). Success is what a fresh read shows afterwards, not the 200.
 * There is deliberately no delete.
 */
export async function updateChat(opts: { chatId: string; account?: string | null; title?: string; archived?: boolean }): Promise<{ ok: boolean; account?: string; title?: string; archived?: boolean; error?: string }> {
  const body: Record<string, unknown> = {}
  if (typeof opts.title === 'string' && opts.title.trim()) body.title = opts.title.trim().slice(0, 200)
  if (typeof opts.archived === 'boolean') body.is_archived = opts.archived
  if (!Object.keys(body).length) return { ok: false, error: 'nothing to change: pass title and/or archived' }
  const found = await ownerOf(opts.chatId, opts.account)
  if ('error' in found) return { ok: false, error: found.error }
  const wc = await apiWorker(found.acc)
  const res = await wc.executeJavaScript(patchScript(opts.chatId, body)).catch((e: unknown) => ({ ok: false, error: String(e) })) as { ok: boolean; error?: string }
  if (!res.ok) return { ok: false, account: label(found.acc), error: res.error }
  await sleep(1_000)
  const after = await apiGet(found.acc, `/backend-api/conversation/${encodeURIComponent(opts.chatId)}`)
  const c = (after.body ?? {}) as { title?: unknown; is_archived?: unknown }
  const titleOk = body.title === undefined || c.title === body.title
  const archivedOk = body.is_archived === undefined || c.is_archived === body.is_archived
  const state = { account: label(found.acc), title: typeof c.title === 'string' ? c.title : undefined, archived: c.is_archived === true }
  return titleOk && archivedOk ? { ok: true, ...state } : { ok: false, ...state, error: 'ChatGPT accepted the change but a fresh read does not show it' }
}

/** Save one ChatGPT image (a library `fileId`) to disk; returns a flowdesk-image:// link. */
export async function downloadImage(opts: { fileId: string; conversationId: string; account?: string | null }): Promise<{ ok: boolean; image?: SavedImage; error?: string }> {
  const acc = oneAccount(opts.account)
  if ('error' in acc) return { ok: false, error: acc.error }
  try {
    return { ok: true, image: await saveImage(await apiWorker(acc), acc.partition, opts.conversationId, { fileId: opts.fileId }) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
