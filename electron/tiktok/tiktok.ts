/**
 * Main-process access to the TikTok bridge.
 *
 * Interacts with the live TikTok session partition via WebContents execution.
 * Supports trending feed discovery, search, competitive SEO analysis, and
 * video performance inspection without requiring login.
 */

import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { clipboard, type WebContents } from 'electron'
import { ensureBackgroundView, getActiveView, getViewById, showView } from '../sessions'
import { whileAwake } from '../keepAwake'
import { isSignedIn, listSocialAccounts, resolveSocialAccount, type SocialAccount } from '../socialAccounts'
import {
  tiktokStatusScript,
  tiktokFeedScript,
  tiktokSearchScript,
  tiktokVideoDetailScript,
  tiktokSuggestScript,
  tiktokOutlierScript,
  tiktokApiSearchScript,
  tiktokApiCreatorFeedScript,
  tiktokApiOutlierScript,
  tiktokApiVideoDetailScript,
  tiktokApiBatchOutliersScript,
  tiktokWarmupScrollScript,
} from './tiktokBridge'

export interface TikTokResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

let activeTikTokAccountId = '1'

export function setActiveTikTokAccount(account: string | number): void {
  const str = String(account || '1').trim()
  activeTikTokAccountId = str.replace(/^social-tiktok-?/, '') || '1'
}

export function getActiveTikTokAccount(): string {
  return activeTikTokAccountId
}

/**
 * The registry account a call means (electron/socialAccounts.ts): by id ("2"),
 * partition ("social-tiktok-2") or label. No account / "active" = the active one,
 * "default" = account 1. An explicit unknown ref is null — never a new partition
 * and never another account, so a write cannot land on the wrong one.
 */
export function resolveTikTokAccount(account?: string | number | null): SocialAccount | null {
  const raw = account === undefined || account === null ? '' : String(account).trim()
  const ref = raw === '' || raw === 'active' ? activeTikTokAccountId : raw === 'default' ? '1' : raw
  return resolveSocialAccount('tiktok', ref)
}

export function resolveTikTokPartition(account?: string | number | null): { tabId: string; partition: string } | null {
  const acc = resolveTikTokAccount(account)
  return acc ? { tabId: acc.partition, partition: acc.partition } : null
}

/** `{ok:false}` for an account the registry does not know, else null. Checked before any page action. */
export function unknownTikTokAccount(account?: string | number | null): TikTokResult | null {
  if (resolveTikTokAccount(account)) return null
  const raw = account === undefined || account === null || String(account).trim() === '' || account === 'active' ? activeTikTokAccountId : account
  return { ok: false, error: `unknown tiktok account "${raw}" — list them with tiktok_accounts` }
}

export async function getTikTokView(account?: string | number): Promise<{ webContents: WebContents }> {
  // Explicit account if given, otherwise strictly the active TikTok account
  const resolved = resolveTikTokPartition(account)
  if (!resolved) throw new Error(unknownTikTokAccount(account)?.error ?? 'unknown tiktok account')
  const { tabId, partition } = resolved

  // 1. Exact lookup by tabId — checks viewCache (visible UI) and backgroundWindows
  const existing = getViewById(tabId)
  if (existing && !existing.webContents.isDestroyed()) {
    return existing
  }

  // 2. Launch background view strictly bound to this exact partition
  const bg = await ensureBackgroundView(tabId, partition, 'https://www.tiktok.com/explore')
  await new Promise(r => setTimeout(r, 3500))
  return bg
}

/**
 * Views holding a video in the Studio upload form, until tiktok_submit_post or
 * HOLD_MS. Background work (radar, profile reads) used to navigate the same
 * view to /explore seconds after the upload, losing the video and its caption.
 */
const uploadHolds = new Map<number, number>()
const HOLD_MS = 20 * 60_000
export const UPLOAD_BUSY = 'this TikTok account has a video waiting in the Studio upload form: call tiktok_submit_post (or tiktok_upload_video again) before using the account for anything else'

function holdsUpload(webContents: WebContents): boolean {
  const until = uploadHolds.get(webContents.id)
  if (until && until > Date.now()) return true
  uploadHolds.delete(webContents.id)
  return false
}

async function navigateAndWait(webContents: WebContents, url: string, minWaitMs = 1000, maxWaitMs = 4000): Promise<void> {
  const currentUrl = webContents.getURL()
  if (currentUrl === url) return
  if (holdsUpload(webContents)) throw new Error(UPLOAD_BUSY)

  void webContents.loadURL(url).catch(() => {})
  await new Promise<void>(resolve => {
    let settled = false
    const finish = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    const timer = setTimeout(finish, maxWaitMs)
    if (!webContents.isLoading()) {
      setTimeout(() => {
        clearTimeout(timer)
        finish()
      }, minWaitMs)
    } else {
      webContents.once('did-finish-load', () => {
        setTimeout(() => {
          clearTimeout(timer)
          finish()
        }, minWaitMs)
      })
    }
  })
}

/**
 * TikTok's patched window.fetch adds X-Bogus/X-Gnarly/msToken to /api/search
 * calls only while the page itself is a /search page. From a profile or the
 * explore page the same fetch goes out unsigned and TikTok answers 200 with an
 * empty body (probes tkr-01/02: 0 bytes vs 112KB). So the in-session API
 * tools first make sure the view is sitting on a search page.
 */
