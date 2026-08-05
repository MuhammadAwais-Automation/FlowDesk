import { app, BrowserWindow, ipcMain, globalShortcut, session, shell, Menu, Tray, nativeImage, crashReporter, nativeTheme, protocol, net } from 'electron'
import { randomUUID } from 'crypto'
import { deflateSync } from 'zlib'
import { mkdir, writeFile } from 'fs/promises'
import { pathToFileURL } from 'url'

// Initializes Crashpad so Windows dev runs are less likely to log "not connected" (harmless Chromium noise otherwise).
crashReporter.start({ productName: 'FlowDesk', uploadToServer: false })

// Must run before app is ready. Gives the custom scheme fetch/CORS semantics
// like a normal https:// origin so an <img src="flowdesk-image://...">
// loads cleanly from the Vite-served renderer without CSP/mixed-content
// trouble (a bare file:// src can be blocked depending on webSecurity/CSP).
protocol.registerSchemesAsPrivileged([
  { scheme: 'flowdesk-image', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
])

// Generated images (e.g. Gemini image-gen replies) are saved here rather
// than inlined as base64 data: URIs in captured chat text — keeps chat
// history/state light and avoids re-downloading the same bytes on every
// render. Served back to the renderer via the flowdesk-image:// protocol.
const generatedImagesDir = join(app.getPath('userData'), 'generated-images')

interface GmailSession {
  email: string
  label: string | null
  partition: string
  addedAt: string
  color?: string | null
}

interface YouTubeAccount {
  id: string
  email: string
  label: string | null
  partition: string
  addedAt: string
  lastActiveTab: 'dashboard' | 'content' | 'analytics'
}

interface CustomTool {
  id: string
  name: string
  url: string
  addedAt: string
}

interface Prompt {
  id: string
  name: string
  content: string
  categoryId: string | null
  createdAt: string
}

interface PromptCategory {
  id: string
  name: string
  color: string
}

import { join } from 'path'
import Store from 'electron-store'
import { setMainWindow, showView, hideView, closeTabView, destroyAllViews, getActiveView, getViewById, setCustomBounds, goBack, goForward, reloadActive, navigateActive, setNavWidth, setToolDockWidth, ensureBackgroundView } from './sessions'
import { setSocialMainWindow, showSocialView, hideAllSocialViews, destroySocialView, setSocialNavWidth, socialGoBack, socialGoForward, socialReload } from './socialHub'
import { injectPrompt, getLatestAssistantText, getSelectedText, type AITool } from './injector'
import { extractTextFromSSEEvent, extractUsageFromSSEEvent, extractModelInfoFromSSEEvent, extractIdsFromSSEEvent } from './chatgptParser'
import { extractTextFromClaudeSSEEvent, extractModelInfoFromSSEEvent as extractClaudeModelInfoFromSSEEvent, extractUsageFromSSEEvent as extractClaudeUsageFromSSEEvent } from './claudeParser'
import { extractLatestGeminiText, extractTurnMetaFromRaw as extractGeminiTurnMetaFromRaw, extractImageUrlsFromRaw as extractGeminiImageUrlsFromRaw } from './geminiParser'
import { extractTextFromSSEEvent as extractQwenTextFromSSEEvent, extractThinkingSummaryFromSSEEvent, extractUsageFromSSEEvent as extractQwenUsageFromSSEEvent } from './qwenParser'
import { extractPerplexitySSEEvent } from './perplexityParser'
import type { AppSettings } from '../src/types/database'
import { PROVIDER_URLS } from './providerUrls'
import { configureBrowserWorkerQueue, notifyCaptureComplete, workerProgress } from './agent/browserWorkerQueue'
import { runAgentTurn } from './agent/leadAgent'

// @anthropic-ai/claude-agent-sdk (electron/claudeSdkProvider.ts, currently
// unused pending the multi-agent orchestrator section) auths via the local
// `claude` CLI's own subscription login only — never a metered API key.
// Guard against ANTHROPIC_API_KEY being set on the machine and silently
// switching the SDK to billed API usage, unconditionally at startup so it's
// never a race against whichever feature imports the SDK first.
delete process.env.ANTHROPIC_API_KEY

const DEFAULT_TOOLS: CustomTool[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', addedAt: '2024-01-01T00:00:00.000Z' },
  { id: 'claude',  name: 'Claude',  url: 'https://claude.ai',   addedAt: '2024-01-01T00:00:00.000Z' },
  { id: 'gemini',  name: 'Gemini',  url: 'https://gemini.google.com', addedAt: '2024-01-01T00:00:00.000Z' },
  { id: 'grok',    name: 'Grok',    url: 'https://grok.com',    addedAt: '2024-01-01T00:00:00.000Z' },
]

const store = new Store<{
  settings: Partial<AppSettings>
  gmailSessions: GmailSession[]
  ytAccounts: YouTubeAccount[]
  customTools: CustomTool[]
  workspaceEmail: string | null
  prompts: Prompt[]
  promptCategories: PromptCategory[]
  activeWorkspaceId: string | null
  workspaces: unknown[]
  folders: unknown[]
  workspacePrompts: unknown[]
  promptVersions: unknown[]
  aiAccounts: unknown[]
}>({
  defaults: {
    settings: {
      launchOnStartup: false,
      minimizeToTray: false,
      theme: 'system',
      hotkeys: {
        injectPanel: 'CommandOrControl+Shift+P',
        captureSelection: 'CommandOrControl+Shift+S',
        switchAccount: 'CommandOrControl+Tab',
      }
    },
    gmailSessions: [],
    ytAccounts: [],
    customTools: DEFAULT_TOOLS,
    workspaceEmail: null,
    prompts: [],
    promptCategories: [],
    activeWorkspaceId: null,
    workspaces: [],
    folders: [],
    workspacePrompts: [],
    promptVersions: [],
    aiAccounts: [],
  }
})

// Agent orchestrator's worker tools reuse the same persistent Google-account
// partition Universal Chat's background tabs already use.
configureBrowserWorkerQueue({ getPartition: () => store.get('gmailSessions')[0]?.partition ?? null })

// Backstop only — electron/agent/browserWorkerQueue.ts's own 60s
// handler-level timeout is authoritative and fires first; this just guards
// against whatever default the SDK's own MCP tool-call timeout would
// otherwise apply if that internal timeout were ever bypassed.
if (!process.env.MCP_TOOL_TIMEOUT) process.env.MCP_TOOL_TIMEOUT = '90000'

let mainWindow: BrowserWindow
let tray: Tray | null = null

// ── PNG icon builder (no external deps) ──────────────────────────
function makePNG(r: number, g: number, b: number, size = 16): Buffer {
  const w = size, h = size
  const rowBytes = 1 + w * 3
  const raw = Buffer.alloc(h * rowBytes)
  for (let y = 0; y < h; y++) {
    raw[y * rowBytes] = 0
    for (let x = 0; x < w; x++) {
      raw[y * rowBytes + 1 + x * 3 + 0] = r
      raw[y * rowBytes + 1 + x * 3 + 1] = g
      raw[y * rowBytes + 1 + x * 3 + 2] = b
    }
  }
  // CRC32 lookup table
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    crcTable[n] = c
  }
  function crc32(buf: Buffer): number {
    let c = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  function mkChunk(type: string, data: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii')
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
    return Buffer.concat([len, t, data, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    mkChunk('IHDR', ihdr),
    mkChunk('IDAT', deflateSync(raw)),
    mkChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Apply settings: startup + tray ───────────────────────────────
function applySettings(s: Partial<AppSettings>) {
  // Launch on startup
  if (typeof s.launchOnStartup === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: s.launchOnStartup })
  }

  // Minimize to tray
  if (s.minimizeToTray) {
    if (!tray) setupTray()
  } else {
    if (tray) { tray.destroy(); tray = null }
  }
}

function setupTray() {
  const iconBuf = makePNG(0x4F, 0x6E, 0xF7) // #4F6EF7 blue
  const icon = nativeImage.createFromBuffer(iconBuf)
  tray = new Tray(icon)
  tray.setToolTip('FlowDesk')
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open FlowDesk',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus() }
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray?.destroy(); app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  setMainWindow(mainWindow)
  setSocialMainWindow(mainWindow)

  // System-theme changes push to the renderer live so "System" theme setting
  // tracks OS dark/light switches without a restart.
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:systemChanged', { shouldUseDarkColors: nativeTheme.shouldUseDarkColors })
  })

  // Minimize-to-tray: intercept close event
  mainWindow.on('close', (e) => {
    const s = store.get('settings') as Partial<AppSettings>
    if (s?.minimizeToTray && tray) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerShortcuts()
}

function registerShortcuts() {
  const settings = store.get('settings') as Partial<AppSettings>
  const hotkeys = settings?.hotkeys ?? {
    injectPanel: 'CommandOrControl+Shift+P',
    captureSelection: 'CommandOrControl+Shift+S',
    switchAccount: 'CommandOrControl+Tab',
  }

  globalShortcut.unregisterAll()

  if (hotkeys.injectPanel) {
    try {
      globalShortcut.register(hotkeys.injectPanel, () => {
        mainWindow?.webContents.send('open-inject-panel')
      })
    } catch (e) {
      console.error('Failed to register injectPanel shortcut:', e)
    }
  }
  if (hotkeys.captureSelection) {
    try {
      globalShortcut.register(hotkeys.captureSelection, () => {
        mainWindow?.webContents.send('capture-selection')
      })
    } catch (e) {
      console.error('Failed to register captureSelection shortcut:', e)
    }
  }
}

// IPC: electron-store
ipcMain.handle('store:get', (_e, key: string) => store.get(key))
ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
  store.set(key, value)
  if (key === 'settings') {
    const s = value as Partial<AppSettings>
    applySettings(s)
    if (s?.hotkeys) registerShortcuts()
  } else if (key.includes('hotkeys')) {
    registerShortcuts()
  }
})

// IPC: get current login item settings (so renderer can display actual state)
ipcMain.handle('app:getLoginItemSettings', () => app.getLoginItemSettings())

ipcMain.handle('theme:getSystem', () => ({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors }))

// IPC: Gmail sessions
ipcMain.handle('gmail:list', () => {
  // Normalize legacy sessions that predate the label field
  const sessions = store.get('gmailSessions')
  return sessions.map(s => ({ ...s, label: s.label ?? null }))
})

ipcMain.handle('gmail:add', async () => {
  const partition = `gmail-${randomUUID()}`

  // Step 1: Open Google login window
  const loginWin = new BrowserWindow({
    width: 500,
    height: 660,
    title: 'Sign in — Google',
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  loginWin.loadURL(
    'https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn'
  )
  loginWin.webContents.on('did-navigate', (_ev, url) => {
    try { loginWin.setTitle(`Sign in — ${new URL(url).hostname}`) } catch {}
  })
  await new Promise<void>((resolve) => loginWin.on('closed', () => resolve()))

  // Step 2: Auto-detect email using a hidden window with the same session
  let email: string | null = null
  try {
    const detectWin = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.fromPartition(`persist:${partition}`),
        nodeIntegration: false,
        contextIsolation: true,
      }
    })
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 8000) // 8s timeout
      detectWin.webContents.on('did-finish-load', async () => {
        clearTimeout(timer)
        try {
          const result = await detectWin.webContents.executeJavaScript(`
            (
              document.querySelector('[data-email]')?.dataset.email ||
              document.querySelector('[aria-label*="@gmail"]')?.getAttribute('aria-label') ||
              null
            )
          `)
          if (typeof result === 'string' && result.includes('@')) email = result
        } catch { /* ignore */ }
        resolve()
      })
      detectWin.loadURL('https://accounts.google.com/')
    })
    detectWin.destroy()
  } catch { /* ignore detection errors */ }

  if (!email) {
    // Return partition so renderer can show fallback email input
    return { error: 'detect_failed', partition }
  }

  // Check duplicate
  const sessions = store.get('gmailSessions')
  if (sessions.find(s => s.email === email)) {
    return { error: 'already_exists', email }
  }

  const entry: GmailSession = {
    email,
    label: null,
    partition,
    addedAt: new Date().toISOString()
  }
  store.set('gmailSessions', [...sessions, entry])
  return entry
})

