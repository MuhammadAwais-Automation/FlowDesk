import { describe, expect, it } from 'vitest'
import { buildScript } from './linkedinBridge'
import {
  feedScript,
  postCommentsScript,
  searchScript,
  myPostsScript,
  notificationsScript,
} from './linkedinReadBridge'

/**
 * These scripts are JavaScript inside template literals, so TypeScript never
 * parses them. Two traps in that gap cost real debugging time today and are
 * pinned here so they cannot come back quietly:
 *
 *   - a backslash escape swallowed by the template literal, which turned
 *     /activity:(\d+)/ into /activity:(d+)/ and made every activityId null;
 *   - a guessed field path, which made every comment author null while the
 *     name sat one key away.
 *
 * Both failed silently. Neither would have shown up in a typecheck.
 */

const builders: Array<[string, () => string]> = [
  ['feedScript', () => feedScript({ limit: 10 })],
  ['postCommentsScript', () => postCommentsScript({ activityId: '7496811041339740160' })],
  ['searchScript', () => searchScript({ query: 'ai developer' })],
  ['myPostsScript', () => myPostsScript({ limit: 10 })],
  ['notificationsScript', () => notificationsScript({ limit: 15 })],
]

describe('every read script', () => {
  it.each(builders)('%s is syntactically valid JavaScript', (_name, build) => {
    expect(() => new Function(`return ${build()}`)).not.toThrow()
  })

  it.each(builders)('%s converts failure into a readable result', (_name, build) => {
    expect(build()).toContain('return { ok: false, error:')
  })

  it.each(builders)('%s issues no POST', (_name, build) => {
    // These are read tools. A POST appearing here would mean something writes.
    expect(build()).not.toContain("method: 'POST'")
  })
})

describe('the escape trap', () => {
  it('ships a regex with no backslash escapes that a template literal could eat', () => {
    // /activity:(\d+)/ written in a template literal arrives as
    // /activity:(d+)/ — it still compiles, still runs, and silently matches
    // nothing. A character class needs no escaping and cannot be corrupted
    // this way.
    const script = feedScript({})
    expect(script).toContain('/activity:([0-9]+)/')
    expect(script).not.toContain('(d+)')
  })

  it('actually extracts an id from a real urn', () => {
    const fn = new Function(`
      return function (urn) {
        var m = /activity:([0-9]+)/.exec(String(urn || ''))
        return m ? m[1] : null
      }
    `)() as (urn: string) => string | null

    expect(fn('urn:li:activity:7496813253121966080')).toBe('7496813253121966080')
    expect(fn('urn:li:share:7480168437810528256')).toBeNull()
    expect(fn('')).toBeNull()
  })
})

describe('field paths are the observed ones', () => {
  it('reads a comment author from commenterForDashConversion, not a guess', () => {
    // The guessed path was `commenter.miniProfile`, which exists but holds no
    // name. Every author came back null and nothing errored.
    const script = postCommentsScript({ activityId: '1' })
    expect(script).toContain('c.commenterForDashConversion')
    expect(script).toContain('str(who.title)')
  })

  it('does not label the connection degree as a headline', () => {
    // supplementaryActorInfoV2 is "1st"/"2nd", not a job title. A field that
    // lies about its contents is worse than an absent one.
    const script = postCommentsScript({ activityId: '1' })
    expect(script).toContain('connectionDegree')
    expect(script).not.toContain('authorHeadline: str(who.supplementaryActorInfoV2)')
  })

  it('reads own-post impressions, which exist only on own posts', () => {
    expect(myPostsScript({})).toContain('impressions: counts.numImpressions')
  })

  it('unwraps LinkedIn text objects through one shared helper', () => {
    // Nearly every user-visible string is { text, textDirection }, sometimes
    // nested twice. Unwrapping in one place is what stops the author-null
    // class of bug recurring per call site.
    expect(buildScript('return {}')).toContain('function str(v)')
  })
})

describe('honesty in the results', () => {
  it('says when a post simply has no comments', () => {
    // 200-with-zero-elements reads identically to a broken call. It was
    // briefly mistaken for one.
    expect(postCommentsScript({ activityId: '1' })).toContain('the call succeeded and this post has no comments')
  })

  it('says search results are ranked and filtered by LinkedIn', () => {
    expect(searchScript({ query: 'x' })).toContain('an empty group does not prove nothing matches')
  })

  it('rejects an activityId that is not numeric instead of building a bad URL', () => {
    const script = postCommentsScript({ activityId: 'urn:li:activity:123' })
    expect(script).toContain('/^[0-9]+$/')
    expect(script).toContain('must be the numeric id')
  })
})

describe('parameter handling', () => {
  it('clamps limits rather than trusting them', () => {
    expect(feedScript({ limit: 9999 })).toContain('count=50')
    expect(feedScript({ limit: -3 })).toContain('count=1')
    expect(notificationsScript({ limit: 9999 })).toContain('count=50')
  })

  it('escapes an interpolated query rather than splicing it in raw', () => {
    const nasty = `'); alert('x`
    const script = searchScript({ query: nasty })
    expect(() => new Function(`return ${script}`)).not.toThrow()
    expect(script).toContain(JSON.stringify(nasty))
  })

  it('strips anything unexpected from resultType, which is interpolated unquoted', () => {
    // resultType lands inside a Rest.li List(...) without quotes, so it is the
    // one parameter JSON.stringify cannot protect.
    const script = searchScript({ query: 'x', resultType: "ALL),(key:evil,value:List(X" })
    expect(script).toContain('List(ALLKEYEVILVALUELISTX)')
    expect(() => new Function(`return ${script}`)).not.toThrow()
  })
})

describe('the feed is not the feed the user sees', () => {
  it('offers only the two sort values LinkedIn actually accepts', () => {
    // relevanceFeed, topFeed and mainFeed all answer 400. The value is
    // interpolated into the URL unquoted, so anything unrecognised is coerced
    // rather than passed through.
    expect(feedScript({ sortBy: 'feed' })).toContain('q=feed&')
    expect(feedScript({ sortBy: 'chronFeed' })).toContain('q=chronFeed&')
    expect(feedScript({ sortBy: 'topFeed' })).toContain('q=chronFeed&')
    expect(feedScript({ sortBy: "x&q=evil" })).toContain('q=chronFeed&')
  })

  it('says in every result that this is not the on-screen feed', () => {
    // A post plainly visible on the user's screen was absent from BOTH
    // orderings: the rendered feed comes from Server-Driven UI, a separate
    // pipeline. Without this note an agent would report it as "your feed".
    expect(feedScript({})).toContain('not the feed rendered on screen')
  })

  it('gives every post a permalink built from its own urn, not the whole feed a URL', () => {
    // Every field on a mapped post used to be readable except one: nothing
    // pointed back at the post itself. Brain's capture pipeline reads this as
    // canonicalUrl — without it, every citation built from a feed post showed
    // "Source link unavailable" even though the post was real.
    const script = feedScript({})
    expect(script).toContain("url: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null")

    const buildUrl = new Function(`
      return function (urn) {
        return urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null
      }
    `)() as (urn: string | null) => string | null

    expect(buildUrl('urn:li:activity:7496813253121966080')).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7496813253121966080/')
    expect(buildUrl(null)).toBeNull()
  })
})