async function ensureSigningContext(webContents: WebContents): Promise<void> {
  if (/tiktok\.com\/search/.test(webContents.getURL())) return
  await webContents.loadURL('https://www.tiktok.com/search?q=trending')
  await new Promise(r => setTimeout(r, 2500)) // signing SDK loads after did-finish-load
}

async function callScript(script: string, timeoutMs = 15000, account?: string | number, signed = false): Promise<TikTokResult> {
  try {
    const view = await getTikTokView(account)
    if (signed) await ensureSigningContext(view.webContents)
    const execPromise = view.webContents.executeJavaScript(script)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TikTok bridge execution timed out after ${timeoutMs}ms`)), timeoutMs),
    )
    const result = await Promise.race([execPromise, timeoutPromise])
    // Say which account answered, unless the script already set the field.
    const label = resolveTikTokPartition(account)?.tabId
    if (result && typeof result === 'object') return { account: label, ...result as TikTokResult }
    return { ok: false, error: `bridge returned a non-object: ${String(result)}`, account: label }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function tkStatus(account?: string | number): Promise<TikTokResult> {
  const bad = unknownTikTokAccount(account)
  if (bad) return bad
  const result = await callScript(tiktokStatusScript(), 15000, account)
  return {
    ...result,
    account: resolveTikTokPartition(account)?.tabId,
  }
}

export async function tkFeed(limit = 20, account?: string | number): Promise<TikTokResult> {
  const bad = unknownTikTokAccount(account)
  if (bad) return bad
  const view = await getTikTokView(account)
  const currentUrl = view.webContents.getURL()

  // The feed script reads the /explore grid; /foryou has no grid to read.
  if (!currentUrl.includes('tiktok.com/explore')) {
    await navigateAndWait(view.webContents, 'https://www.tiktok.com/explore', 3000, 8000)
  }

  return callScript(tiktokFeedScript(limit), 15000, account)
}

export async function tkSearch(query: string, limit = 20, account?: string | number): Promise<TikTokResult> {
  const bad = unknownTikTokAccount(account)
  if (bad) return bad
  const view = await getTikTokView(account)
  const targetUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`
  await navigateAndWait(view.webContents, targetUrl)
  return callScript(tiktokSearchScript(query, limit), 15000, account)
}

export async function tkVideoDetail(url: string, account?: string | number): Promise<TikTokResult> {
  const bad = unknownTikTokAccount(account)
  if (bad) return bad
  const view = await getTikTokView(account)
  await navigateAndWait(view.webContents, url, 2500, 8000)
  const dom = await callScript(tiktokVideoDetailScript(), 15000, account)
  if (dom.ok) return dom
  // The page script fails while the video page is still loading or redirecting
  // (seen live 2026-10-05); the in-session JSON read does not depend on the DOM.
  const id = url.match(/\/video\/(\d+)/)?.[1] ?? url
  const api = await tkApiVideoDetail(id, account)
  return api.ok ? { ...api, via: 'api_fallback' } : dom
}

export async function tkSuggest(seedKeyword: string, account?: string | number): Promise<TikTokResult> {
  const seedClean = seedKeyword.trim()
  if (!seedClean) return { ok: false, error: 'Seed keyword cannot be empty' }
  const bad = unknownTikTokAccount(account)
  if (bad) return bad

  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(seedClean + ' tiktok')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    })
    if (res.ok) {
      const data = await res.json()
      const rawList = Array.isArray(data?.[1]) ? (data[1] as string[]) : []
      const keywords = rawList.map(s => s.replace(/\s*tiktok\s*/gi, '').trim()).filter(Boolean)
      const hashtags = keywords.slice(0, 10).map((k, idx) => ({
        tag: '#' + k.replace(/\s+/g, ''),
        occurrences: 10 - idx,
      }))

      return {
        ok: true,
        mode: 'api_fast',
        seed: seedClean,
        topHashtags: hashtags,
        recommendedKeywords: keywords.slice(0, 8),
        sampleCaptions: keywords.slice(0, 5).map(k => `${k} #viral #trend`),
      }
    }
  } catch {}

  // Fallback to in-session DOM if network fails
  const view = await getTikTokView(account)
  const targetUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(seedClean)}`
  await navigateAndWait(view.webContents, targetUrl)
  return callScript(tiktokSuggestScript(seedClean), 15000, account)
}

export async function tkOutlier(creatorOrQuery: string, account?: string | number): Promise<TikTokResult> {
  const bad = unknownTikTokAccount(account)
  if (bad) return bad
  const view = await getTikTokView(account)
  const cleanTarget = creatorOrQuery.replace(/^@/, '').trim()
  const targetUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(cleanTarget)}`
  await navigateAndWait(view.webContents, targetUrl)
  return callScript(tiktokOutlierScript(cleanTarget), 15000, account)
}

// -------------------------------------------------------------
// Fast Background In-Session API Operations (Zero UI Page Loads)
// -------------------------------------------------------------

export async function tkApiSearch(query: string, limit = 20, offset = 0, account?: string | number): Promise<TikTokResult> {
  return callScript(tiktokApiSearchScript(query, limit, offset), 15000, account, true)
}

export async function tkApiCreatorFeed(creatorHandle: string, limit = 30, account?: string | number): Promise<TikTokResult> {
  return callScript(tiktokApiCreatorFeedScript(creatorHandle, limit), 20000, account, true)
}

