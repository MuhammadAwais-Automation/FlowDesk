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
    expect(rdFeed).toHaveBeenCalledWith({ subreddit: 'technology', sort: 'hot' })
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
    expect(rdCreateComment).toHaveBeenCalledWith('t3_123', 't1_456', 'nice post')
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
    expect(rdCreatePost).toHaveBeenCalledWith('AI_Coders', 'Hello World', 'body text')
  })
})
