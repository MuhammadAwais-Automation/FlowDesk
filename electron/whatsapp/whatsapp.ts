/**
 * Main-process access to the WhatsApp bridge.
 *
 * Shared deliberately: both the IPC handlers (renderer/UI) and the Agent tool
 * layer need exactly these calls, and having each build its own
 * executeJavaScript strings would mean two places to fix when the bridge
 * changes — and one of them silently drifting.
 *
 * Everything here evaluates inside the live WhatsApp page. See
 * whatsappInject.ts for why that is the only place the data is readable at
 * all: the wire carries Noise-encrypted binary, so the page's own decrypted
 * store is the interception point.
 *
 * Every call names an account from the social account registry (id, label or
 * partition; omitted = account 1) and runs only in that account's own view.
 * An explicit account that does not exist is an error, never a fallback to
 * whichever WhatsApp page happens to be open: reading or sending from the
 * wrong number is worse than failing.
 */

import { writeFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app, session, type WebContents } from 'electron'
import { ensureBackgroundView } from '../sessions'
import { resolveSocialAccount, SOCIAL_HOME, type SocialAccount } from '../socialAccounts'

export interface WhatsAppResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

/** Which WhatsApp account a call means: id ("2"), partition or label. Omitted = account 1. */
export type WhatsAppAccountRef = string | number | null | undefined

export function safePayload<T>(v: T, depth = 0, seen = new WeakSet()): T {
  if (v === null || v === undefined) return v
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return v
  if (t === 'function') return '[function]' as unknown as T
  if (t === 'symbol' || t === 'bigint') return String(v) as unknown as T
  if (v instanceof Error) {
    return { name: v.name, message: v.message, stack: v.stack } as unknown as T
  }
  if (depth >= 10) return '[depth limit]' as unknown as T

  if (typeof v === 'object') {
    if (seen.has(v as object)) return '[circular]' as unknown as T
    seen.add(v as object)

    if (Array.isArray(v)) {
      return v.map(item => safePayload(item, depth + 1, seen)) as unknown as T
    }
    try {
      const out: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        out[key] = safePayload(val, depth + 1, seen)
      }
      return out as T
    } catch {
      return '[unreadable]' as unknown as T
    }
  }
  return String(v) as unknown as T
}

const NOT_OPEN = 'WhatsApp is not open. Open the Social page in FlowDesk and sign in, then retry.'

/** The registry account, or an error result. Never falls back to another account. */
function whatsappAccount(ref: WhatsAppAccountRef): SocialAccount | WhatsAppResult {
  const acc = resolveSocialAccount('whatsapp', ref)
  if (acc) return acc
  return { ok: false, error: `unknown whatsapp account "${ref}" — list them with social_accounts { platform: "whatsapp" }` }
}

/** Refuses an explicit unknown account before any argument or page work. */
export function unknownWhatsAppAccount(ref: WhatsAppAccountRef): WhatsAppResult | null {
  const acc = whatsappAccount(ref)
  return 'ok' in acc ? acc : null
}

function onPartition(wc: WebContents, partition: string): boolean {
  try {
    return !wc.isDestroyed() && wc.session === session.fromPartition(`persist:${partition}`)
  } catch {
    return false
  }
}

/** How long a page that just opened gets to finish its history sync. */
const BRIDGE_WAIT_MS = 20000
const bridgeChecked = new WeakSet<WebContents>()

/**
 * Waits once per page for the bridge to report ready. A freshly opened
 * WhatsApp page holds 0 chats for the first ~15s while history sync runs, and
 * a read in that window answers "no chats" rather than failing. A page that
 * never gets ready (QR code, not signed in) is let through after the wait so
 * the call itself reports what it sees.
 */
async function waitForBridge(wc: WebContents): Promise<void> {
  if (bridgeChecked.has(wc)) return
  const deadline = Date.now() + BRIDGE_WAIT_MS
  while (Date.now() < deadline) {
    try {
      const ready = await wc.executeJavaScript('typeof window.__fdWaStatus === "function" && window.__fdWaStatus().ready === true')
      if (ready === true) break
    } catch { /* page still loading */ }
    await new Promise(r => setTimeout(r, 500))
  }
  bridgeChecked.add(wc)
}