// Fallback: user typed email manually after auto-detect failed
ipcMain.handle('gmail:finalizeAdd', (_e, email: string, partition: string) => {
  const trimmed = email.trim().toLowerCase()
  const sessions = store.get('gmailSessions')
  if (sessions.find(s => s.email === trimmed)) {
    return { error: 'already_exists' }
  }
  const entry: GmailSession = {
    email: trimmed,
    label: null,
    partition,
    addedAt: new Date().toISOString()
  }
  store.set('gmailSessions', [...sessions, entry])
  return entry
})

ipcMain.handle('gmail:updateLabel', (_e, email: string, label: string) => {
  const sessions = store.get('gmailSessions')
  store.set('gmailSessions',
    sessions.map(s => s.email === email ? { ...s, label: label.trim() || null } : s)
  )
})

ipcMain.handle('gmail:updateColor', (_e, email: string, color: string) => {
  const sessions = store.get('gmailSessions')
  store.set('gmailSessions',
    sessions.map(s => s.email === email ? { ...s, color: color || null } : s)
  )
})

ipcMain.handle('gmail:openInbox', (_e, tabId: string, partition: string) => {
  showView(tabId, partition, 'https://mail.google.com')
})

ipcMain.handle('gmail:remove', (_e, email: string) => {
  const sessions = store.get('gmailSessions')
  store.set('gmailSessions', sessions.filter(s => s.email !== email))
})

