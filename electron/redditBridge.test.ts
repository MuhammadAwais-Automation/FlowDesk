import vm from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  redditStatusScript,
  redditFeedScript,
  redditPostCommentsScript,
  redditVotePostScript,
  redditVoteCommentScript,
  redditCreateCommentScript,
  redditCreatePostScript,
  redditSubscribeScript,
  redditSearchScript,
  redditMarkReadScript,
  redditApiFeedScript,
  redditApiSearchScript,
  redditApiPostCommentsScript,
  redditOutlierScript,
  cleanSubreddit,
} from './redditBridge'

const allBuilders: Array<[string, () => string]> = [
  ['redditStatusScript', () => redditStatusScript()],
  ['redditFeedScript default', () => redditFeedScript()],
  ['redditFeedScript with options', () => redditFeedScript({ subreddit: 'technology', sort: 'top', limit: 50, timeFilter: 'week' })],
  ['redditPostCommentsScript', () => redditPostCommentsScript('technology', '123456')],
  ['redditVotePostScript UP', () => redditVotePostScript('t3_123', 'UP')],
  ['redditVotePostScript DOWN', () => redditVotePostScript('123', 'DOWN')],
  ['redditVoteCommentScript', () => redditVoteCommentScript('t1_987', 'UP')],
  ['redditCreateCommentScript', () => redditCreateCommentScript('t3_123', 't1_456', 'hello world')],
  ['redditCreatePostScript', () => redditCreatePostScript('r/test', 'My Title', 'My post body content')],
  ['redditSubscribeScript', () => redditSubscribeScript('t5_2sama', 'SUBSCRIBED')],
  ['redditSearchScript', () => redditSearchScript('machine learning', 'relevance', 30)],
  ['redditMarkReadScript', () => redditMarkReadScript()],
  ['redditApiFeedScript default', () => redditApiFeedScript()],
  ['redditApiFeedScript with options', () => redditApiFeedScript({ subreddit: 'r/reactjs', sort: 'top', limit: 30 })],
  ['redditApiSearchScript global', () => redditApiSearchScript('local ai')],
  ['redditApiSearchScript subreddit', () => redditApiSearchScript('claude', { subreddit: 'MachineLearning', limit: 15 })],
  ['redditApiPostCommentsScript default', () => redditApiPostCommentsScript('t3_abc123')],
  ['redditApiPostCommentsScript clean id', () => redditApiPostCommentsScript('def456', 20)],
  ['redditOutlierScript default', () => redditOutlierScript('webdev')],
  ['redditOutlierScript custom mult', () => redditOutlierScript('r/startups', 2.5)],
  ['redditOutlierScript top/week', () => redditOutlierScript('webdev', 3, { sort: 'top', t: 'week' })],
  ['redditSearchScript with time filter', () => redditSearchScript('ai', 'top', 10, 'month')],
  ['redditApiSearchScript sort + t', () => redditApiSearchScript('ai', { sort: 'top', t: 'day' })],
]

describe('redditBridge script validity', () => {
  it.each(allBuilders)('%s produces syntactically valid JavaScript', (_name, build) => {
    // new Function parses without executing. Since the string has "return await (async function() ...",
    // wrapping in async function verifies it parses without syntax errors.
    expect(() => new Function(`return (async () => { ${build()} })`)).not.toThrow()
  })

  it.each(allBuilders)('%s parses as a top-level script, the way executeJavaScript runs it', (_name, build) => {
    // Wrapping in a function (above) hid a top-level `return` that made every
    // Reddit tool fail live with "Script failed to execute".
    expect(() => new vm.Script(build())).not.toThrow()
  })

  it('escapes arbitrary user input in comments and titles', () => {
    const malicious = `'; alert("injection"); //`
    const commentScript = redditCreateCommentScript('t3_abc', 't1_def', malicious)
    expect(() => new Function(`return (async () => { ${commentScript} })`)).not.toThrow()
    expect(commentScript).toContain('alert')

    const postScript = redditCreatePostScript('r/test', malicious, malicious)
    expect(() => new Function(`return (async () => { ${postScript} })`)).not.toThrow()
  })

  it('formats full subreddit and fullname IDs reliably', () => {
    const votePost = redditVotePostScript('12345', 'UP')
    expect(votePost).toContain('t3_12345')

    const voteComment = redditVoteCommentScript('67890', 'DOWN')
    expect(voteComment).toContain('t1_67890')

    const subscribe = redditSubscribeScript('abcdef', 'SUBSCRIBED')
    expect(subscribe).toContain('t5_abcdef')
  })
})

