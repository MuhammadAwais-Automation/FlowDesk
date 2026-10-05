/**
 * One account list for every social platform.
 *
 * Each platform used to keep its own: LinkedIn a JSON file, TikTok a fixed
 * ['1','2','3'], WhatsApp and Facebook a single hardcoded partition, Reddit a
 * "remembered" Social-page view. So a second WhatsApp, Reddit or Facebook account
 * could not exist, and TikTok/LinkedIn were capped.
 *
 * Partitions keep the naming already on disk, so every existing login carries
 * over untouched: account 1 is `social-<platform>`, account N is
 * `social-<platform>-N`. Reddit account 1 keeps the partition the Social page
 * actually signed in with (rememberedView). LinkedIn's own accounts file stays
 * its store, so its labels, names and publicIds are not duplicated.
 */
import { app, BrowserWindow, session } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeTabView, rememberedView } from './sessions'
import { getSavedLinkedInAccounts, saveLinkedInAccounts } from './linkedin/linkedin'
import { getGoogleAccounts, maskAccount, matchFlowAccount } from './flow'
import { routeLink } from './linkRouting'
import { prepareGooglePopup, wantsGoogleChooser } from './googleSignInChooser'

export const SOCIAL_PLATFORMS = ['whatsapp', 'tiktok', 'linkedin', 'reddit', 'facebook', 'pinterest', 'gumroad'] as const
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number]

export interface SocialAccount { platform: SocialPlatform; id: string; label: string; partition: string }

export const SOCIAL_HOME: Record<SocialPlatform, string> = {
  whatsapp: 'https://web.whatsapp.com',
  tiktok: 'https://www.tiktok.com',
  linkedin: 'https://www.linkedin.com/feed/',
  reddit: 'https://www.reddit.com',
  facebook: 'https://www.facebook.com',
  pinterest: 'https://www.pinterest.com',
  gumroad: 'https://gumroad.com/dashboard',
}

// What each platform had before this list existed.
const DEFAULT_IDS: Record<SocialPlatform, string[]> = {
  whatsapp: ['1'], tiktok: ['1', '2', '3'], linkedin: ['1', '2'], reddit: ['1'], facebook: ['1'], pinterest: ['1'], gumroad: ['1'],
}

// `google` = the partition of a Google account from the Accounts page. The slot
// then lives in that partition, so "Continue with Google" there needs no password.
type StoredRow = { id: string; label: string; google?: string }
type Stored = Partial<Record<SocialPlatform, StoredRow[]>>
const GOOGLE_PARTITION = /^gmail-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const file = () => join(app.getPath('userData'), 'social-accounts.json')

export const MAX_SOCIAL_ACCOUNTS = 10
const MAX_LABEL = 60

// The file is user data on disk: anything that is not a list of numbered slots
// is dropped, so a hand-edited or half-written file cannot invent partitions.
export function parseStored(raw: unknown): Stored {
  const out: Stored = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const p of SOCIAL_PLATFORMS) {
    const rows = (raw as Record<string, unknown>)[p]
    if (!Array.isArray(rows)) continue
    const clean = rows
      .filter((r): r is { id: string; label: string } => !!r && typeof r === 'object'
        && typeof (r as { id?: unknown }).id === 'string' && /^[1-9]\d{0,2}$/.test((r as { id: string }).id)
        && typeof (r as { label?: unknown }).label === 'string')
      .map(r => {
        const google = (r as { google?: unknown }).google
        return { id: r.id, label: cleanLabel(r.label) || `Account ${r.id}`, ...(typeof google === 'string' && GOOGLE_PARTITION.test(google) ? { google } : {}) }
      })
      .slice(0, MAX_SOCIAL_ACCOUNTS)
    if (clean.length) out[p] = clean
  }
  return out
}

export function cleanLabel(label: string): string {
  return label.replace(/\p{Cc}/gu, '').trim().slice(0, MAX_LABEL)
}

function readStored(): Stored {
  try { return existsSync(file()) ? parseStored(JSON.parse(readFileSync(file(), 'utf8'))) : {} } catch { return {} }
}

function writeStored(stored: Stored): void {
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8')
  renameSync(tmp, file())
}

export function isSocialPlatform(v: unknown): v is SocialPlatform {
  return typeof v === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(v)
}

export function socialPartition(platform: SocialPlatform, id: string): string {
  if (id === '1') return platform === 'reddit' ? (rememberedView('reddit')?.partition ?? 'social-reddit') : `social-${platform}`
  return `social-${platform}-${id}`
}

export function listSocialAccounts(platform: SocialPlatform): SocialAccount[] {
  if (platform === 'linkedin') {
    return getSavedLinkedInAccounts().map(a => ({ platform, id: a.id, label: a.label, partition: a.partition }))
  }
  const stored = readStored()[platform]
  const rows: StoredRow[] = stored && stored.length ? stored : DEFAULT_IDS[platform].map(id => ({ id, label: `Account ${id}` }))
  return rows.map(r => ({ platform, id: r.id, label: r.label, partition: r.google ?? socialPartition(platform, r.id) }))
}

