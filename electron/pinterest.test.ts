import { beforeEach, describe, expect, it, vi } from 'vitest'

const opened: string[] = []
let answer: Record<string, unknown> = { ok: true, status: 200, code: 0, data: [], bookmark: null }
let signedIn: boolean | null = false

vi.mock('electron', () => ({}))
vi.mock('./sessions', () => ({
  ensureBackgroundView: async (tabId: string) => {
    opened.push(tabId)
    return { webContents: { executeJavaScript: async () => answer, getURL: () => 'https://www.pinterest.com/' } }
  },
}))
vi.mock('./socialAccounts', () => ({
  resolveSocialAccount: (_p: string, ref?: unknown) =>
    ref === undefined || ref === '1' ? { platform: 'pinterest', id: '1', label: 'Account 1', partition: 'social-pinterest' } : null,
  isSignedIn: async () => signedIn,
}))

const { pinterestPin, pinterestSearch, pinterestStatus, pinterestUser, pinterestUserPins } = await import('./pinterest')

describe('pinterest account routing', () => {
  beforeEach(() => { opened.length = 0; signedIn = false; answer = { ok: true, status: 200, code: 0, data: [], bookmark: null } })

  it('refuses an unknown account without opening any page', async () => {
    const out = await pinterestUserPins('pinterest', { account: '7' })
    expect(out).toMatchObject({ ok: false })
    expect(String(out.error)).toContain('unknown pinterest account "7"')
    expect(opened).toEqual([])
    expect((await pinterestStatus('7')).ok).toBe(false)
  })

  it('refuses bad input before opening any page', async () => {
    expect((await pinterestPin('../x')).ok).toBe(false)
    expect((await pinterestUser('a/b')).ok).toBe(false)
    expect(opened).toEqual([])
  })

  it('reports a 404 as not found and tags results with the account', async () => {
    answer = { ok: false, status: 404 }
    const out = await pinterestUser('nobody-here')
    expect(out).toMatchObject({ ok: false, error: 'user "nobody-here" not found on Pinterest', account: '1' })
    expect(opened).toEqual(['social-pinterest']) // same tab as the Social page, so one Chromium per partition
  })

  it('explains that search needs sign-in when a signed-out account gets nothing back', async () => {
    const out = await pinterestSearch('minimal logo')
    expect(out.ok).toBe(false)
    expect(String(out.error)).toContain('signed-in accounts')
    signedIn = true
    expect(await pinterestSearch('minimal logo')).toMatchObject({ ok: true, pins: [] })
  })
})
