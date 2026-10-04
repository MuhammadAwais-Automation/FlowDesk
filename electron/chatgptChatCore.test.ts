import { describe, expect, it } from 'vitest'
import { mapChatList, mapChatSearch, mapImageLibrary, planAsk, toMessages } from './chatgptChatCore'
import type { ConvNode } from './chatgptImageCore'

const node = (o: Partial<ConvNode> & { id: string; role: string }): ConvNode => ({
  parent: null, name: null, recipient: 'all', ctype: 'text', status: 'finished_successfully',
  endTurn: null, createTime: null, text: '', images: [], ...o,
})

describe('mapChatList', () => {
  it('keeps id, title, timestamps and the archived flag', () => {
    const chats = mapChatList({ items: [{ id: 'a', title: 'Hello', create_time: '2026-09-27T16:04:37Z', update_time: '2026-09-27T16:23:13Z', is_archived: false }] })
    expect(chats).toEqual([{ id: 'a', title: 'Hello', createdAt: '2026-09-27T16:04:37Z', updatedAt: '2026-09-27T16:23:13Z', archived: false }])
  })

  it('names untitled chats and skips entries without an id', () => {
    const chats = mapChatList({ items: [{ id: 'a', title: null }, { title: 'no id' }, 7] })
    expect(chats).toHaveLength(1)
    expect(chats[0].title).toBe('(untitled)')
  })

  it('returns nothing for an unexpected body', () => {
    expect(mapChatList(null)).toEqual([])
    expect(mapChatList({ items: 'x' })).toEqual([])
  })
})

describe('mapImageLibrary', () => {
  const item = { asset_pointer: 'sediment://file_abc', title: 'Neon Rifle', conversation_id: 'c1', width: 1774, height: 887, created_at: 1790795529, is_archived: false }

  it('strips the pointer scheme and converts the epoch time', () => {
    const { images, cursor } = mapImageLibrary({ items: [item], cursor: 'K1' })
    expect(images).toEqual([{ fileId: 'file_abc', title: 'Neon Rifle', conversationId: 'c1', width: 1774, height: 887, createdAt: '2026-09-30T19:12:09.000Z', archived: false }])
    expect(cursor).toBe('K1')
  })

  it('skips items without a pointer and reports no cursor at the end', () => {
    const { images, cursor } = mapImageLibrary({ items: [{ title: 'x' }], cursor: null })
    expect(images).toEqual([])
    expect(cursor).toBeNull()
  })
})

describe('mapChatSearch', () => {
  it('keeps the matching snippet and converts the epoch time', () => {
    const hits = mapChatSearch({ items: [{ conversation_id: 'c1', title: 'Reply pong', update_time: 1788088215, payload: { kind: 'message', snippet: 'pong' } }, { title: 'no id' }] })
    expect(hits).toEqual([{ chatId: 'c1', title: 'Reply pong', snippet: 'pong', updatedAt: '2026-08-30T11:10:15.000Z', archived: false }])
  })
})

describe('planAsk', () => {
  const a = { partition: 'a' }, b = { partition: 'b' }, c = { partition: 'c' }
  const none = new Map<string, number>()

  it('puts the preferred account first and keeps the rest in order', () => {
    expect(planAsk([a, b, c], c, none, 0).live).toEqual([c, a, b])
  })

  it('skips an account parked after a limit and reports it', () => {
    const plan = planAsk([a, b], null, new Map([['a', 1000]]), 500)
    expect(plan.live).toEqual([b])
    expect(plan.parked).toEqual([a])
  })

  it('uses the account again once its park time has passed', () => {
    expect(planAsk([a, b], null, new Map([['a', 1000]]), 1000).live).toEqual([a, b])
  })

  it('has nothing live when every account is parked', () => {
    expect(planAsk([a, b], null, new Map([['a', 9], ['b', 9]]), 1).live).toEqual([])
  })
})

describe('mapChatSearch snippets', () => {
  it('cuts a whole-document snippet down to 300 characters', () => {
    const [hit] = mapChatSearch({ items: [{ conversation_id: 'c1', payload: { snippet: 'x'.repeat(14000) } }] })
    expect(hit.snippet).toHaveLength(300)
  })
})

describe('toMessages', () => {
  const nodes = [
    node({ id: '3', role: 'assistant', text: 'Here you go', createTime: 30, endTurn: true }),
    node({ id: '1', role: 'user', text: 'draw a cat', createTime: 10 }),
    node({ id: '2', role: 'tool', createTime: 20, images: [{ fileId: 'file_1', generated: true }] }),
    node({ id: 's', role: 'system', text: 'hidden', createTime: 5 }),
    node({ id: 'c', role: 'assistant', recipient: 'dalle', text: '{"prompt":"cat"}', createTime: 15 }),
  ]

  it('orders by time and drops internal nodes', () => {
    const m = toMessages(nodes)
    expect(m.map(x => x.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(m[0].text).toBe('draw a cat')
    expect(m[1]).toMatchObject({ text: '', images: ['file_1'] })
    expect(m[2].text).toBe('Here you go')
  })

  it('lists a user-uploaded image on the user message', () => {
    const m = toMessages([node({ id: 'u', role: 'user', text: 'edit this', createTime: 1, images: [{ fileId: 'up_1', generated: false }] })])
    expect(m[0].images).toEqual(['up_1'])
  })

  it('keeps only the last N', () => {
    expect(toMessages(nodes, 1).map(x => x.text)).toEqual(['Here you go'])
  })
})