ipcMain.handle('gmail:openLogin', async (_e, email: string, partition: string) => {
  const loginWin = new BrowserWindow({
    width: 500,
    height: 660,
    title: `Sign in — ${email}`,
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  // Load Google sign-in — once logged in here, all Google-auth AI tools work
  loginWin.loadURL('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn')
  loginWin.webContents.on('did-navigate', (_ev, url) => {
    try { loginWin.setTitle(`AI Manager — ${new URL(url).hostname}`) } catch {}
  })
  return new Promise<void>((resolve) => {
    loginWin.on('closed', () => resolve())
  })
})

// IPC: page navigation (show/hide WebContentsView)
ipcMain.handle('page:changed', (_e, page: string) => {
  if (page === 'browser' || page === 'youtube' || page === 'workspace') {
    // View shown when view:switch is called by the page component
  } else {
    hideView()
  }
})

// IPC: update sidebar nav width & dock width so bounds calculations stay correct
ipcMain.handle('view:setNavWidth', (_e, w: number) => { setNavWidth(w); setSocialNavWidth(w) })
ipcMain.handle('view:setDockWidth', (_e, w: number) => setToolDockWidth(w))

// IPC: switch to tab's view (persistent — only loads URL on first open)
ipcMain.handle('view:switch', (_e, tabId: string, partition: string, url: string) => {
  showView(tabId, partition, url)
})

// IPC: close and destroy a specific tab's view
ipcMain.handle('view:close', (_e, tabId: string) => {
  closeTabView(tabId)
})

// IPC: hide view
ipcMain.handle('view:hide', () => hideView())

// IPC: set custom bounds for WebContentsView (used by Accounts page Gmail tab)
ipcMain.handle('view:setCustomBounds', (_e, x: number, y: number, w: number, h: number) => {
  setCustomBounds(x, y, w, h)
})

// IPC: navigation controls for embedded views
ipcMain.handle('view:goBack', () => goBack())
ipcMain.handle('view:goForward', () => goForward())
ipcMain.handle('view:reload', () => reloadActive())
ipcMain.handle('view:navigate', (_e, url: string) => navigateActive(url))

// IPC: clear cookies/storage for a specific partition (used by AccountContextMenu "Clear Session")
ipcMain.handle('session:clearPartition', async (_e, partition: string) => {
  try {
    await session.fromPartition(`persist:${partition}`).clearStorageData()
    return true
  } catch {
    return false
  }
})

// IPC: Social Hub
ipcMain.handle('social:show',      (_e, id: string, partition: string, url: string) => showSocialView(id, partition, url))
ipcMain.handle('social:hide',      () => hideAllSocialViews())
ipcMain.handle('social:destroy',   (_e, id: string) => destroySocialView(id))
ipcMain.handle('social:goBack',    () => socialGoBack())
ipcMain.handle('social:goForward', () => socialGoForward())
ipcMain.handle('social:reload',    () => socialReload())

// IPC: Google Login — opens a real BrowserWindow with account's session
ipcMain.handle('auth:openLoginWindow', async (_e, partition: string, url: string) => {
  const loginWindow = new BrowserWindow({
    width: 900,
    height: 680,
    title: 'Login — AI Manager',
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  loginWindow.loadURL(url)

  // Show loading title while navigating
  loginWindow.webContents.on('did-navigate', (_e, navUrl) => {
    try { loginWindow.setTitle(`AI Manager — ${new URL(navUrl).hostname}`) } catch {}
  })

  // Wait for window to close — session is auto-saved by Electron
  return new Promise<void>((resolve) => {
    loginWindow.on('closed', () => resolve())
  })
})

// ─────────────────────────────────────────────────────────────────
// IPC: YouTube Multi-Account Dashboard
// ─────────────────────────────────────────────────────────────────

/** Return stored YouTube accounts */
ipcMain.handle('yt:list', () => store.get('ytAccounts'))

/**
 * Open Google login window with a fresh isolated session,
 * then auto-detect which email was used.
 */
ipcMain.handle('yt:add', async () => {
  const partition = `yt-${randomUUID()}`

  // Step 1: Open Google login window
  const loginWin = new BrowserWindow({
    width: 520,
    height: 680,
    title: 'Sign in — Google (YouTube)',
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  loginWin.loadURL(
    'https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn'
  )
  loginWin.webContents.on('did-navigate', (_ev, url) => {
    try { loginWin.setTitle(`YouTube Login — ${new URL(url).hostname}`) } catch {}
  })
  await new Promise<void>((resolve) => loginWin.on('closed', () => resolve()))

  // Step 2: Auto-detect email via hidden window with same session
  let email: string | null = null
  try {
    const detectWin = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.fromPartition(`persist:${partition}`),
        nodeIntegration: false,
        contextIsolation: true,
      }
    })
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 8000)
      detectWin.webContents.on('did-finish-load', async () => {
        clearTimeout(timer)
        try {
          const result = await detectWin.webContents.executeJavaScript(`
            (
              document.querySelector('[data-email]')?.dataset.email ||
              document.querySelector('[aria-label*="@gmail"]')?.getAttribute('aria-label') ||
              document.querySelector('[aria-label*="@"]')?.getAttribute('aria-label') ||
              null
            )
          `)
          if (typeof result === 'string' && result.includes('@')) email = result.trim()
        } catch { /* ignore */ }
        resolve()
      })
      detectWin.loadURL('https://accounts.google.com/')
    })
    detectWin.destroy()
  } catch { /* ignore detection errors */ }

  if (!email) {
    return { error: 'detect_failed', partition }
  }

  // Check duplicate
  const accounts = store.get('ytAccounts')
  if (accounts.find(a => a.email === email)) {
    return { error: 'already_exists', email }
  }

  const entry: YouTubeAccount = {
    id: randomUUID(),
    email,
    label: null,
    partition,
    addedAt: new Date().toISOString(),
    lastActiveTab: 'dashboard'
  }
  store.set('ytAccounts', [...accounts, entry])
  return entry
})