describe('redditApi and outlier script execution & output structures', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  async function evalScript<T>(script: string): Promise<T> {
    const fn = new Function(`return ${script}`) // executeJavaScript evaluates the script as an expression
    return (await fn()) as T
  }

  it('redditApiFeedScript executes and maps listings with all required fields', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            children: [
              {
                data: {
                  id: 'post123',
                  name: 't3_post123',
                  title: 'Building Local AI Apps with FlowDesk',
                  author: 'test_dev',
                  subreddit: 'LocalLLaMA',
                  subreddit_name_prefixed: 'r/LocalLLaMA',
                  score: 150,
                  num_comments: 42,
                  url: 'https://example.com/post',
                  permalink: '/r/LocalLLaMA/comments/post123',
                  created_utc: 1711000000,
                  selftext: 'Detailed post body',
                  is_video: false,
                },
              },
            ],
          },
        }),
      } as any
    }) as any

    const script = redditApiFeedScript({ subreddit: 'r/LocalLLaMA', sort: 'hot', limit: 25 })
    expect(script).toContain('/r/LocalLLaMA/hot.json?limit=25')

    const res = await evalScript<{ ok: boolean; count: number; items: any[] }>(script)
    expect(capturedUrl).toBe('/r/LocalLLaMA/hot.json?limit=25')
    expect(res.ok).toBe(true)
    expect(res.count).toBe(1)
    expect(res.items[0]).toEqual({
      id: 't3_post123',
      title: 'Building Local AI Apps with FlowDesk',
      author: 'test_dev',
      subreddit: 'r/LocalLLaMA',
      score: 150,
      numComments: 42,
      url: 'https://example.com/post',
      permalink: '/r/LocalLLaMA/comments/post123',
      createdUtc: 1711000000,
      selftext: 'Detailed post body',
      isVideo: false,
    })
  })

  it('redditApiSearchScript targets search endpoint and maps items', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            children: [
              {
                data: {
                  id: 'search1',
                  name: 't3_search1',
                  title: 'Search Result Title',
                  author: 'search_author',
                  subreddit: 'reactjs',
                  subreddit_name_prefixed: 'r/reactjs',
                  score: 88,
                  num_comments: 12,
                  url: 'https://reddit.com/r/reactjs/1',
                  permalink: '/r/reactjs/comments/1',
                  created_utc: 1712000000,
                  selftext: 'text',
                  is_video: false,
                },
              },
            ],
          },
        }),
      } as any
    }) as any

    const script = redditApiSearchScript('performance', { subreddit: 'reactjs', limit: 10 })
    expect(script).toContain('/r/reactjs/search.json?q=performance&restrict_sr=1&limit=10')

    const res = await evalScript<{ ok: boolean; count: number; items: any[] }>(script)
    expect(capturedUrl).toContain('/r/reactjs/search.json')
    expect(res.ok).toBe(true)
    expect(res.count).toBe(1)
    expect(res.items[0].id).toBe('t3_search1')
    expect(res.items[0].score).toBe(88)
  })

  it('redditApiPostCommentsScript flattens comment trees with required fields', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            data: {
              children: [
                {
                  data: {
                    id: 'post99',
                    name: 't3_post99',
                    title: 'Parent Discussion',
                    author: 'op_user',
                    score: 200,
                    num_comments: 2,
                  },
                },
              ],
            },
          },
          {
            data: {
              children: [
                {
                  data: {
                    id: 'c1',
                    name: 't1_c1',
                    author: 'commenter1',
                    body: 'First level comment',
                    score: 30,
                    created_utc: 1712000050,
                    parent_id: 't3_post99',
                    replies: {
                      data: {
                        children: [
                          {
                            data: {
                              id: 'c2',
                              name: 't1_c2',
                              author: 'commenter2',
                              body: 'Nested response comment',
                              score: 55,
                              created_utc: 1712000060,
                              parent_id: 't1_c1',
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      } as any
    }) as any

    const script = redditApiPostCommentsScript('t3_post99', 50)
    expect(script).toContain('/comments/post99.json')

    const res = await evalScript<{ ok: boolean; postId: string; post: any; comments: any[] }>(script)
    expect(capturedUrl).toContain('/comments/post99.json')
    expect(res.ok).toBe(true)
    expect(res.postId).toBe('post99')
    expect(res.post.title).toBe('Parent Discussion')
    expect(res.comments.length).toBe(2)
    // Sorted by score descending: c2 (55) then c1 (30)
    expect(res.comments[0].author).toBe('commenter2')
    expect(res.comments[0].score).toBe(55)
    expect(res.comments[0].body).toBe('Nested response comment')
    expect(res.comments[0].createdUtc).toBe(1712000060)
    expect(res.comments[1].author).toBe('commenter1')
    expect(res.comments[1].score).toBe(30)
  })

  it('redditOutlierScript calculates median, outliers, highDebatePainPoints, and topHooks', async () => {
    globalThis.fetch = (async (_url: string) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            children: [
              // Sample of 5 posts with upvotes: 10, 20, 30, 40, 300 -> Median upvotes = 30
              {
                data: {
                  id: 'p1',
                  name: 't3_p1',
                  title: 'Simple observation',
                  author: 'a1',
                  subreddit: 'r/tech',
                  score: 10,
                  num_comments: 2,
                },
              },
              {
                data: {
                  id: 'p2',
                  name: 't3_p2',
                  title: 'Why does the new API constantly fail?',
                  author: 'a2',
                  subreddit: 'r/tech',
                  score: 20,
                  num_comments: 35, // 35 / 20 = 1.75 debate ratio + question pattern
                },
              },
              {
                data: {
                  id: 'p3',
                  name: 't3_p3',
                  title: 'Regular weekly update',
                  author: 'a3',
                  subreddit: 'r/tech',
                  score: 30,
                  num_comments: 15,
                },
              },
              {
                data: {
                  id: 'p4',
                  name: 't3_p4',
                  title: 'How do I fix this major problem with deployment?',
                  author: 'a4',
                  subreddit: 'r/tech',
                  score: 40,
                  num_comments: 60, // 60 / 40 = 1.5 ratio + "how do I" + "problem"
                },
              },
              {
                data: {
                  id: 'p5',
                  name: 't3_p5',
                  title: '7 ways to accelerate your AI workflow 10x',
                  author: 'a5',
                  subreddit: 'r/tech',
                  score: 300, // 300 >= 3.0 * 30 (outlier!)
                  num_comments: 25,
                },
              },
            ],
          },
        }),
      } as any
    }) as any

    const script = redditOutlierScript('tech', 3.0)
    const res = await evalScript<{
      ok: boolean
      medianScore: number
      medianComments: number
      outliers: any[]
      highDebatePainPoints: any[]
      topHooks: any[]
    }>(script)

    expect(res.ok).toBe(true)
    expect(res.medianScore).toBe(30)
    expect(res.medianComments).toBe(25) // [2, 15, 25, 35, 60] -> sorted median is 25

    // Outlier check: score >= 3.0 * 30 = 90
    expect(res.outliers.length).toBe(1)
    expect(res.outliers[0].id).toBe('t3_p5')
    expect(res.outliers[0].score).toBe(300)
    expect(res.outliers[0].outlierMultiplier).toBe(10)

    // highDebatePainPoints check: ratio >= 1.2 or frustration keywords
    expect(res.highDebatePainPoints.some((p) => p.id === 't3_p2')).toBe(true)
    expect(res.highDebatePainPoints.some((p) => p.id === 't3_p4')).toBe(true)

    // topHooks check: extracted patterns
    expect(res.topHooks.length).toBeGreaterThan(0)
    expect(res.topHooks[0].postId).toBe('t3_p5')
    expect(res.topHooks[0].pattern).toBe('Listicle / Numbered Tips')
    expect(res.topHooks[0].hookTemplate).toContain('[X]')
  })
})

