import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))

const { liCreatePost, liDeletePost, MAX_POST_LENGTH } = await import('./linkedinPost')
const { createPostScript, deletePostScript, deleteCommentScript } = await import('./linkedinBridge')

/**
 * A post is public, attributed, and visible immediately. The properties pinned
 * here are the ones whose failure would not be loud: publishing something other
 * than the approved text, publishing to a wider audience than was chosen, or
 * reporting success from a request the server never accepted.
 *
 * The request shape itself came from a real post published by hand with the CDP
 * recorder running, not from documentation — see FINDINGS-linkedin.md.
 */

describe('refusing before anything is sent', () => {
  it.each(['', '   ', '\n\t'])('refuses an empty post', async blank => {
    const out = await liCreatePost(blank)
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('empty post')
  })

  it('refuses text past the LinkedIn limit rather than letting it be truncated', async () => {
    const out = await liCreatePost('x'.repeat(MAX_POST_LENGTH + 1))
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain(String(MAX_POST_LENGTH))
  })

  it('reports LinkedIn not being open as a result, not a throw', async () => {
    const out = await liCreatePost('hello')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })
})

describe('the request carries exactly what was approved', () => {
  it('embeds the text as data, not spliced into source', () => {
    const nasty = `'); alert('x`
    const script = createPostScript(nasty)
    expect(() => new Function(`return ${script}`)).not.toThrow()
    expect(script).toContain(JSON.stringify(nasty))
  })

  it('keeps line breaks, which are part of how a post reads', () => {
    const script = createPostScript('one\n\ntwo')
    expect(script).toContain(JSON.stringify('one\n\ntwo'))
  })

  it('sends no mention or hashtag attributes, so nothing links to anyone', () => {
    // attributesV2 is where mentions live. Anything non-empty here would tag a
    // real person in a post they were never shown.
    expect(createPostScript('hi')).toContain('attributesV2: []')
  })
})

describe('audience is chosen, never inferred', () => {
  it('defaults to public, which is what LinkedIn itself defaults to', () => {
    expect(createPostScript('hi')).toContain(JSON.stringify('ANYONE'))
  })

  it('sends the connections-only value when asked', () => {
    const script = createPostScript('hi', { visibility: 'connections' })
    expect(script).toContain(JSON.stringify('CONNECTIONS_ONLY'))
    expect(script).not.toContain(JSON.stringify('ANYONE'))
  })
})

describe('not reporting success the server did not give', () => {
  const script = createPostScript('hi')

  it('requires a share urn, not just a 200', () => {
    // The rule the messaging path learned the hard way: a resolved request is
    // not a delivered one. A 200 with no entity is a failure.
    expect(script).toContain("res.status !== 200 || !entity")
    expect(script).toContain('did not confirm the post')
  })

  it('names the likely cause and the fix when the query id has rotated', () => {
    // The queryId is a build-specific hash and will change when LinkedIn ships
    // a new web client. Saying so where the error is read is the difference
    // between a five-minute recapture and an afternoon.
    expect(script).toContain('may have rotated')
  })

  it('reports an absent permalink rather than inventing one', () => {
    // The response carries a share urn; the feed permalink uses an activity id,
    // which LinkedIn does not return here.
    expect(script).toContain('permalink: shareId ?')
  })
})

describe('the UI-driving path is gone', () => {
  it('no longer clicks, types, or navigates the tab', async () => {
    // It was built first, because liking and commenting had to be done that
    // way. Reading one real post off the wire showed posting is a plain API
    // call — so the composer, the trusted click, the coordinates and the
    // submit-button disambiguation were all deleted rather than kept "just in
    // case". Each of them was a way for this to break silently.
    const source = await import('./linkedinPost')
    expect(Object.keys(source)).not.toContain('LOCATE_SHARE_BOX_SCRIPT')
    expect(Object.keys(source)).not.toContain('DUMP_COMPOSER_SCRIPT')
  })
})

describe('drafts', () => {
  it('sends DRAFT instead of PUBLISHED when asked', () => {
    // Verified against the live API: the same endpoint accepts DRAFT, returns a
    // share urn for it, and that draft can then be deleted. That is what made it
    // possible to test create and delete end to end without publishing anything
    // to a real audience.
    expect(createPostScript('hi', { asDraft: true })).toContain(JSON.stringify('DRAFT'))
    expect(createPostScript('hi', { asDraft: true })).not.toContain(JSON.stringify('PUBLISHED'))
  })

  it('publishes by default, so a missing flag never silently hides a post', () => {
    expect(createPostScript('hi')).toContain(JSON.stringify('PUBLISHED'))
  })

  it('does not claim a draft was posted', () => {
    expect(createPostScript('hi', { asDraft: true })).toContain('posted: false')
    expect(createPostScript('hi', { asDraft: true })).toContain('draft: true')
  })
})

