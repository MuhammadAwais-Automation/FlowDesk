import { describe, expect, it, vi } from 'vitest'

/**
 * Drives the real `call()` path by standing in for the live page, so the
 * expression built for each bridge function is exercised rather than mocked
 * away. `evaluate` decides what the page would have answered.
 */
let evaluate: (expression: string) => unknown = () => ({ ok: false })
vi.mock('./sessions', () => ({
  getWhatsAppView: () => ({ webContents: { executeJavaScript: async (expression: string) => evaluate(expression) } }),
}))

const { waUnreadWithMessages, WA_MAX_EXPANDED_CHATS } = await import('./whatsapp')

const chat = (id: string, fields: Record<string, unknown> = {}) => ({
  id, name: `Chat ${id}`, isGroup: id.includes('@g.us'), unread: 1, t: 1789059750,
  last: { msgId: 'x', type: 'protocol', fromMe: false, sender: 'Someone', body: null, caption: null },
  ...fields,
})

const thread = (body: string) => ({
  ok: true, messages: [{ msgId: 'm1', type: 'chat', fromMe: false, sender: 'Yasir Bhai', body }],
})

function respond(chats: unknown[], perChat: (chatId: string) => unknown) {
  const asked: string[] = []
  evaluate = expression => {
    if (expression.startsWith('window.__fdWaListChats')) return { ok: true, count: chats.length, chats }
    const match = /__fdWaListMessages\("([^"]+)"/.exec(expression)
    if (match) {
      asked.push(match[1])
      return perChat(match[1])
    }
    return { ok: false, error: 'unexpected' }
  }
  return asked
}

describe('waUnreadWithMessages', () => {
  it('attaches each unread chat its own thread', async () => {
    respond([chat('a@c.us'), chat('b@g.us')], id => thread(`hello from ${id}`))

    const result = await waUnreadWithMessages(50)
    const chats = result.chats as Array<Record<string, unknown>>

    expect(result.ok).toBe(true)
    expect(chats).toHaveLength(2)
    expect((chats[0].messages as Array<{ body: string }>)[0].body).toBe('hello from a@c.us')
    expect((chats[1].messages as Array<{ body: string }>)[0].body).toBe('hello from b@g.us')
  })

  it('asks for each chat by its own id, in listed order', async () => {
    const asked = respond([chat('a@c.us'), chat('b@g.us')], () => thread('hi'))
    await waUnreadWithMessages(50)

    expect(asked).toEqual(['a@c.us', 'b@g.us'])
  })

  // One chat that will not load must not take the others with it: its unread
  // count and name are still a real signal.
  it('keeps a chat whose thread fails, with the reason', async () => {
    respond([chat('a@c.us'), chat('b@c.us')], id => (
      id === 'a@c.us' ? { ok: false, error: 'chat not found: a@c.us' } : thread('fine')
    ))

    const chats = (await waUnreadWithMessages(50)).chats as Array<Record<string, unknown>>

    expect(chats[0].messages).toEqual([])
    expect(chats[0].messagesError).toBe('chat not found: a@c.us')
    expect(chats[1].messages).toHaveLength(1)
  })

  // Each expansion is a round trip into the live page that may page history
  // in, and the Brain gives the whole capability call 60 seconds.
  it('expands only the first WA_MAX_EXPANDED_CHATS and still lists the rest', async () => {
    const many = Array.from({ length: WA_MAX_EXPANDED_CHATS + 4 }, (_, index) => chat(`${index}@c.us`))
    const asked = respond(many, () => thread('hi'))

    const chats = (await waUnreadWithMessages(500)).chats as Array<Record<string, unknown>>

    expect(asked).toHaveLength(WA_MAX_EXPANDED_CHATS)
    expect(chats).toHaveLength(many.length)
    expect(chats[WA_MAX_EXPANDED_CHATS].messages).toBeUndefined()
  })

  it('passes a failed listing straight through rather than inventing chats', async () => {
    evaluate = () => ({ ok: false, error: 'WhatsApp is not open.' })

    const result = await waUnreadWithMessages(50)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('WhatsApp is not open.')
  })

  it('does not call the message bridge for a chat with no id', async () => {
    const asked = respond([{ name: 'broken', unread: 1 }], () => thread('hi'))

    const chats = (await waUnreadWithMessages(50)).chats as Array<Record<string, unknown>>

    expect(asked).toEqual([])
    expect(chats[0].name).toBe('broken')
  })
})
