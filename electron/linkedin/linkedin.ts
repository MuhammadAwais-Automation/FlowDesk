/**
 * Main-process access to the LinkedIn messaging bridge.
 *
 * Shared by the IPC handlers and the Agent tool layer for the same reason
 * whatsapp.ts is: two callers building their own executeJavaScript strings
 * means two places to fix when the bridge changes, and one of them quietly
 * drifting out of step.
 *
 * Supports multiple isolated accounts (Account 1, Account 2, etc.) using
 * distinct persistent session partitions ('social-linkedin', 'social-linkedin-2', etc.)
 * with zero cross-session storage leakage and spoof-free Chrome UA.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app, type WebContents } from 'electron'
import { getActiveView, getViewById, ensureBackgroundView, showView } from '../sessions'
import {
  statusScript,
  listChatsScript,
  listMessagesScript,
  unreadScript,
  findPeopleScript,
  sendScript,
  markReadScript,
  linkedinApiFeedScript,
  linkedinOutlierScript,
  type OutlierOptions,
} from './linkedinBridge'
import {
  feedScript,
  myPostsScript,
  notificationsScript,
  postCommentsScript,
  searchScript,
} from './linkedinReadBridge'
import { linkedInWatchStatus } from './linkedinRealtimeWatch'

export interface LinkedInResult {
  ok: boolean
  error?: string
  account?: string
  accountId?: string
  [key: string]: unknown
}

export interface LinkedInAccountConfig {
  id: string
  label: string
  partition: string
  publicId?: string | null
  name?: string | null
  headline?: string | null
}

export interface LinkedInAccountInfo extends LinkedInAccountConfig {
  authenticated: boolean
  active: boolean
  currentUrl: string
}

const DEFAULT_LINKEDIN_ACCOUNTS: LinkedInAccountConfig[] = [
  { id: '1', label: 'Account 1 (Primary)', partition: 'social-linkedin' },
  { id: '2', label: 'Account 2', partition: 'social-linkedin-2' },
]

function accountsFile(): string {
  try {
    return join(app.getPath('userData'), 'social-linkedin-accounts.json')
  } catch {
    return join(homedir(), '.flowdesk', 'social-linkedin-accounts.json')
  }
}

export function getSavedLinkedInAccounts(): LinkedInAccountConfig[] {
  const file = accountsFile()
  try {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(data) && data.length > 0) {
        return data
      }
    }
  } catch {}
  return DEFAULT_LINKEDIN_ACCOUNTS
}

export function saveLinkedInAccounts(accounts: LinkedInAccountConfig[]): void {
  const file = accountsFile()
  try {
    const dir = join(file, '..')
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(accounts, null, 2), 'utf8')
  } catch (e) {
    console.error('[FlowDesk LinkedIn] Failed to save accounts:', e)
  }
}

let activeLinkedInAccountId = '1'

export function setActiveLinkedInAccount(account: string | number): void {
  const resolved = resolveLinkedInPartition(account)
  activeLinkedInAccountId = resolved.accountId
}

export function getActiveLinkedInAccount(): string {
  return activeLinkedInAccountId
}

export function resolveLinkedInPartition(account?: string | number): { tabId: string; partition: string; accountId: string } {
  const target = account !== undefined && account !== null && String(account).trim() !== '' && account !== 'active'
    ? String(account).trim()
    : activeLinkedInAccountId

  const accounts = getSavedLinkedInAccounts()
  const lower = target.toLowerCase()

  // 1. Exact ID match (e.g. "1", "2")
  const byId = accounts.find(a => a.id.toLowerCase() === lower)
  if (byId) {
    return { tabId: byId.partition, partition: byId.partition, accountId: byId.id }
  }

  // 2. Exact partition match (e.g. "social-linkedin", "social-linkedin-2")
  const byPart = accounts.find(a => a.partition.toLowerCase() === lower)
  if (byPart) {
    return { tabId: byPart.partition, partition: byPart.partition, accountId: byPart.id }
  }

  // 3. Label/name/publicId match (e.g. "Personal", "Sales", "Awais")
  const byLabel = accounts.find(a =>
    a.label.toLowerCase() === lower ||
    a.label.toLowerCase().includes(lower) ||
    (a.name && a.name.toLowerCase().includes(lower)) ||
    (a.publicId && a.publicId.toLowerCase() === lower)
  )
  if (byLabel) {
    return { tabId: byLabel.partition, partition: byLabel.partition, accountId: byLabel.id }
  }

  // 4. Default / standard fallback
  if (target === '1' || target === 'default' || target === 'social-linkedin') {
    return { tabId: 'social-linkedin', partition: 'social-linkedin', accountId: '1' }
  }
  if (target.startsWith('social-linkedin-')) {
    const cleanId = target.replace('social-linkedin-', '')
    return { tabId: target, partition: target, accountId: cleanId }
  }
  return { tabId: `social-linkedin-${target}`, partition: `social-linkedin-${target}`, accountId: target }
}

export async function getLinkedInView(account?: string | number): Promise<{ webContents: WebContents }> {
  const resolved = resolveLinkedInPartition(account)
  const { tabId, partition } = resolved

  // 1. Exact lookup by tabId — checks viewCache (visible UI) and backgroundWindows
  const existing = getViewById(tabId)
  if (existing && !existing.webContents.isDestroyed()) {
    return existing
  }

  // 2. Launch background view strictly bound to this exact partition
  const bg = await ensureBackgroundView(tabId, partition, 'https://www.linkedin.com/feed/')
  await new Promise(r => setTimeout(r, 3500))
  return bg
}

export async function call(script: string, timeoutMs = 15000, account?: string | number): Promise<LinkedInResult> {
  const resolved = resolveLinkedInPartition(account)
  let view: { webContents: WebContents }
  try {
    view = await getLinkedInView(account)
  } catch (e) {
    return {
      ok: false,
      error: `Could not launch LinkedIn background view (${resolved.tabId}): ${e instanceof Error ? e.message : String(e)}`,
      account: resolved.tabId,
      accountId: resolved.accountId,
    }
  }
  try {
    const execPromise = view.webContents.executeJavaScript(script)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`LinkedIn bridge execution timed out after ${timeoutMs}ms`)), timeoutMs),
    )
    const result = await Promise.race([execPromise, timeoutPromise])
    if (result && typeof result === 'object') {
      return { ...(result as LinkedInResult), account: resolved.tabId, accountId: resolved.accountId }
    }
    return { ok: false, error: `bridge returned a non-object: ${String(result)}`, account: resolved.tabId, accountId: resolved.accountId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: resolved.tabId, accountId: resolved.accountId }
  }
}

export function liStatus(account?: string | number): Promise<LinkedInResult> {
  return call(statusScript(), 15000, account)
}

export function liListChats(options: { limit?: number; cursor?: string; onlyUnread?: boolean; account?: string | number } = {}): Promise<LinkedInResult> {
  const { account, ...rest } = options
  return call(listChatsScript(rest), 15000, account)
}

export function liListMessages(conversationUrn: string, limit?: number, before?: number, account?: string | number): Promise<LinkedInResult> {
  return call(listMessagesScript({ conversationUrn, limit, before }), 15000, account)
}

export function liUnread(account?: string | number): Promise<LinkedInResult> {
  return call(unreadScript(), 15000, account)
}

/**
 * Finds someone you already have a conversation with, and returns the
 * conversationUrn that liSend needs. Does not search all of LinkedIn — see
 * findPeopleScript for why that is the right boundary here.
 */