describe('deleting a post', () => {
  it.each(['urn:li:activity:123', 'https://x', '', '12a'])('refuses %s as an activity id', async bad => {
    const out = await liDeletePost(bad)
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('must be the numeric id')
  })

  it('reports LinkedIn not being open as a result, not a throw', async () => {
    const out = await liDeletePost('123')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('LinkedIn is not open')
  })

  const script = deletePostScript('7497263203417169921')

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('takes the share urn paired with THIS activity, never the first one found', () => {
    // The failure this prevents is unrecoverable. A post that reshares somebody
    // else's content carries their share urn in the same response, so "the first
    // share urn" would delete a stranger's post. Only the shareUrn sitting
    // beside this activity's own urn is accepted.
    expect(script).toContain('meta.urn === activityUrn && meta.shareUrn')
  })

  it('asks for the normalized representation, which is the only one carrying the data', () => {
    // Found by running the shipped script live: with api()'s default
    // application/json accept header, LinkedIn returns a form with no
    // `included` array, the paired lookup finds nothing, and the delete refuses
    // — correctly, but for the wrong reason. The header decides the shape of
    // the response, not just its encoding.
    expect(script).toContain('normalized+json+2.1')
  })

  it('refuses rather than guessing when no paired share urn exists', () => {
    expect(script).toContain('nothing safe to delete')
  })

  it('verifies the post is actually gone instead of trusting the status code', () => {
    // A 2xx is the server accepting the request, not proof the post is gone.
    expect(script).toContain('stillThere')
    expect(script).toContain('still readable')
  })

  it('says plainly when the post belongs to someone else', () => {
    expect(script).toContain('does not belong to the signed-in account')
  })
})

describe('scheduling', () => {
  it('marks the post SCHEDULED and sends the timestamp, verified against the live API', () => {
    const when = Date.now() + 3_600_000
    const script = createPostScript('hi', { scheduledAt: when })
    expect(script).toContain(JSON.stringify('SCHEDULED'))
    expect(script).toContain(`post.scheduledAt = ${JSON.stringify(when)}`)
  })

  it('does not mark a plain post SCHEDULED', () => {
    expect(createPostScript('hi')).not.toContain(JSON.stringify('SCHEDULED'))
  })
})

describe('image attach', () => {
  const script = createPostScript('hi', { image: { base64: 'AAAA', altText: 'a cat' } })

  it('registers, uploads and polls before creating — in that order', () => {
    // The order is load-bearing: a post that references an asset whose bytes
    // are not yet processed shows a broken image. Verified live: a real PNG
    // returns 201 on PUT and the recipe reaches AVAILABLE before the post.
    const reg = script.indexOf('api(MEDIA_UPLOAD_URL, {')
    const put = script.indexOf("method: 'PUT'")
    const poll = script.indexOf('AVAILABLE')
    const create = script.indexOf('api(CREATE_POST_URL, {')
    expect(reg).toBeGreaterThan(-1)
    expect(put).toBeGreaterThan(reg)
    expect(poll).toBeGreaterThan(put)
    expect(create).toBeGreaterThan(poll)
  })

  it('sends the verified ShareMedia shape: mediaUrn + category IMAGE', () => {
    // Assembled by error-probing the live schema: `media` is a Map, its asset
    // field is `mediaUrn`, and `category` is a NonNull that must be 'IMAGE'.
    expect(script).toContain('mediaUrn: asset')
    expect(script).toContain("category: 'IMAGE'")
  })

  it('carries the alt text', () => {
    expect(script).toContain(JSON.stringify('a cat'))
  })
})

describe('deleting a comment', () => {
  const script = deleteCommentScript('7497307258071154688', '7497311591932182528')

  it('parses as JavaScript', () => {
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })

  it('reconstructs the comment urn from the two ids', () => {
    // Verified urn form: urn:li:comment:(activity:<postId>,<commentId>).
    expect(script).toContain("'urn:li:comment:(activity:' + activityId + ',' + commentId + ')'")
  })

  it('checks canDelete before deleting, never touching a comment that is not the user\'s', () => {
    // LinkedIn sets canDelete false for other people's comments. Refusing on it
    // means the tool never fires a delete it has no right to make.
    expect(script).toContain('match.canDelete !== true')
    expect(script).toContain('it is not yours')
  })

  it('verifies the comment is gone rather than trusting the 2xx', () => {
    expect(script).toContain('still present')
  })
})
