import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  resolveLinkedInPartition,
  setActiveLinkedInAccount,
  getActiveLinkedInAccount,
  saveLinkedInAccounts,
  liAccounts,
  liSwitchAccount,
  setOnLinkedInAccountSwitchedListener,
  linkedInAccountError,
  findLinkedInAccount,
  liStatus,
  liSend,
  getLinkedInView,
} from './linkedin'
import { ensureBackgroundView, showView } from '../sessions'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\fake\\userData'),
    isPackaged: false,
  },
}))

vi.mock('../sessions', () => ({
  getActiveView: vi.fn(() => null),
  getViewById: vi.fn((tabId: string) => {
    if (tabId === 'social-linkedin') {
      return {
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'https://www.linkedin.com/feed/',
          executeJavaScript: vi.fn(async () => ({
            ok: true,
            signedIn: true,
            name: 'Awais Mushtaq',
            publicId: 'awais-mushtaq-ab5442302',
            headline: 'Full-Stack AI Developer',
          })),
        },
      }
    }
    return null
  }),
  ensureBackgroundView: vi.fn(async (_tabId: string, _partition: string) => ({
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'https://www.linkedin.com/feed/',
      executeJavaScript: vi.fn(async () => ({ ok: true })),
    },
  })),
  showView: vi.fn(),
}))

vi.mock('node:fs', () => {
  let storedJson: string | null = null
  return {
    existsSync: vi.fn(() => storedJson !== null),
    readFileSync: vi.fn(() => storedJson || '[]'),
    writeFileSync: vi.fn((_file: string, content: string) => {
      storedJson = content
    }),
    mkdirSync: vi.fn(),
  }
})

describe('LinkedIn Multi-Account Partition & Routing', () => {
  beforeEach(() => {
    setActiveLinkedInAccount('1')
  })

  it('resolves primary account partition as social-linkedin by default', () => {
    const res = resolveLinkedInPartition('1')
    expect(res).toEqual({
      tabId: 'social-linkedin',
      partition: 'social-linkedin',
      accountId: '1',
    })
  })

  it('resolves secondary account partition as social-linkedin-2', () => {
    const res = resolveLinkedInPartition('2')
    expect(res).toEqual({
      tabId: 'social-linkedin-2',
      partition: 'social-linkedin-2',
      accountId: '2',
    })
  })

  it('resolves partition given explicit partition string', () => {
    const res = resolveLinkedInPartition('social-linkedin-3')
    expect(res).toEqual({
      tabId: 'social-linkedin-3',
      partition: 'social-linkedin-3',
      accountId: '3',
    })
  })

  it('resolves account by label/name match', () => {
    saveLinkedInAccounts([
      { id: '1', label: 'Personal Awais', partition: 'social-linkedin' },
      { id: '2', label: 'Sales Outreach', partition: 'social-linkedin-2' },
    ])

    const salesRes = resolveLinkedInPartition('Sales')
    expect(salesRes.accountId).toBe('2')
    expect(salesRes.partition).toBe('social-linkedin-2')

    const personalRes = resolveLinkedInPartition('awais')
    expect(personalRes.accountId).toBe('1')
    expect(personalRes.partition).toBe('social-linkedin')
  })

  it('switches active account and notifies listener', async () => {
    const switched: string[] = []
    setOnLinkedInAccountSwitchedListener(id => switched.push(id))

    const res = await liSwitchAccount('2')
    expect(res.ok).toBe(true)
    expect(res.account).toBe('social-linkedin-2')
    expect(getActiveLinkedInAccount()).toBe('2')
    expect(switched).toContain('2')
  })

  it('lists accounts with authentication status from active view', async () => {
    saveLinkedInAccounts([
      { id: '1', label: 'Account 1 (Primary)', partition: 'social-linkedin' },
      { id: '2', label: 'Account 2', partition: 'social-linkedin-2' },
    ])

    const res = await liAccounts()
    expect(res.ok).toBe(true)
    expect(res.accounts.length).toBe(2)

    const acc1 = res.accounts.find(a => a.id === '1')
    expect(acc1?.authenticated).toBe(true)
    expect(acc1?.name).toBe('Awais Mushtaq')

    const acc2 = res.accounts.find(a => a.id === '2')
    expect(acc2?.authenticated).toBe(false)
  })
})

describe('unknown LinkedIn accounts are refused, never invented', () => {
  beforeEach(() => {
    saveLinkedInAccounts([
      { id: '1', label: 'Account 1 (Primary)', partition: 'social-linkedin' },
      { id: '2', label: 'Account 2', partition: 'social-linkedin-2' },
    ])
    setActiveLinkedInAccount('1')
    vi.mocked(ensureBackgroundView).mockClear()
    vi.mocked(showView).mockClear()
  })

  it('finds saved accounts by id, partition and label', () => {
    expect(findLinkedInAccount('2')?.partition).toBe('social-linkedin-2')
    expect(findLinkedInAccount('social-linkedin')?.id).toBe('1')
    expect(findLinkedInAccount('primary')?.id).toBe('1')
    expect(findLinkedInAccount('7')).toBeNull()
  })

  it('accepts no account, empty and active as the default', () => {
    expect(linkedInAccountError()).toBeNull()
    expect(linkedInAccountError('')).toBeNull()
    expect(linkedInAccountError('active')).toBeNull()
    expect(linkedInAccountError('2')).toBeNull()
  })

  it('names an unknown account and the saved ones', () => {
    expect(linkedInAccountError('social-linkedin-9')).toMatch(/^unknown linkedin account "social-linkedin-9"/)
    expect(linkedInAccountError(7)).toContain('saved accounts: 1, 2')
  })

  it('a read on an unknown account fails before any view is opened', async () => {
    const res = await liStatus('ghost')
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/^unknown linkedin account "ghost"/) })
    expect(ensureBackgroundView).not.toHaveBeenCalled()
  })

  it('getLinkedInView rejects an unknown account instead of creating a partition', async () => {
    await expect(getLinkedInView('social-linkedin-3')).rejects.toThrow(/unknown linkedin account/)
    expect(ensureBackgroundView).not.toHaveBeenCalled()
  })

  it('switching to an unknown account changes nothing', async () => {
    const res = await liSwitchAccount('ghost')
    expect(res.ok).toBe(false)
    expect(showView).not.toHaveBeenCalled()
    expect(getActiveLinkedInAccount()).toBe('1')
  })

  it('Active in any case means the active account, not a new partition', () => {
    setActiveLinkedInAccount('2')
    expect(resolveLinkedInPartition('Active').partition).toBe('social-linkedin-2')
    expect(linkedInAccountError('ACTIVE')).toBeNull()
  })

  it('refuses a partial label that names more than one account', () => {
    expect(findLinkedInAccount('account')).toBeNull()
    expect(linkedInAccountError('account')).toMatch(/^unknown linkedin account/)
    expect(findLinkedInAccount('primary')?.id).toBe('1')
  })

  it('send refuses empty text and a malformed urn before any view is opened', async () => {
    expect(await liSend('urn:li:msg_conversation:(a,b)', '   ')).toEqual({ ok: false, error: 'refusing to send empty text' })
    expect((await liSend('not-a-urn', 'hi')).ok).toBe(false)
    expect(ensureBackgroundView).not.toHaveBeenCalled()
  })
})
