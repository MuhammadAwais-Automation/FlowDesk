/**
 * The Electron-free half of ChatGPT chat access: shaping the conversation list
 * and one conversation's messages. Shapes are from live captures
 * (probes/out/cg-01-api-survey, cg-11-conv-shape):
 *  - GET /backend-api/conversations?offset&limit&order=updated answers
 *    `{ items: [{ id, title, create_time, update_time, is_archived, ... }] }`
 *    with ISO timestamps.
 *  - GET /backend-api/conversation/{id} answers a `mapping` of nodes whose
 *    messages carry `create_time` as epoch seconds.
 */
import type { ConvNode } from './chatgptImageCore'

export interface ChatSummary {
  id: string
  title: string
  updatedAt: string | null
  createdAt: string | null
  archived: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** Image file ids (sediment://… stripped); download through the image tools. */
  images: string[]
  at: string | null
}

export function mapChatList(body: unknown): ChatSummary[] {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((raw): ChatSummary[] => {
    const i = raw as Record<string, unknown>
    if (typeof i?.id !== 'string') return []
    return [{
      id: i.id,
      title: typeof i.title === 'string' && i.title ? i.title : '(untitled)',
      updatedAt: typeof i.update_time === 'string' ? i.update_time : null,
      createdAt: typeof i.create_time === 'string' ? i.create_time : null,
      archived: i.is_archived === true,
    }]
  })
}

export interface LibraryImage {
  fileId: string
  title: string | null
  conversationId: string | null
  width: number | null
  height: number | null
  createdAt: string | null
  archived: boolean
}

/** One page of GET /backend-api/my/recent/image_gen: every generated image across all chats. */
export function mapImageLibrary(body: unknown): { images: LibraryImage[]; cursor: string | null } {
  const b = (body ?? {}) as { items?: unknown; cursor?: unknown }
  const items = Array.isArray(b.items) ? b.items : []
  const images = items.flatMap((raw): LibraryImage[] => {
    const i = raw as Record<string, unknown>
    const ptr = typeof i?.asset_pointer === 'string' ? i.asset_pointer.replace(/^[a-z]+:\/\//, '') : null
    if (!ptr) return []
    return [{
      fileId: ptr,
      title: typeof i.title === 'string' ? i.title : null,
      conversationId: typeof i.conversation_id === 'string' ? i.conversation_id : null,
      width: typeof i.width === 'number' ? i.width : null,
      height: typeof i.height === 'number' ? i.height : null,
      createdAt: typeof i.created_at === 'number' ? new Date(i.created_at * 1000).toISOString() : null,
      archived: i.is_archived === true,
    }]
  })
  return { images, cursor: typeof b.cursor === 'string' && b.cursor ? b.cursor : null }
}

export interface ChatHit { chatId: string; title: string; snippet: string | null; updatedAt: string | null; archived: boolean }

/** GET /backend-api/conversations/search: full-text hits with the matching message snippet. */
export function mapChatSearch(body: unknown): ChatHit[] {
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((raw): ChatHit[] => {
    const i = raw as Record<string, unknown>
    if (typeof i?.conversation_id !== 'string') return []
    const payload = i.payload as { snippet?: unknown } | null
    return [{
      chatId: i.conversation_id,
      title: typeof i.title === 'string' && i.title ? i.title : '(untitled)',
      snippet: typeof payload?.snippet === 'string' ? payload.snippet.slice(0, 300) : null,
      updatedAt: typeof i.update_time === 'number' ? new Date(i.update_time * 1000).toISOString() : null,
      archived: i.is_archived === true,
    }]
  })
}

/**
 * Which accounts a text send may use, in order. A chat that already exists
 * lives on one account and gets only that one; otherwise the preferred account
 * goes first, then the rest. An account parked after a limit is skipped until
 * its park time passes, and reported separately so the error can say why.
 */
export function planAsk<T extends { partition: string }>(
  all: T[],
  preferred: T | null,
  parkedUntil: Map<string, number>,
  now: number,
): { live: T[]; parked: T[] } {
  const ordered = preferred ? [preferred, ...all.filter(a => a.partition !== preferred.partition)] : [...all]
  const isParked = (a: T) => (parkedUntil.get(a.partition) ?? 0) > now
  return { live: ordered.filter(a => !isParked(a)), parked: ordered.filter(isParked) }
}

const iso = (t: number | null | undefined) => (typeof t === 'number' && t > 0 ? new Date(t * 1000).toISOString() : null)

/**
 * The visible conversation in time order: what the user typed, what the
 * assistant answered, and the images the image tool produced (attached to an
 * assistant message of their own). Internal tool/system nodes are dropped.
 */
export function toMessages(nodes: ConvNode[], lastN?: number): ChatMessage[] {
  const out: (ChatMessage & { t: number })[] = []
  for (const n of nodes) {
    const t = n.createTime ?? 0
    const images = n.images.filter(i => n.role === 'tool' ? i.generated : true).map(i => i.fileId)
    if (n.role === 'user' && (n.text.trim() || images.length)) out.push({ role: 'user', text: n.text, images, at: iso(n.createTime), t })
    else if (n.role === 'assistant' && n.recipient === 'all' && n.text.trim()) out.push({ role: 'assistant', text: n.text, images, at: iso(n.createTime), t })
    else if (n.role === 'tool' && images.length) out.push({ role: 'assistant', text: '', images, at: iso(n.createTime), t })
  }
  out.sort((a, b) => a.t - b.t)
  const list = out.map(({ t: _t, ...m }) => m)
  return lastN && lastN > 0 ? list.slice(-lastN) : list
}
