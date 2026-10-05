import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestApproval } from './approval'

// The bridge is mocked: these tests cover the tool layer's own contract —
// account routing, refusing an unknown account before approval or any page
// work, and failures reaching MCP as isError.
const fb = {
  fbFeed: vi.fn(), fbReact: vi.fn(), fbComment: vi.fn(), fbReply: vi.fn(),
  fbShare: vi.fn(), fbFollow: vi.fn(), fbHide: vi.fn(),
}
vi.mock('../facebook', () => ({
  fbFeed: (...a: unknown[]) => fb.fbFeed(...a),
  fbReact: (...a: unknown[]) => fb.fbReact(...a),
  fbComment: (...a: unknown[]) => fb.fbComment(...a),
  fbReply: (...a: unknown[]) => fb.fbReply(...a),
  fbShare: (...a: unknown[]) => fb.fbShare(...a),
  fbFollow: (...a: unknown[]) => fb.fbFollow(...a),
  fbHide: (...a: unknown[]) => fb.fbHide(...a),
  unknownFacebookAccount: (ref?: string | null) =>
    ref && !['1', '2'].includes(ref) ? { ok: false, error: `unknown facebook account "${ref}"` } : null,
}))

const { createFacebookTools, FACEBOOK_TOOL_BASE_NAMES, fitFeedForAgent } = await import('./facebookTools')

interface TestTool {
  name: string
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>, extra?: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
}

function tools(requestApproval: RequestApproval = vi.fn(async () => true)): TestTool[] {
  return createFacebookTools(requestApproval) as unknown as TestTool[]
}
const get = (all: TestTool[], name: string) => all.find(t => t.name === name)!

const WRITE_ARGS: Record<string, Record<string, unknown>> = {
  facebook_react: { feedbackId: 'f', reactionType: 'like' },
  facebook_comment: { feedbackId: 'f', text: 'hi' },
  facebook_reply_to_comment: { postId: '1', commentId: '2', text: 'hi' },
  facebook_share: { permalink: 'https://www.facebook.com/x/posts/1' },
  facebook_follow: { authorId: '1' },
  facebook_hide: { nodeId: 'n' },
}

beforeEach(() => {
  for (const f of Object.values(fb)) { f.mockReset(); f.mockResolvedValue({ ok: true }) }
})

describe('facebook tools', () => {
  it('give every tool an optional account', () => {
    for (const name of FACEBOOK_TOOL_BASE_NAMES) expect(get(tools(), name).inputSchema).toHaveProperty('account')
  })

  it('refuse an unknown account before asking for approval or calling Facebook', async () => {
    const requestApproval = vi.fn(async () => true)
    const all = tools(requestApproval)
    for (const [name, args] of Object.entries(WRITE_ARGS)) {
      const res = await get(all, name).handler({ ...args, account: 'nope' })
      expect(res.isError).toBe(true)
      expect(res.content[0].text).toContain('unknown facebook account')
    }
    expect(requestApproval).not.toHaveBeenCalled()
    for (const f of Object.values(fb)) expect(f).not.toHaveBeenCalled()
  })

  it('pass the account through to the bridge', async () => {
    await get(tools(), 'facebook_feed').handler({ count: 3, account: '2' })
    expect(fb.fbFeed).toHaveBeenCalledWith(3, undefined, '2')
    await get(tools(), 'facebook_react').handler({ feedbackId: 'f', reactionType: 'like', account: '2' })
    expect(fb.fbReact).toHaveBeenCalledWith('f', 'like', '2')
    await get(tools(), 'facebook_hide').handler({ nodeId: 'n' })
    expect(fb.fbHide).toHaveBeenCalledWith('n', undefined)
  })

  it('report a bridge {ok:false} as isError', async () => {
    fb.fbFeed.mockResolvedValue({ ok: false, error: 'Facebook rejected the request' })
    const res = await get(tools(), 'facebook_feed').handler({})
    expect(res.isError).toBe(true)
  })

  it('do not flag a successful read', async () => {
    fb.fbFeed.mockResolvedValue({ ok: true, posts: [] })
    const res = await get(tools(), 'facebook_feed').handler({})
    expect(res.isError).toBeUndefined()
  })

  it('keep a long feed as valid JSON with every post and the cursor', async () => {
    const posts = Array.from({ length: 20 }, (_, i) => ({ postId: String(i), feedbackId: `f${i}`, text: 'x'.repeat(3000) }))
    fb.fbFeed.mockResolvedValue({ ok: true, count: 20, posts, nextCursor: 'c2' })
    const res = await get(tools(), 'facebook_feed').handler({ count: 20 })
    const parsed = JSON.parse(res.content[0].text) as { posts: { text: string; textTruncated?: boolean }[]; nextCursor: string }
    expect(parsed.posts).toHaveLength(20)
    expect(parsed.nextCursor).toBe('c2')
    expect(parsed.posts.every(p => p.textTruncated && p.text.length < 3000)).toBe(true)
  })

  it('leave a short feed and failures untouched', () => {
    const small = { ok: true, posts: [{ text: 'hi' }] }
    expect(fitFeedForAgent(small)).toBe(small)
    const failed = { ok: false, error: 'x' }
    expect(fitFeedForAgent(failed)).toBe(failed)
  })
})
