import { describe, expect, it } from 'vitest'
import { conversationText } from './recipeDefinitions'

/**
 * The shape a real `whatsapp.list_unread` capture carries, copied from an
 * actual `artifacts/<jobId>/raw/capture.jsonl.gz` in a live profile — not
 * invented. Six of the eight chats in that capture had `last.body: null`,
 * which is the whole reason the transcript path exists: the recipe was
 * classifying a chat list, never a conversation.
 */
const REAL_CHAT = {
  id: '120363419113495363@g.us',
  name: 'Freelancers Empire ',
  isGroup: true,
  unread: 2,
  t: 1789059750,
  last: {
    msgId: 'A5035CF0B4375F2B35727B33B7984920',
    type: 'protocol', fromMe: false, t: 1789059750,
    senderId: '114822192623859@lid', sender: 'Sahib Zada Atta',
    body: null, caption: null, mediaBytes: 0,
  },
}

/** `serializeMsg`'s real output shape, from whatsappInject.ts. */
const message = (fields: Record<string, unknown>) => ({
  msgId: 'm', type: 'chat', fromMe: false, t: 1789059750,
  senderId: '92300@c.us', sender: 'Yasir Bhai', body: null, caption: null, mediaBytes: 0,
  ...fields,
})

describe('conversationText', () => {
  it('reads a thread as sender-labelled lines', () => {
    expect(conversationText({
      ...REAL_CHAT,
      messages: [
        message({ body: 'Scope thora barha dein' }),
        message({ fromMe: true, sender: 'You', body: 'Budget wahi rahega?' }),
      ],
    })).toBe('Yasir Bhai: Scope thora barha dein | You: Budget wahi rahega?')
  })

  it('falls back to the caption when a media message has no body', () => {
    expect(conversationText({ messages: [message({ type: 'image', caption: 'ye wala design' })] }))
      .toBe('Yasir Bhai: ye wala design')
  })

  it('skips messages with nothing readable instead of emitting a bare label', () => {
    expect(conversationText({ messages: [message({ type: 'protocol' }), message({ body: 'Ok' })] }))
      .toBe('Yasir Bhai: Ok')
  })

  // The old path produced '' for this record, and an empty record cannot be
  // classified, scored or digested. Returning '' here is still correct — the
  // caller falls through to the preview line — but it must not invent text.
  it('returns nothing for a chat with no messages array', () => {
    expect(conversationText(REAL_CHAT)).toBe('')
  })

  it('returns nothing when every message is unreadable', () => {
    expect(conversationText({ messages: [message({ type: 'protocol' })] })).toBe('')
  })

  it('names an unlabelled sender rather than dropping the line', () => {
    expect(conversationText({ messages: [message({ sender: null, body: 'Hi' })] })).toBe('Unknown: Hi')
    expect(conversationText({ messages: [message({ sender: null, fromMe: true, body: 'Hi' })] })).toBe('You: Hi')
  })

  it('keeps the recent end when a thread is longer than the budget', () => {
    const messages = Array.from({ length: 400 }, (_, index) => message({ body: `message number ${index}` }))
    const text = conversationText({ messages })

    expect(text.length).toBeLessThanOrEqual(4000)
    expect(text).toContain('message number 399')
    expect(text).not.toContain('message number 1 ')
  })

  it('ignores a messages value that is not an array of objects', () => {
    expect(conversationText({ messages: 'nope' })).toBe('')
    expect(conversationText({ messages: [null, 'text', 42] })).toBe('')
  })
})
