import { describe, expect, it } from 'vitest'
import {
  buildScript,
  statusScript,
  listChatsScript,
  listMessagesScript,
  unreadScript,
  findPeopleScript,
  sendScript,
  markReadScript,
} from './linkedinBridge'

/**
 * These scripts are JavaScript programs living inside template literals, so
 * the TypeScript compiler never parses them — a syntax error surfaces only at
 * runtime, inside a page, as an unhelpful message. During the WhatsApp work a
 * regex "fix" broke that bridge exactly this way and only a validity test
 * caught it, so the same check is here from the start rather than after the
 * first incident.
 *
 * The rest of these assert the properties that were learned the hard way and
 * would otherwise regress silently: no false success on send, the encoding
 * that LinkedIn actually requires, and refusing to invent a sender the API
 * does not reliably provide.
 */

const allBuilders: Array<[string, () => string]> = [
  ['statusScript', () => statusScript()],
  ['listChatsScript', () => listChatsScript({ limit: 20 })],
  ['listChatsScript with cursor', () => listChatsScript({ limit: 5, cursor: 'REVTQ0VO' })],
  ['listMessagesScript', () => listMessagesScript({ conversationUrn: 'urn:li:msg_conversation:(a,b)' })],
  ['listMessagesScript with anchor', () => listMessagesScript({ conversationUrn: 'urn:li:msg_conversation:(a,b)', before: 1787326150487 })],
  ['unreadScript', () => unreadScript()],
  ['findPeopleScript', () => findPeopleScript('awais')],
  ['sendScript', () => sendScript('urn:li:msg_conversation:(a,b)', 'hello')],
  ['markReadScript', () => markReadScript()],
]

describe('every built script', () => {
  it.each(allBuilders)('%s is syntactically valid JavaScript', (_name, build) => {
    // new Function parses without executing, which is the point: these scripts
    // call fetch and touch document, so running them here would prove nothing
    // and fail for the wrong reasons.
    expect(() => new Function(`return ${build()}`)).not.toThrow()
  })

  it.each(allBuilders)('%s resolves to an object rather than throwing across the boundary', (_name, build) => {
    // A rejected promise arrives in the main process as an Error whose useful
    // detail has already been lost, so every script wraps its body in a catch
    // that converts failure into a readable result.
    expect(build()).toContain('return { ok: false, error:')
  })
})

describe('parameter handling', () => {
  it('escapes interpolated values rather than splicing them in raw', () => {
    const nasty = `'); alert('x`
    const script = sendScript('urn:li:msg_conversation:(a,b)', nasty)
    expect(() => new Function(`return ${script}`)).not.toThrow()
    // JSON.stringify is what keeps a quote in message text from ending the
    // string it lives in — and message text is attacker-influenced.
    expect(script).toContain(JSON.stringify(nasty))
  })

  it('clamps a caller-supplied limit instead of trusting it', () => {
    expect(listChatsScript({ limit: 9999 })).toContain('count:50')
    expect(listChatsScript({ limit: -5 })).toContain('count:1')
    expect(listMessagesScript({ conversationUrn: 'urn:li:msg_conversation:(a,b)', limit: 9999 })).toContain('countBefore:100')
  })

  it('omits the cursor key entirely when there is no cursor', () => {
    // Rest.li rejects an empty value, so an absent cursor must produce no key
    // at all rather than ",nextCursor:".
    const withoutCursor = listChatsScript({ limit: 20 })
    expect(withoutCursor).toContain('var cursor = ""')
    expect(withoutCursor).toContain('if (cursor) base +=')
  })
})

describe('the encoding LinkedIn actually requires', () => {
  it('escapes parentheses, which encodeURIComponent deliberately does not', () => {
    // A conversation urn contains a parenthesised pair. Using the default
    // encoding returned 400 during discovery; this is that fix, pinned.
    const fn = new Function(`
      function enc(v) {
        return encodeURIComponent(String(v)).replace(/\\(/g, '%28').replace(/\\)/g, '%29')
      }
      return enc
    `)() as (v: string) => string

    expect(fn('urn:li:msg_conversation:(urn:li:fsd_profile:AB,2-XY==)'))
      .toBe('urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3AAB%2C2-XY%3D%3D%29')
  })

  it('ships that same encoder in the prelude', () => {
    expect(buildScript('return { ok: true }')).toContain(`.replace(/\\(/g, '%28').replace(/\\)/g, '%29')`)
  })
})

describe('send reports what the server confirmed, not that a promise resolved', () => {
  const script = sendScript('urn:li:msg_conversation:(a,b)', 'hello')

  it('requires an entityUrn in the response before claiming success', () => {
    expect(script).toContain("!value || !value.entityUrn")
    expect(script).toContain('send was not confirmed by LinkedIn')
  })

  it('returns the server-issued message urn', () => {
    expect(script).toContain('messageUrn: value.entityUrn')
  })

  it('refuses empty text', () => {
    expect(script).toContain('refusing to send empty text')
  })

  it('validates the conversation urn shape before posting', () => {
    expect(script).toContain("convUrn.indexOf('urn:li:msg_conversation:') !== 0")
  })

  it('generates a fresh originToken per send rather than reusing one', () => {
    expect(script).toContain('crypto.randomUUID')
  })
})

describe('honesty about what the API does not provide', () => {
  it('does not name a sender in the chat list', () => {
    // Verified by probe li-04: the inbox response reports the mailbox owner as
    // sender on every row, including messages plainly sent by someone else. A
    // name here would be a confident lie, so there is none.
    const script = listChatsScript({ limit: 20 })
    expect(script).toContain('sender: null')
    expect(script).toContain('senderUnavailableReason')
  })

  it('does name senders in a thread, where the API does provide them', () => {
    expect(listMessagesScript({ conversationUrn: 'urn:li:msg_conversation:(a,b)' })).toContain('from: who.name')
  })

  it('says that people search only covers existing conversations', () => {
    // Verified by probe li-06: the connections route returns bare urns with no
    // names, so searching conversations is both the honest and the useful
    // choice — it is the only one that yields a name AND something sendable.
    expect(findPeopleScript('x')).toContain('people you have never messaged are not included')
  })

  it('returns the conversationUrn that send requires', () => {
    expect(findPeopleScript('x')).toContain('conversationUrn: conversation.entityUrn')
  })

  it('keeps earlier pages when a later page fails', () => {
    expect(findPeopleScript('x')).toContain('if (page === 0) return')
  })
})

describe('read paths cannot write', () => {
  const readOnly = [
    ['statusScript', statusScript()],
    ['listChatsScript', listChatsScript({})],
    ['listMessagesScript', listMessagesScript({ conversationUrn: 'urn:li:msg_conversation:(a,b)' })],
    ['unreadScript', unreadScript()],
    ['findPeopleScript', findPeopleScript('x')],
  ] as const

  it.each(readOnly)('%s issues no POST', (_name, script) => {
    expect(script).not.toContain("method: 'POST'")
  })
})
