import { app, BrowserWindow, ipcMain, globalShortcut, session, shell, Menu, Tray, nativeImage, crashReporter } from 'electron'
import { randomUUID } from 'crypto'
import { deflateSync } from 'zlib'

// Initializes Crashpad so Windows dev runs are less likely to log "not connected" (harmless Chromium noise otherwise).
crashReporter.start({ productName: 'FlowDesk', uploadToServer: false })

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
import { setMainWindow, showView, hideView, closeTabView, destroyAllViews, getActiveView, getViewById, setCustomBounds, goBack, goForward, reloadActive, navigateActive, setNavWidth } from './sessions'
import { setSocialMainWindow, showSocialView, hideAllSocialViews, destroySocialView, setSocialNavWidth, socialGoBack, socialGoForward, socialReload } from './socialHub'
import { injectPrompt, getLatestAssistantText, getSelectedText } from './injector'
import type { AppSettings } from '../src/types/database'

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
      preload: join(__dirname, '../preload/preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  setMainWindow(mainWindow)
  setSocialMainWindow(mainWindow)

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

// IPC: update sidebar nav width so bounds calculations stay correct
ipcMain.handle('view:setNavWidth', (_e, w: number) => { setNavWidth(w); setSocialNavWidth(w) })

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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  // Apply persisted settings on startup (tray, etc.)
  const savedSettings = store.get('settings') as Partial<AppSettings>
  if (savedSettings) applySettings(savedSettings)
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
