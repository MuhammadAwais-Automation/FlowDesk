import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'fd-social-'))
let linkedin = [
  { id: '1', label: 'Account 1 (Primary)', partition: 'social-linkedin' },
  { id: '2', label: 'Account 2', partition: 'social-linkedin-2' },
]

vi.mock('electron', () => ({ app: { getPath: () => dir }, BrowserWindow: vi.fn(), session: {} }))
vi.mock('./sessions', () => ({ rememberedView: () => ({ tabId: 'social-reddit-x', partition: 'gmail-abc' }) }))
vi.mock('./linkedin/linkedin', () => ({
  getSavedLinkedInAccounts: () => linkedin,
  saveLinkedInAccounts: (a: typeof linkedin) => { linkedin = a },
}))

const { addSocialAccount, cleanLabel, listSocialAccounts, parseStored, resolveSocialAccount, socialPartition } = await import('./socialAccounts')

describe('social account registry', () => {
  beforeEach(() => { linkedin = linkedin.slice(0, 2) })

  it('keeps the partitions that already hold logins', () => {
    expect(socialPartition('whatsapp', '1')).toBe('social-whatsapp')
    expect(socialPartition('tiktok', '3')).toBe('social-tiktok-3')
    expect(socialPartition('reddit', '1')).toBe('gmail-abc') // where the Social page signed Reddit in
    expect(socialPartition('reddit', '2')).toBe('social-reddit-2')
  })

  it('starts each platform with the slots it had before', () => {
    expect(listSocialAccounts('tiktok').map(a => a.id)).toEqual(['1', '2', '3'])
    expect(listSocialAccounts('whatsapp').map(a => a.partition)).toEqual(['social-whatsapp'])
    expect(listSocialAccounts('linkedin').map(a => a.label)).toEqual(['Account 1 (Primary)', 'Account 2'])
  })

  it('resolves by id, partition or label, and defaults to account 1', () => {
    expect(resolveSocialAccount('tiktok', '2')?.partition).toBe('social-tiktok-2')
    expect(resolveSocialAccount('tiktok', 'social-tiktok-3')?.id).toBe('3')
    expect(resolveSocialAccount('linkedin', 'account 1 (primary)')?.id).toBe('1')
    expect(resolveSocialAccount('facebook')?.partition).toBe('social-facebook')
  })

  it('refuses an account that does not exist instead of falling back', () => {
    expect(resolveSocialAccount('whatsapp', '2')).toBeNull()
    expect(resolveSocialAccount('tiktok', 'nobody')).toBeNull()
  })

  it('adds the next numbered slot and remembers it', () => {
    const wa = addSocialAccount('whatsapp', 'Shop')
    expect(wa).toMatchObject({ id: '2', label: 'Shop', partition: 'social-whatsapp-2' })
    expect(listSocialAccounts('whatsapp').map(a => a.id)).toEqual(['1', '2'])
    expect(resolveSocialAccount('whatsapp', 'shop')?.id).toBe('2')

    const li = addSocialAccount('linkedin')
    expect(li).toMatchObject({ id: '3', label: 'Account 3', partition: 'social-linkedin-3' })
    expect(linkedin.map(a => a.id)).toEqual(['1', '2', '3']) // LinkedIn's own file stays its store
  })

  it('drops malformed stored rows instead of trusting them', () => {
    expect(parseStored(null)).toEqual({})
    expect(parseStored({ tiktok: 'x' })).toEqual({})
    expect(parseStored({ tiktok: [{ id: '2', label: 'Two' }, { id: '../x', label: 'bad' }, { id: 3, label: 'n' }] }))
      .toEqual({ tiktok: [{ id: '2', label: 'Two' }] })
  })

  it('strips control characters and caps label length', () => {
    expect(cleanLabel(String.fromCharCode(32, 97, 0, 98, 10, 99, 32))).toBe('abc')
    expect(cleanLabel('x'.repeat(200))).toHaveLength(60)
  })
})
