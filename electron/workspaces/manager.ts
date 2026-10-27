import { app, session, type BrowserWindow, type WebContents } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeTabView, getViewById, openTabView, setWorkspaceTabOpener, showView } from '../sessions'
import {
  createWorkspace, findWorkspace, MAX_TABS, nextTabId, normalizeUrl, parseViewId, pushActivity, sanitizeStored, viewIdFor,
  type AgentActivity, type BrowserWorkspace, type WorkspaceTab,
} from './model'

/**
 * Owns the workspaces: their file on disk, their tab views, the agent log the
 * Workspaces page shows, the per-workspace pause ("I'll take over"), and the
 * Allow/Deny prompts that let the user approve a confirm-needed action on
 * screen instead of in chat.
 */

let ui: BrowserWindow | null = null
let list: BrowserWorkspace[] | null = null
let saveTimer: NodeJS.Timeout | null = null
const paused = new Set<string>()
const logs = new Map<string, AgentActivity[]>()
const wired = new WeakSet<WebContents>()
/** True while the Workspaces page is on screen: only then can the user answer an approval. */
let watching = false

const file = () => join(app.getPath('userData'), 'workspaces.json')

function all(): BrowserWorkspace[] {
  if (!list) {
    try { list = sanitizeStored(JSON.parse(readFileSync(file(), 'utf8'))) } catch { list = [] }
  }
  return list
}

function save(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void mkdir(app.getPath('userData'), { recursive: true })
      .then(() => writeFile(file(), JSON.stringify(all(), null, 2), 'utf8'))
      .catch(err => console.warn('[workspaces] save failed:', err?.message ?? err))
  }, 300)
}

function send(channel: string, payload: unknown): void {
  if (ui && !ui.isDestroyed()) ui.webContents.send(channel, payload)
}

export interface WorkspaceInfo extends BrowserWorkspace {
  paused: boolean
  /** Tab view ids that have a live page now (others load when shown or opened). */
  open: string[]
}

export function publicList(): WorkspaceInfo[] {
  return all().map(w => ({
    ...w,
    paused: paused.has(w.id),
    open: w.tabs.map(t => viewIdFor(w, t)).filter(v => !!getViewById(v)),
  }))
}

function changed(): void {
  save()
  send('ws:changed', publicList())
}

export function setWorkspacesWindow(win: BrowserWindow): void {
  ui = win
  setWorkspaceTabOpener((fromTabId, url) => {
    const at = parseViewId(fromTabId)
    if (at) openTab(at.ws, url, 'page')
  })
}

export function setWatching(on: boolean): void {
  watching = on
}

function get(key: string): BrowserWorkspace {
  const ws = findWorkspace(all(), key)
  if (!ws) {
    const names = all().map(w => `"${w.name}" (${w.id})`).join(', ') || 'none yet'
    throw new Error(`no workspace "${key}" — workspaces: ${names}`)
  }
  return ws
}

export function create(name: string): BrowserWorkspace {
  const n = name.trim()
  if (!n) throw new Error('a workspace needs a name')
  if (findWorkspace(all(), n)) throw new Error(`a workspace named "${n}" already exists`)
  const ws = createWorkspace(n, all())
  all().push(ws)
  changed()
  return ws
}

export function rename(key: string, name: string): void {
  const ws = get(key)
  const n = name.trim()
  if (!n) throw new Error('a workspace needs a name')
  ws.name = n.slice(0, 40)
  changed()
}

/** Closes its tabs and forgets the workspace; `wipe` also signs it out everywhere (clears its storage). */
export async function remove(key: string, wipe: boolean): Promise<void> {
  const ws = get(key)
  for (const t of ws.tabs) closeTabView(viewIdFor(ws, t))
  list = all().filter(w => w.id !== ws.id)
  paused.delete(ws.id)
  logs.delete(ws.id)
  if (wipe) await session.fromPartition(`persist:${ws.partition}`).clearStorageData().catch(() => {})
  changed()
}

/** Keeps the stored tab in step with the page: url and title as the user or agent browses. */
function wire(tab: WorkspaceTab, wc: WebContents): void {
  if (wired.has(wc)) return
  wired.add(wc)
  const update = () => {
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    const title = wc.getTitle()
    if (url && url !== tab.url && normalizeUrl(url)) tab.url = url
    if (title && title !== tab.title) tab.title = title
    changed()
  }
  wc.on('did-navigate', update)
  wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => { if (isMainFrame) update() })
  wc.on('page-title-updated', update)
}

/** The tab's live page, creating it (off screen) when it has not been opened since FlowDesk started. */
function ensureView(ws: BrowserWorkspace, tab: WorkspaceTab): WebContents {
  const id = viewIdFor(ws, tab)
  const existing = getViewById(id)?.webContents
  if (existing && !existing.isDestroyed()) { wire(tab, existing); return existing }
  const wc = openTabView(id, ws.partition, tab.url)
  wire(tab, wc)
  return wc
}

/** A workspace tab's page by view id, opened if needed; null for any other view. */
export function workspaceView(viewId: string): WebContents | null {
  const at = parseViewId(viewId)
  if (!at) return null
  const ws = findWorkspace(all(), at.ws)
  const tab = ws?.tabs.find(t => t.id === at.tab)
  return ws && tab ? ensureView(ws, tab) : null
}