/** Fallback: user typed email manually after auto-detect failed */
ipcMain.handle('yt:finalizeAdd', (_e, email: string, partition: string) => {
  const trimmed = email.trim().toLowerCase()
  const accounts = store.get('ytAccounts')
  if (accounts.find(a => a.email === trimmed)) {
    return { error: 'already_exists' }
  }
  const entry: YouTubeAccount = {
    id: randomUUID(),
    email: trimmed,
    label: null,
    partition,
    addedAt: new Date().toISOString(),
    lastActiveTab: 'dashboard'
  }
  store.set('ytAccounts', [...accounts, entry])
  return entry
})

/** Remove a YouTube account by ID */
ipcMain.handle('yt:remove', (_e, id: string) => {
  const accounts = store.get('ytAccounts')
  store.set('ytAccounts', accounts.filter(a => a.id !== id))
})

/** Rename/update display label */
ipcMain.handle('yt:updateLabel', (_e, id: string, label: string) => {
  const accounts = store.get('ytAccounts')
  store.set('ytAccounts',
    accounts.map(a => a.id === id ? { ...a, label: label.trim() || null } : a)
  )
})

/** Update lastActiveTab for an account */
ipcMain.handle('yt:setLastTab', (_e, id: string, tab: string) => {
  const accounts = store.get('ytAccounts')
  store.set('ytAccounts',
    accounts.map(a => a.id === id ? { ...a, lastActiveTab: tab } : a)
  )
})

/** Open Google re-authentication window for an existing account */
ipcMain.handle('yt:openLoginWindow', async (_e, partition: string) => {
  const loginWin = new BrowserWindow({
    width: 520,
    height: 680,
    title: 'Re-authenticate — YouTube',
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  loginWin.loadURL('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn')
  loginWin.webContents.on('did-navigate', (_ev, url) => {
    try { loginWin.setTitle(`YouTube — ${new URL(url).hostname}`) } catch {}
  })
  return new Promise<void>((resolve) => loginWin.on('closed', () => resolve()))
})

/**
 * Detect YouTube channel ID by loading YouTube Studio in a hidden window
 * with the account's session, then extracting from the DOM/URL.
 * Returns channel ID string or null if detection failed.
 */
ipcMain.handle('yt:detectChannelId', async (_e, partition: string) => {
  let channelId: string | null = null
  try {
    const detectWin = new BrowserWindow({
      show: false,
      webPreferences: {
        session: session.fromPartition(`persist:${partition}`),
        nodeIntegration: false,
        contextIsolation: true,
      }
    })

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 12000) // 12s timeout
      detectWin.webContents.on('did-finish-load', async () => {
        clearTimeout(timer)
        try {
          // Try extracting from current URL first
          const currentUrl = detectWin.webContents.getURL()
          const urlMatch = currentUrl.match(/\/channel\/(UC[\w-]{22})/)
          if (urlMatch) {
            channelId = urlMatch[1]
          } else {
            // Fallback: extract from page DOM
            const result = await detectWin.webContents.executeJavaScript(`
              (
                document.querySelector('a[href*="/channel/UC"]')?.href?.match(/\/channel\/(UC[\\w-]{22})/)?.[1] ||
                window.__WEB_CONTEXT_PARAMS__?.channelId ||
                null
              )
            `)
            if (typeof result === 'string' && result.startsWith('UC')) channelId = result
          }
        } catch { /* ignore */ }
        resolve()
      })
      detectWin.loadURL('https://studio.youtube.com/')
    })
    detectWin.destroy()
  } catch { /* ignore */ }

  return channelId
})

// IPC: open URL in external browser (system default)
ipcMain.handle('yt:openExternal', (_e, url: string) => shell.openExternal(url))

// ─────────────────────────────────────────────────────────────────
// IPC: Custom Tools Library
// ─────────────────────────────────────────────────────────────────

ipcMain.handle('tools:list', () => store.get('customTools'))

ipcMain.handle('tools:add', (_e, name: string, url: string) => {
  const tools = store.get('customTools')
  const entry: CustomTool = {
    id: randomUUID(),
    name: name.trim(),
    url: url.trim(),
    addedAt: new Date().toISOString(),
  }
  store.set('customTools', [...tools, entry])
  return entry
})

ipcMain.handle('tools:remove', (_e, id: string) => {
  const tools = store.get('customTools')
  store.set('customTools', tools.filter(t => t.id !== id))
})

ipcMain.handle('tools:reorder', (_e, reordered: CustomTool[]) => {
  store.set('customTools', reordered)
})

// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// IPC: Personal Workspace (single Google account, fixed partition)
// ─────────────────────────────────────────────────────────────────

const WORKSPACE_PARTITION = 'persist:workspace-personal'

/** Return saved email (null if not set up yet) */
ipcMain.handle('workspace:getEmail', () => store.get('workspaceEmail'))

/** Save email after user completes login */
ipcMain.handle('workspace:setEmail', (_e, email: string) => {
  store.set('workspaceEmail', email.trim())
})