/**
 * The account's own view only. This used to take ANY open web.whatsapp.com
 * page, which with two accounts reads (or sends from) the wrong number. The
 * Social page tab and the background window both use the partition as tabId
 * (account 1 = social-whatsapp); ensureBackgroundView returns the open UI view
 * when there is one, waits for a background window still loading, and opens
 * a hidden one otherwise, so the agent path works without the Social page.
 */
async function resolveWhatsAppView(acc: SocialAccount): Promise<{ webContents: WebContents } | string> {
  let view: { webContents: WebContents } | null = null
  try {
    view = await ensureBackgroundView(acc.partition, acc.partition, SOCIAL_HOME.whatsapp)
  } catch {
    return NOT_OPEN
  }
  if (!view) return NOT_OPEN
  if (!onPartition(view.webContents, acc.partition)) {
    return `the open view for whatsapp account "${acc.id}" is not on its partition ${acc.partition}; refusing to use it`
  }
  await waitForBridge(view.webContents)
  return view
}

export async function call(expr: string, timeoutMs = 20000, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const acc = whatsappAccount(account)
  if ('ok' in acc) return acc
  const view = await resolveWhatsAppView(acc)
  if (typeof view === 'string') return { ok: false, error: view, account: acc.id }
  let timer: NodeJS.Timeout | undefined
  try {
    const execPromise = view.webContents.executeJavaScript(expr)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`WhatsApp bridge execution timed out after ${timeoutMs}ms`)), timeoutMs)
    })
    const res = await Promise.race([execPromise, timeoutPromise])
    if (res && typeof res === 'object') return { ...safePayload(res as WhatsAppResult), account: acc.id }
    return { ok: false, error: `bridge returned a non-object: ${String(res)}`, account: acc.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: acc.id }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Bridge state plus whether the account is signed in.
 *
 * WhatsApp keeps its session in IndexedDB, so there is no cookie to read
 * (isSignedIn answers null) and the answer has to come from the page: a store
 * holding chats or contacts is a signed-in account. An empty or unreadable
 * store is "unknown" (null) rather than a guessed false — it is also what a
 * signed-in account looks like during its first seconds of history sync.
 */
export async function waStatus(account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const res = await call('window.__fdWaStatus()', 20000, account)
  if (!res.ok) return { ...res, signedIn: null }
  const loaded = Number(res.chats) > 0 || Number(res.contacts) > 0
  return loaded
    ? { ...res, signedIn: true }
    : { ...res, signedIn: null, hint: 'No chats loaded: still syncing, or not signed in. Sign in with social_open_login { platform: "whatsapp" }.' }
}

export function waListChats(limit?: number, onlyUnread?: boolean, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined
  const safeOnlyUnread = typeof onlyUnread === 'boolean' ? onlyUnread : undefined
  return call(`window.__fdWaListChats(${JSON.stringify({ limit: safeLimit, onlyUnread: safeOnlyUnread })})`, 20000, account)
}

/** Older name for waListChats, kept for the whatsapp.api_chats RPC and tool. */
export function waApiListChats(limit?: number, onlyUnread?: boolean, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  return waListChats(limit, onlyUnread, account)
}

export function waListMessages(chatId: string, limit?: number, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const unknown = unknownWhatsAppAccount(account)
  if (unknown) return Promise.resolve(unknown)
  if (!chatId || typeof chatId !== 'string') {
    return Promise.resolve({ ok: false, error: 'chatId is required and must be a string' })
  }
  const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  return call(`window.__fdWaListMessages(${JSON.stringify(chatId)}, ${JSON.stringify(safeLimit)})`, 20000, account)
}

/** Older name for waListMessages, kept for the whatsapp.api_messages RPC and tool. */
export function waApiListMessages(chatId: string, limit?: number, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  return waListMessages(chatId, limit, account)
}

