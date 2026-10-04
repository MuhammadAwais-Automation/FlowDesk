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
 */

import { writeFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app, type WebContents } from 'electron'
import { getWhatsAppView, ensureBackgroundView } from '../sessions'

export interface WhatsAppResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

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

async function resolveWhatsAppView(): Promise<{ webContents: WebContents } | null> {
  try {
    const existing = getWhatsAppView()
    if (existing) return existing

    if (typeof ensureBackgroundView === 'function') {
      try {
        const bg = await ensureBackgroundView('social-whatsapp', 'social-whatsapp', 'https://web.whatsapp.com')
        if (bg) {
          await new Promise(r => setTimeout(r, 4000))
          return bg
        }
      } catch {
        return null
      }
    }
    return null
  } catch {
    return null
  }
}

export async function call(expr: string, timeoutMs = 20000): Promise<WhatsAppResult> {
  const view = await resolveWhatsAppView()
  if (!view) {
    return { ok: false, error: 'WhatsApp is not open. Open the Social page in FlowDesk and sign in, then retry.' }
  }
  let timer: NodeJS.Timeout | undefined
  try {
    const execPromise = view.webContents.executeJavaScript(expr)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`WhatsApp bridge execution timed out after ${timeoutMs}ms`)), timeoutMs)
    })
    const res = await Promise.race([execPromise, timeoutPromise])
    if (res && typeof res === 'object') return safePayload(res as WhatsAppResult)
    return { ok: false, error: `bridge returned a non-object: ${String(res)}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function waStatus(): Promise<WhatsAppResult> {
  return call('window.__fdWaStatus()')
}

export function waListChats(limit?: number, onlyUnread?: boolean): Promise<WhatsAppResult> {
  const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined
  const safeOnlyUnread = typeof onlyUnread === 'boolean' ? onlyUnread : undefined
  return call(`window.__fdWaListChats(${JSON.stringify({ limit: safeLimit, onlyUnread: safeOnlyUnread })})`)
}

export function waApiListChats(limit?: number, onlyUnread?: boolean): Promise<WhatsAppResult> {
  return waListChats(limit, onlyUnread)
}

export function waListMessages(chatId: string, limit?: number): Promise<WhatsAppResult> {
  if (!chatId || typeof chatId !== 'string') {
    return Promise.resolve({ ok: false, error: 'chatId is required and must be a string' })
  }
  const safeLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  return call(`window.__fdWaListMessages(${JSON.stringify(chatId)}, ${JSON.stringify(safeLimit)})`)
}

export function waApiListMessages(chatId: string, limit?: number): Promise<WhatsAppResult> {
  return waListMessages(chatId, limit)
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
export async function waUnreadWithMessages(limit: number, messagesPerChat = 20): Promise<WhatsAppResult> {
  const listed = await waListChats(limit, true)
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
      const thread = await waListMessages(chatId, messagesPerChat)
      chats.push(thread.ok && Array.isArray(thread.messages)
        ? { ...chat, messages: thread.messages }
        : { ...chat, messages: [], messagesError: String(thread.error ?? 'unavailable') })
    } catch (e) {
      chats.push({ ...chat, messages: [], messagesError: e instanceof Error ? e.message : String(e) })
    }
  }
  return { ...listed, chats }
}

export function waSearchContacts(query: string): Promise<WhatsAppResult> {
  return call(`window.__fdWaChats(${JSON.stringify(query ?? '')})`)
}

export function waSend(chatId: string, text: string): Promise<WhatsAppResult> {
  if (!chatId || typeof chatId !== 'string') {
    return Promise.resolve({ ok: false, error: 'chatId is required and must be a string' })
  }
  if (text === undefined || text === null || typeof text !== 'string') {
    return Promise.resolve({ ok: false, error: 'text is required and must be a string' })
  }
  return call(`window.__fdWaSend(${JSON.stringify(chatId)}, ${JSON.stringify(text)})`)
}

export function waDeleteMessage(chatId: string, msgId: string, forEveryone: boolean): Promise<WhatsAppResult> {
  if (!chatId || typeof chatId !== 'string') {
    return Promise.resolve({ ok: false, error: 'chatId is required and must be a string' })
  }
  if (!msgId || typeof msgId !== 'string') {
    return Promise.resolve({ ok: false, error: 'msgId is required and must be a string' })
  }
  return call(`window.__fdWaDeleteMessage(${JSON.stringify(chatId)}, ${JSON.stringify(msgId)}, ${JSON.stringify(!!forEveryone)})`)
}

const MIME_EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf',
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
): Promise<WhatsAppResult> {
  if (!chatId || typeof chatId !== 'string') {
    return { ok: false, error: 'chatId is required and must be a string' }
  }
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: 'filePath is required and must be a string' }
  }

  const view = await resolveWhatsAppView()
  if (!view) {
    return { ok: false, error: 'WhatsApp is not open. Open the Social page in FlowDesk and sign in, then retry.' }
  }

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
        return { ok: false, error: `staging the file failed: ${staged?.error ?? 'unknown error'}` }
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
    return safePayload(res)
  } catch (e) {
    // Staged bytes are a copy of the user's file sitting in page memory. If
    // the send never got far enough to clear them itself, clear them here.
    try { await webContents.executeJavaScript(`window.__fdWaDiscardFile(${JSON.stringify(token)})`) } catch { /* view gone */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function waDownloadMedia(chatId: string, msgId: string): Promise<WhatsAppResult> {
  if (!chatId || typeof chatId !== 'string') {
    return { ok: false, error: 'chatId is required and must be a string' }
  }
  if (!msgId || typeof msgId !== 'string') {
    return { ok: false, error: 'msgId is required and must be a string' }
  }
  const res = await call(`window.__fdWaDownloadMedia(${JSON.stringify(chatId)}, ${JSON.stringify(msgId)})`)
  if (!res.ok) return res

  const base64 = res.base64 as string | undefined
  if (!base64) return { ok: false, error: 'bridge returned no bytes' }

  const mimetype = (res.mimetype as string | null) ?? ''
  // Strip codec parameters: WhatsApp reports voice notes as
  // "audio/ogg; codecs=opus", which is not a lookup key.
  const baseMime = mimetype.split(';')[0].trim()
  const ext = MIME_EXT[baseMime] ?? 'bin'

  const dir = join(app.getPath('downloads'), 'FlowDesk WhatsApp')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${msgId}.${ext}`)
  await writeFile(path, Buffer.from(base64, 'base64'))

  // Deliberately does not return base64: the caller has a path, and echoing
  // a megabyte of encoded audio back through a tool result helps nobody.
  return {
    ok: true,
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
export async function waDiagnose(): Promise<WhatsAppResult> {
  const [status, diag, media] = await Promise.all([
    call('window.__fdWaStatus()'),
    call('window.__fdWaDiag()'),
    call('window.__fdWaMediaProbe()'),
  ])
  return { ok: true, status, chatAndModules: diag, media }
}