export async function tkApiOutlier(creatorHandle: string, minMultiplier = 3.0, account?: string | number): Promise<TikTokResult> {
  return callScript(tiktokApiOutlierScript(creatorHandle, minMultiplier), 20000, account, true)
}

export async function tkApiVideoDetail(urlOrId: string, account?: string | number): Promise<TikTokResult> {
  return callScript(tiktokApiVideoDetailScript(urlOrId), 15000, account)
}

export async function tkApiBatchOutliers(creators: string[], minMultiplier = 2.5, account?: string | number): Promise<TikTokResult> {
  return callScript(tiktokApiBatchOutliersScript(creators, minMultiplier), 35000, account, true)
}

export async function tkEval(script: string, account?: string | number): Promise<TikTokResult> {
  return callScript(script, 15000, account)
}

/** Caption each account's Studio form should carry, from tiktok_upload_video. */
const pendingCaptions = new Map<string, string>()

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Studio may append its own hashtags or spacing; the given caption must lead. */
export function captionMatches(shown: string, want: string): boolean {
  const w = squash(want)
  return !w || squash(shown).startsWith(w)
}

async function readStudioCaption(wc: Electron.WebContents): Promise<string> {
  return String(await wc.executeJavaScript(`(() => {
    const editor = document.querySelector('.notranslate.public-DraftEditor-content[contenteditable="true"], [contenteditable="true"]')
    return editor ? editor.innerText : ''
  })()`) ?? '')
}

type UploadOptions = {
  videoFilePath: string
  caption: string
  scheduleTime?: string | number
  allowComment?: boolean
  allowDuet?: boolean
  account?: string | number
}

/** The Studio page is kept awake while the video goes in, whatever FlowDesk section is open. */
export async function tkUploadVideo(options: UploadOptions): Promise<TikTokResult> {
  const scheduled = options.scheduleTime !== undefined && options.scheduleTime !== null && options.scheduleTime !== ''
  if (scheduled || !resolveTikTokPartition(options.account)) return uploadInStudio(options)
  const wc = (await getTikTokView(options.account)).webContents
  return whileAwake(wc, () => uploadInStudio(options))
}