/** Open Google sign-in popup with the workspace partition */
ipcMain.handle('workspace:openLogin', async () => {
  const loginWin = new BrowserWindow({
    width: 520, height: 680,
    title: 'Sign in — Personal Workspace',
    webPreferences: {
      session: session.fromPartition(WORKSPACE_PARTITION),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })
  loginWin.loadURL('https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn')
  loginWin.webContents.on('did-navigate', (_ev, url) => {
    try { loginWin.setTitle(`Workspace — ${new URL(url).hostname}`) } catch {}
  })
  return new Promise<void>((resolve) => loginWin.on('closed', () => resolve()))
})

/** Log out: clear session storage + remove saved email */
ipcMain.handle('workspace:logout', async () => {
  store.set('workspaceEmail', null)
  try {
    await session.fromPartition(WORKSPACE_PARTITION).clearStorageData()
  } catch { /* ignore */ }
})

// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// IPC: Prompt Library
// ─────────────────────────────────────────────────────────────────

ipcMain.handle('prompts:list', () => store.get('prompts'))

ipcMain.handle('prompts:save', (_e, id: string | null, name: string, content: string, categoryId: string | null) => {
  const prompts = store.get('prompts')
  if (id) {
    const updated = prompts.map(p => p.id === id ? { ...p, name, content, categoryId } : p)
    store.set('prompts', updated)
    return updated.find(p => p.id === id)
  } else {
    const entry: Prompt = { id: randomUUID(), name, content, categoryId, createdAt: new Date().toISOString() }
    store.set('prompts', [...prompts, entry])
    return entry
  }
})

ipcMain.handle('prompts:delete', (_e, id: string) => {
  store.set('prompts', store.get('prompts').filter(p => p.id !== id))
})

ipcMain.handle('prompts:categories:list', () => store.get('promptCategories'))

ipcMain.handle('prompts:categories:save', (_e, id: string | null, name: string, color: string) => {
  const cats = store.get('promptCategories')
  if (id) {
    store.set('promptCategories', cats.map(c => c.id === id ? { ...c, name, color } : c))
    return undefined
  } else {
    const entry: PromptCategory = { id: randomUUID(), name, color }
    store.set('promptCategories', [...cats, entry])
    return entry
  }
})

ipcMain.handle('prompts:categories:delete', (_e, id: string) => {
  store.set('promptCategories', store.get('promptCategories').filter(c => c.id !== id))
  // Orphan prompts that were in this category
  store.set('prompts', store.get('prompts').map(p => p.categoryId === id ? { ...p, categoryId: null } : p))
})

// ─────────────────────────────────────────────────────────────────

// IPC: inject prompt into active view (legacy)
ipcMain.handle('view:inject', async (_e, text: string, tool: string) => {
  const view = getActiveView()
  if (!view) return false
  return injectPrompt(view.webContents, text, tool as 'chatgpt' | 'claude' | 'gemini' | 'grok')
})

// IPC: inject prompt into a specific tab by ID (works even when view is hidden)
ipcMain.handle('view:injectToTab', async (_e, tabId: string, text: string, tool: string) => {
  const view = getViewById(tabId)
  if (!view) return false
  return injectPrompt(view.webContents, text, tool as 'chatgpt' | 'claude' | 'gemini' | 'grok')
})

// IPC: get selected text from AI view
ipcMain.handle('view:getSelection', async () => {
  const view = getActiveView()
  if (!view) return ''
  return getSelectedText(view.webContents)
})

// IPC: capture the latest assistant response from a specific AI tab.
ipcMain.handle('view:captureLatestAssistant', async (_e, tabId: string, tool: string) => {
  const view = getViewById(tabId)
  if (!view) return ''
  return getLatestAssistantText(view.webContents, tool as 'chatgpt' | 'claude' | 'gemini' | 'grok')
})

// ─────────────────────────────────────────────────────────────────
// IPC: Universal Chat — one background (never-shown) WebContentsView per
// provider, sharing the user's existing Google-authenticated session
// (same partition model AI Browser tabs already use) so no separate login
// flow is needed if the user has already used these sites via that account.
// ─────────────────────────────────────────────────────────────────

ipcMain.handle('universalChat:ensureView', async (_e, provider: string) => {
  const url = PROVIDER_URLS[provider]
  if (!url) return { error: 'unknown_provider' as const }

  const gmailSessions = store.get('gmailSessions')
  if (gmailSessions.length === 0) return { error: 'no_google_account' as const }

  const tabId = `universalchat-${provider}`
  await ensureBackgroundView(tabId, gmailSessions[0].partition, url)
  return { tabId }
})

// Fills AND submits — unlike view:injectToTab (used by AI Browser's manual
// "Inject Prompt", where a human presses Enter/Send themselves), nobody is
// watching Universal Chat's background tabs.
ipcMain.handle('universalChat:send', async (_e, tabId: string, text: string, tool: string) => {
  console.log(`[FlowDesk universalChat] send called tabId=${tabId} tool=${tool} textPreview="${text.slice(0, 40)}" at ${new Date().toISOString()}`)
  const view = getViewById(tabId)
  if (!view) return false
  const ok = await injectPrompt(view.webContents, text, tool as AITool, true)
  console.log(`[FlowDesk universalChat] send result ok=${ok} at ${new Date().toISOString()}`)
  return ok
})

// ─────────────────────────────────────────────────────────────────
// IPC: Agent orchestrator — a lead Claude (Agent SDK, subscription-auth'd)
// that can call the 5 browser-driven worker tools mid-conversation. Single-
// flight: only one turn runs at a time, aborted via agent:abort.
// ─────────────────────────────────────────────────────────────────

let currentAgentAbort: AbortController | null = null

ipcMain.handle('agent:sendMessage', async (_e, prompt: string) => {
  currentAgentAbort?.abort()
  const abortController = new AbortController()
  currentAgentAbort = abortController

  // browserWorkerQueue's heartbeat (see its own comment) is the only signal
  // the renderer gets while a slow provider is mid-wait — the SDK's own
  // tool_progress never fires for these custom tools. Forward each tick as
  // a tool_progress-shaped agent:event for the duration of this turn only.
  const onWorkerProgress = (data: { tool: string; elapsedSeconds: number }) => {
    mainWindow?.webContents.send('agent:event', { type: 'tool_progress', toolUseId: data.tool, tool: data.tool, elapsedSeconds: data.elapsedSeconds })
  }
  workerProgress.on('progress', onWorkerProgress)

  try {
    for await (const event of runAgentTurn(prompt, abortController)) {
      mainWindow?.webContents.send('agent:event', event)
    }
  } finally {
    workerProgress.off('progress', onWorkerProgress)
    if (currentAgentAbort === abortController) currentAgentAbort = null
  }
  return true
})

ipcMain.handle('agent:abort', async () => {
  currentAgentAbort?.abort()
  currentAgentAbort = null
})

// ─────────────────────────────────────────────────────────────────
// IPC: PoC live capture — chunks arrive from captureInject.ts via
// webviewPreload.ts, get reassembled into SSE events, parsed, and
// forwarded to the renderer as they arrive (and once complete).
// ─────────────────────────────────────────────────────────────────

interface CaptureChunk {
  id: string
  tool: string
  url: string
  chunk?: string
  done?: boolean
  error?: string
}

interface CaptureBuffer {
  buf: string
  text: string
  tool: string
}

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
}

