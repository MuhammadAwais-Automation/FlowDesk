/**
 * "Continue with Google" inside a social view, using the Google accounts the
 * user already added on the Accounts page.
 *
 * A social view (`social-*` partition) has no Google login of its own, so
 * Google's popup asked for an email and password again. Instead, when that
 * popup opens on a session with no Google login, FlowDesk asks which Accounts-
 * page Google account to use, copies that account's google.com session into
 * this view's session, and only then loads the popup — which then shows that
 * account to click. Nothing is typed or submitted for the user: they still
 * pick the account in Google's popup themselves.
 *
 * The popup is the real window.open child, so Google's reply still reaches
 * the page that opened it.
 */
import { BrowserWindow, dialog, session, type Cookie, type Session } from 'electron'
import { getGoogleAccounts, maskAccount } from './flow'

export function isGoogleSignInUrl(url: string): boolean {
  try { return new URL(url).hostname === 'accounts.google.com' } catch { return false }
}

/** Only social views get the chooser; Google-account partitions already are Google. */
export function wantsGoogleChooser(partition: string, url: string): boolean {
  return partition.startsWith('social-') && isGoogleSignInUrl(url)
}

export async function hasGoogleLogin(ses: Session): Promise<boolean> {
  const sid = await ses.cookies.get({ domain: 'google.com', name: 'SID' }).catch(() => [])
  return sid.length > 0
}

const isGoogleCookie = (c: Cookie) => !!c.domain && /(^|\.)google\.com$/.test(c.domain.replace(/^\./, ''))

/** The cookie as cookies.set() needs it; host-only and __Host- cookies keep no domain. */
export function toCookieDetails(c: Cookie): Electron.CookiesSetDetails {
  const host = (c.domain ?? '').replace(/^\./, '')
  const keepDomain = !c.hostOnly && !c.name.startsWith('__Host-')
  return {
    url: `https://${host}${c.path || '/'}`,
    name: c.name,
    value: c.value,
    ...(keepDomain ? { domain: c.domain } : {}),
    path: c.path || '/',
    secure: c.secure,
    httpOnly: c.httpOnly,
    ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
    ...(c.sameSite && c.sameSite !== 'unspecified' ? { sameSite: c.sameSite } : {}),
  }
}

/** Copies one Accounts-page Google login (google.com cookies only) into `target`. */
export async function copyGoogleSession(fromPartition: string, target: Session): Promise<number> {
  const all = await session.fromPartition(`persist:${fromPartition}`).cookies.get({})
  let copied = 0
  for (const c of all.filter(isGoogleCookie)) {
    try { await target.cookies.set(toCookieDetails(c)); copied++ } catch { /* one odd cookie must not stop the rest */ }
  }
  await target.cookies.flushStore().catch(() => {})
  return copied
}

/**
 * Runs on the Google popup a social view opened (created hidden). If the view
 * has no Google login yet, asks which Accounts-page account to use first.
 */
export async function prepareGooglePopup(child: BrowserWindow, url: string, parent: BrowserWindow | null): Promise<void> {
  const ses = child.webContents.session
  const accounts = getGoogleAccounts()
  if (await hasGoogleLogin(ses) || !accounts.length) { child.show(); return }
  const owner = parent && !parent.isDestroyed() ? parent : undefined
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: 'Continue with Google',
    message: 'Sign in with which Google account?',
    detail: 'These are the Google accounts on the FlowDesk Accounts page. You still choose the account in Google\'s window next.',
    buttons: [...accounts.map(a => a.label ? `${a.label} — ${a.email}` : a.email), 'Cancel'],
    cancelId: accounts.length,
    noLink: true,
  }
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  if (child.isDestroyed()) return
  if (response >= accounts.length) { child.close(); return }
  const copied = await copyGoogleSession(accounts[response].partition, ses)
  console.log(`[google-chooser] ${maskAccount(accounts[response].email)} → popup session (${copied} google.com cookies)`)
  if (child.isDestroyed()) return
  await child.webContents.loadURL(url).catch(() => {})
  child.show()
}