export function openTab(key: string, rawUrl: string, by: 'user' | 'agent' | 'page'): { view: string; url: string; wc: WebContents } {
  const ws = get(key)
  const url = normalizeUrl(rawUrl || 'about:blank')
  if (!url) throw new Error(`cannot open "${rawUrl}": only http(s) web pages`)
  if (ws.tabs.length >= MAX_TABS) throw new Error(`workspace "${ws.name}" already has ${MAX_TABS} tabs; close one first`)
  const tab: WorkspaceTab = { id: nextTabId(ws), url, title: '' }
  ws.tabs.push(tab)
  ws.activeTab = tab.id
  const wc = ensureView(ws, tab)
  const view = viewIdFor(ws, tab)
  if (by === 'agent') note(view, 'open', `opened ${url}`, true)
  changed()
  return { view, url, wc }
}

export function closeTab(key: string, tabId: string): void {
  const ws = get(key)
  const i = ws.tabs.findIndex(t => t.id === tabId)
  if (i < 0) return
  closeTabView(viewIdFor(ws, ws.tabs[i]))
  ws.tabs.splice(i, 1)
  if (ws.activeTab === tabId) ws.activeTab = ws.tabs[Math.min(i, ws.tabs.length - 1)]?.id ?? null
  changed()
}

/** Puts a tab on screen (the page then sets its bounds). */
export function show(key: string, tabId: string): string {
  const ws = get(key)
  const tab = ws.tabs.find(t => t.id === tabId)
  if (!tab) throw new Error(`no tab ${tabId} in "${ws.name}"`)
  ensureView(ws, tab)
  const view = viewIdFor(ws, tab)
  showView(view, ws.partition, tab.url)
  if (ws.activeTab !== tab.id) { ws.activeTab = tab.id; changed() }
  return view
}

/** Address bar: a url, a bare host or words to search. */
export function navigate(key: string, tabId: string, input: string): string {
  const ws = get(key)
  const tab = ws.tabs.find(t => t.id === tabId)
  if (!tab) throw new Error(`no tab ${tabId} in "${ws.name}"`)
  const url = normalizeUrl(input)
  if (!url) throw new Error(`cannot open "${input}": only http(s) web pages`)
  void ensureView(ws, tab).loadURL(url).catch(() => { /* the page shows its own error */ })
  return url
}

/** Agent moved to another tab: the page follows when that workspace is shown. */
export function focusTab(viewId: string): void {
  const at = parseViewId(viewId)
  const ws = at && findWorkspace(all(), at.ws)
  if (!ws || ws.activeTab === at!.tab) return
  ws.activeTab = at!.tab
  changed()
}

// ── Agent lane: log, pause, approvals ────────────────────────────────────────

export function setPaused(key: string, on: boolean): void {
  const ws = get(key)
  if (on) paused.add(ws.id)
  else paused.delete(ws.id)
  changed()
}

/** Why the agent may not act in this view now, or null. Only workspace views can be paused. */
export function agentBlocked(viewId: string | null): string | null {
  const at = viewId ? parseViewId(viewId) : null
  if (!at || !paused.has(at.ws)) return null
  const ws = findWorkspace(all(), at.ws)
  note(viewId!, 'blocked', 'agent waited: the user has taken over', false)
  return `the user has paused the agent in workspace "${ws?.name ?? at.ws}" and is using it themselves — stop and ask them when to continue`
}

export function note(viewId: string | null, kind: AgentActivity['kind'], text: string, ok: boolean): void {
  const at = viewId ? parseViewId(viewId) : null
  if (!at) return
  const entry: AgentActivity = { at: new Date().toISOString(), view: viewId!, kind, text: text.slice(0, 300), ok }
  logs.set(at.ws, pushActivity(logs.get(at.ws) ?? [], entry))
  send('ws:activity', { ws: at.ws, entry })
}

/** Runs an agent call with the workspace marked busy, so the page shows "working" while it runs, not only after. */
export async function busy<T>(viewId: string | null, fn: () => Promise<T>): Promise<T> {
  const at = viewId ? parseViewId(viewId) : null
  if (!at) return fn()
  send('ws:busy', { ws: at.ws, on: true })
  try { return await fn() } finally { send('ws:busy', { ws: at.ws, on: false }) }
}

export function activity(key: string): AgentActivity[] {
  return logs.get(get(key).id) ?? []
}

const approvals = new Map<string, (allow: boolean) => void>()
const APPROVAL_MS = 120_000

/**
 * Asks the user on the Workspaces page to allow one confirm-needed action.
 * Null when nobody can answer there (page not open): the agent then asks in chat.
 */
export function askApproval(viewId: string, what: string, reason: string): Promise<boolean> | null {
  const at = parseViewId(viewId)
  if (!at || !watching || !ui || ui.isDestroyed()) return null
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  focusTab(viewId)
  note(viewId, 'approval', `asks to ${what}`, true)
  send('ws:approval', { id, ws: at.ws, view: viewId, what, reason })
  ui.flashFrame(true)
  return new Promise(resolve => {
    const timer = setTimeout(() => finish(false), APPROVAL_MS)
    function finish(allow: boolean) {
      clearTimeout(timer)
      approvals.delete(id)
      send('ws:approvalDone', { id, allow })
      if (ui && !ui.isDestroyed()) ui.flashFrame(false)
      note(viewId, 'approval', allow ? `user allowed: ${what}` : `user did not allow: ${what}`, allow)
      resolve(allow)
    }
    approvals.set(id, finish)
  })
}

export function answerApproval(id: string, allow: boolean): void {
  approvals.get(id)?.(allow)
}

export function waitLoaded(wc: WebContents, ms = 15_000): Promise<void> {
  return new Promise(resolve => {
    if (wc.isDestroyed() || !wc.isLoading()) { setTimeout(resolve, 150); return }
    const done = () => { clearTimeout(t); wc.removeListener('did-stop-loading', done); resolve() }
    const t = setTimeout(done, ms)
    wc.once('did-stop-loading', done)
  })
}
