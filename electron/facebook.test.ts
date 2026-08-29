import { describe, expect, it, vi } from 'vitest'

vi.mock('./sessions', () => ({ findViewByUrl: () => null }))

const { fbFeed, fbComment, fbReply, fbShare, fbFollow, fbHide } = await import('./facebook')

describe('facebook feed', () => {
  it('reports Facebook not being open as a result, not a throw', async () => {
    const out = await fbFeed()
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Facebook is not open')
  })
})

describe('facebook comment', () => {
  it('refuses an empty comment before touching the network', async () => {
    const out = await fbComment('feedback:1', '   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('empty comment')
  })

  it('reports Facebook not being open as a result, not a throw', async () => {
    const out = await fbComment('feedback:1', 'hello')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Facebook is not open')
  })
})

describe('facebook reply', () => {
  it('refuses an empty reply before touching the network', async () => {
    const out = await fbReply('1', '2', '   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('empty reply')
  })

  it('reports Facebook not being open as a result, not a throw', async () => {
    const out = await fbReply('1', '2', 'hello')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Facebook is not open')
  })
})

describe('facebook share', () => {
  it('refuses to share without a permalink', async () => {
    const out = await fbShare('   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('permalink')
  })

  it('reports Facebook not being open as a result, not a throw', async () => {
    const out = await fbShare('https://www.facebook.com/x/posts/123')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Facebook is not open')
  })
})

describe('facebook follow', () => {
  it('refuses to follow without an authorId', async () => {
    const out = await fbFollow('   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('authorId')
  })

  it('reports Facebook not being open as a result, not a throw', async () => {
    const out = await fbFollow('100050500269286')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Facebook is not open')
  })
})

describe('facebook hide', () => {
  it('refuses to hide without a nodeId', async () => {
    const out = await fbHide('   ')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('nodeId')
  })

  it('reports Facebook not being open as a result, not a throw', async () => {
    const out = await fbHide('some-node-id')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('Facebook is not open')
  })
})