/** Which Accounts-page Google account (masked email) a slot lives in, if any. */
export function googleAccountOf(acc: SocialAccount): string | null {
  const g = getGoogleAccounts().find(a => a.partition === acc.partition)
  return g ? maskAccount(g.email) : null
}

export interface AddSocialAccountOptions {
  /** Email, label or partition of a Google account from the Accounts page. */
  googleAccount?: string
  /** Re-point this existing slot instead of adding a new one. */
  account?: string
}

/**
 * The account a call means: by id ("2"), partition, or label. No ref = account 1.
 * An explicit ref that matches nothing is null, never a silent fallback: a post
 * from the wrong account is worse than an error.
 */
export function resolveSocialAccount(platform: SocialPlatform, ref?: string | number | null): SocialAccount | null {
  const all = listSocialAccounts(platform)
  if (ref === undefined || ref === null || String(ref).trim() === '') return all.find(a => a.id === '1') ?? all[0] ?? null
  const r = String(ref).trim().toLowerCase()
  return all.find(a => a.id === r) ?? all.find(a => a.partition.toLowerCase() === r)
    ?? all.find(a => a.label.toLowerCase() === r) ?? null
}

/**
 * A new numbered account slot, or (with `account`) an existing slot re-pointed.
 * With `googleAccount` the slot lives in that Google account's partition from
 * the Accounts page; the user then signs in with openSocialLogin.
 */
export function addSocialAccount(platform: SocialPlatform, label?: string, opts: AddSocialAccountOptions = {}): SocialAccount {
  const all = listSocialAccounts(platform)
  let google: string | undefined
  if (opts.googleAccount) {
    const m = matchFlowAccount(getGoogleAccounts(), opts.googleAccount)
    if ('error' in m) throw new Error(m.error.replace('flow_accounts', 'the Accounts page'))
    google = m.partition
    const taken = all.find(a => a.partition === google && a.id !== opts.account)
    if (taken) throw new Error(`${platform} account ${taken.id} (${taken.label}) already uses that Google account`)
  }
  const existing = opts.account ? all.find(a => a.id === String(opts.account).trim()) : undefined
  if (opts.account && !existing) throw new Error(`unknown ${platform} account "${opts.account}" — list them with social_accounts`)
  if (!existing && all.length >= MAX_SOCIAL_ACCOUNTS) throw new Error(`${platform} already has ${MAX_SOCIAL_ACCOUNTS} accounts`)
  const id = existing ? existing.id : String(Math.max(0, ...all.map(a => Number(a.id) || 0)) + 1)
  const googleEmail = google ? getGoogleAccounts().find(a => a.partition === google)?.email : undefined
  const name = cleanLabel(label ?? '') || (existing && !googleEmail ? existing.label : googleEmail ? maskAccount(googleEmail) : `Account ${id}`)
  const partition = google ?? (existing ? existing.partition : socialPartition(platform, id))
  if (platform === 'linkedin') {
    const rest = getSavedLinkedInAccounts().filter(a => a.id !== id)
    saveLinkedInAccounts([...rest, { id, label: name, partition }].sort((a, b) => Number(a.id) - Number(b.id)))
  } else {
    const stored = readStored()
    const rows: StoredRow[] = all.map(a => {
      const prev = (stored[platform] ?? []).find(r => r.id === a.id)
      return { id: a.id, label: a.label, ...(prev?.google ? { google: prev.google } : {}) }
    })
    const keep = google ?? rows.find(r => r.id === id)?.google
    const row: StoredRow = { id, label: name, ...(keep ? { google: keep } : {}) }
    stored[platform] = existing ? rows.map(r => (r.id === id ? row : r)) : [...rows, row]
    writeStored(stored)
  }
  return { platform, id, label: name, partition }
}

/**
 * Drops a slot and signs it out. Account 1 stays: every tool falls back to it.
 * A slot living in an Accounts-page Google partition only loses the row; that
 * partition's cookies belong to the Accounts page and are left alone.
 */
export async function removeSocialAccount(platform: SocialPlatform, ref: string): Promise<SocialAccount> {
  const acc = resolveSocialAccount(platform, ref)
  if (!acc) throw new Error(`unknown ${platform} account "${ref}"`)
  if (acc.id === '1') throw new Error('account 1 cannot be removed')
  if (platform === 'linkedin') {
    saveLinkedInAccounts(getSavedLinkedInAccounts().filter(a => a.id !== acc.id))
  } else {
    const stored = readStored()
    stored[platform] = listSocialAccounts(platform).filter(a => a.id !== acc.id).map(a => {
      const prev = (stored[platform] ?? []).find(r => r.id === a.id)
      return { id: a.id, label: a.label, ...(prev?.google ? { google: prev.google } : {}) }
    })
    writeStored(stored)
  }
  closeTabView(`social-${platform}-${acc.id}`)
  if (!GOOGLE_PARTITION.test(acc.partition)) {
    await session.fromPartition(`persist:${acc.partition}`).clearStorageData().catch(() => {})
  }
  return acc
}

