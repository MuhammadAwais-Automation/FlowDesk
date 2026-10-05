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
  linkedinApiFeedScript,
  linkedinOutlierScript,
  extractHook,
  classifyHook,
  extractTakeaways,
  calculateMedian,
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
  ['linkedinApiFeedScript', () => linkedinApiFeedScript(20)],
  ['linkedinOutlierScript default', () => linkedinOutlierScript()],
  ['linkedinOutlierScript custom', () => linkedinOutlierScript({ minMultiplier: 3.0, limit: 15 })],
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

describe('Viral Hook & Outlier Engine', () => {
  describe('extractHook', () => {
    it('returns empty string for empty input', () => {
      expect(extractHook('')).toBe('')
      expect(extractHook(null as unknown as string)).toBe('')
    })

    it('extracts first 2-3 lines before "...see more"', () => {
      const post = `Stop doing code reviews this way.
They waste senior engineers' time and frustrate juniors.
Here is the 3-step process our team adopted instead:
...see more
1. Automated linting
2. Architecture review first
3. 15-minute sync`
      const hook = extractHook(post)
      expect(hook).toBe(
        `Stop doing code reviews this way.\nThey waste senior engineers' time and frustrate juniors.\nHere is the 3-step process our team adopted instead:`
      )
    })

    it('handles unicode ellipsis “…see more”', () => {
      const post = `Most developers write bad unit tests.
Not because they are bad engineers.
Because nobody taught them how to test behavior.
…see more
Here are the fundamentals:`
      const hook = extractHook(post)
      expect(hook).toBe(
        `Most developers write bad unit tests.\nNot because they are bad engineers.\nBecause nobody taught them how to test behavior.`
      )
    })

    it('caps hook length at 200 characters with ellipsis', () => {
      const longLine = 'A'.repeat(250)
      const hook = extractHook(longLine)
      expect(hook.length).toBeLessThanOrEqual(200)
      expect(hook.endsWith('...')).toBe(true)
    })

    it('preserves single or double line hooks', () => {
      const shortPost = 'Unpopular opinion: Meetings should be illegal before 11 AM.'
      expect(extractHook(shortPost)).toBe(shortPost)
    })
  })

  describe('classifyHook', () => {
    it('classifies Contrarian patterns', () => {
      expect(classifyHook('Stop doing standard performance reviews.')).toBe('Contrarian')
      expect(classifyHook('Unpopular opinion: 90% of meetings could be an email.')).toBe('Contrarian')
      expect(classifyHook("Don't learn Python in 2026 without reading this.")).toBe('Contrarian')
      expect(classifyHook('Most startup founders are doing pricing completely wrong.')).toBe('Contrarian')
      expect(classifyHook('The biggest myth about venture capital:')).toBe('Contrarian')
      expect(classifyHook('Nobody wants to admit this about remote work:')).toBe('Contrarian')
    })

    it('classifies Story / Vulnerability patterns', () => {
      expect(classifyHook('3 years ago, I was fired from my tech lead role.')).toBe('Story / Vulnerability')
      expect(classifyHook('I failed 12 technical interviews before getting hired.')).toBe('Story / Vulnerability')
      expect(classifyHook('Today I walked away from a $250k salary to build my dream.')).toBe('Story / Vulnerability')
      expect(classifyHook('When I was broke and had $0 in my account, I learned one lesson:')).toBe('Story / Vulnerability')
      expect(classifyHook('I lost our biggest client yesterday. Here is what happened:')).toBe('Story / Vulnerability')
    })

    it('classifies Framework / List patterns', () => {
      expect(classifyHook('7 tools that will save you 15 hours every single week:')).toBe('Framework / List')
      expect(classifyHook('5 steps to build a high-converting landing page:')).toBe('Framework / List')
      expect(classifyHook('A simple framework to prioritize engineering tasks:')).toBe('Framework / List')
      expect(classifyHook('How to master distributed systems in 6 months:')).toBe('Framework / List')
      expect(classifyHook('10 rules for writing clean TypeScript code:')).toBe('Framework / List')
    })

    it('classifies Observation / Question patterns', () => {
      expect(classifyHook('Why are tech giants cutting middle management?')).toBe('Observation / Question')
      expect(classifyHook('Is artificial intelligence going to replace product managers?')).toBe('Observation / Question')
      expect(classifyHook('What is the biggest bottleneck in your engineering workflow?')).toBe('Observation / Question')
      expect(classifyHook('Notice how B2B software is feeling more like consumer apps lately.')).toBe('Observation / Question')
    })
  })

  describe('extractTakeaways', () => {
    it('extracts bullet points and numbered list items', () => {
      const text = `Here are 4 habits of elite software architects:
• Always document trade-offs before code
- Validate boundaries before implementations
1. Keep the data flow unidirectional
✔ Write tests that describe outcomes, not implementation details`
      const takeaways = extractTakeaways(text)
      expect(takeaways).toHaveLength(4)
      expect(takeaways[0]).toBe('Always document trade-offs before code')
      expect(takeaways[1]).toBe('Validate boundaries before implementations')
      expect(takeaways[2]).toBe('Keep the data flow unidirectional')
      expect(takeaways[3]).toBe('Write tests that describe outcomes, not implementation details')
    })

    it('falls back to body sentences when no bullet markers exist', () => {
      const text = `Hook line 1
Hook line 2
Hook line 3
Software architecture is fundamentally about managing complexity.
The best systems are the ones simple enough to reason about in your head.
Consistency beats cleverness every single day.`
      const takeaways = extractTakeaways(text)
      expect(takeaways.length).toBeGreaterThan(0)
      expect(takeaways[0]).toContain('Software architecture is fundamentally about managing complexity.')
    })
  })

  describe('calculateMedian', () => {
    it('handles empty input', () => {
      expect(calculateMedian([])).toBe(0)
    })

    it('calculates median for odd-length arrays', () => {
      expect(calculateMedian([10, 50, 20])).toBe(20)
      expect(calculateMedian([5, 1, 9, 3, 7])).toBe(5)
    })

    it('calculates median for even-length arrays', () => {
      expect(calculateMedian([10, 20, 30, 40])).toBe(25)
      expect(calculateMedian([100, 200])).toBe(150)
    })
  })

  describe('script builders parameter handling', () => {
    it.each([
      ['linkedinApiFeedScript', () => linkedinApiFeedScript(20)],
      ['linkedinOutlierScript', () => linkedinOutlierScript()],
    ])('%s drops promotion slots that have no activity id and no text', (_name, build) => {
      const src = build()
      const block = src.slice(src.indexOf('var posts = []'), src.indexOf('posts.push(p)') + 'posts.push(p)\n    }'.length)
      const run = new Function(`${block}\n;return { posts, addPost }`)() as { posts: unknown[]; addPost: (p: unknown) => void }
      run.addPost({ activityId: null, postUrn: 'urn:li:inAppPromotion:1', text: null })
      run.addPost({ activityId: '7', postUrn: 'urn:li:activity:7', text: null })
      run.addPost({ activityId: null, postUrn: 'urn:li:ugcPost:8', text: 'hello' })
      expect(run.posts).toHaveLength(2)
    })

    it('clamps limit in linkedinApiFeedScript', () => {
      expect(linkedinApiFeedScript(500)).toContain('var limit = 100')
      expect(linkedinApiFeedScript(-5)).toContain('var limit = 1')
    })

    it('clamps limit and applies default multiplier in linkedinOutlierScript', () => {
      const defaultScript = linkedinOutlierScript()
      expect(defaultScript).toContain('var minMultiplier = 2.5')
      expect(defaultScript).toContain('var limit = 25')

      const customScript = linkedinOutlierScript({ minMultiplier: 4.2, limit: 120 })
      expect(customScript).toContain('var minMultiplier = 4.2')
      expect(customScript).toContain('var limit = 100')
    })

    it('checks outlier score formula: (reactions + comments * 2) >= threshold', () => {
      const script = linkedinOutlierScript()
      expect(script).toContain('(p.reactions || p.likes || 0) + (p.comments || 0) * 2')
      expect(script).toContain('score >= threshold')
      expect(script).toContain('hookPattern: pattern')
      expect(script).toContain('takeaways: takeaways')
    })
  })
})

