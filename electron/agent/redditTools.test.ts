import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { RequestApproval } from './approval'

const rdStatus = vi.fn()
const rdFeed = vi.fn()
const rdPostComments = vi.fn()
const rdSearch = vi.fn()
const rdVotePost = vi.fn()
const rdVoteComment = vi.fn()
const rdCreateComment = vi.fn()
const rdCreatePost = vi.fn()
const rdSubscribe = vi.fn()
const rdMarkRead = vi.fn()

vi.mock('../reddit', () => ({
  rdStatus: (...args: unknown[]) => rdStatus(...args),
  rdFeed: (...args: unknown[]) => rdFeed(...args),
  rdPostComments: (...args: unknown[]) => rdPostComments(...args),
  rdSearch: (...args: unknown[]) => rdSearch(...args),
  rdVotePost: (...args: unknown[]) => rdVotePost(...args),
  rdVoteComment: (...args: unknown[]) => rdVoteComment(...args),
  rdCreateComment: (...args: unknown[]) => rdCreateComment(...args),
  rdCreatePost: (...args: unknown[]) => rdCreatePost(...args),
  rdSubscribe: (...args: unknown[]) => rdSubscribe(...args),
  rdMarkRead: (...args: unknown[]) => rdMarkRead(...args),
}))

const { createRedditTools, REDDIT_TOOL_NAMES } = await import('./redditTools')