async function uploadInStudio(options: UploadOptions): Promise<TikTokResult> {
  const filePath = String(options.videoFilePath ?? '').trim()
  if (!filePath) return { ok: false, error: 'refusing to upload without a video file path' }
  const resolved = resolveTikTokPartition(options.account)
  if (!resolved) return unknownTikTokAccount(options.account) as TikTokResult
  // A schedule is done in the Studio form itself (date, time, Schedule, the
  // Allow popup) and confirmed by TikTok's own answer; see tiktokSchedule.ts.
  if (options.scheduleTime !== undefined && options.scheduleTime !== null && options.scheduleTime !== '') {
    const { tkScheduleVideo } = await import('./tiktokSchedule')
    return tkScheduleVideo({ filePath, caption: options.caption, scheduleAt: options.scheduleTime, account: options.account })
  }

  try {
    await stat(filePath)
  } catch (e) {
    return { ok: false, error: `could not read video file ${filePath}: ${e instanceof Error ? e.message : String(e)}` }
  }

  const fileName = basename(filePath)
  const view = await getTikTokView(options.account)
  // A new upload replaces whatever waited in the form before.
  uploadHolds.delete(view.webContents.id)

  const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload'
  const onUpload = view.webContents.getURL().includes('/tiktokstudio/upload')
  const formEmpty = onUpload && await view.webContents.executeJavaScript(`Boolean(document.querySelector('input[type="file"]'))`).catch(() => false)
  if (!onUpload) {
    await navigateAndWait(view.webContents, UPLOAD_URL)
  } else if (!formEmpty) {
    // An earlier video still fills the form (no file picker): start a fresh one.
    // Studio's "Leave site?" (beforeunload) would block the reload; accept it.
    view.webContents.once('will-prevent-unload', e => e.preventDefault())
    void view.webContents.loadURL(UPLOAD_URL).catch(() => {})
    await new Promise(r => setTimeout(r, 2500))
  }
  // Held from here on, so background work cannot leave the page meanwhile.
  uploadHolds.set(view.webContents.id, Date.now() + HOLD_MS)

  // 1. The file input mounts after the Studio app boots, often after
  // did-finish-load; injecting before it existed sent the call down a script
  // fallback that threw "Script failed to execute" (report 2026-10-12).
  const inputDeadline = Date.now() + 30_000
  let hasInput = false
  let reloads = 0
  while (Date.now() < inputDeadline) {
    // A navigation that slipped in before the hold took the page away.
    if (!view.webContents.getURL().includes('/tiktokstudio/upload') && reloads < 2) {
      reloads++
      void view.webContents.loadURL(UPLOAD_URL).catch(() => {})
      await new Promise(r => setTimeout(r, 2500))
    }
    hasInput = await view.webContents.executeJavaScript(`Boolean(document.querySelector('input[type="file"]'))`).catch(() => false)
    if (hasInput) break
    await new Promise(r => setTimeout(r, 500))
  }
  if (!hasInput) uploadHolds.delete(view.webContents.id)
  if (!hasInput) return { ok: false, account: resolved.tabId, error: 'the TikTok Studio upload page showed no file picker within 25 s (signed out, or Studio is down?)' }

  try {
    const wasAttached = view.webContents.debugger.isAttached()
    if (!wasAttached) view.webContents.debugger.attach('1.3')
    await view.webContents.debugger.sendCommand('DOM.enable')
    const doc = (await view.webContents.debugger.sendCommand('DOM.getDocument')) as { root: { nodeId: number } }
    const node = (await view.webContents.debugger.sendCommand('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]',
    })) as { nodeId: number }
    if (!node?.nodeId) { uploadHolds.delete(view.webContents.id); return { ok: false, account: resolved.tabId, error: 'the Studio file picker disappeared before the video could be added' } }
    await view.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId: node.nodeId })
    if (!wasAttached) {
      try { view.webContents.debugger.detach() } catch {}
    }
  } catch (e) {
    uploadHolds.delete(view.webContents.id)
    return { ok: false, account: resolved.tabId, error: 'could not hand the video to the Studio file picker: ' + (e instanceof Error ? e.message : String(e)) }
  }
  uploadHolds.set(view.webContents.id, Date.now() + HOLD_MS)

  // 2. Wait up to 15s for the Draft.js editor to mount
  let editorReady = false
  const waitMountStart = Date.now()
  while (Date.now() - waitMountStart < 15000) {
    const check = await view.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('.notranslate.public-DraftEditor-content[contenteditable="true"], [contenteditable="true"]')
      if (editor) {
        editor.focus()
        return true
      }
      return false
    })()`)
    if (check) {
      editorReady = true
      break
    }
    await new Promise(r => setTimeout(r, 500))
  }

  // 3. Wait for the upload first: Studio fills the caption with the file name
  // when the upload finishes, overwriting anything typed before (report 2026-10-12).
  const pollStart = Date.now()
  let postReady = false
  while (Date.now() - pollStart < 90000) {
    const uploadStatus = await view.webContents.executeJavaScript(`(() => {
      const postBtn = document.querySelector('button[data-e2e="post_video_button"]')
      const body = document.body ? document.body.innerText : ''
      const isUploaded = body.includes('Uploaded（') || body.includes('Uploaded(') || body.includes('100%')
      const isReady = Boolean(postBtn && !postBtn.disabled && postBtn.getAttribute('aria-disabled') !== 'true')
      return { isUploaded, isReady }
    })()`)

    if (uploadStatus.isReady || uploadStatus.isUploaded) {
      postReady = true
      break
    }
    await new Promise(r => setTimeout(r, 1500))
  }
  if (postReady) await new Promise(r => setTimeout(r, 1500))

  // 4. Set caption safely via CDP Input.insertText (works in background without OS focus)
  const typeCaption = async (text: string) => {
    let typedViaCdp = false
    try {
      const wasAttached = view.webContents.debugger.isAttached()
      if (!wasAttached) view.webContents.debugger.attach('1.3')
      await view.webContents.executeJavaScript(`(() => {
        const editor = document.querySelector('.notranslate.public-DraftEditor-content[contenteditable="true"], [contenteditable="true"]')
        if (editor) {
          editor.focus()
          const sel = window.getSelection()
          const range = document.createRange()
          range.selectNodeContents(editor)
          sel.removeAllRanges()
          sel.addRange(range)
        }
      })()`)
      // Studio prefills the file name; a DOM selection alone did not replace it
      // (caption came out "<file name><caption>"), so clear with the keyboard.
      const key = (type: string, k: string, code: string, vk: number, modifiers = 0) =>
        view.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers })
      await key('rawKeyDown', 'a', 'KeyA', 65, 2)
      await key('keyUp', 'a', 'KeyA', 65, 2)
      await key('rawKeyDown', 'Backspace', 'Backspace', 8)
      await key('keyUp', 'Backspace', 'Backspace', 8)
      await new Promise(r => setTimeout(r, 200))
      await view.webContents.debugger.sendCommand('Input.insertText', { text })
      typedViaCdp = true
      if (!wasAttached) {
        try { view.webContents.debugger.detach() } catch {}
      }
    } catch (err) {
      console.warn('[FlowDesk TikTok] CDP Input.insertText failed during upload caption, falling back to clipboard:', err)
    }

    if (!typedViaCdp) {
      try {
        view.webContents.selectAll()
        clipboard.writeText(text)
        view.webContents.paste()
        await new Promise(r => setTimeout(r, 600))
      } catch {
        // Best-effort native clipboard paste
      }
    }
  }

  // 5. Type, then read it back; Studio sometimes writes the file name in
  // after the caption was typed, so retry. tiktok_submit_post refuses while it differs.
  const caption = String(options.caption ?? '').trim()
  pendingCaptions.set(resolved.tabId, caption)
  let shown = await readStudioCaption(view.webContents)
  for (let attempt = 0; editorReady && caption && !captionMatches(shown, caption) && attempt < 3; attempt++) {
    await typeCaption(options.caption)
    await new Promise(r => setTimeout(r, 1500))
    shown = await readStudioCaption(view.webContents)
  }
  if (caption && !captionMatches(shown, caption)) {
    uploadHolds.delete(view.webContents.id)
    return {
      ok: false,
      account: resolved.tabId,
      error: 'video is in the Studio form but the caption did not stick (Studio shows: ' + JSON.stringify(shown.slice(0, 80)) + '). Do not call tiktok_submit_post; run tiktok_upload_video again.',
      status: 'CAPTION_NOT_SET',
    }
  }

  return {
    ok: true,
    uploaded: true,
    account: resolved.tabId,
    fileName,
    caption: options.caption,
    scheduleTime: options.scheduleTime,
    postButtonReady: postReady,
    status: postReady ? 'READY_TO_POST' : 'UPLOADING',
  }
}

/** Releases the account's Studio form; `discard` also reloads the page, dropping the form unposted. */
export function finishUpload(wc: WebContents, tabId: string, discard = false): void {
  uploadHolds.delete(wc.id)
  pendingCaptions.delete(tabId)
  if (discard) {
    wc.once('will-prevent-unload', e => e.preventDefault())
    void wc.loadURL('https://www.tiktok.com/tiktokstudio/upload').catch(() => {})
  }
}

export async function tkSubmitPost(account?: string | number): Promise<TikTokResult> {
  if (!resolveTikTokPartition(account)) return unknownTikTokAccount(account) as TikTokResult
  const wc = (await getTikTokView(account)).webContents
  return whileAwake(wc, () => submitInStudio(account))
}

async function submitInStudio(account?: string | number): Promise<TikTokResult> {
  const resolved = resolveTikTokPartition(account)
  if (!resolved) return unknownTikTokAccount(account) as TikTokResult
  const view = await getTikTokView(account)

  // Never post a video whose caption Studio replaced (e.g. with the file name).
  const want = pendingCaptions.get(resolved.tabId)
  if (want) {
    const shown = await readStudioCaption(view.webContents)
    if (!captionMatches(shown, want)) {
      return { ok: false, account: resolved.tabId, error: 'not posted: the Studio caption is ' + JSON.stringify(shown.slice(0, 80)) + ', not the caption given to tiktok_upload_video. Run tiktok_upload_video again.' }
    }
  }

  // 1. Locate Post button and calculate coordinates
  const btnInfo = await view.webContents.executeJavaScript(`(() => {
    const postBtn = document.querySelector('button[data-e2e="post_video_button"]')
    if (!postBtn) return { ok: false, error: 'Post button not found' }
    if (postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true') {
      return { ok: false, error: 'Post button is disabled (video may still be uploading or processing)' }
    }
    postBtn.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = postBtn.getBoundingClientRect()
    return {
      ok: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      btnText: postBtn.innerText || 'Post',
    }
  })()`)

  if (!btnInfo || !btnInfo.ok) {
    return btnInfo || { ok: false, error: 'Failed to inspect Post button' }
  }

  // 2. Dispatch native OS-level mouse clicks (isTrusted: true)
  view.webContents.focus()
  view.webContents.sendInputEvent({ type: 'mouseMove', x: btnInfo.x, y: btnInfo.y })
  await new Promise(r => setTimeout(r, 100))
  view.webContents.sendInputEvent({ type: 'mouseDown', x: btnInfo.x, y: btnInfo.y, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 80))
  view.webContents.sendInputEvent({ type: 'mouseUp', x: btnInfo.x, y: btnInfo.y, button: 'left', clickCount: 1 })

  // 3. Fallback click invocation
  await view.webContents.executeJavaScript(`(() => {
    const postBtn = document.querySelector('button[data-e2e="post_video_button"]')
    if (postBtn) postBtn.click()
  })()`)

  // 4. Poll for success navigation or modal confirmations
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const res = await view.webContents.executeJavaScript(`(() => {
      const url = window.location.href
      const body = document.body ? document.body.innerText : ''
      const isContent = url.includes('/tiktokstudio/content')
      const isSuccess = body.includes('Uploaded successfully') ||
        body.includes('Your video has been uploaded') ||
        body.includes('Your video has been scheduled') ||
        body.includes('Scheduled successfully') ||
        body.includes('scheduled successfully') ||
        body.includes('Manage your posts')

      // Dismiss any secondary modal e.g. "Schedule" / "Post now" / "Got it"
      const modalButtons = Array.from(document.querySelectorAll('[role="dialog"] button, .tux-modal button, [class*="modal"] button'))
      const confirmBtn = modalButtons.find(b => {
        const t = b.innerText.toLowerCase()
        return t.includes('post now') || t.includes('schedule') || t.includes('post anyway') || t.includes('got it') || t.includes('continue')
      })
      if (confirmBtn) {
        confirmBtn.click()
      }

      return { url, isContent, isSuccess }
    })()`)

    if (res.isContent || res.isSuccess) {
      pendingCaptions.delete(resolved.tabId)
      uploadHolds.delete(view.webContents.id)
      return { ok: true, submitted: true, account: resolved.tabId, message: 'Video submitted to TikTok Studio successfully', url: res.url }
    }
  }

  // No navigation to /tiktokstudio/content and no success banner: the server never confirmed the post.
  return { ok: false, submitted: false, account: resolved.tabId, error: 'Post click dispatched but TikTok Studio never confirmed the upload (no redirect to content page or success message)' }
}

export async function tkAccounts(): Promise<{
  ok: boolean
  accounts: Array<{
    id: string
    label: string
    partition: string
    authenticated: boolean
    username: string | null
    active: boolean
    /** The account a tool call without `account` goes to. */
    selected: boolean
    currentUrl: string
  }>
}> {
  const active = getActiveView()
  // The shared list (electron/socialAccounts.ts), not a fixed ['1','2','3'].
  const registry = listSocialAccounts('tiktok')
  const accountIds = registry.map(a => a.id)
  const results: Array<{
    id: string
    label: string
    partition: string
    authenticated: boolean
    username: string | null
    active: boolean
    selected: boolean
    currentUrl: string
  }> = []

  for (const id of accountIds) {
    const partition = registry.find(a => a.id === id)?.partition ?? (id === '1' ? 'social-tiktok' : `social-tiktok-${id}`)
    const view = getViewById(partition)
    let authenticated = false
    let username: string | null = null
    let currentUrl = ''
    let isActive = false

    if (view && !view.webContents.isDestroyed()) {
      currentUrl = view.webContents.getURL()
      isActive = Boolean(active && active.webContents.id === view.webContents.id)
      try {
        const status = await view.webContents.executeJavaScript(tiktokStatusScript())
        if (status && typeof status === 'object') {
          authenticated = Boolean(status.authenticated)
          username = status.username || null
        }
      } catch {}
    } else {
      // Never opened this run: the session cookie still tells whether it is signed in
      // (it used to read as false, so a signed-in account 2 looked signed out).
      authenticated = (await isSignedIn({ platform: 'tiktok', id, label: '', partition })) === true
    }

    const base = registry.find(a => a.id === id)?.label ?? `Account ${id}`
    results.push({
      id,
      label: username ? `${base} (@${username})` : base,
      partition,
      authenticated,
      username,
      active: isActive,
      selected: id === activeTikTokAccountId,
      currentUrl,
    })
  }

  return { ok: true, accounts: results }
}

let onAccountSwitchedListener: ((accountId: string) => void) | null = null

export function setOnAccountSwitchedListener(fn: (accountId: string) => void): void {
  onAccountSwitchedListener = fn
}

export async function tkSwitchAccount(account: string | number): Promise<TikTokResult> {
  // Unknown account: refuse before touching the visible view or the active id.
  const acc = resolveTikTokAccount(account === 'active' ? '' : account)
  if (!acc) return unknownTikTokAccount(account) as TikTokResult
  const tabId = acc.partition
  setActiveTikTokAccount(acc.id)
  showView(tabId, acc.partition, 'https://www.tiktok.com')
  const cleanId = acc.id
  if (onAccountSwitchedListener) {
    try { onAccountSwitchedListener(cleanId) } catch {}
  }
  return { ok: true, account: tabId, message: `Switched active TikTok account to ${tabId}` }
}

/**
 * Lists the signed-in account's own posts over TikTok Studio's content API
 * (POST /tiktok/creator/manage/item_list/v1/). Like search, the page's own
 * fetch only signs it (X-Bogus/X-Gnarly) while the view is on a Studio page,
 * so the view is parked there first. Replaces a profile-page DOM scrape that
 * had started returning 0 posts for an account with 10.
 */
export async function tkListPosts(account?: string | number): Promise<TikTokResult> {
  const resolved = resolveTikTokPartition(account)
  if (!resolved) return unknownTikTokAccount(account) as TikTokResult
  try {
    const view = await getTikTokView(account)
    if (!/tiktok\.com\/tiktokstudio/.test(view.webContents.getURL())) {
      if (holdsUpload(view.webContents)) return { ok: false, error: UPLOAD_BUSY, account: resolved.tabId }
      await view.webContents.loadURL('https://www.tiktok.com/tiktokstudio/content')
      await new Promise(r => setTimeout(r, 2500)) // signing SDK loads after did-finish-load
    }
    const result = await view.webContents.executeJavaScript(tiktokStudioItemsScript()) as TikTokResult
    return { ...result, account: resolved.tabId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: resolved.tabId }
  }
}

export function tiktokStudioItemsScript(): string {
  return `(async function () {
    try {
      var posts = []
      var cursor = 0
      for (var page = 0; page < 10; page++) {
        var r = await fetch('/tiktok/creator/manage/item_list/v1/?aid=1988&app_name=tiktok_creator_center&device_platform=web', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ cursor: cursor, size: 50, query: { sort_orders: [{ field_name: 'post_time', order: 2 }], conditions: [], is_recent_posts: false } }),
        })
        var text = await r.text()
        if (!text) return { ok: false, error: 'empty response — the request went out unsigned (view not on a Studio page)' }
        var j = JSON.parse(text)
        if (j.status_code !== 0) return { ok: false, error: 'item_list status ' + j.status_code + ': ' + (j.status_msg || '') }
        ;(j.item_list || []).forEach(function (it) {
          // 140 was the only scheduled status seen until a post scheduled through
          // the Studio form came back as 141 (listed "Oct 23, 4:30 PM" in Studio);
          // a schedule_time still ahead is the surer sign.
          var at = Number(it.schedule_time) * 1000
          var isScheduled = it.status === 140 || it.status === 141 || (at > Date.now())
          posts.push({
            id: it.item_id,
            url: 'https://www.tiktok.com/video/' + it.item_id,
            caption: it.desc || '',
            createdAt: it.create_time ? new Date(Number(it.create_time) * 1000).toISOString() : null,
            scheduledAt: isScheduled && at > 0 ? new Date(at).toISOString() : null,
            isScheduled: isScheduled,
            status: it.status,
            // Studio's own code: 1 = Everyone. Anything else is restricted.
            visibility: it.visibility,
            inReview: Boolean(it.in_review),
            views: Number(it.play_count) || 0,
            likes: Number(it.like_count) || 0,
            comments: Number(it.comment_count) || 0,
            shares: Number(it.share_count) || 0,
            saves: Number(it.favorite_count) || 0,
            durationMs: it.duration || null,
          })
        })
        if (!j.has_more) break
        cursor = j.cursor
      }
      return { ok: true, via: 'api', count: posts.length, posts: posts }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })()`
}

/**
 * TikTok's own page request client (the module whose protected-path list
 * starts with /api/update/profile/). Writes such as /api/aweme/delete/ need
 * tt-ticket-guard headers — an ECDSA signature from keys the page holds — so
 * they go through the page's client, which adds them, rather than a bare fetch.
 * Found by source content, not module id, so a redeploy renumbering modules
 * does not break it.
 */
export const TIKTOK_CLIENT_FN = `
  function tiktokClient() {
    var req = null
    window.__LOADABLE_LOADED_CHUNKS__.push([[Symbol('fd')], {}, function (r) { req = r }])
    if (!req) return null
    var id = Object.keys(req.m).find(function (k) {
      try { var s = req.m[k].toString(); return s.indexOf('"/api/update/profile/","/api/commit/follow/user","/api/comment/publish"') >= 0 && /\\.d\\(t,\\{h:/.test(s) } catch (e) { return false }
    })
    return id ? req(id).h : null
  }
`

/**
 * TIKTOK_CLIENT_FN needs the main web app: TikTok Studio is a separate app
 * without that client (tkd-02 failed there), so leave Studio pages too.
 */
export async function ensureTikTokWebApp(webContents: WebContents): Promise<void> {
  const url = webContents.getURL()
  if (!/^https:\/\/www\.tiktok\.com\//.test(url) || url.includes('/tiktokstudio')) {
    await navigateAndWait(webContents, 'https://www.tiktok.com/explore', 2500, 8000)
  }
}

export function tiktokDeleteScript(itemId: string): string {
  return `(async function () {
    ${TIKTOK_CLIENT_FN}
    try {
      var h = tiktokClient()
      if (!h) return { ok: false, error: 'TikTok page client not found — is a www.tiktok.com page loaded?' }
      var res = await h.post('/api/aweme/delete/', { query: { aweme_id: ${JSON.stringify(itemId)}, tt_csrf_token: h.csrfToken }, headers: { 'tt-csrf-token': h.csrfToken } })
      if (!res || res.status_code !== 0) return { ok: false, error: 'delete not confirmed', status_code: res && res.status_code, status_msg: res && res.status_msg }
      return { ok: true, deleted: true, via: 'api', itemId: ${JSON.stringify(itemId)} }
    } catch (e) {
      return { ok: false, error: e instanceof Response ? 'delete request failed: HTTP ' + e.status : String(e && e.message || e) }
    }
  })()`
}

/** Deletes one of the account's own videos over the API (probe tkd-01: status_code 0, gone from the list). */
export async function tkDeleteVideo(options: {
  videoId?: string
  videoUrl?: string
  account?: string | number
}): Promise<TikTokResult> {
  const targetId = options.videoId ?? options.videoUrl?.match(/\/video\/(\d+)/)?.[1]
  if (!targetId || !/^\d+$/.test(targetId)) {
    return { ok: false, error: 'Must provide either videoId or videoUrl (a numeric id or a /video/<id> URL) to delete a video' }
  }
  const resolved = resolveTikTokPartition(options.account)
  if (!resolved) return unknownTikTokAccount(options.account) as TikTokResult
  try {
    const view = await getTikTokView(options.account)
    await ensureTikTokWebApp(view.webContents)
    const result = await view.webContents.executeJavaScript(tiktokDeleteScript(targetId)) as TikTokResult
    return { ...result, account: resolved.tabId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: resolved.tabId }
  }
}

export async function tkDeleteAllVideos(options: {
  account?: string | number
  limit?: number
} = {}): Promise<TikTokResult> {
  // A negative limit would make slice(0, -n) delete all but n videos.
  const maxLimit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.max(0, Math.min(200, Math.floor(options.limit)))
    : 100
  if (maxLimit === 0) return { ok: false, error: 'limit must be at least 1' }
  const resolved = resolveTikTokPartition(options.account)
  if (!resolved) return unknownTikTokAccount(options.account) as TikTokResult

  // 1. Fetch current user posts
  const listRes = await tkListPosts(options.account)
  if (!listRes.ok) return listRes

  const posts = (Array.isArray(listRes.posts) ? (listRes.posts as Array<{ id?: string; videoId?: string; url: string; caption?: string }>) : [])
    .map(p => ({ ...p, videoId: String(p.id ?? p.videoId ?? '') }))
    .filter(p => p.videoId)
  if (posts.length === 0) {
    return {
      ok: true,
      account: resolved.tabId,
      totalDeleted: 0,
      message: 'No videos found on this TikTok account to delete.',
    }
  }

  const targetBatch = posts.slice(0, maxLimit)
  const deleted: Array<{ videoId: string; caption?: string; status: string }> = []
  const failed: Array<{ videoId: string; error: string }> = []

  for (let i = 0; i < targetBatch.length; i++) {
    const p = targetBatch[i]
    console.log(`[FlowDesk TikTok] Deleting video ${i + 1}/${targetBatch.length} (ID: ${p.videoId})...`)

    const delRes = await tkDeleteVideo({
      videoId: p.videoId,
      videoUrl: p.url,
      account: options.account,
    })

    if (delRes.ok && delRes.deleted) {
      deleted.push({ videoId: p.videoId, caption: p.caption, status: 'DELETED' })
    } else {
      failed.push({ videoId: p.videoId, error: delRes.error || 'Failed to delete' })
    }

    // Safety pause of 2.5 seconds between deletions to avoid triggering spam/bot shields
    if (i < targetBatch.length - 1) {
      await new Promise(r => setTimeout(r, 2500))
    }
  }

  return {
    ok: true,
    account: resolved.tabId,
    totalAttempted: targetBatch.length,
    totalDeleted: deleted.length,
    failedCount: failed.length,
    deleted,
    failed,
    message: `Successfully deleted ${deleted.length} out of ${targetBatch.length} videos from TikTok.`,
  }
}

export async function tkWarmupScroll(options: {
  account?: string | number
  durationSeconds?: number
  niche?: string
  autoLike?: boolean
} = {}): Promise<TikTokResult> {
  const resolved = resolveTikTokPartition(options.account)
  if (!resolved) return unknownTikTokAccount(options.account) as TikTokResult
  const view = await getTikTokView(options.account)
  const durationSec = Math.max(10, Math.min(600, options.durationSeconds ?? 60))

  let targetUrl = 'https://www.tiktok.com/foryou'
  if (options.niche && options.niche.trim()) {
    targetUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(options.niche.trim())}`
  }

  const currentUrl = view.webContents.getURL()
  if (!currentUrl.includes('tiktok.com/foryou') && !currentUrl.includes('tiktok.com/explore') && (!options.niche || !currentUrl.includes(encodeURIComponent(options.niche.trim())))) {
    await navigateAndWait(view.webContents, targetUrl, 4000)
  }

  const script = tiktokWarmupScrollScript({
    durationSeconds: durationSec,
    autoLike: options.autoLike,
  })

  const result = await callScript(script, (durationSec + 15) * 1000, options.account)
  return {
    ...result,
    account: resolved.tabId,
    mode: 'human_warmup',
  }
}