// Generated-image URLs (Gemini's lh3.googleusercontent.com/gg-dl/... links)
// 404/403 when fetched from a browser session that isn't logged into the
// same Google account that generated them — confirmed by testing: the URL
// loads fine inside Gemini's own tab, but breaks as a plain <img src> in the
// app's own renderer, which has no Google auth cookies for that domain.
// Downloading it here, server-side, using the SAME session (and therefore
// the same cookies) that captured it sidesteps that entirely. The bytes are
// saved to disk (not inlined as a base64 data: URI in the captured chat
// text — that would bloat chat storage/IPC payloads with megabytes of text
// per image) and a flowdesk-image:// URL pointing at the saved file is
// returned instead.
async function downloadAndSaveGeneratedImage(url: string, sess: Electron.Session): Promise<string | null> {
  try {
    // Session.fetch() (not net.fetch — that always uses the default
    // session and has no way to target a specific one) so the request goes
    // out with the exact cookies of the session that captured this URL.
    const res = await sess.fetch(url)
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') || 'image/png').split(';')[0].trim()
    const ext = IMAGE_EXT_BY_MIME[contentType] || 'png'
    const buf = Buffer.from(await res.arrayBuffer())

    await mkdir(generatedImagesDir, { recursive: true })
    const fileName = `${randomUUID()}.${ext}`
    await writeFile(join(generatedImagesDir, fileName), buf)
    return `flowdesk-image://${fileName}`
  } catch {
    return null
  }
}

function extractCaptureText(tool: string, evt: string): string[] {
  if (tool === 'claude') return extractTextFromClaudeSSEEvent(evt)
  return extractTextFromSSEEvent(evt)
}

// Centralizes every capture:complete emission: broadcasts to the renderer
// exactly as before, AND notifies the Agent orchestrator's per-tool waiter
// (electron/agent/browserWorkerQueue.ts) if one is pending for this tool.
function emitCaptureComplete(payload: { id: string; tool: string; text: string; error?: string }) {
  mainWindow?.webContents.send('capture:complete', payload)
  notifyCaptureComplete(payload.tool, payload.text, payload.error)
}

// Discovery: log every network call a provider's tab makes, unfiltered,
// to find its real streaming endpoint (see buildURLSnifferSrc).
ipcMain.on('capture:sniff', (_e, entry: { tool: string; transport: string; method: string; url: string; status?: number; size?: number; preview?: string }) => {
  console.log(`[FlowDesk sniff][${entry.tool}][${entry.transport}] ${entry.method} ${entry.url} status=${entry.status ?? ''} size=${entry.size ?? ''}${entry.preview ? ' preview=' + entry.preview : ''}`)
})

// Discovery: every Grok WS event type verbatim, unfiltered — extraction for
// Grok happens client-side (buildWSCaptureInjectSrc), so unlike the other
// providers there's no server-side raw-event log to inspect otherwise.
ipcMain.on('capture:grokRaw', (_e, entry: { type: string; evt: unknown }) => {
  if (process.env.FD_CAPTURE_DEBUG) {
    console.log(`[FlowDesk capture][grok][raw event][${entry.type}]`, JSON.stringify(entry.evt).slice(0, 1500))
  }
})

const captureBuffers = new Map<string, CaptureBuffer>()

