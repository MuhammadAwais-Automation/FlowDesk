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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rememberedView } from './sessions'
import { getSavedLinkedInAccounts, saveLinkedInAccounts } from './linkedin/linkedin'

export const SOCIAL_PLATFORMS = ['whatsapp', 'tiktok', 'linkedin', 'reddit', 'facebook'] as const
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number]

export interface SocialAccount { platform: SocialPlatform; id: string; label: string; partition: string }

export const SOCIAL_HOME: Record<SocialPlatform, string> = {
  whatsapp: 'https://web.whatsapp.com',
  tiktok: 'https://www.tiktok.com',
  linkedin: 'https://www.linkedin.com/feed/',
  reddit: 'https://www.reddit.com',
  facebook: 'https://www.facebook.com',
}

// What each platform had before this list existed.
const DEFAULT_IDS: Record<SocialPlatform, string[]> = {
  whatsapp: ['1'], tiktok: ['1', '2', '3'], linkedin: ['1', '2'], reddit: ['1'], facebook: ['1'],
}

type Stored = Partial<Record<SocialPlatform, { id: string; label: string }[]>>
const file = () => join(app.getPath('userData'), 'social-accounts.json')

function readStored(): Stored {
  try { return existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) as Stored : {} } catch { return {} }
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
  const rows = stored && stored.length ? stored : DEFAULT_IDS[platform].map(id => ({ id, label: `Account ${id}` }))
  return rows.map(r => ({ platform, id: r.id, label: r.label, partition: socialPartition(platform, r.id) }))
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

/** A new numbered account slot; the user then signs in with openSocialLogin. */
export function addSocialAccount(platform: SocialPlatform, label?: string): SocialAccount {
  const all = listSocialAccounts(platform)
  const next = String(Math.max(0, ...all.map(a => Number(a.id) || 0)) + 1)
  const name = (label ?? '').trim() || `Account ${next}`
  if (platform === 'linkedin') {
    saveLinkedInAccounts([...getSavedLinkedInAccounts(), { id: next, label: name, partition: socialPartition(platform, next) }])
  } else {
    const stored = readStored()
    stored[platform] = [...all.map(a => ({ id: a.id, label: a.label })), { id: next, label: name }]
    writeFileSync(file(), JSON.stringify(stored, null, 2), 'utf8')
  }
  return { platform, id: next, label: name, partition: socialPartition(platform, next) }
}

// The session cookie each site sets once signed in. Read straight from the
// partition, so no page has to be opened; an account whose view was never
// opened used to read as "not signed in". WhatsApp keeps its session in
// IndexedDB, so it reads as null (unknown) rather than a guessed false.
const AUTH_COOKIE: Partial<Record<SocialPlatform, { url: string; name: string }>> = {
  tiktok: { url: 'https://www.tiktok.com', name: 'sessionid' },
  linkedin: { url: 'https://www.linkedin.com', name: 'li_at' },
  reddit: { url: 'https://www.reddit.com', name: 'reddit_session' },
  facebook: { url: 'https://www.facebook.com', name: 'c_user' },
}

export async function isSignedIn(acc: SocialAccount): Promise<boolean | null> {
  const c = AUTH_COOKIE[acc.platform]
  if (!c) return null
  const found = await session.fromPartition(`persist:${acc.partition}`).cookies.get({ url: c.url, name: c.name }).catch(() => null)
  return found === null ? null : found.length > 0
}

/** Every account of one platform (or all), with whether it is signed in. */
export async function socialAccountsStatus(platform?: SocialPlatform) {
  const platforms = platform ? [platform] : [...SOCIAL_PLATFORMS]
  const out: (SocialAccount & { signedIn: boolean | null })[] = []
  for (const p of platforms) for (const a of listSocialAccounts(p)) out.push({ ...a, signedIn: await isSignedIn(a) })
  return { ok: true, accounts: out }
}

/** A visible window on the account's own partition, for the user to sign in once. */
export function openSocialLogin(platform: SocialPlatform, ref?: string | number | null): { ok: boolean; account?: SocialAccount; error?: string } {
  const acc = resolveSocialAccount(platform, ref)
  if (!acc) return { ok: false, error: `unknown ${platform} account "${ref}" — list them with social_accounts` }
  const win = new BrowserWindow({
    width: 1100, height: 850, title: `${platform} sign-in — ${acc.label}`,
    webPreferences: { session: session.fromPartition(`persist:${acc.partition}`), nodeIntegration: false, contextIsolation: true },
  })
  void win.loadURL(SOCIAL_HOME[platform])
  return { ok: true, account: acc }
}
