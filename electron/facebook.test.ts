import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sessions are compared by identity, the way Electron hands out one Session per partition.
const sessions = new Map<string, object>()
const sessionFor = (p: string) => { if (!sessions.has(p)) sessions.set(p, { p }); return sessions.get(p)! }

interface FakeView { webContents: { session: object; isDestroyed: () => boolean; executeJavaScript: ReturnType<typeof vi.fn> } }
const views = new Map<string, FakeView>()
const ensureBackgroundView = vi.fn(async (_tabId: string, _partition: string, _url: string): Promise<FakeView> => { throw new Error('no window in tests') })

vi.mock('electron', () => ({ session: { fromPartition: (p: string) => sessionFor(p) } }))
vi.mock('./sessions', () => ({
  getViewById: (tabId: string) => views.get(tabId) ?? null,
  ensureBackgroundView: (tabId: string, partition: string, url: string) => ensureBackgroundView(tabId, partition, url),
}))
vi.mock('./socialAccounts', () => {
  const all = [
    { platform: 'facebook', id: '1', label: 'Account 1', partition: 'social-facebook' },
    { platform: 'facebook', id: '2', label: 'Work', partition: 'social-facebook-2' },
  ]
  return {
    SOCIAL_HOME: { facebook: 'https://www.facebook.com' },
    resolveSocialAccount: (_p: string, ref?: string | number | null) => {
      if (ref === undefined || ref === null || String(ref).trim() === '') return all[0]
      const r = String(ref).trim().toLowerCase()
      return all.find(a => a.id === r || a.partition === r || a.label.toLowerCase() === r) ?? null
    },
  }
})

function fakeView(partition: string, ...answers: unknown[]): FakeView {
  const exec = vi.fn()
  for (const a of answers) exec.mockResolvedValueOnce(a)
  return { webContents: { session: sessionFor(`persist:${partition}`), isDestroyed: () => false, executeJavaScript: exec } }
}

beforeEach(() => {
  views.clear()
  ensureBackgroundView.mockClear()
})

const { fbFeed, fbReact, fbComment, fbReply, fbShare, fbFollow, fbHide } = await import('./facebook')

describe('facebook accounts', () => {
  it('refuses an unknown account on every tool before opening any page', async () => {
    const outs = await Promise.all([
      fbFeed(5, null, 'nope'),
      fbReact('feedback:1', 'like', 'nope'),
      fbComment('feedback:1', 'hello', null, 'nope'),
      fbReply('1', '2', 'hello', null, 'nope'),
      fbShare('https://www.facebook.com/x/posts/1', '', 'FRIENDS', 'nope'),
      fbFollow('100', 'nope'),
      fbHide('node', 'nope'),
    ])
    for (const out of outs) {
      expect(out.ok).toBe(false)
      expect(String(out.error)).toContain('unknown facebook account "nope"')
    }
    expect(ensureBackgroundView).not.toHaveBeenCalled()
  })

  it('with no account uses account 1 on its own partition', async () => {
    views.set('social-facebook', fakeView('social-facebook', { ok: true, posts: [{}], nextCursor: null, hasNextPage: false }))
    const out = await fbFeed(1)
    expect(out).toMatchObject({ ok: true, count: 1, account: '1' })
  })

  it('reads account 2 from its own view, never account 1\'s', async () => {
    const one = fakeView('social-facebook', { ok: true, posts: [], nextCursor: null })
    views.set('social-facebook', one)
    ensureBackgroundView.mockResolvedValueOnce(fakeView('social-facebook-2', { ok: true, posts: [{}], nextCursor: null, hasNextPage: false }))
    const out = await fbFeed(1, null, 'work')
    expect(out).toMatchObject({ ok: true, account: '2' })
    expect(ensureBackgroundView).toHaveBeenCalledWith('social-facebook-2', 'social-facebook-2', 'https://www.facebook.com')
    expect(one.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('refuses a view whose session is not the account\'s partition', async () => {
    const wrong = fakeView('social-facebook-2')
    views.set('social-facebook', wrong)
    const out = await fbReact('feedback:1', 'like')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('not on its partition')
    expect(wrong.webContents.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('facebook feed paging', () => {
  it('follows nextCursor until count is reached, since page one is short', async () => {
    const view = fakeView('social-facebook',
      { ok: true, posts: [{}, {}, {}, {}], nextCursor: 'c1', hasNextPage: true },
      { ok: true, posts: [{}, {}, {}], nextCursor: 'c2', hasNextPage: true },
    )
    views.set('social-facebook', view)
    const out = await fbFeed(6)
    expect(out).toMatchObject({ ok: true, count: 7, nextCursor: 'c2', hasNextPage: true })
    expect(view.webContents.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('stops at the end of the feed', async () => {
    views.set('social-facebook', fakeView('social-facebook', { ok: true, posts: [{}], nextCursor: null, hasNextPage: false }))
    const out = await fbFeed(10)
    expect(out).toMatchObject({ ok: true, count: 1, hasNextPage: false })
  })

  it('keeps earlier pages when a later page fails, with the cursor to retry', async () => {
    views.set('social-facebook', fakeView('social-facebook',
      { ok: true, posts: [{}, {}], nextCursor: 'c1', hasNextPage: true },
      { ok: false, error: 'Facebook rejected the request' },
    ))
    const out = await fbFeed(5)
    expect(out).toMatchObject({ ok: true, count: 2, nextCursor: 'c1' })
    expect(String(out.warning)).toContain('rejected')
  })

  it('returns a first-page failure as is', async () => {
    views.set('social-facebook', fakeView('social-facebook', { ok: false, error: 'Facebook rejected the request' }))
    const out = await fbFeed(5, 'garbage')
    expect(out).toMatchObject({ ok: false, error: 'Facebook rejected the request' })
  })
})

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