ipcMain.on('capture:chunk', async (_e, payload: CaptureChunk) => {
  let entry = captureBuffers.get(payload.id)
  if (!entry) {
    entry = { buf: '', text: '', tool: payload.tool || 'unknown' }
    captureBuffers.set(payload.id, entry)
  }

  // Perplexity: standard SSE '\n\n' event boundaries, but each event's
  // extraction yields both incremental deltas (appended, for live preview)
  // and sometimes an authoritative full-text snapshot (which overrides
  // entry.text outright — see perplexityParser.ts).
  if (entry.tool === 'perplexity') {
    if (payload.chunk) {
      entry.buf += payload.chunk
      const events = entry.buf.split('\n\n')
      entry.buf = events.pop() ?? ''
      for (const evt of events) {
        if (process.env.FD_CAPTURE_DEBUG) {
          console.log(`[FlowDesk capture][perplexity][raw event]`, evt)
        }
        const { deltas, finalText } = extractPerplexitySSEEvent(evt)
        for (const delta of deltas) entry.text += delta
        if (finalText) entry.text = finalText
      }
      mainWindow?.webContents.send('capture:live', { id: payload.id, tool: entry.tool, textSoFar: entry.text })
    }
    if (payload.error) {
      // The page aborts the underlying connection right after end_of_stream
      // as its normal way of closing up — flush whatever's left in the
      // buffer first, same as the 'done' path below, since real content can
      // still be sitting there unprocessed when the abort lands.
      if (entry.buf) {
        if (process.env.FD_CAPTURE_DEBUG) {
          console.log(`[FlowDesk capture][perplexity][raw event][on-error flush]`, entry.buf)
        }
        const { deltas, finalText } = extractPerplexitySSEEvent(entry.buf)
        for (const delta of deltas) entry.text += delta
        if (finalText) entry.text = finalText
        entry.buf = ''
      }
      console.error(`[FlowDesk capture][perplexity] stream error (likely benign end-of-stream abort):`, payload.error, `— extracted text so far:`, JSON.stringify(entry.text))
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text, error: entry.text ? undefined : payload.error })
      captureBuffers.delete(payload.id)
      return
    }
    if (payload.done) {
      if (entry.buf) {
        const { deltas, finalText } = extractPerplexitySSEEvent(entry.buf)
        for (const delta of deltas) entry.text += delta
        if (finalText) entry.text = finalText
        entry.buf = ''
      }
      console.log(`[FlowDesk capture][perplexity] response complete:\n`, entry.text)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text })
      captureBuffers.delete(payload.id)
    }
    return
  }

  // Grok's extraction already happened client-side (buildWSCaptureInjectSrc
  // parses the WebSocket JSON events and only posts clean text deltas) —
  // main.ts just appends them in arrival order, no further parsing needed.
  if (entry.tool === 'grok') {
    if (payload.chunk) {
      entry.text += payload.chunk
      mainWindow?.webContents.send('capture:live', { id: payload.id, tool: entry.tool, textSoFar: entry.text })
    }
    if (payload.error) {
      console.error(`[FlowDesk capture][grok] stream error:`, payload.error)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text, error: payload.error })
      captureBuffers.delete(payload.id)
      return
    }
    if (payload.done) {
      console.log(`[FlowDesk capture][grok] response complete:\n`, entry.text)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text })
      captureBuffers.delete(payload.id)
    }
    return
  }

  // Qwen: standard SSE '\n\n' event boundaries, one JSON object per event
  // (confirmed via a live capture — see qwenParser.ts for the shape).
  if (entry.tool === 'qwen') {
    if (payload.chunk) {
      entry.buf += payload.chunk
      const events = entry.buf.split('\n\n')
      entry.buf = events.pop() ?? ''
      for (const evt of events) {
        if (process.env.FD_CAPTURE_DEBUG) {
          console.log(`[FlowDesk capture][qwen][raw event]`, evt.slice(0, 500))
        }
        for (const found of extractQwenTextFromSSEEvent(evt)) entry.text += found
        const thinking = extractThinkingSummaryFromSSEEvent(evt)
        if (thinking) console.log(`[FlowDesk thinking][qwen]`, JSON.stringify(thinking))
        const usage = extractQwenUsageFromSSEEvent(evt)
        if (usage) mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
      }
      mainWindow?.webContents.send('capture:live', { id: payload.id, tool: entry.tool, textSoFar: entry.text })
    }
    if (payload.error) {
      console.error(`[FlowDesk capture][qwen] stream error:`, payload.error)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text, error: payload.error })
      captureBuffers.delete(payload.id)
      return
    }
    if (payload.done) {
      if (entry.buf) {
        for (const found of extractQwenTextFromSSEEvent(entry.buf)) entry.text += found
        const usage = extractQwenUsageFromSSEEvent(entry.buf)
        if (usage) {
          console.log(`[FlowDesk usage][qwen]`, `${usage.outputTokens}/${usage.totalTokens} tokens (input=${usage.inputTokens}, reasoning=${usage.reasoningTokens ?? 0})`)
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
        entry.buf = ''
      }
      console.log(`[FlowDesk capture][qwen] response complete:\n`, entry.text)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text })
      captureBuffers.delete(payload.id)
    }
    return
  }

  // Gemini's batchexecute frames aren't SSE — no '\n\n' event boundaries,
  // and each frame carries the FULL current candidate text rather than an
  // incremental delta. Re-parse the whole accumulated buffer on each chunk
  // and each successful extraction *replaces* entry.text instead of
  // appending to it.
  if (entry.tool === 'gemini') {
    if (payload.chunk) {
      entry.buf += payload.chunk
      const latest = extractLatestGeminiText(entry.buf)
      if (latest !== null) entry.text = latest
      mainWindow?.webContents.send('capture:live', { id: payload.id, tool: entry.tool, textSoFar: entry.text })
    }
    if (payload.error) {
      console.error(`[FlowDesk capture][gemini] stream error:`, payload.error)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text, error: payload.error })
      captureBuffers.delete(payload.id)
      return
    }
    if (payload.done) {
      if (process.env.FD_CAPTURE_DEBUG) {
        console.log(`[FlowDesk capture][gemini][raw buffer]`, entry.buf.slice(0, 3000))
      }
      const latest = extractLatestGeminiText(entry.buf)
      if (latest !== null) entry.text = latest

      // Image generation turns: the captured text is a fake placeholder
      // ("http://googleusercontent.com/image_generation_content/449") that
      // Gemini's own web app swaps for the real image client-side — swap it
      // here too, for the real https://lh3.googleusercontent.com/... URL(s)
      // found elsewhere in the same payload, as Markdown image syntax so
      // any UI rendering the captured text can show the actual image.
      const imageUrls = extractGeminiImageUrlsFromRaw(entry.buf)
      if (imageUrls.length > 0) {
        // The raw lh3.googleusercontent.com URL 404s when loaded from the
        // app's own renderer (no matching Google auth cookies there) — fetch
        // it here using the exact session that captured it (same cookies),
        // save it to disk, and swap in a flowdesk-image:// URL instead of
        // the bare (and otherwise-inaccessible) googleusercontent URL.
        const savedUrls = await Promise.all(imageUrls.map(url => downloadAndSaveGeneratedImage(url, _e.sender.session)))
        const resolvedUrls = imageUrls.map((url, idx) => savedUrls[idx] ?? url)

        const placeholderPattern = /https?:\/\/googleusercontent\.com\/image_generation_content\/\d+\/?/g
        let i = 0
        entry.text = entry.text.replace(placeholderPattern, () => {
          const url = resolvedUrls[i] ?? resolvedUrls[resolvedUrls.length - 1]
          i += 1
          return `![generated image](${url})`
        })
        // Any image URLs beyond the number of placeholders found (or if no
        // placeholder was present at all) still get appended, so nothing's lost.
        for (; i < resolvedUrls.length; i++) entry.text += `\n\n![generated image](${resolvedUrls[i]})`
      }

      const meta = extractGeminiTurnMetaFromRaw(entry.buf)
      if (meta) {
        console.log(`[FlowDesk modelInfo][gemini]`, JSON.stringify(meta))
        mainWindow?.webContents.send('capture:modelInfo', { tool: entry.tool, info: meta })
        if (meta.conversationId) {
          mainWindow?.webContents.send('capture:ids', { tool: entry.tool, ids: { conversationId: meta.conversationId, messageId: meta.responseId } })
        }
      }
      console.log(`[FlowDesk capture][gemini] response complete:\n`, entry.text)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text })
      captureBuffers.delete(payload.id)
    }
    return
  }

  if (payload.chunk) {
    entry.buf += payload.chunk
    // SSE events are separated by a blank line; keep any trailing
    // incomplete event in the buffer until the next chunk arrives.
    const events = entry.buf.split('\n\n')
    entry.buf = events.pop() ?? ''
    for (const evt of events) {
      if (process.env.FD_CAPTURE_DEBUG) {
        console.log(`[FlowDesk capture][${entry.tool}][raw event]`, evt.slice(0, 500))
      }
      for (const found of extractCaptureText(entry.tool, evt)) entry.text += found
      if (entry.tool === 'chatgpt') {
        const usage = extractUsageFromSSEEvent(evt)
        if (usage) {
          console.log(`[FlowDesk usage][chatgpt]`, usage.map(u => `${u.feature}: ${u.remaining} left (resets ${u.resetAfter})`).join(' | '))
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
        const modelInfo = extractModelInfoFromSSEEvent(evt)
        if (modelInfo) {
          console.log(`[FlowDesk modelInfo][chatgpt]`, `model=${modelInfo.modelSlug} plan=${modelInfo.planType} autoReasoning=${modelInfo.autoSwitchedToReasoning} ttfvt=${modelInfo.ttfvtMs}ms region=${modelInfo.clusterRegion}`)
          mainWindow?.webContents.send('capture:modelInfo', { tool: entry.tool, info: modelInfo })
        }
        const ids = extractIdsFromSSEEvent(evt)
        if (ids) {
          console.log(`[FlowDesk ids][chatgpt]`, `conversationId=${ids.conversationId} messageId=${ids.messageId}`)
          mainWindow?.webContents.send('capture:ids', { tool: entry.tool, ids })
        }
      }
      if (entry.tool === 'claude') {
        const modelInfo = extractClaudeModelInfoFromSSEEvent(evt)
        if (modelInfo) {
          console.log(`[FlowDesk modelInfo][claude]`, JSON.stringify(modelInfo))
          mainWindow?.webContents.send('capture:modelInfo', { tool: entry.tool, info: modelInfo })
        }
        const usage = extractClaudeUsageFromSSEEvent(evt)
        if (usage) {
          console.log(`[FlowDesk usage][claude]`, usage.map(w => `${w.window}: ${Math.round(w.utilization * 100)}% used (${w.status})`).join(' | '))
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
      }
    }
    mainWindow?.webContents.send('capture:live', { id: payload.id, tool: entry.tool, textSoFar: entry.text })
  }

  if (payload.error) {
    console.error(`[FlowDesk capture][${entry.tool}] stream error:`, payload.error)
    emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text, error: payload.error })
    captureBuffers.delete(payload.id)
    return
  }

  if (payload.done) {
    // Flush whatever's left in the buffer — the final SSE event is rarely
    // followed by a trailing blank line before the connection closes, so it
    // never gets processed by the '\n\n' splitter above.
    if (entry.buf) {
      if (process.env.FD_CAPTURE_DEBUG) {
        console.log(`[FlowDesk capture][${entry.tool}][raw event][final]`, entry.buf.slice(0, 500))
      }
      for (const found of extractCaptureText(entry.tool, entry.buf)) entry.text += found
      if (entry.tool === 'chatgpt') {
        const usage = extractUsageFromSSEEvent(entry.buf)
        if (usage) {
          console.log(`[FlowDesk usage][chatgpt]`, usage.map(u => `${u.feature}: ${u.remaining} left (resets ${u.resetAfter})`).join(' | '))
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
        const modelInfo = extractModelInfoFromSSEEvent(entry.buf)
        if (modelInfo) {
          console.log(`[FlowDesk modelInfo][chatgpt]`, `model=${modelInfo.modelSlug} plan=${modelInfo.planType} autoReasoning=${modelInfo.autoSwitchedToReasoning} ttfvt=${modelInfo.ttfvtMs}ms region=${modelInfo.clusterRegion}`)
          mainWindow?.webContents.send('capture:modelInfo', { tool: entry.tool, info: modelInfo })
        }
        const ids = extractIdsFromSSEEvent(entry.buf)
        if (ids) {
          console.log(`[FlowDesk ids][chatgpt]`, `conversationId=${ids.conversationId} messageId=${ids.messageId}`)
          mainWindow?.webContents.send('capture:ids', { tool: entry.tool, ids })
        }
      }
      if (entry.tool === 'claude') {
        const modelInfo = extractClaudeModelInfoFromSSEEvent(entry.buf)
        if (modelInfo) {
          console.log(`[FlowDesk modelInfo][claude]`, JSON.stringify(modelInfo))
          mainWindow?.webContents.send('capture:modelInfo', { tool: entry.tool, info: modelInfo })
        }
        const usage = extractClaudeUsageFromSSEEvent(entry.buf)
        if (usage) {
          console.log(`[FlowDesk usage][claude]`, usage.map(w => `${w.window}: ${Math.round(w.utilization * 100)}% used (${w.status})`).join(' | '))
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
      }
      entry.buf = ''
    }
    console.log(`[FlowDesk capture][${entry.tool}] response complete:\n`, entry.text)
    emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text })
    captureBuffers.delete(payload.id)
  }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  // Apply persisted settings on startup (tray, etc.)
  const savedSettings = store.get('settings') as Partial<AppSettings>
  if (savedSettings) applySettings(savedSettings)

  // Serves images saved by downloadAndSaveGeneratedImage from disk. Files
  // are named with a UUID, so decoding+resolving the requested path is safe
  // against traversal (join() below stays inside generatedImagesDir).
  protocol.handle('flowdesk-image', (request) => {
    const fileName = decodeURIComponent(new URL(request.url).hostname || new URL(request.url).pathname.replace(/^\/+/, ''))
    const filePath = join(generatedImagesDir, fileName)
    if (!filePath.startsWith(generatedImagesDir)) return new Response('Forbidden', { status: 403 })
    // pathToFileURL (not a bare `file://${filePath}` template) — on Windows,
    // filePath has backslashes and a drive letter (C:\Users\...), which
    // isn't a valid file: URL as-is; pathToFileURL handles that escaping
    // correctly on every platform.
    return net.fetch(pathToFileURL(filePath).href)
  })
})
app.on('window-all-closed', () => {
  const s = store.get('settings') as Partial<AppSettings>
  // Only quit if NOT using minimize-to-tray (tray users quit via tray menu)
  if (!s?.minimizeToTray || !tray) {
    if (process.platform !== 'darwin') app.quit()
  }
})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  destroyAllViews()
  if (tray) { tray.destroy(); tray = null }
})
