import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))
vi.mock('./linkedinUiActions', () => ({
  __testing: { permalinkFor: (id: string) => `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`, READY_SCRIPT: '' },
}))

const { liReplyToComment, __testing } = await import('./linkedinReply')
const { openReplyScript, verifyAndSubmitReplyScript } = __testing

/**
 * A reply is public and attributed. The failure that must never be quiet is
 * replying under the WRONG comment — so the defining property here is that an
 * ambiguous or absent match refuses rather than guesses.
 */

describe('refusing before anything opens', () => {
  it('requires a snippet long enough to identify one comment', async () => {
    const out = await liReplyToComment('123', 'short', 'hi')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('at least 8 characters')
  })

  it('refuses an empty reply', async () => {
    const out = await liReplyToComment('123', 'a distinctive snippet', '   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('empty reply')
  })

  it('reports LinkedIn not being open as a result, not a throw', async () => {
    const out = await liReplyToComment('123', 'a distinctive snippet', 'hi')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })
})

describe('the open script refuses to guess which comment', () => {
  const script = openReplyScript('a snippet of the comment', 'Jane Doe')

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('refuses when zero comments match', () => {
    expect(script).toContain('no comment on this post matched')
  })

  it('refuses when MORE than one matches, rather than picking one', () => {
    // This is the whole safety property. A reply under a stranger's comment is
    // public and cannot be undone.
    expect(script).toContain('candidates.length > 1')
    expect(script).toContain('ambiguous: true')
  })

  it('anchors on the "Reply to <name>" buttons, one per comment', () => {
    expect(script).toContain('^Reply to ')
  })

  it('finds the comment container by structure, not by data-view-name', () => {
    // The first version walked up looking for an ancestor tagged
    // data-view-name ~ /comment/ or componentkey ~ replaceableComment. Verified
    // live: a permalink page has neither, so the walk stopped on the button
    // itself — whose text is just "Reply" — and no snippet could ever match.
    // The container is now the smallest ancestor holding exactly one reply
    // button, which is true whether or not LinkedIn tags anything.
    expect(script).toContain('replyButtonsInside !== 1')
    expect(script).not.toContain("componentkey') && ")
  })
})

describe('submitting only the approved reply', () => {
  const script = verifyAndSubmitReplyScript('the approved reply')

  it('compares the box against the approved text before clicking', () => {
    expect(script).toContain(JSON.stringify('the approved reply'))
    expect(script).toContain('different text than was approved')
  })

  it('clicks the reply submit ("Reply"), not the post submit ("Comment")', () => {
    expect(script).toContain("=== 'Reply'")
  })

  it('escapes the reply text rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const built = verifyAndSubmitReplyScript(nasty)
    expect(() => new Function(`return ${built}`)).not.toThrow()
    expect(built).toContain(JSON.stringify(nasty))
  })
})

describe('LinkedIn pre-fills the reply box with a mention', () => {
  it('accepts the mention followed by the approved text, and nothing else', () => {
    // Verified live: typing only the reply left the box reading
    // "Awais Mushtaq <the reply>", because LinkedIn inserts an @mention of the
    // person being replied to. A strict equality check refused every real
    // reply. The allowance is exactly one shape — mention + approved text — so
    // a stale draft or a partial insertion still refuses.
    const script = verifyAndSubmitReplyScript('the approved reply', 'Jane Doe')
    expect(script).toContain('typed !== expected && typed !== withMention')
    expect(script).toContain(JSON.stringify('Jane Doe'))
  })

  it('still requires an exact match when there is no mention', () => {
    const script = verifyAndSubmitReplyScript('the approved reply')
    expect(script).toContain('typed !== expected')
  })
})
