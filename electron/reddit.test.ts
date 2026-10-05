import { beforeEach, describe, expect, it, vi } from 'vitest'

// One fake Electron session per partition, so "same session" is checkable.
const sessions = new Map<string, { storagePath: string }>()
const sessionFor = (partition: string) => {
  if (!sessions.has(partition)) sessions.set(partition, { storagePath: `/Partitions/${partition}` })
  return sessions.get(partition)!
}
const fakeView = (partition: string, url = 'https://www.reddit.com/') => ({
  webContents: {
    session: sessionFor(partition.replace(/^persist:/, '')),
    isDestroyed: () => false,
    getURL: () => url,
    executeJavaScript: vi.fn(async () => ({ ok: true, ranOn: partition })),
  },
})

let openRedditView: ReturnType<typeof fakeView> | null = null
const ensureBackgroundView = vi.fn(async (_tabId: string, partition: string, _url?: string) => fakeView(partition))
const getViewById = vi.fn((_tabId: string): unknown => ({}))
let accounts = [
  { platform: 'reddit', id: '1', label: 'Account 1', partition: 'gmail-abc' },
  { platform: 'reddit', id: '2', label: 'Work', partition: 'social-reddit-2' },
]

vi.mock('electron', () => ({ session: { fromPartition: (p: string) => sessionFor(p.replace(/^persist:/, '')) } }))
vi.mock('./sessions', () => ({
  findAnyViewByUrl: () => openRedditView,
  ensureBackgroundView: (...a: [string, string, string]) => ensureBackgroundView(...a),
  getViewById: (id: string) => getViewById(id),
  rememberedView: () => ({ tabId: 'social-reddit-someone', partition: 'gmail-abc' }),
}))
vi.mock('./socialAccounts', () => ({
  resolveSocialAccount: (_p: string, ref?: string | number | null) => {
    if (ref === undefined || ref === null || String(ref).trim() === '') return accounts[0]
    const r = String(ref).trim().toLowerCase()
    return accounts.find(a => a.id === r || a.partition === r || a.label.toLowerCase() === r) ?? null
  },
}))

const reddit = await import('./reddit')

beforeEach(() => {
  vi.clearAllMocks()
  openRedditView = null
  accounts = accounts.slice(0, 2)
})

describe('reddit account routing', () => {
  it('maps account 1 to the Social page tab and account N to its own numbered tab', () => {
    expect(reddit.redditTarget()).toMatchObject({ accountId: '1', tabId: 'social-reddit-someone', partition: 'gmail-abc' })
    expect(reddit.redditTarget('work')).toMatchObject({ accountId: '2', tabId: 'social-reddit-2', partition: 'social-reddit-2' })
    expect(reddit.redditTarget('9')).toBeNull()
  })

  it('rejects unregistered accounts before touching any page, for reads and writes', async () => {
    const reads = await reddit.rdFeed({ subreddit: 'technology' }, '9')
    const writes = await reddit.rdVotePost('t3_abc', 'UP', 'nobody')
    expect(reads).toEqual({ ok: false, error: expect.stringContaining('unknown reddit account "9"') })
    expect(writes).toEqual({ ok: false, error: expect.stringContaining('unknown reddit account "nobody"') })
    expect(ensureBackgroundView).not.toHaveBeenCalled()
  })

  it('reuses an open reddit.com view only when it is on the account partition', async () => {
    openRedditView = fakeView('gmail-abc')
    const res = await reddit.rdStatus()
    expect(res).toEqual({ ok: true, ranOn: 'gmail-abc' })
    expect(ensureBackgroundView).not.toHaveBeenCalled()
  })

  it('never reads account 2 through account 1\'s open view', async () => {
    openRedditView = fakeView('gmail-abc')
    const res = await reddit.rdStatus('2')
    expect(res).toEqual({ ok: true, ranOn: 'social-reddit-2' })
    expect(ensureBackgroundView).toHaveBeenCalledWith('social-reddit-2', 'social-reddit-2', 'https://www.reddit.com')
    expect(openRedditView.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('does not use a reddit.com view from another profile for the default account', async () => {
    openRedditView = fakeView('some-ai-browser-tab')
    const res = await reddit.rdStatus()
    expect(res).toEqual({ ok: true, ranOn: 'gmail-abc' })
    expect(ensureBackgroundView).toHaveBeenCalledWith('social-reddit-someone', 'gmail-abc', 'https://www.reddit.com')
  })

  it('fails when the tab it gets back is on a different partition', async () => {
    ensureBackgroundView.mockResolvedValueOnce(fakeView('someone-else'))
    const res = await reddit.rdStatus('2')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not on account 2/)
  })
})

describe('reddit argument checks', () => {
  it('refuses empty or invalid input before any page action', async () => {
    const results = await Promise.all([
      reddit.rdSearch('  '),
      reddit.rdApiSearch(''),
      reddit.rdPostComments('technology', ''),
      reddit.rdApiPostComments(''),
      reddit.rdApiOutlier('r/'),
      reddit.rdFeed({ sort: 'best' as never }),
      reddit.rdApiFeed({ sort: '../api/v1/me' }),
      reddit.rdVotePost('t3_a', 'SIDEWAYS' as never),
      reddit.rdCreateComment('t3_a', 't3_a', ''),
      reddit.rdCreatePost('', 'title'),
      reddit.rdSubscribe('t5_a', 'MAYBE' as never),
    ])
    for (const r of results) expect(r).toEqual({ ok: false, error: expect.any(String) })
    expect(ensureBackgroundView).not.toHaveBeenCalled()
  })
})