// The session cookie each site sets once signed in. Read straight from the
// partition, so no page has to be opened; an account whose view was never
// opened used to read as "not signed in". WhatsApp keeps its session in
// IndexedDB, so it reads as null (unknown) rather than a guessed false.
const AUTH_COOKIE: Partial<Record<SocialPlatform, { url: string; name: string; value?: string }>> = {
  tiktok: { url: 'https://www.tiktok.com', name: 'sessionid' },
  linkedin: { url: 'https://www.linkedin.com', name: 'li_at' },
  reddit: { url: 'https://www.reddit.com', name: 'reddit_session' },
  facebook: { url: 'https://www.facebook.com', name: 'c_user' },
  // Pinterest sets _auth=0 for visitors too; only 1 means signed in.
  pinterest: { url: 'https://www.pinterest.com', name: '_auth', value: '1' },
}

export async function isSignedIn(acc: SocialAccount): Promise<boolean | null> {
  const c = AUTH_COOKIE[acc.platform]
  if (!c) return null
  const found = await session.fromPartition(`persist:${acc.partition}`).cookies.get({ url: c.url, name: c.name }).catch(() => null)
  return found === null ? null : found.some(k => c.value === undefined || k.value === c.value)
}

/** Every account of one platform (or all), with whether it is signed in. */
export async function socialAccountsStatus(platform?: SocialPlatform) {
  const platforms = platform ? [platform] : [...SOCIAL_PLATFORMS]
  const out: (SocialAccount & { signedIn: boolean | null; google: string | null })[] = []
  for (const p of platforms) for (const a of listSocialAccounts(p)) out.push({ ...a, signedIn: await isSignedIn(a), google: googleAccountOf(a) })
  // What social_add_account { googleAccount } can bind a slot to.
  const googleAccounts = getGoogleAccounts().map(g => ({ email: maskAccount(g.email), label: g.label ?? null, partition: g.partition }))
  return { ok: true, accounts: out, googleAccounts }
}

/** A visible window on the account's own partition, for the user to sign in once. */
// Where signing in starts when the home page is not the login page.
const SOCIAL_LOGIN: Partial<Record<SocialPlatform, string>> = { pinterest: 'https://www.pinterest.com/login/', gumroad: 'https://gumroad.com/login' }

// One sign-in window per partition: asking again focuses it instead of stacking windows.
const loginWindows = new Map<string, BrowserWindow>()

// Set by main.ts: brings FlowDesk forward on Social → platform → account. The
// user signs in there, with the top-bar account picker, never in a separate
// window. The window below stays only for when no app window exists (tests).
let showSocialTab: ((platform: SocialPlatform, account: SocialAccount) => boolean) | null = null
export function setSocialShowHandler(fn: typeof showSocialTab): void { showSocialTab = fn }

export function openSocialLogin(platform: SocialPlatform, ref?: string | number | null): { ok: boolean; account?: SocialAccount; error?: string; shown?: string } {
  const acc = resolveSocialAccount(platform, ref)
  if (!acc) return { ok: false, error: `unknown ${platform} account "${ref}" — list them with social_accounts` }
  if (showSocialTab?.(platform, acc)) return { ok: true, account: acc, shown: `FlowDesk Social → ${platform} → ${acc.label}; the user signs in there` }
  const open = loginWindows.get(acc.partition)
  if (open && !open.isDestroyed()) { open.show(); open.focus(); return { ok: true, account: acc } }
  const win = new BrowserWindow({
    width: 1100, height: 850, title: `${platform} sign-in — ${acc.label}`,
    webPreferences: { session: session.fromPartition(`persist:${acc.partition}`), nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  // "Continue with Google" opens Google's chooser as a popup; it must open on
  // this same session (the Google account bound to the slot), not be dropped.
  // In a social-* session with no Google login, the popup opens hidden and
  // prepareGooglePopup first offers the Accounts-page Google accounts.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (routeLink(url, win.webContents.getURL()) !== 'oauth-popup') return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: {
      width: 500, height: 660, parent: win, show: !wantsGoogleChooser(acc.partition, url),
      webPreferences: { session: win.webContents.session, nodeIntegration: false, contextIsolation: true, sandbox: true },
    } }
  })
  win.webContents.on('did-create-window', (child, { url }) => {
    if (wantsGoogleChooser(acc.partition, url)) void prepareGooglePopup(child, url, win)
  })
  loginWindows.set(acc.partition, win)
  win.on('closed', () => loginWindows.delete(acc.partition))
  void win.loadURL(SOCIAL_LOGIN[platform] ?? SOCIAL_HOME[platform])
  return { ok: true, account: acc }
}