/**
 * How many unread chats get their messages fetched.
 *
 * Each expansion is its own executeJavaScript round trip that may page
 * history in through WAWebChatLoadMessages, and the Brain's capability bridge
 * gives the whole call 60 seconds. Ten leaves room for slow chats; the rest
 * are still listed, just without a transcript.
 */
export const WA_MAX_EXPANDED_CHATS = 10

/**
 * Unread chats, each with its recent messages.
 *
 * `waListChats` alone answers with one preview line per chat — `last.body` —
 * which is null whenever the newest event was a protocol message. A real
 * capture of eight unread chats carried text for two of them, so everything
 * downstream (classification, and the digest that will write these into the
 * knowledge store) was reading a chat list rather than a conversation.
 *
 * The fan-out lives here because Electron main is the only process that may
 * touch a connector: the Brain's utility process asks for one capability and
 * gets whole threads back, without learning how to drive WhatsApp itself.
 *
 * Sequential on purpose. Every call evaluates inside the same live page and
 * loads into the same message store, so parallel requests contend.
 */
export async function waUnreadWithMessages(limit: number, messagesPerChat = 20, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const listed = await waListChats(limit, true, account)
  if (!listed.ok || !Array.isArray(listed.chats)) return listed

  const chats: Array<Record<string, unknown>> = []
  let expandedCount = 0
  for (const entry of listed.chats as unknown[]) {
    const chat = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const chatId = typeof chat.id === 'string' && chat.id ? chat.id : null
    if (!chatId || expandedCount >= WA_MAX_EXPANDED_CHATS) {
      chats.push(chat)
      continue
    }
    expandedCount++
    // A chat that fails to load is kept with an empty transcript rather than
    // dropped: its unread count and name are still a real signal, and losing
    // the whole chat would make one unreadable thread look like no thread.
    try {
      const thread = await waListMessages(chatId, messagesPerChat, account)
      chats.push(thread.ok && Array.isArray(thread.messages)
        ? { ...chat, messages: thread.messages }
        : { ...chat, messages: [], messagesError: String(thread.error ?? 'unavailable') })
    } catch (e) {
      chats.push({ ...chat, messages: [], messagesError: e instanceof Error ? e.message : String(e) })
    }
  }
  return { ...listed, chats }
}

export function waSearchContacts(query: string, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  return call(`window.__fdWaChats(${JSON.stringify(query ?? '')})`, 20000, account)
}

export function waSend(chatId: string, text: string, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const unknown = unknownWhatsAppAccount(account)
  if (unknown) return Promise.resolve(unknown)
  if (!chatId || typeof chatId !== 'string') {
    return Promise.resolve({ ok: false, error: 'chatId is required and must be a string' })
  }
  if (text === undefined || text === null || typeof text !== 'string') {
    return Promise.resolve({ ok: false, error: 'text is required and must be a string' })
  }
  // The gateway coerces a missing text to '' and the page would send it as an
  // empty bubble; nothing meaningful is ever an empty WhatsApp message.
  if (!text.trim()) {
    return Promise.resolve({ ok: false, error: 'text is empty; refusing to send an empty message' })
  }
  return call(`window.__fdWaSend(${JSON.stringify(chatId)}, ${JSON.stringify(text)})`, 20000, account)
}

export function waDeleteMessage(chatId: string, msgId: string, forEveryone: boolean, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const unknown = unknownWhatsAppAccount(account)
  if (unknown) return Promise.resolve(unknown)
  if (!chatId || typeof chatId !== 'string') {
    return Promise.resolve({ ok: false, error: 'chatId is required and must be a string' })
  }
  if (!msgId || typeof msgId !== 'string') {
    return Promise.resolve({ ok: false, error: 'msgId is required and must be a string' })
  }
  return call(`window.__fdWaDeleteMessage(${JSON.stringify(chatId)}, ${JSON.stringify(msgId)}, ${JSON.stringify(!!forEveryone)})`, 20000, account)
}

