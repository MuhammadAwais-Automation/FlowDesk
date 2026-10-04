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
