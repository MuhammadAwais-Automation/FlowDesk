import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))

const { liCreatorAnalytics, __testing, htmlToText, parseAnalyticsText } = await import('./linkedinAnalytics')
const { READ_ANALYTICS_SCRIPT, FETCH_ANALYTICS_SCRIPT } = __testing

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

// Shape of the real server response (probes/lka-02/03, 2026-09-28), trimmed.
const SERVER_HTML = '<html><head><script>{"web.impression-flag":{"treatment":"control"}}</script><style>.x{}</style></head><body>'
  + '<nav>0 notifications Home 1 My Network Messaging 22 Notifications</nav>'
  + '<h2>Content performance</h2><label>Impressions</label><p><span>33</span></p><p>Impressions</p>'
  + '<p>136% vs. prior 7 days</p><p>0</p><p>Social engagements</p>'
  + '<p>Reactions</p><p>0</p><p>Comments</p><p>2</p><p>Reposts</p><p>1</p><p>Saves</p><p>4</p></body></html>'

describe('creator analytics (server HTTP read)', () => {
  it('reads figures from the server HTML with the right label direction', () => {
    const f = parseAnalyticsText(htmlToText(SERVER_HTML))
    expect(f).toMatchObject({
      rendered: true, impressions: '33', socialEngagements: '0',
      reactions: '0', comments: '2', reposts: '1', saves: '4',
    })
  })

  it('ignores scripts and nav counts that precede the analytics section', () => {
    const text = htmlToText(SERVER_HTML)
    expect(text).not.toContain('treatment')
    expect(parseAnalyticsText(text).impressions).not.toBe('22')
  })

  it('reports not rendered when the page has no impressions', () => {
    expect(parseAnalyticsText(htmlToText('<body>Sign in</body>')).rendered).toBe(false)
  })

  it('the fetch script is a same-origin read-only GET and parses as JavaScript', () => {
    expect(() => new Function(`return ${FETCH_ANALYTICS_SCRIPT}`)).not.toThrow()
    expect(FETCH_ANALYTICS_SCRIPT).toContain('https://www.linkedin.com/analytics/creator/content/')
    expect(FETCH_ANALYTICS_SCRIPT).toContain("credentials: 'include'")
    expect(FETCH_ANALYTICS_SCRIPT).not.toMatch(/method: *'(POST|PUT|DELETE)'/)
  })
})
