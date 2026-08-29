import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))

const { liCreatorAnalytics, __testing } = await import('./linkedinAnalytics')
const { READ_ANALYTICS_SCRIPT } = __testing

describe('creator analytics (DOM read)', () => {
  it('reports LinkedIn not being open as a result, not a throw', async () => {
    const out = await liCreatorAnalytics()
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })

  it('the read script parses as JavaScript', () => {
    expect(() => new Function(`return ${READ_ANALYTICS_SCRIPT}`)).not.toThrow()
  })

  it('reads inside the iframe too, where the analytics actually render', () => {
    // The analytics UI runs in the same-origin /preload iframe; reading only the
    // top document would miss the numbers entirely.
    expect(READ_ANALYTICS_SCRIPT).toContain('iframe')
    expect(READ_ANALYTICS_SCRIPT).toContain('contentDocument')
  })

  it('reads label-then-number for engagement, number-then-label for impressions', () => {
    // Verified live, and this was a real wrong-answer bug: the page reads
    // "99 Impressions" but "Reactions 5 Comments 5 Reposts 0". Using
    // number-before for everything made each engagement metric take its
    // NEIGHBOUR's figure — it reported reposts: 5 when the true value was 0.
    // A number that is confidently wrong is worse than one that is absent.
    expect(READ_ANALYTICS_SCRIPT).toContain("impressions: before('Impressions')")
    expect(READ_ANALYTICS_SCRIPT).toContain("reposts: after('Reposts')")
    expect(READ_ANALYTICS_SCRIPT).toContain("reactions: after('Reactions')")
  })

  it('builds its patterns without backslash escapes, which templates swallow', () => {
    // Third time this trap has been hit in this codebase. Here it made the
    // pattern arrive as 's*' and match the letter s. A space character class
    // needs no escaping and cannot be swallowed.
    expect(READ_ANALYTICS_SCRIPT).toContain("([0-9,]+) *")
    expect(READ_ANALYTICS_SCRIPT).not.toContain("([0-9,]+)s*")
  })

})