export function liFindPeople(query: string, pages?: number, account?: string | number): Promise<LinkedInResult> {
  return call(findPeopleScript(query, pages), 15000, account)
}

/**
 * Sending is a user-approved action. This function does NOT ask — approval is
 * obtained in the tool layer, which is the only place that knows who is asking
 * and can show the recipient and text before anything is sent. Callers that
 * skip that step are the bug.
 */
export function liSend(conversationUrn: string, text: string, account?: string | number): Promise<LinkedInResult> {
  return call(sendScript(conversationUrn, text), 15000, account)
}

/**
 * Whether the realtime push channel is being watched right now. Answers the
 * question an empty event list cannot: nothing happened, or nothing was
 * listening?
 */
export function liWatchStatus(): LinkedInResult {
  const { error, ...watch } = linkedInWatchStatus()
  return { ok: true, ...watch, watcherError: error }
}

export function liMarkRead(account?: string | number): Promise<LinkedInResult> {
  return call(markReadScript(), 15000, account)
}

// ── Read surfaces beyond messaging ───────────────────────────────────

export function liFeed(limit?: number, start?: number, sortBy?: string, account?: string | number): Promise<LinkedInResult> {
  return call(feedScript({ limit, start, sortBy }), 15000, account)
}

export function liPostComments(activityId: string, limit?: number, account?: string | number): Promise<LinkedInResult> {
  return call(postCommentsScript({ activityId, limit }), 15000, account)
}