describe('reddit write verification and search/outlier filters', () => {
  const originalFetch = globalThis.fetch
  const g = globalThis as unknown as { document?: unknown }
  const originalDocument = g.document

  afterEach(() => {
    globalThis.fetch = originalFetch
    g.document = originalDocument
  })

  function signedIn() {
    g.document = { cookie: 'csrf_token=tok123', querySelector: () => null }
  }

  function textResponse(body: string, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) }
  }

  async function run<T>(script: string): Promise<T> {
    return (await new Function(`return ${script}`)()) as T
  }

  it('treats a 200 GraphQL response carrying errors as a failure and surfaces them', async () => {
    signedIn()
    globalThis.fetch = (async () => textResponse(JSON.stringify({ data: null, errors: [{ message: 'RATELIMIT' }] }))) as never
    const res = await run<{ ok: boolean; errors: unknown[]; error: string }>(redditVotePostScript('t3_x', 'UP'))
    expect(res.ok).toBe(false)
    expect(res.errors).toHaveLength(1)
    expect(res.error).toContain('RATELIMIT')
  })

  it('keeps a clean GraphQL response ok', async () => {
    signedIn()
    globalThis.fetch = (async () => textResponse(JSON.stringify({ data: { updatePostVoteState: { ok: true } } }))) as never
    const res = await run<{ ok: boolean }>(redditVotePostScript('t3_x', 'UP'))
    expect(res.ok).toBe(true)
  })

  it('reports a created comment only when the response carries a new comment id', async () => {
    signedIn()
    globalThis.fetch = (async () => textResponse('<shreddit-comment thingid="t1_newc0mment" parentid="t1_456"></shreddit-comment>')) as never
    const res = await run<{ ok: boolean; commentId: string }>(redditCreateCommentScript('t3_123', 't1_456', 'hi'))
    expect(res).toMatchObject({ ok: true, commentId: 't1_newc0mment' })
  })

  it('rejects a 200 create-comment response with no comment id', async () => {
    signedIn()
    globalThis.fetch = (async () => textResponse('<div class="error">Something went wrong</div>')) as never
    const res = await run<{ ok: boolean; snippet: string }>(redditCreateCommentScript('t3_123', 't1_456', 'hi'))
    expect(res.ok).toBe(false)
    expect(res.snippet).toContain('Something went wrong')
  })

  it('does not mistake the parent id for the new comment', async () => {
    signedIn()
    globalThis.fetch = (async () => textResponse('<div data-parent="t1_456">rate limited</div>')) as never
    const res = await run<{ ok: boolean }>(redditCreateCommentScript('t3_123', 't1_456', 'hi'))
    expect(res.ok).toBe(false)
  })

  it('rejects a create-comment JSON response with errors', async () => {
    signedIn()
    globalThis.fetch = (async () => textResponse(JSON.stringify({ json: { errors: [['RATELIMIT', 'slow down']] } }))) as never
    const res = await run<{ ok: boolean; errors: unknown[] }>(redditCreateCommentScript('t3_123', 't3_123', 'hi'))
    expect(res.ok).toBe(false)
    expect(res.errors).toHaveLength(1)
  })

  it('adds time filter and sort to search URLs only when given', () => {
    expect(redditSearchScript('ai')).toContain('/search.json?q=ai&sort=relevance&limit=25"')
    expect(redditSearchScript('ai', 'top', 10, 'week')).toContain('&t=week')
    expect(redditApiSearchScript('ai')).toContain('/search.json?q=ai&limit=25"')
    expect(redditApiSearchScript('ai', { subreddit: 'r/ml', sort: 'top', t: 'month' })).toContain(
      '/r/ml/search.json?q=ai&restrict_sr=1&limit=25&sort=top&t=month',
    )
    // Unknown time filters are dropped rather than sent to Reddit.
    expect(redditSearchScript('ai', 'top', 10, 'decade' as never)).not.toContain('&t=')
  })

  it('outlier defaults to hot and honours sort/t', () => {
    expect(redditOutlierScript('webdev')).toContain('/r/webdev/hot.json?limit=50"')
    expect(redditOutlierScript('webdev', 3, { sort: 'top', t: 'week' })).toContain('/r/webdev/top.json?limit=50&t=week')
    expect(redditOutlierScript('webdev', 3, { sort: 'rising' })).toContain('/r/webdev/rising.json?limit=50"')
  })

  it('outlier adds scorePerHour from createdUtc', async () => {
    const now = Math.floor(Date.now() / 1000)
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          children: [
            { data: { name: 't3_a', title: 'a', score: 100, num_comments: 1, created_utc: now - 10 * 3600 } },
            { data: { name: 't3_b', title: 'b', score: 1, num_comments: 1, created_utc: now - 3600 } },
            { data: { name: 't3_c', title: 'c', score: 2, num_comments: 1, created_utc: 0 } },
          ],
        },
      }),
    })) as never
    const res = await run<{ ok: boolean; sort: string; outliers: Array<{ id: string; scorePerHour: number }> }>(
      redditOutlierScript('tech', 3),
    )
    expect(res.ok).toBe(true)
    expect(res.sort).toBe('hot')
    expect(res.outliers[0].id).toBe('t3_a')
    expect(res.outliers[0].scorePerHour).toBeCloseTo(10, 0)
  })
})