const MIME_EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf',
}

/**
 * Attachments the page can actually take.
 *
 * WhatsApp itself accepts far larger files, but every byte here crosses into
 * the page as base64 inside an evaluated script. This is the point where a
 * too-large file is refused with a number the user can act on, rather than
 * becoming a hung renderer or an out-of-memory failure with no explanation.
 */
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024

/** Bytes per staged chunk, before base64 expands them by a third. */
const CHUNK_BYTES = 512 * 1024

/**
 * Mimetype from the file extension.
 *
 * Deliberately a small table rather than a dependency. It only has to cover
 * what changes WhatsApp's own behaviour: images and video get rendered inline,
 * audio becomes a playable clip, and everything else is a document either way.
 * An unknown extension falls back to a generic type and is sent as a document,
 * which is the outcome that cannot be wrong.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function mimetypeFor(filePath: string): string {
  return MIME_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Whether a file should travel as a document rather than as media.
 *
 * Anything WhatsApp cannot render inline is a document — that is not a
 * preference, it is what the outward type means. Callers can force a document
 * for something renderable (sending a photo as a file so it keeps its original
 * quality and name), but they cannot force the reverse, because asking
 * WhatsApp to render a .zip as a photo has no meaning.
 */
export function shouldSendAsDocument(mimetype: string, asDocument?: boolean): boolean {
  if (asDocument) return true
  return !/^(image|video|audio)\//.test(mimetype)
}

/**
 * Sends one file to one chat.
 *
 * The route inside the page (createFromData -> prepRawMedia -> waitForPrep ->
 * sendToChat) was found by probing the live page and verified end to end
 * against a real chat before this was written: a document arrived with its
 * filename and byte count intact, and an image arrived as an image.
 *
 * Approval happens in the tool layer above this — the only place that can show
 * the user the recipient, the file and its size, and get a real answer.
 */
