import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), dialog: {}, session: {} }))
vi.mock('./flow', () => ({ getGoogleAccounts: () => [], maskAccount: (e: string) => e }))

const { isGoogleSignInUrl, toCookieDetails, waitForGoogleSignIn, wantsGoogleChooser } = await import('./googleSignInChooser')

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

describe('waitForGoogleSignIn', () => {
  const fakeWin = () => {
    const handlers: Record<string, () => void> = {}
    const win = {
      destroyed: false,
      on: (ev: string, fn: () => void) => { handlers[ev] = fn; return win },
      close: () => { win.destroyed = true; handlers.closed?.() },
      isDestroyed: () => win.destroyed,
    }
    return win
  }
  const ses = {} as Electron.Session

  it('closes the window and resolves once the session is signed in', async () => {
    const win = fakeWin()
    let signedIn = false
    const p = waitForGoogleSignIn(win as never, ses, { pollMs: 5, settleMs: 5, isSignedIn: async () => signedIn })
    await new Promise(r => setTimeout(r, 20))
    expect(win.destroyed).toBe(false)
    signedIn = true
    await expect(p).resolves.toEqual({ signedIn: true })
    expect(win.destroyed).toBe(true)
  })

  it('reports a cancel when the user closes the window before signing in', async () => {
    const win = fakeWin()
    const p = waitForGoogleSignIn(win as never, ses, { pollMs: 5, isSignedIn: async () => false })
    win.close()
    await expect(p).resolves.toEqual({ signedIn: false })
  })

  it('still counts a sign-in finished just before the user closed the window', async () => {
    const win = fakeWin()
    const p = waitForGoogleSignIn(win as never, ses, { pollMs: 10_000, isSignedIn: async () => true })
    win.close()
    await expect(p).resolves.toEqual({ signedIn: true })
  })
})
