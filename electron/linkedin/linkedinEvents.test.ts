import { describe, expect, it, beforeEach } from 'vitest'
import {
  recordLinkedInEvent,
  recentLinkedInEvents,
  takeNewMessages,
  linkedInEventStats,
  resetLinkedInEvents,
} from './linkedinEvents'

/**
 * The store's job is "tell me what arrived while I was not looking", so the
 * failures worth pinning are the ones that corrupt that answer rather than
 * break loudly: a redelivered message counted twice, the user's own messages
 * reported as if someone had written to them, and a cursor that moves when it
 * should not.
 */

function message(overrides: Partial<Parameters<typeof recordLinkedInEvent>[0]> = {}) {
  return {
    kind: 'message',
    at: Date.now(),
    messageUrn: `urn:li:msg_message:(self,${Math.random()})`,
    conversationUrn: 'urn:li:msg_conversation:(a,b)',
    text: 'hello',
    from: 'Iqra Mushtaq',
    fromUrn: 'urn:li:fsd_profile:OTHER',
    fromMe: false,
    ...overrides,
  }
}

beforeEach(() => resetLinkedInEvents())

describe('deduplication', () => {
  it('ignores a message urn it has already stored', () => {
    // LinkedIn redelivers on reconnect. Counting a redelivery as new is the
    // single most damaging thing this store could do.
    const evt = message({ messageUrn: 'urn:li:msg_message:(self,dup)' })
    expect(recordLinkedInEvent(evt)).toBe(true)
    expect(recordLinkedInEvent({ ...evt })).toBe(false)
    expect(recentLinkedInEvents(10).filter(e => e.kind === 'message')).toHaveLength(1)
  })

  it('does not deduplicate events that carry no message urn', () => {
    // Typing and presence events repeat legitimately and have no urn; treating
    // them as duplicates would silently drop real signal.
    expect(recordLinkedInEvent({ kind: 'typingIndicatorsTopic', at: 1 })).toBe(true)
    expect(recordLinkedInEvent({ kind: 'typingIndicatorsTopic', at: 2 })).toBe(true)
    expect(recentLinkedInEvents(10)).toHaveLength(2)
  })

  it('rejects a malformed event rather than storing it', () => {
    expect(recordLinkedInEvent(undefined as never)).toBe(false)
    expect(recordLinkedInEvent({ at: 1 } as never)).toBe(false)
    expect(recentLinkedInEvents(10)).toHaveLength(0)
  })
})

describe('the new-message cursor', () => {
  it('returns nothing on a second call when nothing else arrived', () => {
    recordLinkedInEvent(message())
    expect(takeNewMessages().messages).toHaveLength(1)
    expect(takeNewMessages().messages).toHaveLength(0)
  })

  it('returns only what arrived after the previous call', () => {
    recordLinkedInEvent(message({ at: Date.now() - 10_000, text: 'old' }))
    takeNewMessages()
    recordLinkedInEvent(message({ at: Date.now() + 5_000, text: 'new' }))
    const { messages } = takeNewMessages()
    expect(messages.map(m => m.text)).toEqual(['new'])
  })

  it('excludes the user\'s own messages', () => {
    // A message sent from the user's phone arrives on this channel too.
    // Reporting it as an incoming message would be noise dressed as a
    // notification.
    recordLinkedInEvent(message({ fromMe: true, text: 'sent from my phone' }))
    recordLinkedInEvent(message({ fromMe: false, text: 'from someone else' }))
    const { messages } = takeNewMessages()
    expect(messages.map(m => m.text)).toEqual(['from someone else'])
  })

  it('excludes non-message events', () => {
    recordLinkedInEvent({ kind: 'typingIndicatorsTopic', at: Date.now() + 1000 })
    expect(takeNewMessages().messages).toHaveLength(0)
  })
})

describe('recent activity does not disturb the cursor', () => {
  it('leaves new messages still pending after being read', () => {
    recordLinkedInEvent(message({ text: 'unseen' }))
    recentLinkedInEvents(10)
    expect(takeNewMessages().messages.map(m => m.text)).toEqual(['unseen'])
  })

  it('filters by kind when asked', () => {
    recordLinkedInEvent(message({ text: 'a' }))
    recordLinkedInEvent({ kind: 'presenceStatusTopic', at: Date.now() })
    expect(recentLinkedInEvents(10, 'message')).toHaveLength(1)
    expect(recentLinkedInEvents(10, 'presenceStatusTopic')).toHaveLength(1)
  })
})

describe('stats distinguish incoming from own', () => {
  it('counts them separately', () => {
    recordLinkedInEvent(message({ fromMe: true }))
    recordLinkedInEvent(message({ fromMe: false }))
    recordLinkedInEvent({ kind: 'presenceStatusTopic', at: Date.now() })
    const stats = linkedInEventStats()
    expect(stats.bufferedEvents).toBe(3)
    expect(stats.messageEvents).toBe(2)
    expect(stats.incomingMessages).toBe(1)
  })
})

describe('the buffer is bounded', () => {
  it('drops the oldest rather than growing without limit', () => {
    for (let i = 0; i < 400; i++) recordLinkedInEvent(message({ text: `m${i}` }))
    const all = recentLinkedInEvents(1000)
    expect(all.length).toBeLessThanOrEqual(300)
    expect(all[all.length - 1].text).toBe('m399')
  })
})
