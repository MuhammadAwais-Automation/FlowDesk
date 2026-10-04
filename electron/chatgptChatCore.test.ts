import { describe, expect, it } from 'vitest'
import { mapChatList, toMessages } from './chatgptChatCore'
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
