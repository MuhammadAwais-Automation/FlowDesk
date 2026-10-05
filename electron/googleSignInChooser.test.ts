import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), dialog: {}, session: {} }))
vi.mock('./flow', () => ({ getGoogleAccounts: () => [], maskAccount: (e: string) => e }))

const { isGoogleSignInUrl, toCookieDetails, wantsGoogleChooser } = await import('./googleSignInChooser')

const cookie = (over: Record<string, unknown>) => ({
  name: 'SID', value: 'v', domain: '.google.com', hostOnly: false, path: '/', secure: true, httpOnly: true,
  session: false, expirationDate: 2000000000, sameSite: 'no_restriction', ...over,
}) as Electron.Cookie

describe('google sign-in chooser', () => {
  it('offers the chooser only for Google popups in social views', () => {
    expect(wantsGoogleChooser('social-pinterest', 'https://accounts.google.com/gsi/select?x=1')).toBe(true)
    expect(wantsGoogleChooser('gmail-abc', 'https://accounts.google.com/gsi/select')).toBe(false)
    expect(wantsGoogleChooser('social-pinterest', 'https://evil.example/accounts.google.com')).toBe(false)
    expect(isGoogleSignInUrl('not a url')).toBe(false)
  })

  it('copies domain cookies with their domain and host-only ones without', () => {
    expect(toCookieDetails(cookie({}))).toMatchObject({ url: 'https://google.com/', domain: '.google.com', sameSite: 'no_restriction', expirationDate: 2000000000 })
    const hostOnly = toCookieDetails(cookie({ name: '__Host-GAPS', domain: 'accounts.google.com', hostOnly: true }))
    expect(hostOnly.url).toBe('https://accounts.google.com/')
    expect(hostOnly).not.toHaveProperty('domain')
    expect(toCookieDetails(cookie({ sameSite: 'unspecified' }))).not.toHaveProperty('sameSite')
  })
})