export function liSearch(query: string, resultType?: string, limit?: number, account?: string | number): Promise<LinkedInResult> {
  return call(searchScript({ query, resultType, limit }), 15000, account)
}

export function liMyPosts(limit?: number, start?: number, account?: string | number): Promise<LinkedInResult> {
  return call(myPostsScript({ limit, start }), 15000, account)
}

export function liNotifications(limit?: number, onlyUnread?: boolean, account?: string | number): Promise<LinkedInResult> {
  return call(notificationsScript({ limit, onlyUnread }), 15000, account)
}

// ── In-Session API & Outlier Engine ──────────────────────────────────

export function lkApiFeed(limit?: number, account?: string | number): Promise<LinkedInResult> {
  return call(linkedinApiFeedScript(limit), 15000, account)
}
export const liApiFeed = lkApiFeed

export function lkApiOutlier(options?: OutlierOptions, account?: string | number): Promise<LinkedInResult> {
  return call(linkedinOutlierScript(options), 20000, account)
}
export const liApiOutlier = lkApiOutlier

// ── Multi-Account Suite ─────────────────────────────────────────────

export async function liAccounts(): Promise<{
  ok: boolean
  activeAccount: string
  accounts: LinkedInAccountInfo[]
}> {
  const saved = getSavedLinkedInAccounts()
  const active = getActiveView()
  const results: LinkedInAccountInfo[] = []
  let updatedAccounts = false

  for (const acc of saved) {
    const { tabId, partition } = resolveLinkedInPartition(acc.id)
    const view = getViewById(tabId)
    let authenticated = false
    let name: string | null = acc.name || null
    let publicId: string | null = acc.publicId || null
    let headline: string | null = acc.headline || null
    let currentUrl = ''
    let isActive = Boolean(acc.id === activeLinkedInAccountId)

    if (view && !view.webContents.isDestroyed()) {
      currentUrl = view.webContents.getURL()
      if (active && active.webContents.id === view.webContents.id) {
        isActive = true
      }
      try {
        const st = await view.webContents.executeJavaScript(statusScript())
        if (st && typeof st === 'object' && st.ok) {
          authenticated = Boolean(st.signedIn)
          if (st.name) name = String(st.name)
          if (st.publicId) publicId = String(st.publicId)
          if (st.headline) headline = String(st.headline)

          if (name !== acc.name || publicId !== acc.publicId || headline !== acc.headline) {
            acc.name = name ?? undefined
            acc.publicId = publicId ?? undefined
            acc.headline = headline ?? undefined
            updatedAccounts = true
          }
        }
      } catch {}
    }

    results.push({
      id: acc.id,
      label: acc.label,
      partition,
      authenticated,
      name,
      publicId,
      headline,
      active: isActive,
      currentUrl,
    })
  }

  if (updatedAccounts) {
    saveLinkedInAccounts(saved)
  }

  return { ok: true, activeAccount: activeLinkedInAccountId, accounts: results }
}

let onLinkedInAccountSwitchedListener: ((accountId: string) => void) | null = null

export function setOnLinkedInAccountSwitchedListener(fn: (accountId: string) => void): void {
  onLinkedInAccountSwitchedListener = fn
}

export async function liSwitchAccount(account: string | number): Promise<LinkedInResult> {
  const resolved = resolveLinkedInPartition(account)
  setActiveLinkedInAccount(resolved.accountId)
  showView(resolved.tabId, resolved.partition, 'https://www.linkedin.com/feed/')
  if (onLinkedInAccountSwitchedListener) {
    try { onLinkedInAccountSwitchedListener(resolved.accountId) } catch {}
  }
  return {
    ok: true,
    account: resolved.tabId,
    accountId: resolved.accountId,
    message: `Switched active LinkedIn account to ${resolved.tabId} (${resolved.accountId})`,
  }
}

// ── Profile Suite ───────────────────────────────────────────────────

export {
  liGetProfile,
  liUpdateProfile,
  liUploadProfilePhoto,
  liUploadCoverImage,
  type LinkedInProfileData,
  type LinkedInProfileUpdate,
  type LinkedInProfileResult,
  type LinkedInExperienceItem,
  type LinkedInEducationItem,
} from './linkedinProfile'