describe('subreddit names and URLs (live 404s on 2026-10-04)', () => {
  const urlOf = (script: string) => (script.match(/fetch\("([^"]+)"/) || [])[1]

  it('strips an "r/" prefix so r/technology does not become /r/r%2Ftechnology', () => {
    expect(cleanSubreddit('r/technology')).toBe('technology')
    expect(cleanSubreddit(' /r/SaaS/ ')).toBe('SaaS')
    expect(cleanSubreddit('R/AI_Agents')).toBe('AI_Agents')
    expect(cleanSubreddit(undefined)).toBe('')
    expect(urlOf(redditFeedScript({ subreddit: 'r/technology', limit: 3 }))).toBe('/r/technology/hot.json?limit=3')
  })

  it('drops an unknown time filter instead of sending it', () => {
    expect(urlOf(redditFeedScript({ subreddit: 'x', sort: 'top', timeFilter: 'bogus' as never }))).toBe('/r/x/top.json?limit=25')
    expect(urlOf(redditFeedScript({ subreddit: 'x', sort: 'top', timeFilter: 'day' }))).toBe('/r/x/top.json?limit=25&t=day')
  })

  it('reads a thread by post id alone when the subreddit is missing or prefixed', () => {
    expect(urlOf(redditPostCommentsScript('', 't3_abc', 5))).toBe('/comments/abc.json?limit=5&depth=3')
    expect(urlOf(redditPostCommentsScript('r/technology', 'abc', 5))).toBe('/r/technology/comments/abc.json?limit=5&depth=3')
    expect(urlOf(redditPostCommentsScript('technology', 'abc', 9999))).toBe('/r/technology/comments/abc.json?limit=500&depth=3')
  })

  it('reports an HTTP failure of a GraphQL write as an error string', async () => {
    const originalFetch = globalThis.fetch
    const originalDocument = (globalThis as { document?: unknown }).document
    ;(globalThis as { document?: unknown }).document = { cookie: 'csrf_token=abc', querySelector: () => null }
    globalThis.fetch = (async () => ({ ok: false, status: 403, text: async () => '{"data":null}' })) as unknown as typeof fetch
    try {
      const out = await (new Function(`return ${redditMarkReadScript()}`)()) as { ok: boolean; error?: string }
      expect(out.ok).toBe(false)
      expect(out.error).toContain('403')
    } finally {
      globalThis.fetch = originalFetch
      ;(globalThis as { document?: unknown }).document = originalDocument
    }
  })
})