export async function waSendFile(
  chatId: string,
  filePath: string,
  caption?: string,
  asDocument?: boolean,
  account?: WhatsAppAccountRef,
): Promise<WhatsAppResult> {
  const acc = whatsappAccount(account)
  if ('ok' in acc) return acc
  if (!chatId || typeof chatId !== 'string') {
    return { ok: false, error: 'chatId is required and must be a string' }
  }
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: 'filePath is required and must be a string' }
  }

  const view = await resolveWhatsAppView(acc)
  if (typeof view === 'string') return { ok: false, error: view, account: acc.id }

  let bytes: Buffer
  let size: number
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { ok: false, error: `${filePath} is not a file` }
    size = info.size
    if (size === 0) return { ok: false, error: 'refusing to send an empty file' }
    if (size > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        error: `${filePath} is ${(size / 1024 / 1024).toFixed(1)}MB; the limit for sending through FlowDesk is ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`,
      }
    }
    bytes = await readFile(filePath)
  } catch (e) {
    return { ok: false, error: `could not read ${filePath}: ${e instanceof Error ? e.message : String(e)}` }
  }

  const filename = basename(filePath)
  const mimetype = mimetypeFor(filePath)
  const token = `fd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const webContents = view.webContents
  const execWithTimeout = async <T>(script: string, timeoutMs = 20000): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    const execPromise = webContents.executeJavaScript(script)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`WhatsApp file operation timed out after ${timeoutMs}ms`)), timeoutMs)
    })
    try {
      return await Promise.race([execPromise, timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES).toString('base64')
      const staged = await execWithTimeout<{ ok?: boolean; error?: string }>(
        `window.__fdWaStageChunk(${JSON.stringify(token)}, ${JSON.stringify(chunk)}, ${JSON.stringify(mimetype)})`,
      )
      if (!staged?.ok) {
        return { ok: false, error: `staging the file failed: ${staged?.error ?? 'unknown error'}`, account: acc.id }
      }
    }

    const res = await execWithTimeout<WhatsAppResult>(
      `window.__fdWaSendFile(${JSON.stringify(chatId)}, ${JSON.stringify({
        token,
        mimetype,
        filename,
        caption: caption || undefined,
        asDocument: shouldSendAsDocument(mimetype, asDocument),
        // Checked inside the page before anything is sent. A lost chunk would
        // otherwise deliver a silently truncated file, which looks like a
        // successful send from every side.
        expectedBytes: size,
      })})`,
      30000,
    )
    return { ...safePayload(res), account: acc.id }
  } catch (e) {
    // Staged bytes are a copy of the user's file sitting in page memory. If
    // the send never got far enough to clear them itself, clear them here.
    try { await webContents.executeJavaScript(`window.__fdWaDiscardFile(${JSON.stringify(token)})`) } catch { /* view gone */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: acc.id }
  }
}

/**
 * The file name a downloaded message is saved under. msgId is caller input
 * and ends up in a path, so anything but a plain id character is replaced:
 * "../../x" must not climb out of the downloads folder.
 */
export function mediaFileName(msgId: string, ext: string): string {
  const safeId = msgId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'media'
  return `${safeId}.${ext}`
}

/**
 * Download one media message and write it to disk, returning the path.
 *
 * The bytes come back from the page as base64 because that is what survives
 * an executeJavaScript round trip — but base64 is not what a caller wants to
 * be handed. An agent asked to "listen to that voice note" needs a real file
 * it can pass to a transcriber, so the encoding stays an implementation
 * detail and the tool returns a path.
 */
export async function waDownloadMedia(chatId: string, msgId: string, account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const unknown = unknownWhatsAppAccount(account)
  if (unknown) return unknown
  if (!chatId || typeof chatId !== 'string') {
    return { ok: false, error: 'chatId is required and must be a string' }
  }
  if (!msgId || typeof msgId !== 'string') {
    return { ok: false, error: 'msgId is required and must be a string' }
  }
  const res = await call(`window.__fdWaDownloadMedia(${JSON.stringify(chatId)}, ${JSON.stringify(msgId)})`, 20000, account)
  if (!res.ok) return res

  const base64 = res.base64 as string | undefined
  if (!base64) return { ok: false, error: 'bridge returned no bytes', account: res.account }

  const mimetype = (res.mimetype as string | null) ?? ''
  // Strip codec parameters: WhatsApp reports voice notes as
  // "audio/ogg; codecs=opus", which is not a lookup key.
  const baseMime = mimetype.split(';')[0].trim()
  const ext = MIME_EXT[baseMime] ?? 'bin'

  const dir = join(app.getPath('downloads'), 'FlowDesk WhatsApp')
  await mkdir(dir, { recursive: true })
  const path = join(dir, mediaFileName(msgId, ext))
  await writeFile(path, Buffer.from(base64, 'base64'))

  // Deliberately does not return base64: the caller has a path, and echoing
  // a megabyte of encoded audio back through a tool result helps nobody.
  return {
    ok: true,
    account: res.account,
    path,
    type: res.type,
    mimetype: mimetype || null,
    bytes: res.bytes,
    duration: res.duration ?? null,
    via: res.via,
  }
}

/**
 * Everything the bridge knows about its own state, in one call.
 *
 * Until now each probe was reachable only by setting an env var and
 * restarting the app — which meant every diagnosis cost a restart, a QR-less
 * relog wait, and a fresh history sync. When a failure is intermittent that
 * is the difference between finding it and not. Exposing the same probes as
 * a tool lets whoever hits the failure ask about it straight away, while the
 * broken state is still there to look at.
 */
export async function waDiagnose(account?: WhatsAppAccountRef): Promise<WhatsAppResult> {
  const unknown = unknownWhatsAppAccount(account)
  if (unknown) return unknown
  const [status, diag, media] = await Promise.all([
    call('window.__fdWaStatus()', 20000, account),
    call('window.__fdWaDiag()', 20000, account),
    call('window.__fdWaMediaProbe()', 20000, account),
  ])
  return { ok: true, account: status.account, status, chatAndModules: diag, media }
}
