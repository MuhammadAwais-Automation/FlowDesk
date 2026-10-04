import { describe, expect, it } from 'vitest'
import { selectToolDomains, widenDomains } from './toolDomains'
import { createAgentToolSet } from './tools'

describe('selectToolDomains', () => {
  it('loads nothing extra for a question about the owner', () => {
    // The question that started this work. It names no domain, and the answer
    // comes from the Brain -- which is never routed away.
    expect(selectToolDomains('tum kon hoo or meray baray ma kia jantay hoo')).toEqual(new Set())
  })

  it('finds the domain a question names', () => {
    expect(selectToolDomains('Yasir ko whatsapp par bhej do')).toContain('whatsapp')
    expect(selectToolDomains('ek linkedin post likho')).toContain('linkedin')
    expect(selectToolDomains('reddit par upvote check karo')).toContain('reddit')
    expect(selectToolDomains('is par deep research karo')).toContain('notebooklm')
  })

  it('loads several when a question spans them', () => {
    const domains = selectToolDomains('linkedin post ke liye ek image generate karo')
    expect(domains).toContain('linkedin')
    expect(domains).toContain('flow')
  })
})

describe('widenDomains', () => {
  it('keeps what a session already needed', () => {
    // Turn 2 says "ab usay bhej do" and names nothing; WhatsApp must survive.
    const first = widenDomains([], 'whatsapp kholo')
    const second = widenDomains(first, 'ab usay bhej do')
    expect(second).toContain('whatsapp')
  })

  it('adds without dropping', () => {
    const grown = widenDomains(widenDomains([], 'whatsapp kholo'), 'ek linkedin post bhi')
    expect([...grown].sort()).toEqual(['linkedin', 'whatsapp'])
  })
})

describe('createAgentToolSet domain filtering', () => {
  const nameCount = (domains?: Set<never>) => createAgentToolSet(undefined, undefined, domains).names.length

  it('ships every family when no routing is given', () => {
    // codexLeadAgent and the older tests rely on this default.
    expect(nameCount()).toBeGreaterThan(80)
  })

  it('ships far fewer when nothing was routed in', () => {
    const routed = createAgentToolSet(undefined, undefined, new Set())
    expect(routed.names.length).toBeLessThan(30)
    // The three that are never routed away.
    expect(routed.names.some(name => name.includes('ask_chatgpt'))).toBe(true)
    expect(routed.names.some(name => name.includes('ask_deepseek'))).toBe(true)
    expect(routed.names.some(name => name.includes('brain_'))).toBe(true)
    expect(routed.names.some(name => name.includes('linkedin'))).toBe(false)
  })
})
