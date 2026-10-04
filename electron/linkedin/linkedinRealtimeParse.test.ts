import { describe, expect, it } from 'vitest'
import {
  parseDecoratedEvent,
  parseStreamChunk,
  selfFromMessageUrn,
  shortTopic,
  nameOf,
} from './linkedinRealtimeParse'

/**
 * Fixtures mirror the structure of a real captured frame exactly, with the
 * names and message text replaced. The real capture stays in probes/out/,
 * which is gitignored precisely because it holds actual message content.
 *
 * This logic previously lived inside an injected page-script string, where
 * TypeScript could not check it and no test could reach it — and it turned out
 * not to run at all, which took a live experiment rather than a test run to
 * find out.
 */

const SELF = 'urn:li:fsd_profile:AAASELF'
const OTHER = 'urn:li:fsd_profile:BBBOTHER'
const MESSAGE_URN = `urn:li:msg_message:(${SELF},2-abc==)`

function participant(urn: string, first: string, last: string) {
  return {
    hostIdentityUrn: urn,
    entityUrn: `urn:li:msg_messagingParticipant:${urn}`,
    participantType: { member: { firstName: { text: first }, lastName: { text: last } } },
  }
}

function messageEvent(overrides: Record<string, unknown> = {}) {
  return {
    topic: 'urn:li-realtime:messagesTopic:urn:li-realtime:myself',
    leftServerAt: 1787372227428,
    payload: {
      data: {
        doDecorateMessageMessengerRealtimeDecoration: {
          result: {
            entityUrn: MESSAGE_URN,
            backendUrn: 'urn:li:messagingMessage:2-abc==',
            deliveredAt: 1787372227108,
            body: { text: 'sample text' },
            renderContent: [],
            actor: participant(OTHER, 'Sample', 'Sender'),
            conversation: {
              entityUrn: 'urn:li:msg_conversation:(AAASELF,2-conv==)',
              groupChat: false,
              conversationParticipants: [participant(SELF, 'Account', 'Owner'), participant(OTHER, 'Sample', 'Sender')],
            },
            ...overrides,
          },
        },
      },
    },
  }
}

describe('a pushed message', () => {
  it('carries text, sender name and conversation without a further lookup', () => {
    // This is the whole value of the realtime channel: everything needed to
    // act on a message arrives with it.
    const event = parseDecoratedEvent(messageEvent())!
    expect(event.kind).toBe('message')
    expect(event.text).toBe('sample text')
    expect(event.from).toBe('Sample Sender')
    expect(event.conversationUrn).toBe('urn:li:msg_conversation:(AAASELF,2-conv==)')
    expect(event.at).toBe(1787372227108)
  })

  it('names the sender, which the inbox list cannot', () => {
    expect(parseDecoratedEvent(messageEvent())!.from).toBe('Sample Sender')
  })

  it('marks the user\'s own message as fromMe', () => {
    // Sent from another device, it arrives here too. Reporting it as incoming
    // would be noise dressed as a notification.
    const own = parseDecoratedEvent(messageEvent({ actor: participant(SELF, 'Account', 'Owner') }))!
    expect(own.fromMe).toBe(true)
    expect(parseDecoratedEvent(messageEvent())!.fromMe).toBe(false)
  })

  it('lists the other participants', () => {
    expect(parseDecoratedEvent(messageEvent())!.participants).toEqual([
      { urn: SELF, name: 'Account Owner' },
      { urn: OTHER, name: 'Sample Sender' },
    ])
  })

  it('flags an attachment when one is present', () => {
    expect(parseDecoratedEvent(messageEvent())!.hasAttachment).toBe(false)
    expect(parseDecoratedEvent(messageEvent({ renderContent: [{ file: {} }] }))!.hasAttachment).toBe(true)
  })

  it('finds the decoration key rather than hardcoding it', () => {
    // The key is query-specific and changes with LinkedIn's build.
    const renamed = messageEvent()
    const data = renamed.payload.data as Record<string, unknown>
    data.doDecorateSomethingElseV9 = data.doDecorateMessageMessengerRealtimeDecoration
    delete data.doDecorateMessageMessengerRealtimeDecoration
    expect(parseDecoratedEvent(renamed)!.text).toBe('sample text')
  })
})

describe('other topics', () => {
  it.each([
    ['urn:li-realtime:typingIndicatorsTopic:urn:li-realtime:myself', 'typingIndicatorsTopic'],
    ['urn:li-realtime:messageSeenReceiptsTopic:urn:li-realtime:myself', 'messageSeenReceiptsTopic'],
    ['urn:li-realtime:presenceStatusTopic:urn:li:fsd_profile:X', 'presenceStatusTopic'],
    ['urn:li-realtime:tabBadgeUpdateTopic:urn:li-realtime:myself', 'tabBadgeUpdateTopic'],
  ])('%s is kept thin as %s', (topic, kind) => {
    const event = parseDecoratedEvent({ topic, leftServerAt: 5 })!
    expect(event.kind).toBe(kind)
    expect(event.text).toBeUndefined()
  })

  it('does not crash on an unrecognised shape', () => {
    expect(parseDecoratedEvent({})!.kind).toBe('unknown')
    expect(parseDecoratedEvent(null as never)).toBeNull()
  })
})

describe('stream chunking', () => {
  const frame = `data: ${JSON.stringify({ 'com.linkedin.realtimefrontend.DecoratedEvent': messageEvent() })}\n`

  it('parses a whole frame', () => {
    const { events, remainder } = parseStreamChunk(frame)
    expect(events).toHaveLength(1)
    expect(remainder).toBe('')
  })

  it('holds a partial frame until the rest arrives', () => {
    // Chunk boundaries fall anywhere and one event runs to ~18KB, so a parser
    // that assumed a chunk was a frame would corrupt most of them.
    const split = Math.floor(frame.length / 2)
    const first = parseStreamChunk(frame.slice(0, split))
    expect(first.events).toHaveLength(0)

    const second = parseStreamChunk(first.remainder + frame.slice(split))
    expect(second.events).toHaveLength(1)
    expect(second.events[0].text).toBe('sample text')
  })

  it('parses several frames from one chunk', () => {
    expect(parseStreamChunk(frame + frame + frame).events).toHaveLength(3)
  })

  it('counts a bad frame instead of throwing', () => {
    // One malformed frame must not stop a channel open for the whole session.
    const { events, parseErrors } = parseStreamChunk(`data: {not json\n${frame}`)
    expect(parseErrors).toBe(1)
    expect(events).toHaveLength(1)
  })

  it('ignores non-data lines', () => {
    expect(parseStreamChunk(': keepalive\nevent: message\n\n').events).toHaveLength(0)
  })
})

describe('helpers', () => {
  it('extracts the mailbox owner from a message urn', () => {
    expect(selfFromMessageUrn(MESSAGE_URN)).toBe(SELF)
  })

  it('returns null rather than a wrong answer', () => {
    expect(selfFromMessageUrn('urn:li:messagingMessage:2-abc')).toBeNull()
    expect(selfFromMessageUrn(undefined)).toBeNull()
  })

  it('shortens a topic urn', () => {
    expect(shortTopic('urn:li-realtime:messagesTopic:urn:li-realtime:myself')).toBe('messagesTopic')
    expect(shortTopic(undefined)).toBe('unknown')
  })

  it('returns null for a participant with no member', () => {
    expect(nameOf(undefined)).toBeNull()
    expect(nameOf({ hostIdentityUrn: 'x' })).toBeNull()
  })
})