interface TestTool {
  name: string
  description: string
  handler: (input: Record<string, unknown>, extra?: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
}

function getTool(tools: TestTool[], name: string): TestTool {
  const found = tools.find(t => t.name === name)
  if (!found) throw new Error(`tool not registered: ${name}`)
  return found
}

function toolsWith(requestApproval: RequestApproval): TestTool[] {
  return createRedditTools(requestApproval) as unknown as TestTool[]
}

const approveAll: RequestApproval = async () => true
const denyAll: RequestApproval = async () => false

beforeEach(() => {
  vi.clearAllMocks()
  rdStatus.mockResolvedValue({ ok: true, signedIn: true, username: 'FastAbbreviations506', totalKarma: 100 })
  rdFeed.mockResolvedValue({ ok: true, count: 2, posts: [{ id: 't3_1', title: 'Test Post' }] })
  rdPostComments.mockResolvedValue({ ok: true, post: { id: 't3_1' }, comments: [] })
  rdSearch.mockResolvedValue({ ok: true, count: 1, results: [] })
  rdVotePost.mockResolvedValue({ ok: true, status: 200 })
  rdVoteComment.mockResolvedValue({ ok: true, status: 200 })
  rdCreateComment.mockResolvedValue({ ok: true, created: true })
  rdCreatePost.mockResolvedValue({ ok: true, data: { createSubredditPost: { ok: true } } })
  rdSubscribe.mockResolvedValue({ ok: true, status: 200 })
  rdMarkRead.mockResolvedValue({ ok: true, status: 200 })
})

describe('redditTools registry', () => {
  it('registers all 10 Reddit tools', () => {
    const tools = toolsWith(approveAll)
    expect(tools.length).toBe(10)
    expect(REDDIT_TOOL_NAMES.length).toBe(10)
  })

  it('runs read-only tools without approval check', async () => {
    const approvalSpy = vi.fn(approveAll)
    const tools = toolsWith(approvalSpy)

    const statusTool = getTool(tools, 'reddit_status')
    const res = await statusTool.handler({})
    expect(approvalSpy).not.toHaveBeenCalled()
    expect(rdStatus).toHaveBeenCalled()
    expect(res.content[0].text).toContain('FastAbbreviations506')

    const feedTool = getTool(tools, 'reddit_feed')
    await feedTool.handler({ subreddit: 'technology', sort: 'hot' })
    expect(approvalSpy).not.toHaveBeenCalled()
    expect(rdFeed).toHaveBeenCalledWith({ subreddit: 'technology', sort: 'hot' }, undefined)
  })

  it('requires human approval for comment creation and respects denial', async () => {
    const toolsDeny = toolsWith(denyAll)
    const commentTool = getTool(toolsDeny, 'reddit_create_comment')

    const resDeny = await commentTool.handler({ postId: 't3_123', parentId: 't1_456', text: 'nice post' })
    expect(rdCreateComment).not.toHaveBeenCalled()
    expect(resDeny.content[0].text).toContain('User declined approval')

    const toolsApprove = toolsWith(approveAll)
    const commentToolApprove = getTool(toolsApprove, 'reddit_create_comment')
    const resApprove = await commentToolApprove.handler({ postId: 't3_123', parentId: 't1_456', text: 'nice post' })
    expect(rdCreateComment).toHaveBeenCalledWith('t3_123', 't1_456', 'nice post', undefined)
    expect(resApprove.content[0].text).toContain('true')
  })

  it('requires human approval for post creation and respects denial', async () => {
    const toolsDeny = toolsWith(denyAll)
    const postTool = getTool(toolsDeny, 'reddit_create_post')

    const resDeny = await postTool.handler({ subreddit: 'AI_Coders', title: 'Hello World', body: 'body text' })
    expect(rdCreatePost).not.toHaveBeenCalled()
    expect(resDeny.content[0].text).toContain('User declined approval')

    const toolsApprove = toolsWith(approveAll)
    const postToolApprove = getTool(toolsApprove, 'reddit_create_post')
    await postToolApprove.handler({ subreddit: 'AI_Coders', title: 'Hello World', body: 'body text' })
    expect(rdCreatePost).toHaveBeenCalledWith('AI_Coders', 'Hello World', 'body text', undefined)
  })
})

describe('reddit agent tools account routing', () => {
  it('passes the chosen account through and names it in the approval request', async () => {
    const asked: unknown[] = []
    const tools = toolsWith(async (req) => { asked.push(req); return true })
    await getTool(tools, 'reddit_status').handler({ account: '2' })
    expect(rdStatus).toHaveBeenCalledWith('2')
    await getTool(tools, 'reddit_search').handler({ query: 'ai', t: 'day', account: 'Work' })
    expect(rdSearch).toHaveBeenCalledWith('ai', undefined, undefined, 'day', 'Work')
    await getTool(tools, 'reddit_create_comment').handler({ postId: 't3_1', parentId: 't3_1', text: 'hi', account: '2' })
    expect(rdCreateComment).toHaveBeenCalledWith('t3_1', 't3_1', 'hi', '2')
    expect(JSON.stringify(asked[0])).toContain('Reddit account 2')
  })
})

describe('reddit agent write tools ask first', () => {
  it('does not vote, join or mark read when the user declines', async () => {
    const tools = toolsWith(denyAll)
    const outs = await Promise.all([
      getTool(tools, 'reddit_vote_post').handler({ postId: 't3_1', voteState: 'UP' }),
      getTool(tools, 'reddit_vote_comment').handler({ commentId: 't1_1', voteState: 'DOWN' }),
      getTool(tools, 'reddit_subscribe').handler({ subredditId: 't5_1', subscribeState: 'SUBSCRIBED' }),
      getTool(tools, 'reddit_mark_read').handler({}),
    ])
    for (const out of outs) expect(out.content[0].text).toContain('declined')
    expect(rdVotePost).not.toHaveBeenCalled()
    expect(rdVoteComment).not.toHaveBeenCalled()
    expect(rdSubscribe).not.toHaveBeenCalled()
    expect(rdMarkRead).not.toHaveBeenCalled()
  })

  it('runs an approved vote on the named account', async () => {
    const asked: Array<{ title: string }> = []
    const tools = toolsWith(async (req) => { asked.push(req); return true })
    await getTool(tools, 'reddit_vote_post').handler({ postId: 't3_1', voteState: 'UP', account: '2' })
    expect(rdVotePost).toHaveBeenCalledWith('t3_1', 'UP', '2')
    expect(asked[0].title).toContain('Reddit account 2')
  })
})