/**
 * Edits one of the account's own video captions over Studio's API
 * (POST /tiktok/post/edit/v1/, verified live: status_code 0 and the list
 * showed the new caption). Studio's own fetch signs it, so the view is parked
 * on a Studio page first, as tkListPosts does.
 */
export async function tkEditVideoCaption(options: {
  videoId: string
  caption: string
  account?: string | number
}): Promise<TikTokResult> {
  const resolved = resolveTikTokPartition(options.account)
  if (!resolved) return unknownTikTokAccount(options.account) as TikTokResult
  if (!/^\d+$/.test(String(options.videoId))) return { ok: false, error: 'videoId must be numeric', account: resolved.tabId }
  const caption = String(options.caption ?? '')
  try {
    const view = await getTikTokView(options.account)
    if (!/tiktok\.com\/tiktokstudio/.test(view.webContents.getURL())) {
      if (holdsUpload(view.webContents)) return { ok: false, error: UPLOAD_BUSY, account: resolved.tabId }
      await view.webContents.loadURL('https://www.tiktok.com/tiktokstudio/content')
      await new Promise(r => setTimeout(r, 2500))
    }
    const result = await view.webContents.executeJavaScript(`(async function () {
      try {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        var r = await fetch('/tiktok/post/edit/v1/?aid=1988&app_name=tiktok_creator_center&device_platform=web&tz_name=' + encodeURIComponent(tz), {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ aweme_id: ${JSON.stringify(String(options.videoId))}, is_text_changed: true, text: ${JSON.stringify(caption)}, markup_text: ${JSON.stringify(caption)}, text_extra: [], tz_name: tz }),
        })
        var t = await r.text()
        var j = null
        try { j = JSON.parse(t) } catch (e) {}
        if (!j) return { ok: false, error: 'empty or non-JSON reply (HTTP ' + r.status + ') — request likely went out unsigned' }
        if (j.status_code !== 0) return { ok: false, error: 'caption edit not confirmed', status_code: j.status_code, status_msg: j.status_msg }
        return { ok: true, edited: true, via: 'api' }
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) }
      }
    })()`) as TikTokResult
    if (!result.ok) return { ...result, videoId: options.videoId, account: resolved.tabId }
    // TikTok answered ok yet kept the old caption on a fresh upload (report
    // 2026-10-12), so ok means the post list shows the new caption.
    let now: string | undefined
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const list = await view.webContents.executeJavaScript(tiktokStudioItemsScript()) as TikTokResult
      const post = (Array.isArray(list.posts) ? list.posts as Array<{ id?: string; caption?: string }> : []).find(p => String(p.id) === String(options.videoId))
      now = post?.caption
      if (now !== undefined && captionMatches(now, caption)) return { ok: true, edited: true, verified: true, via: 'api', videoId: options.videoId, account: resolved.tabId }
    }
    return {
      ok: false,
      videoId: options.videoId,
      account: resolved.tabId,
      error: now === undefined
        ? 'TikTok accepted the edit but the video is not in the post list, so the caption could not be checked'
        : 'TikTok accepted the edit but the caption did not change (still ' + JSON.stringify(now.slice(0, 80)) + '). A video still processing can refuse edits; try again later.',
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: resolved.tabId }
  }
}
