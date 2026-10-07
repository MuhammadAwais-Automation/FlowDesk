import { app, BrowserWindow, ipcMain, globalShortcut, session, shell, Menu, Tray, nativeImage, crashReporter, nativeTheme, protocol, net, dialog, webContents } from 'electron'
import { randomUUID } from 'crypto'
import { deflateSync } from 'zlib'
import { mkdir, writeFile, copyFile } from 'fs/promises'
import { pathToFileURL } from 'url'
import { createElectronBrainClient } from './brain/electronClient'
import type { BrainClient } from './brain/client'
import type { BrainScope } from '../src/types/brain'

// Initializes Crashpad so Windows dev runs are less likely to log "not connected" (harmless Chromium noise otherwise).
crashReporter.start({ productName: 'FlowDesk', uploadToServer: false })

// Prevent Windows Chromium GPU cache locking (Access is denied 0x5) across concurrent session partitions
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// "Continue with Google" buttons (Pinterest and other sites using Google
// Identity Services) ask Chrome's FedCM for its built-in account chooser.
// Electron has no FedCM UI, so the click silently did nothing. With FedCM off,
// Google falls back to its own popup window (accounts.google.com/gsi/...),
// which the sign-in windows open on the same session.
app.commandLine.appendSwitch('disable-features', 'FedCm')

// Two instances share one user-data dir: the second cannot write the cookie
// databases the first holds open, so its logins lived only in memory and were
// gone after a restart (Pinterest account 1 signed out every time). Hand off to
// the running window instead.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

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

import { join, basename, resolve, sep } from 'path'
import Store from 'electron-store'
import { setMainWindow, showView, hideView, closeTabView, destroyAllViews, getActiveView, getViewById, setCustomBounds, goBack, goForward, reloadActive, navigateActive, setNavWidth, setToolDockWidth, findAnyViewByUrl, findWorkerViewByTool, prewarmBackgroundViews, flushAllCookies, rememberedView } from './sessions'
import { attachShellLinkPolicy } from './shellLinkPolicy'
import { addSocialAccount, isSocialPlatform, removeSocialAccount, setSocialShowHandler, socialAccountsStatus } from './socialAccounts'
import { startProbeRunner } from './discovery/probeRunner'
import { APPROVAL_TIMEOUT_MS, loadPolicy, policyPaths, readActionLog, savePolicy } from './gateway/actionPolicy'
import { initSkillsRegistry, listSkills, getSkill, saveSkill, deleteSkill, listWorkflows, getWorkflow, saveWorkflow, deleteWorkflow } from './skills/skillRegistry'
import { listWorkflowRuns, configureRunStore } from './skills/workflowRunner'
import { injectPrompt, getLatestAssistantText, getSelectedText, type AITool } from './injector'
import { extractTextFromSSEEvent, extractUsageFromSSEEvent, extractModelInfoFromSSEEvent, extractIdsFromSSEEvent, extractImageAssetsFromSSEEvent, isMessageStreamComplete, isDalleToolInvoked } from './chatgptParser'
import { extractTextFromClaudeSSEEvent, extractModelInfoFromSSEEvent as extractClaudeModelInfoFromSSEEvent, extractUsageFromSSEEvent as extractClaudeUsageFromSSEEvent } from './claudeParser'
import { extractLatestGeminiText, extractTurnMetaFromRaw as extractGeminiTurnMetaFromRaw, extractImageUrlsFromRaw as extractGeminiImageUrlsFromRaw } from './geminiParser'
import { extractTextFromSSEEvent as extractQwenTextFromSSEEvent, extractThinkingSummaryFromSSEEvent, extractUsageFromSSEEvent as extractQwenUsageFromSSEEvent } from './qwenParser'
import { extractPerplexitySSEEvent } from './perplexityParser'
import type { AppSettings } from '../src/types/database'
import { PROVIDER_URLS } from './providerUrls'
import { configureBrowserWorkerQueue, notifyCaptureComplete, notifyCaptureActivity, notifyImageProgress, workerProgress, askBrowserProvider, type WorkerProgress } from './agent/browserWorkerQueue'
import { orderBrowserAccounts } from './agent/accountFailover'
import { waStatus, waListChats, waListMessages, waSend, waUnreadWithMessages } from './whatsapp/whatsapp'
import { liFeed, liSearch } from './linkedin/linkedin'
import {
  rdStatus,
  rdFeed,
  rdPostComments,
  rdSearch,
  rdVotePost,
  rdVoteComment,
  rdCreateComment,
  rdCreatePost,
  rdSubscribe,
  rdMarkRead,
} from './reddit'
import {
  notebooklmStatus, notebooklmDoctor, notebooklmLogin, notebooklmSelectAccount,
  notebooklmGetActiveProfile, notebooklmDownloadArtifact, normalizeArtifactKind,
  notebooklmStartChatStream, notebooklmCancelChatStream,
  type NotebookLMSourceInput, type NotebookLMArtifactRequest,
} from './notebooklm'
import { notebooklmServiceState, startNotebookLMService } from './notebooklmService'
import { getNativeNotebookCapability, openNativeNotebook, closeNativeNotebook } from './notebooklmNative'
import { notebookCapabilities, type StartResearchInput, type GenerateArtifactInput } from './notebooklmCapabilities'
import { NotebookJobQueue, type NotebookJob } from './notebooklmJobs'
import { configureNotebookJobRuntime } from './notebooklmJobRuntime'
import { recordProviderUsage, type ProviderLimits } from './providerUsage'
import { socialRecipeRequestSchema } from './brain/socialRecipes'
import { executeBrainCapability } from './brain/capabilityProtocol'
import { startLocalGateway, setGatewayBrainHandler, knownWriteActions, executeWorkflow, resumeWorkflow, type GatewayServer } from './gateway/localGateway'
import { setGooglePartitionGetter, setGoogleAccountsGetter } from './flow'
import { waitForGoogleSignIn } from './googleSignInChooser'
import { configureChatgptImages } from './chatgptImages'
import { startRadar } from './tiktok/tiktokRadar'
import { loadNiches } from './tiktok/tiktokRadarStore'
import { setActiveTikTokAccount, setOnAccountSwitchedListener } from './tiktok/tiktok'
import { setActiveLinkedInAccount, setOnLinkedInAccountSwitchedListener, liAccounts, saveLinkedInAccounts } from './linkedin/linkedin'

/**
 * Brain chat digest: pending. It ran on the in-app Claude SDK, removed
 * 2026-10-08 with the in-app agents; the Brain rework will pick its model.
 * Each chat comes back with an error so the step reports what it skipped.
 */
async function digestChats(chats: Array<{ chatId: string; name: string; transcript: string }>) {
  const error = 'chat digest is pending: the in-app Claude model was removed; it returns with the Brain rework'
  return { ok: true, results: chats.map(chat => ({ chatId: chat.chatId, name: chat.name, prose: '', error })) }
}

const captureDebugEnabled = () => !app.isPackaged && process.env.FD_CAPTURE_DEBUG === '1'

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

configureBrowserWorkerQueue({
  getAccounts: () => orderBrowserAccounts(
    store.get('agentBrowserAccountEmail' as never) as string | null,
    (store.get('gmailSessions') as GmailSession[]).map(({ email, partition }) => ({ email, partition })),
  ),
})

configureChatgptImages({
  getAccounts: () => (store.get('gmailSessions') as GmailSession[]).map(({ email, partition }) => ({ email, partition })),
  getPreferred: () => store.get('agentBrowserAccountEmail' as never) as string | null,
})

setGoogleAccountsGetter(() => (store.get('gmailSessions') as GmailSession[]).map(({ email, partition, label }) => ({ email, partition, label: label ?? null })))

// social_open_login: show FlowDesk on Social → platform → account (the user
// picks a Google account in the top bar and signs in there), not a popup.
setSocialShowHandler((platform, account) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const win = mainWindow
  if (win.isMinimized()) win.restore()
  win.show()
  // Windows refuses focus() from a background app; a moment on top brings it forward.
  win.setAlwaysOnTop(true)
  win.focus()
  setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false) }, 300)
  const send = () => win.webContents.send('social:show', { platform, account: account.id })
  // A renderer still loading has not subscribed yet; send once it has.
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 500))
  else send()
  return true
})

setGooglePartitionGetter(() => {
  const sessions = (store.get('gmailSessions') as GmailSession[]) || []
  if (sessions.length === 0) return null
  const preferred = sessions.find(s => s.email.toLowerCase().includes('awaismushtaqokr'))
  return preferred?.partition ?? sessions[0]?.partition ?? null
})

// Backstop only — electron/agent/browserWorkerQueue.ts's own 60s
// handler-level timeout is authoritative and fires first; this just guards
// against whatever default the SDK's own MCP tool-call timeout would
// otherwise apply if that internal timeout were ever bypassed.
if (!process.env.MCP_TOOL_TIMEOUT) process.env.MCP_TOOL_TIMEOUT = '90000'

let mainWindow: BrowserWindow
let tray: Tray | null = null
let brainClient: BrainClient | null = null

async function brainRequest(method: Parameters<BrainClient['request']>[0], payload: unknown) {
  if (!brainClient) throw new Error('Brain is starting')
  return brainClient.request(method, payload)
}

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
  const isHeadless = process.env.FLOWDESK_HEADLESS === '1' || process.argv.includes('--headless') || process.argv.includes('--hidden') || process.argv.includes('--background')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    show: !isHeadless,
    title: 'FlowDesk',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  setMainWindow(mainWindow)

  setOnAccountSwitchedListener((accountId) => {
    try {
      mainWindow?.webContents.send('tiktok:accountSwitched', accountId)
    } catch {}
  })

  setOnLinkedInAccountSwitchedListener((accountId) => {
    try {
      mainWindow?.webContents.send('linkedin:accountSwitched', accountId)
    } catch {}
  })

  // Defence in depth for links the shell renders. The renderer already refuses
  // to paint a non-http(s) citation as an href (src/lib/shellLinkDecision.ts),
  // but that is a rendering decision: it cannot stop a navigation started any
  // other way, and it protects only the components that remember to call it.
  // This is the enforcement half — nothing leaves the shell, and nothing
  // reaches `shell.openExternal`, unless the one shared allowlist permits it.
  attachShellLinkPolicy(mainWindow.webContents)

  // System-theme changes push to the renderer live so "System" theme setting
  // tracks OS dark/light switches without a restart.
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:systemChanged', { shouldUseDarkColors: nativeTheme.shouldUseDarkColors })
  })

  // Minimize-to-tray: intercept close event (or keep hidden in headless mode)
  mainWindow.on('close', (e) => {
    const s = store.get('settings') as Partial<AppSettings>
    if ((s?.minimizeToTray || isHeadless) && tray) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  watchRendererMount(mainWindow)
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
    if (!isHeadless) {
      // Detached: docked DevTools took half the 1200px window and squeezed the app UI.
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (!isHeadless) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
      // Windows blocks focus-stealing, so a window launched from a terminal opens
      // behind it (and Chromium skips painting occluded windows, so it looks blank).
      // A brief always-on-top raises it once without pinning it there.
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
    })
  } else {
    if (!tray) setupTray()
    console.log('[FlowDesk] Running in HEADLESS mode (window hidden, Local Gateway & background sessions active)')
  }

  registerShortcuts()
}

// A cold start sometimes finishes loading the page without React ever mounting
// (an entry module request fails while the dev server is still warming up, or
// the load itself fails) and nothing retries, so the window stays white until
// the app is restarted. Reload when #root is still empty a while after load.
function watchRendererMount(win: BrowserWindow) {
  const MAX_RELOADS = 3
  let reloads = 0
  let timer: NodeJS.Timeout | undefined
  const retry = (why: string) => {
    if (win.isDestroyed() || reloads >= MAX_RELOADS) return
    reloads++
    console.warn(`[FlowDesk] renderer ${why}, reloading (${reloads}/${MAX_RELOADS})`)
    win.webContents.reloadIgnoringCache()
  }
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 = aborted by a newer navigation
    clearTimeout(timer)
    timer = setTimeout(() => retry(`load failed (${desc})`), 1500)
  })
  win.webContents.on('did-finish-load', () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (win.isDestroyed()) return
      const kids = await win.webContents
        .executeJavaScript(`document.getElementById('root')?.childElementCount ?? 0`)
        .catch(() => 0)
      if (!kids) retry('did not mount')
    }, 10_000)
  })
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
// Settings → Security: what an outside agent may do (see gateway/actionPolicy.ts).
ipcMain.handle('actionPolicy:get', async () => {
  const { policyFile } = policyPaths(app.getPath('userData'))
  return { policy: await loadPolicy(policyFile), actions: await knownWriteActions(), file: policyFile }
})
ipcMain.handle('actionPolicy:set', async (_e, policy: unknown) => savePolicy(policyPaths(app.getPath('userData')).policyFile, policy))
ipcMain.handle('actionPolicy:log', async (_e, limit: unknown) =>
  readActionLog(policyPaths(app.getPath('userData')).logFile, typeof limit === 'number' ? Math.min(Math.max(limit, 1), 500) : 50))

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

// Mirrors the scope resolution in runAgentMessage (global scope, else the
// active project's scope as its child) so the Agent page can show which
// scope a turn will actually use, next to the Use/Learn/Temp controls.
// A visible answer to "which scope am I in" is what the earlier session-scope
// bug hid entirely.
ipcMain.handle('brain:getActiveScope', async () => {
  if (!brainClient) return null
  try {
    const globalScope = await brainRequest('ensureScope', { type: 'global', externalRef: 'global', name: 'Global' }) as BrainScope
    const { projects: brainProjects, activeProjectId: brainProjectId } = projectSnapshot()
    const brainProject = brainProjects.find(project => project.id === brainProjectId)
    return brainProject
      ? await brainRequest('ensureScope', { type: 'project', externalRef: brainProject.id, name: brainProject.title, parentId: globalScope.id }) as BrainScope
      : globalScope
  } catch {
    return null
  }
})

ipcMain.handle('brain:getStatus', () => brainRequest('status', {}))
ipcMain.handle('brain:getOverview', (_e, scopeId?: string) => brainRequest('overview', { scopeId }))
ipcMain.handle('brain:ensureScope', (_e, input: unknown) => brainRequest('ensureScope', input))
ipcMain.handle('brain:listScopes', (_e, input?: unknown) => brainRequest('listScopes', input ?? {}))
ipcMain.handle('brain:search', (_e, input: unknown) => brainRequest('search', input))
ipcMain.handle('brain:getMemory', (_e, id: string) => brainRequest('getMemory', { id }))
ipcMain.handle('brain:listMemories', (_e, scopeId?: string) => brainRequest('listMemories', { scopeId }))
ipcMain.handle('brain:remember', (_e, input: unknown) => brainRequest('remember', input))
ipcMain.handle('brain:forget', async (_e, id: string) => {
  const confirmation = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Forget memory'],
    defaultId: 0,
    cancelId: 0,
    title: 'Forget Brain memory?',
    message: 'This creates a recoverable tombstone and removes the memory from retrieval.',
  })
  if (confirmation.response !== 1) return false
  return brainRequest('forget', { id })
})
ipcMain.handle('brain:listCandidates', (_e, scopeId?: string) => brainRequest('listCandidates', { scopeId }))
ipcMain.handle('brain:decideCandidate', (_e, input: unknown) => brainRequest('decideCandidate', input))
ipcMain.handle('brain:listJobs', () => brainRequest('listJobs', {}))
ipcMain.handle('brain:listOpportunities', (_e, input: unknown) => brainRequest('listOpportunities', input))
ipcMain.handle('brain:countOpportunities', (_e, input: unknown) => brainRequest('countOpportunities', input))
ipcMain.handle('brain:knowledgeManifest', (_e, input: unknown) => brainRequest('knowledge.manifest', input))
ipcMain.handle('brain:knowledgeRead', (_e, input: unknown) => brainRequest('knowledge.read', input))
ipcMain.handle('brain:knowledgeSearch', (_e, input: unknown) => brainRequest('knowledge.search', input))
ipcMain.handle('brain:knowledgeDailyNote', (_e, input: unknown) => brainRequest('knowledge.dailyNote', input))
ipcMain.handle('brain:knowledgeNeighbors', (_e, input: unknown) => brainRequest('knowledge.neighbors', input))
ipcMain.handle('brain:knowledgeGraph', (_e, input: unknown) => brainRequest('knowledge.graph', input))
ipcMain.handle('brain:knowledgeAnswerPack', (_e, input: unknown) => brainRequest('knowledge.answerPack', input))
ipcMain.handle('brain:entityList', (_e, input: unknown) => brainRequest('entity.list', input))
ipcMain.handle('brain:entityBackfill', (_e, input: unknown) => brainRequest('entity.backfill', input))
ipcMain.handle('brain:entityGet', (_e, input: unknown) => brainRequest('entity.get', input))
ipcMain.handle('brain:entityMentions', (_e, input: unknown) => brainRequest('entity.mentions', input))
ipcMain.handle('brain:entityListProposals', (_e, input: unknown) => brainRequest('entity.listProposals', input))
ipcMain.handle('brain:entityDecideProposal', (_e, input: unknown) => brainRequest('entity.decideProposal', input))

// ── Inline Dictation safe IPC handlers ─────────────────────────────
ipcMain.handle('inlineDictation:getRunState', (_e, _surface: unknown, _sessionId: unknown) => null)
ipcMain.handle('inlineDictation:start', (_e, _input: unknown) => ({ status: 'unavailable' }))
ipcMain.handle('inlineDictation:stop', (_e, _runId: unknown) => ({ status: 'completed' }))
ipcMain.handle('brain:knowledgeBuildVectors', (_e, input: unknown) => brainRequest('knowledge.buildVectors', input))
ipcMain.handle('brain:knowledgeVectorStatus', (_e, input: unknown) => brainRequest('knowledge.vectorStatus', input))
ipcMain.handle('brain:listEvents', (_e, input: unknown) => brainRequest('listEvents', input))
ipcMain.handle('brain:knowledgeList', (_e, input: unknown) => brainRequest('knowledge.list', input))
ipcMain.handle('brain:knowledgeImportVault', (_e, input: unknown) => brainRequest('knowledge.importVault', input))
ipcMain.handle('brain:knowledgeProposeCandidate', (_e, input: unknown) => brainRequest('knowledge.proposeCandidate', input))
ipcMain.handle('brain:knowledgeListCandidates', (_e, input: unknown) => brainRequest('knowledge.listCandidates', input))
ipcMain.handle('brain:knowledgeDecideCandidate', (_e, input: unknown) => brainRequest('knowledge.decideCandidate', input))
ipcMain.handle('brain:knowledgeCompact', (_e, input: unknown) => brainRequest('knowledge.compact', input))
ipcMain.handle('brain:knowledgeMigrateMemories', (_e, input: unknown) => brainRequest('knowledge.migrateMemories', input))
ipcMain.handle('brain:knowledgeListUnresolvedLinks', (_e, input: unknown) => brainRequest('knowledge.listUnresolvedLinks', input))
ipcMain.handle('brain:getOpportunityEvidence', (_e, input: unknown) => brainRequest('getOpportunityEvidence', input))
ipcMain.handle('brain:reviewOpportunity', (_e, input: unknown) => brainRequest('reviewOpportunity', input))
ipcMain.handle('brain:buildDecisionBrief', (_e, input: unknown) => brainRequest('buildDecisionBrief', input))
ipcMain.handle('brain:listSourceMetrics', (_e, input: unknown) => brainRequest('listSourceMetrics', input))
ipcMain.handle('brain:getArtifactManifest', (_e, jobId: string) => brainRequest('getArtifactManifest', { jobId }))
ipcMain.handle('brain:runRecipe', (_e, input: unknown) => brainRequest('enqueueJob', input))
ipcMain.handle('brain:completeJob', (_e, input: unknown) => brainRequest('completeJob', input))
ipcMain.handle('brain:controlJob', (_e, input: unknown) => brainRequest('controlJob', input))
ipcMain.handle('brain:getVaultStatus', () => brainRequest('vaultStatus', {}))
ipcMain.handle('brain:syncVault', () => brainRequest('vaultSync', {}))
ipcMain.handle('brain:listVaultConflicts', (_e, scopeId: unknown) => brainRequest('listVaultConflicts', { scopeId }))
ipcMain.handle('brain:resolveVaultConflict', (_e, input: unknown) => brainRequest('resolveVaultConflict', input))
ipcMain.handle('brain:getConsent', (_e, input: unknown) => brainRequest('getConsent', input))
ipcMain.handle('brain:grantConsent', (_e, input: unknown) => brainRequest('grantConsent', input))
ipcMain.handle('brain:revokeConsent', (_e, input: unknown) => brainRequest('revokeConsent', input))
ipcMain.handle('brain:exportBackup', async () => {
  const selected = await dialog.showSaveDialog({
    title: 'Export FlowDesk Brain backup',
    defaultPath: join(app.getPath('downloads'), `flowdesk-brain-${new Date().toISOString().slice(0, 10)}.flowdesk-brain.zip`),
    filters: [{ name: 'FlowDesk Brain backup', extensions: ['zip'] }],
  })
  if (selected.canceled || !selected.filePath) return null
  return brainRequest('exportBackup', { outputPath: selected.filePath })
})
ipcMain.handle('brain:importBackup', async () => {
  const selected = await dialog.showOpenDialog({ title: 'Import FlowDesk Brain backup', properties: ['openFile'], filters: [{ name: 'FlowDesk Brain backup', extensions: ['zip'] }] })
  const inputPath = selected.filePaths[0]
  if (selected.canceled || !inputPath) return null
  const confirmation = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Import backup'],
    defaultId: 0,
    cancelId: 0,
    title: 'Replace current Brain?',
    message: 'FlowDesk will create a pre-import backup, validate the archive, and then replace the current Brain.',
  })
  if (confirmation.response !== 1) return null
  return brainRequest('importBackup', { inputPath })
})
ipcMain.handle('brain:createMonitor', (_e, input: unknown) => brainRequest('createMonitor', input))
ipcMain.handle('brain:listMonitors', (_e, scopeId?: string) => brainRequest('listMonitors', { scopeId }))
ipcMain.handle('brain:setMonitorStatus', (_e, input: unknown) => brainRequest('setMonitorStatus', input))
ipcMain.handle('brain:deleteMonitor', (_e, input: unknown) => brainRequest('deleteMonitor', input))
ipcMain.handle('brain:listEntities', (_e, scopeId: string) => brainRequest('listEntities', { scopeId }))
ipcMain.handle('brain:getGraph', (_e, scopeId: string) => brainRequest('getGraph', { scopeId }))
ipcMain.handle('brain:runSocialRecipe', async (_e, input: unknown) => {
  const request = socialRecipeRequestSchema.parse(input)
  const provider = 'local-brain'
  const consent = await brainRequest('getConsent', { scopeId: request.scopeId, recipeId: request.recipeId, provider }) as boolean
  if (!consent) {
    return {
      requiresConsent: true,
      provider,
      fields: request.recipeId.startsWith('whatsapp') ? ['message_text', 'sender', 'timestamp', 'chat_id'] : ['post_text', 'author', 'timestamp', 'url', 'engagement'],
      retentionDays: request.parameters.retentionDays ?? 30,
      destinationScopeId: request.scopeId,
    }
  }
  const job = await brainRequest('enqueueJob', {
    recipeId: request.recipeId,
    recipeVersion: 1,
    scopeId: request.scopeId,
    accountId: request.accountId ?? null,
    // enqueueJob's idempotency key is a hash of recipeId + scopeId + accountId
    // + parameters, and reuses any existing non-failed/non-cancelled job with
    // the same key instead of capturing again. Without windowStart, every
    // manual "Scan" click sent identical parameters, so every click after the
    // first silently returned the same already-completed job — the button
    // looked like it ran, but no new capture ever happened. A monitor's
    // scheduled runs already avoid this by including their own windowStart
    // (see scheduler.ts); a manual run needs the same discriminator.
    parameters: { query: request.parameters.query ?? '', limit: request.parameters.limit ?? 50, retentionDays: request.parameters.retentionDays ?? 30, windowStart: new Date().toISOString() },
    ...(request.parameters.continuationSessionId ? { continuation: {
      sessionId: request.parameters.continuationSessionId,
      mode: request.parameters.mode ?? 'interactive',
      contextBudget: 1200,
    } } : {}),
  }) as { id: string }
  return { requiresConsent: false, job }
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
  const { signedIn } = await waitForGoogleSignIn(loginWin, session.fromPartition(`persist:${partition}`))
  if (!signedIn) return { error: 'cancelled' }

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
          // The aria-label fallback reads "Google Account: Name\n(x@gmail.com)";
          // keep only the address, or the whole label became the account's email.
          const found = typeof result === 'string' ? result.match(/[^\s()<>]+@[^\s()<>]+/) : null
          if (found) email = found[0].toLowerCase()
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

/**
 * Which added Google account the agent's browser-worker tools use.
 *
 * Without it browserWorkerQueue always took gmailSessions[0], so once that
 * first account hit a provider's usage limit every worker call kept failing
 * against it, with no way to point the agent at a still-usable account short
 * of removing accounts to change the array order. Null means "use the first",
 * preserving the old behaviour for anyone who never sets it.
 */
ipcMain.handle('gmail:getAgentAccount', () => (store.get('agentBrowserAccountEmail' as never) as string | null) ?? null)

ipcMain.handle('gmail:setAgentAccount', (_e, email: unknown) => {
  store.set('agentBrowserAccountEmail' as never, (typeof email === 'string' && email ? email : null) as never)
})

/** Save-As for a flowdesk-image:// URL. Resolves false when the user cancels. */
ipcMain.handle('image:download', async (_e, url: unknown) => {
  if (typeof url !== 'string') return false
  const fileName = decodeURIComponent(new URL(url).hostname || new URL(url).pathname.replace(/^\/+/, ''))
  const sourcePath = join(generatedImagesDir, fileName)
  // basename above already collapses any traversal, but the images directory
  // is the only place this may ever read from, so the check is explicit.
  if (!sourcePath.startsWith(generatedImagesDir)) return false
  const result = await dialog.showSaveDialog({ defaultPath: join(app.getPath('downloads'), fileName) })
  if (result.canceled || !result.filePath) return false
  await copyFile(sourcePath, result.filePath)
  return true
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
ipcMain.handle('view:setNavWidth', (_e, w: number) => { setNavWidth(w) })
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
ipcMain.handle('view:hide', (_e, specificTabId?: string) => hideView(typeof specificTabId === 'string' ? specificTabId : undefined))

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

// IPC: Synchronize active TikTok account between React UI and main process
ipcMain.handle('tiktok:setActiveAccount', (_e, account: string | number) => {
  setActiveTikTokAccount(account)
  return true
})

// IPC: Synchronize active LinkedIn account between React UI and main process
ipcMain.handle('linkedin:setActiveAccount', (_e, account: string | number) => {
  setActiveLinkedInAccount(account)
  return true
})

// IPC: the social account registry (socialAccounts.ts) for the Social page switcher.
ipcMain.handle('social:accounts', async (_e, platform: unknown) => {
  if (!isSocialPlatform(platform)) return { ok: false, error: 'unknown platform' }
  return socialAccountsStatus(platform)
})

// Adds a slot, or with `account` renames that slot. Never signs anything in.
// With `googleAccount` (an Accounts-page Google partition) the slot lives in that session.
ipcMain.handle('social:addAccount', (_e, platform: unknown, label: unknown, account: unknown, googleAccount: unknown) => {
  if (!isSocialPlatform(platform)) return { ok: false, error: 'unknown platform' }
  try {
    return { ok: true, account: addSocialAccount(platform, typeof label === 'string' ? label : undefined, {
      ...(typeof account === 'string' ? { account } : {}),
      ...(typeof googleAccount === 'string' ? { googleAccount } : {}),
    }) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('social:removeAccount', async (_e, platform: unknown, account: unknown) => {
  if (!isSocialPlatform(platform) || typeof account !== 'string') return { ok: false, error: 'bad arguments' }
  try {
    return { ok: true, account: await removeSocialAccount(platform, account) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('linkedin:getAccounts', async () => {
  return liAccounts()
})

ipcMain.handle('linkedin:saveAccounts', (_e, accounts: unknown) => {
  if (Array.isArray(accounts)) {
    saveLinkedInAccounts(accounts)
  }
  return true
})

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
  const { signedIn } = await waitForGoogleSignIn(loginWin, session.fromPartition(`persist:${partition}`))
  if (!signedIn) return { error: 'cancelled' }

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
          // The aria-label fallback reads "Google Account: Name\n(x@gmail.com)";
          // keep only the address, or the whole label became the account's email.
          const found = typeof result === 'string' ? result.match(/[^\s()<>]+@[^\s()<>]+/) : null
          if (found) email = found[0].toLowerCase().trim()
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

/**
 * Projects: the folder the agent is allowed to read and write in.
 *
 * Stored rather than derived because the boundary has to outlive a restart —
 * projectTools.ts refuses any path outside the active project's rootPath, so
 * losing this would silently widen or remove that boundary.
 */
interface ProjectSessionRecord {
  id: string
  title: string
  rootPath: string
  createdAt: string
  lastOpenedAt: string
}

function projectSnapshot(): { projects: ProjectSessionRecord[]; activeProjectId: string | null } {
  const projects = (store.get('projects' as never) as ProjectSessionRecord[] | undefined) ?? []
  const activeProjectId = (store.get('activeProjectId' as never) as string | null | undefined) ?? null
  return { projects, activeProjectId }
}

function saveProjects(projects: ProjectSessionRecord[], activeProjectId: string | null) {
  store.set('projects' as never, projects as never)
  store.set('activeProjectId' as never, activeProjectId as never)
  return { projects, activeProjectId }
}

ipcMain.handle('brain:chooseVaultFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Choose your knowledge vault folder',
  })
  if (result.canceled || !result.filePaths[0]) return null
  const vaultRoot = result.filePaths[0]
  // The old memory-vault directory (electron/brain/vault.ts's VaultManager
  // root, <userData>/brain/vault) is a different, unrelated thing that also
  // used to be called "vault" -- picking it here would re-import the entire
  // legacy memory ledger as knowledge_documents. Nothing checked this before;
  // it's cheap insurance now that the two systems are named the same.
  const legacyVaultRoot = join(app.getPath('userData'), 'brain', 'vault')
  const normalizedChoice = resolve(vaultRoot)
  const normalizedLegacy = resolve(legacyVaultRoot)
  if (normalizedChoice === normalizedLegacy || normalizedChoice.startsWith(`${normalizedLegacy}${sep}`)) {
    throw new Error('That folder is FlowDesk\'s internal memory vault, not a folder to import from. Choose your own notes folder instead.')
  }
  store.set('brainVaultRoot' as never, vaultRoot as never)
  return vaultRoot
})

ipcMain.handle('brain:getVaultRoot', () => (store.get('brainVaultRoot' as never) as string | undefined) ?? null)

ipcMain.handle('project:list', () => projectSnapshot())

ipcMain.handle('project:chooseFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a project folder',
  })
  if (result.canceled || !result.filePaths[0]) return null
  const rootPath = result.filePaths[0]
  const { projects } = projectSnapshot()
  // Re-choosing a folder already tracked reopens it instead of creating a
  // duplicate entry pointing at the same directory.
  const existing = projects.find(project => project.rootPath === rootPath)
  const now = new Date().toISOString()
  if (existing) {
    return saveProjects(
      projects.map(project => project.id === existing.id ? { ...project, lastOpenedAt: now } : project),
      existing.id,
    )
  }
  const created: ProjectSessionRecord = {
    id: randomUUID(),
    title: basename(rootPath) || rootPath,
    rootPath,
    createdAt: now,
    lastOpenedAt: now,
  }
  return saveProjects([...projects, created], created.id)
})

ipcMain.handle('project:create', async (_e, title: unknown) => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose a folder for this project',
  })
  if (result.canceled || !result.filePaths[0]) return null
  const rootPath = result.filePaths[0]
  const now = new Date().toISOString()
  const created: ProjectSessionRecord = {
    id: randomUUID(),
    title: typeof title === 'string' && title.trim() ? title.trim() : basename(rootPath) || rootPath,
    rootPath,
    createdAt: now,
    lastOpenedAt: now,
  }
  const { projects } = projectSnapshot()
  return saveProjects([...projects, created], created.id)
})

ipcMain.handle('project:setActive', (_e, id: unknown) => {
  const { projects } = projectSnapshot()
  if (typeof id !== 'string' || !projects.some(project => project.id === id)) return projectSnapshot()
  const now = new Date().toISOString()
  return saveProjects(
    projects.map(project => project.id === id ? { ...project, lastOpenedAt: now } : project),
    id,
  )
})

// ─────────────────────────────────────────────────────────────────
// IPC: NotebookLM — thin wrappers over notebooklm.ts and the job queue.
//
// Almost every handler is a direct pass-through: notebookCapabilities
// already prefers the local REST sidecar and falls back to the CLI worker,
// so routing decisions belong there rather than being duplicated here.
// ─────────────────────────────────────────────────────────────────

const notebookJobQueue = new NotebookJobQueue(
  {
    get: () => (store.get('notebooklmJobs' as never) as NotebookJob[] | undefined),
    set: (_key, value) => store.set('notebooklmJobs' as never, value as never),
  },
  notebookCapabilities,
  () => (store.get('notebooklmAccount' as never) as string | null) ?? null,
  jobs => void mirrorNotebookJobs(jobs),
)
configureNotebookJobRuntime(notebookJobQueue)

async function mirrorNotebookJobs(jobs: NotebookJob[]) {
  if (!brainClient) return
  try {
    const globalScope = await brainRequest('ensureScope', { type: 'global', externalRef: 'global', name: 'Global' }) as BrainScope
    for (const job of jobs) {
      const brainJob = await brainRequest('enqueueJob', {
        recipeId: job.kind === 'research' ? 'notebooklm.research' : 'notebooklm.artifact',
        recipeVersion: 1,
        scopeId: globalScope.id,
        accountId: job.accountEmail ?? null,
        parameters: { legacyJobId: job.id, notebookId: job.notebookId, kind: job.kind },
      }) as { id: string; status: string }
      if (job.status === 'completed') {
        await brainRequest('completeJob', {
          id: brainJob.id,
          result: {
            recordCount: job.remote?.sourceCount ?? job.remote?.artifactCount ?? 0,
            coverage: { sources: job.remote?.sourceCount, artifacts: job.remote?.artifactCount },
            warnings: [],
            failures: [],
            artifactRefs: [`notebooklm://${job.notebookId}/jobs/${job.id}`],
          },
        })
      } else if (job.status === 'failed') {
        await brainRequest('failJob', { id: brainJob.id, error: job.error ?? 'NotebookLM job failed' })
      } else if (job.status === 'cancelled') {
        await brainRequest('controlJob', { id: brainJob.id, action: 'cancel' })
      }
    }
    store.set('notebooklmJobsBrainImportedAt' as never, new Date().toISOString() as never)
  } catch (error) {
    console.log(`[FlowDesk brain] NotebookLM bridge skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function flowDeskGoogleAccounts() {
  return (store.get('gmailSessions') as GmailSession[]).map(({ email, partition }) => ({ email, partition }))
}

function notebooklmAccountEmail(): string | null {
  return (store.get('notebooklmAccount' as never) as string | null) ?? null
}

ipcMain.handle('notebooklm:status', () => notebooklmStatus())
ipcMain.handle('notebooklm:serviceStatus', () => notebooklmServiceState())
ipcMain.handle('notebooklm:doctor', () => notebooklmDoctor())
ipcMain.handle('notebooklm:login', (_e, browser?: 'chromium' | 'chrome' | 'msedge') => notebooklmLogin(browser))

ipcMain.handle('notebooklm:selectAccount', async (_e, email: string | null) => {
  const next = typeof email === 'string' && email ? email : null
  store.set('notebooklmAccount' as never, next as never)
  notebooklmSelectAccount(next)
  // The sidecar holds a per-profile browser session, so it has to be
  // restarted against the new profile rather than reused.
  return startNotebookLMService(notebooklmGetActiveProfile())
})

ipcMain.handle('notebooklm:nativeStatus', () => getNativeNotebookCapability(notebooklmAccountEmail(), flowDeskGoogleAccounts()))
ipcMain.handle('notebooklm:openNative', () => openNativeNotebook(notebooklmAccountEmail(), flowDeskGoogleAccounts()))
ipcMain.handle('notebooklm:closeNative', () => closeNativeNotebook())

ipcMain.handle('notebooklm:listNotebooks', () => notebookCapabilities.listNotebooks())
ipcMain.handle('notebooklm:createNotebook', (_e, title: string) => notebookCapabilities.createNotebook({ title }))
ipcMain.handle('notebooklm:addSource', (_e, input: NotebookLMSourceInput) => notebookCapabilities.addSource(input))
ipcMain.handle('notebooklm:listSources', (_e, notebookId: string) => notebookCapabilities.listSources(notebookId))
ipcMain.handle('notebooklm:sourceCounts', (_e, notebookIds: string[]) => notebookCapabilities.getSourceCounts(notebookIds))
ipcMain.handle('notebooklm:startResearch', (_e, notebookId: string, query: string, mode?: 'fast' | 'deep') =>
  notebookCapabilities.startResearch({ notebookId, query, ...(mode ? { mode } : {}) }))
ipcMain.handle('notebooklm:researchStatus', (_e, notebookId: string) => notebookCapabilities.researchStatus(notebookId))
ipcMain.handle('notebooklm:ask', (_e, notebookId: string, question: string) => notebookCapabilities.ask({ notebookId, question }))
ipcMain.handle('notebooklm:listArtifacts', (_e, notebookId: string) => notebookCapabilities.listArtifacts(notebookId))
ipcMain.handle('notebooklm:generateArtifact', (_e, request: NotebookLMArtifactRequest) => notebookCapabilities.generateArtifact(request))
ipcMain.handle('notebooklm:downloadArtifact', (_e, notebookId: string, kind: string, artifactId?: string) =>
  notebooklmDownloadArtifact(notebookId, normalizeArtifactKind(kind), artifactId))
ipcMain.handle('notebooklm:manage', (_e, action: string, payload?: { notebookId?: string; args?: string[] }) =>
  notebookCapabilities.manage(action, payload))

ipcMain.handle('notebooklm:chatStream:start', (_e, notebookId: string, question: string, requestId?: string) =>
  notebooklmStartChatStream(
    notebookId,
    question,
    event => mainWindow?.webContents.send('notebooklm:chatStream:event', event),
    requestId,
  ))
ipcMain.handle('notebooklm:chatStream:cancel', (_e, streamId: string) => notebooklmCancelChatStream(streamId))

ipcMain.handle('notebooklm:jobs:list', (_e, notebookId?: string) => notebookJobQueue.list(notebookId))
ipcMain.handle('notebooklm:jobs:research', (_e, input: StartResearchInput) => notebookJobQueue.startResearch(input))
ipcMain.handle('notebooklm:jobs:artifact', (_e, input: GenerateArtifactInput) => notebookJobQueue.generateArtifact(input))
ipcMain.handle('notebooklm:jobs:refresh', (_e, id: string) => notebookJobQueue.refresh(id))
ipcMain.handle('notebooklm:jobs:cancel', (_e, id: string) => notebookJobQueue.cancel(id))
ipcMain.handle('notebooklm:jobs:retry', (_e, id: string) => notebookJobQueue.retry(id))

// ─────────────────────────────────────────────────────────────────
// IPC: WhatsApp — thin wrappers. Every one of these refuses cleanly when
// WhatsApp Web is not open, so no readiness check is needed here.
// ─────────────────────────────────────────────────────────────────

ipcMain.handle('whatsapp:status', () => waStatus())
ipcMain.handle('whatsapp:listChats', (_e, limit?: number, onlyUnread?: boolean) => waListChats(limit, onlyUnread))
ipcMain.handle('whatsapp:listMessages', (_e, chatId: string, limit?: number) => waListMessages(chatId, limit))
ipcMain.handle('whatsapp:send', (_e, chatId: string, text: string) => waSend(chatId, text))

// ─────────────────────────────────────────────────────────────────
// IPC: Skills & Workflows Engine
// ─────────────────────────────────────────────────────────────────
ipcMain.handle('skills:list', (_e, filter) => listSkills(filter))
ipcMain.handle('skills:get', (_e, id: string) => getSkill(id) ?? null)
ipcMain.handle('skills:save', async (_e, skill) => { await saveSkill(skill); return true })
ipcMain.handle('skills:delete', async (_e, id: string) => deleteSkill(id))
ipcMain.handle('workflows:list', (_e, filter) => listWorkflows(filter))
ipcMain.handle('workflows:get', (_e, id: string) => getWorkflow(id) ?? null)
ipcMain.handle('workflows:save', async (_e, wf) => { await saveWorkflow(wf); return true })
ipcMain.handle('workflows:delete', async (_e, id: string) => deleteWorkflow(id))
// Same executor as the MCP path: runs real tools through the action guard.
ipcMain.handle('workflows:run', async (_e, id: string, inputs?: Record<string, any>) => executeWorkflow(id, inputs))
ipcMain.handle('workflows:resume', async (_e, runId: string) => resumeWorkflow(runId))
ipcMain.handle('workflows:runs', () => listWorkflowRuns())

// Reddit bridge IPC
ipcMain.handle('reddit:status', () => rdStatus())
ipcMain.handle('reddit:feed', (_e, options?: unknown) => rdFeed(options && typeof options === 'object' ? options : {}))
ipcMain.handle('reddit:postComments', (_e, subreddit: string, postId: string, limit?: number) => rdPostComments(subreddit, postId, limit))
ipcMain.handle('reddit:search', (_e, query: string, sort?: 'relevance' | 'hot' | 'top' | 'new', limit?: number) => rdSearch(query, sort, limit))
ipcMain.handle('reddit:votePost', (_e, postId: string, voteState: 'UP' | 'DOWN' | 'NONE') => rdVotePost(postId, voteState))
ipcMain.handle('reddit:voteComment', (_e, commentId: string, voteState: 'UP' | 'DOWN' | 'NONE') => rdVoteComment(commentId, voteState))
ipcMain.handle('reddit:createComment', (_e, postId: string, parentId: string, text: string) => rdCreateComment(postId, parentId, text))
ipcMain.handle('reddit:createPost', (_e, subreddit: string, title: string, body?: string) => rdCreatePost(subreddit, title, body))
ipcMain.handle('reddit:subscribe', (_e, subredditId: string, subscribeState: 'SUBSCRIBED' | 'UNSUBSCRIBED') => rdSubscribe(subredditId, subscribeState))
ipcMain.handle('reddit:markRead', () => rdMarkRead())

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
  /**
   * In-flight image downloads for this turn. Awaited before completing, so a
   * turn whose only content is an image cannot complete empty and get
   * discarded by browserWorkerQueue's empty-completion guard.
   */
  pendingImages?: Promise<void>[]
  /** ChatGPT sent message_stream_complete — the turn is over. */
  streamComplete?: boolean
  /** Already settled, so the later HTTP-body end must not re-emit it empty. */
  completed?: boolean
  /** Last reported image progress stage number (1..6) */
  imageProgressStage?: number
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

/**
 * Turns a ChatGPT image asset into a saved flowdesk-image:// URL.
 *
 * Two hops, both confirmed against the live API by discovery probes
 * (probes/out/cg-02-image-fetch.json, cg-04-full-chain.json) rather than
 * assumed:
 *
 *   1. /backend-api/files/download/{fileId} -> { download_url }
 *      Needs an Authorization: Bearer token — cookies alone return 401 (probe
 *      "files/download cookies only": 401 Unauthorized). Run inside the page,
 *      which already holds that token, so no credential ever has to be read
 *      into or stored by the main process.
 *   2. GET download_url -> the actual bytes
 *      A signed estuary URL; probe confirmed cookies alone are enough here
 *      (step2_cookiesOnly: 200, 1223184 bytes), so the existing session-scoped
 *      downloader handles it unchanged.
 */
async function resolveChatGPTImage(
  asset: { fileId: string; conversationId?: string },
  sender: Electron.WebContents,
): Promise<string | null> {
  try {
    const query = asset.conversationId
      ? `?conversation_id=${encodeURIComponent(asset.conversationId)}&inline=false&download_intent=false`
      : ''
    const downloadUrl: string | null = await sender.executeJavaScript(`
      (async function () {
        try {
          var s = await fetch('/api/auth/session').then(function (r) { return r.json() })
          if (!s || !s.accessToken) return null
          var r = await fetch(${JSON.stringify(`/backend-api/files/download/${asset.fileId}${query}`)}, {
            headers: { Authorization: 'Bearer ' + s.accessToken },
          })
          if (!r.ok) return null
          var j = await r.json()
          return j && j.download_url ? j.download_url : null
        } catch (e) { return null }
      })()
    `)
    if (!downloadUrl) return null
    return await downloadAndSaveGeneratedImage(downloadUrl, sender.session)
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

// The live-tick counterpart, and the ONLY place capture:live is emitted.
//
// browserWorkerQueue.ts's notifyCaptureActivity is what resets a pending
// waiter's idle timer — its own comment describes being called "from main.ts's
// emitCaptureLive on every capture:live tick", but no such function existed
// and notifyCaptureActivity was never called from anywhere in this file. The
// idle timer therefore never reset, no matter how much data a provider was
// actively streaming, making IDLE_TIMEOUT_MS behave as a flat deadline rather
// than the stall detector it was written to be. Same class of loss as the
// probe runner and the still-missing IPC handlers: dropped in the main.ts
// rewrite, invisible because nothing errors when a notification simply never
// fires. Every send site routes through here so it cannot silently drift apart
// again.
function emitCaptureLive(payload: { id: string; tool: string; textSoFar: string }) {
  mainWindow?.webContents.send('capture:live', payload)
  notifyCaptureActivity(payload.tool, payload.textSoFar)
}

workerProgress.on('progress', (data: WorkerProgress) => {
  if (data.type === 'image_progress') {
    mainWindow?.webContents.send('capture:imageProgress', data)
  }
})

/**
 * Settles one captured turn exactly once.
 *
 * Awaits any in-flight image downloads first: an image-only turn has no text
 * until its asset has been fetched and turned into markdown, and completing
 * before that lands is precisely the bug this path exists to fix — the empty
 * completion gets dropped by browserWorkerQueue's empty-completion guard and
 * the agent waits out its timeout on an image that already finished.
 *
 * The entry is marked rather than deleted because both triggers can fire for
 * the same turn: message_stream_complete arrives first, then the HTTP body
 * ends some time later. Deleting here would let that second trigger build a
 * fresh empty entry and broadcast a second, empty capture:complete over the
 * real one.
 */
async function finishCapture(id: string, entry: CaptureBuffer) {
  if (entry.completed) return
  if (entry.pendingImages?.length) {
    await Promise.all(entry.pendingImages)
    entry.pendingImages = []
  }
  if (entry.imageProgressStage && entry.imageProgressStage < 6) {
    entry.imageProgressStage = 6
    notifyImageProgress(entry.tool, 100, 'Image generated & ready for download/display')
  }
  entry.completed = true
  console.log(`[FlowDesk capture][${entry.tool}] response complete:\n`, entry.text)
  emitCaptureComplete({ id, tool: entry.tool, text: entry.text })
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
  if (captureDebugEnabled()) {
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
        if (captureDebugEnabled()) {
          console.log(`[FlowDesk capture][perplexity][raw event]`, evt)
        }
        const { deltas, finalText } = extractPerplexitySSEEvent(evt)
        for (const delta of deltas) entry.text += delta
        if (finalText) entry.text = finalText
      }
      emitCaptureLive({ id: payload.id, tool: entry.tool, textSoFar: entry.text })
    }
    if (payload.error) {
      // The page aborts the underlying connection right after end_of_stream
      // as its normal way of closing up — flush whatever's left in the
      // buffer first, same as the 'done' path below, since real content can
      // still be sitting there unprocessed when the abort lands.
      if (entry.buf) {
        if (captureDebugEnabled()) {
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
      emitCaptureLive({ id: payload.id, tool: entry.tool, textSoFar: entry.text })
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
        if (captureDebugEnabled()) {
          console.log(`[FlowDesk capture][qwen][raw event]`, evt.slice(0, 500))
        }
        for (const found of extractQwenTextFromSSEEvent(evt)) entry.text += found
        const thinking = extractThinkingSummaryFromSSEEvent(evt)
        if (thinking) console.log(`[FlowDesk thinking][qwen]`, JSON.stringify(thinking))
        const usage = extractQwenUsageFromSSEEvent(evt)
        if (usage) {
          recordProviderUsage(entry.tool, usage as ProviderLimits)
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
      }
      emitCaptureLive({ id: payload.id, tool: entry.tool, textSoFar: entry.text })
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
          recordProviderUsage(entry.tool, usage as ProviderLimits)
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
      emitCaptureLive({ id: payload.id, tool: entry.tool, textSoFar: entry.text })
    }
    if (payload.error) {
      console.error(`[FlowDesk capture][gemini] stream error:`, payload.error)
      emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text, error: payload.error })
      captureBuffers.delete(payload.id)
      return
    }
    if (payload.done) {
      if (captureDebugEnabled()) {
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
      if (captureDebugEnabled()) {
        console.log(`[FlowDesk capture][${entry.tool}][raw event]`, evt.slice(0, 500))
      }
      for (const found of extractCaptureText(entry.tool, evt)) entry.text += found
      if (entry.tool === 'chatgpt') {
        const usage = extractUsageFromSSEEvent(evt)
        if (usage) {
          console.log(`[FlowDesk usage][chatgpt]`, usage.map(u => `${u.feature}: ${u.remaining} left (resets ${u.resetAfter})`).join(' | '))
          recordProviderUsage(entry.tool, usage as ProviderLimits)
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

        // Image generation stages for ChatGPT
        const currentStage = entry.imageProgressStage || 0
        if (currentStage < 2 && isDalleToolInvoked(evt)) {
          entry.imageProgressStage = 2
          notifyImageProgress(entry.tool, 35, 'DALL-E image generation tool invoked')
        } else if (currentStage === 2) {
          entry.imageProgressStage = 3
          notifyImageProgress(entry.tool, 60, 'ChatGPT actively rendering image')
        }

        // An image-generation turn carries its result as a structured part
        // (author role "tool", content_type "image_asset_pointer") that the
        // text extractor above correctly finds nothing in — so without this
        // the turn completes with EMPTY text and browserWorkerQueue's
        // "ignore incidental empty completions" guard discards it, leaving
        // the agent waiting on an image that already exists. Confirmed live
        // (FD_CAPTURE_DEBUG, 2026-08-30): asset at 14:31:14, turn done at
        // 14:31:20, "response complete:" printed with nothing after it.
        const imageAssets = extractImageAssetsFromSSEEvent(evt)
        if (imageAssets.length > 0 && (entry.imageProgressStage || 0) < 4) {
          entry.imageProgressStage = 4
          notifyImageProgress(entry.tool, 85, 'Image asset pointer received from backend')
        }

        for (const asset of imageAssets) {
          console.log(`[FlowDesk image][chatgpt] ${asset.fileId} (${asset.width}x${asset.height}) "${asset.title ?? 'untitled'}" — resolving`)
          if ((entry.imageProgressStage || 0) < 5) {
            entry.imageProgressStage = 5
            notifyImageProgress(entry.tool, 95, 'FlowDesk resolving & caching generated image')
          }
          const pending = resolveChatGPTImage(asset, _e.sender).then(saved => {
            if (saved) {
              entry.text += `${entry.text ? '\n\n' : ''}![${asset.title ?? 'generated image'}](${saved})`
              console.log(`[FlowDesk image][chatgpt] saved -> ${saved}`)
              entry.imageProgressStage = 6
              notifyImageProgress(entry.tool, 100, 'Image generated & ready for download/display')
            } else {
              console.error(`[FlowDesk image][chatgpt] could not download ${asset.fileId}`)
            }
          })
          ;(entry.pendingImages ??= []).push(pending)
        }

        // ChatGPT's own end-of-turn event. The fetch-reader `done` this
        // handler otherwise completes on is the HTTP body ending, which for
        // an image turn happens late or not at all because the connection is
        // held open — so this is what actually makes the agent's waiter
        // resolve when the answer is genuinely ready.
        if (isMessageStreamComplete(evt)) entry.streamComplete = true
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
          recordProviderUsage(entry.tool, usage as ProviderLimits)
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
      }
    }
    emitCaptureLive({ id: payload.id, tool: entry.tool, textSoFar: entry.text })

    // The provider said the turn is done. Settle now instead of waiting for
    // the HTTP body to end, which on an image turn lags the answer by minutes
    // (or never arrives, since the connection is held open for notifications).
    if (entry.streamComplete) {
      await finishCapture(payload.id, entry)
      return
    }
  }

  if (payload.error) {
    if (entry.completed) {
      captureBuffers.delete(payload.id)
      return
    }
    console.error(`[FlowDesk capture][${entry.tool}] stream error:`, payload.error)
    emitCaptureComplete({ id: payload.id, tool: entry.tool, text: entry.text, error: payload.error })
    captureBuffers.delete(payload.id)
    return
  }

  if (payload.done) {
    // Already settled via message_stream_complete — the body simply caught up.
    if (entry.completed) {
      captureBuffers.delete(payload.id)
      return
    }
    // Flush whatever's left in the buffer — the final SSE event is rarely
    // followed by a trailing blank line before the connection closes, so it
    // never gets processed by the '\n\n' splitter above.
    if (entry.buf) {
      if (captureDebugEnabled()) {
        console.log(`[FlowDesk capture][${entry.tool}][raw event][final]`, entry.buf.slice(0, 500))
      }
      for (const found of extractCaptureText(entry.tool, entry.buf)) entry.text += found
      if (entry.tool === 'chatgpt') {
        const usage = extractUsageFromSSEEvent(entry.buf)
        if (usage) {
          console.log(`[FlowDesk usage][chatgpt]`, usage.map(u => `${u.feature}: ${u.remaining} left (resets ${u.resetAfter})`).join(' | '))
          recordProviderUsage(entry.tool, usage as ProviderLimits)
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
          recordProviderUsage(entry.tool, usage as ProviderLimits)
          mainWindow?.webContents.send('capture:usage', { tool: entry.tool, limits: usage })
        }
      }
      entry.buf = ''
    }
    await finishCapture(payload.id, entry)
    captureBuffers.delete(payload.id)
  }
})

let localGatewayServer: GatewayServer | null = null

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  try {
    await initSkillsRegistry({ userDataDir: app.getPath('userData') })
    await configureRunStore(join(app.getPath('userData'), 'workflow-runs'))
    console.log('[FlowDesk Skills] registry initialized')
  } catch (err) {
    console.warn('[FlowDesk Skills] failed to initialize skills registry:', err)
  }
  try {
    localGatewayServer = await startLocalGateway(app.getPath('userData'), undefined, {
      // Actions listed under requireApproval in action-policy.json. Headless
      // there may be nobody to click, so the box closes itself and denies.
      requestApproval: async ({ action, summary }) => {
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), APPROVAL_TIMEOUT_MS)
        try {
          const details = Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join('\n')
          const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'FlowDesk — agent action',
            message: `An agent wants to run "${action}".`,
            detail: `${details || 'No details.'}\n\nDenied automatically after ${APPROVAL_TIMEOUT_MS / 1000}s.`,
            buttons: ['Allow', 'Deny'],
            defaultId: 1,
            cancelId: 1,
            signal: abort.signal,
          })
          return response === 0 && !abort.signal.aborted
        } finally {
          clearTimeout(timer)
        }
      },
    })
    console.log(`[FlowDesk Gateway] listening on 127.0.0.1:${localGatewayServer.info.port}`)
  } catch (err) {
    console.warn('[FlowDesk Gateway] failed to start local gateway:', err)
  }
  // Warm the social worker windows so MCP/agent tools work straight after
  // launch (headless included) without the user opening each platform first.
  // tabId/partition/url must match what whatsapp.ts, linkedin.ts and reddit.ts
  // pass to ensureBackgroundView() so their calls reuse these windows. TikTok
  // and Flow pick partitions per account, so they are left to warm on demand.
  const prewarmSettings = (store.get('settings') as (Partial<AppSettings> & { prewarmSocial?: boolean }) | undefined) || {}
  if (prewarmSettings.prewarmSocial !== false) {
    setInterval(() => { void flushAllCookies() }, 120_000).unref()
    void prewarmBackgroundViews([
      { tabId: 'social-whatsapp', partition: 'social-whatsapp', url: 'https://web.whatsapp.com' },
      { tabId: 'social-linkedin', partition: 'social-linkedin', url: 'https://www.linkedin.com/feed/' },
      { ...(rememberedView('reddit') ?? { tabId: 'social-reddit', partition: 'social-reddit' }), url: 'https://www.reddit.com' },
    ])
  }
  // Radar schedules live in memory; resume every niche the user left enabled.
  // Delayed so the TikTok view is not fought over while the app is still starting.
  setTimeout(() => {
    void loadNiches().then(niches => {
      for (const n of niches) if (n.enabled) void startRadar(n.id)
    }).catch(err => console.warn('[FlowDesk radar] could not resume niches:', err))
  }, 60_000).unref()
  brainClient = createElectronBrainClient(app.getPath('userData'), join(__dirname, 'brainUtility.js'), envelope => executeBrainCapability(envelope, {
    hasConsent: async (scopeId, recipeId, provider) => await brainRequest('getConsent', { scopeId, recipeId, provider }) === true,
    read: request => {
      switch (request.capability) {
        // Unread chats with their transcripts, not just a preview line each.
        case 'whatsapp.list_unread': return waUnreadWithMessages(request.input.limit)
        case 'model.digest_chats': return digestChats(request.input.chats)
        case 'linkedin.feed': return liFeed(request.input.limit, 0, request.input.sort)
        case 'linkedin.search': return liSearch(request.input.query, 'CONTENT', request.input.limit)
        case 'reddit.feed': return rdFeed({ subreddit: request.input.subreddit, sort: request.input.sort, limit: request.input.limit })
        case 'reddit.search': return rdSearch(request.input.query, request.input.sort || 'new', request.input.limit)
      }
    },
  }))
  brainClient.on('status', status => mainWindow?.webContents.send('brain:event', {
    type: 'status',
    createdAt: new Date().toISOString(),
    data: status,
  }))
  brainClient.start()
  setGatewayBrainHandler(async (method, payload: any) => {
    let scopeId = payload?.scopeId
    if (!scopeId && brainClient) {
      try {
        const globalScope = await brainRequest('ensureScope', { type: 'global', externalRef: 'global', name: 'Global' }) as any
        const { projects: brainProjects, activeProjectId: brainProjectId } = projectSnapshot()
        const brainProject = brainProjects.find(p => p.id === brainProjectId)
        scopeId = brainProject?.id ?? globalScope?.id
      } catch {}
    }

    if (method === 'search') {
      const text = payload?.text || payload?.query || ''
      return brainRequest('search', {
        text,
        scopeId,
        includeParents: true,
        limit: payload?.limit ?? 10,
        tokenBudget: payload?.tokenBudget ?? 1200,
      })
    }
    if (method === 'remember') {
      return brainRequest('remember', {
        scopeId,
        kind: payload?.kind ?? 'fact',
        text: String(payload?.text || ''),
      })
    }
    if (method === 'knowledge.search') {
      return brainRequest('knowledge.search', {
        scopeId,
        query: String(payload?.query || payload?.text || ''),
        limit: payload?.limit ?? 10,
      })
    }
    if (method === 'knowledge.read') {
      return brainRequest('knowledge.read', {
        scopeId,
        path: String(payload?.path || ''),
      })
    }
    if (method === 'knowledge.neighbors') {
      return brainRequest('knowledge.neighbors', {
        scopeId,
        path: String(payload?.path || ''),
        depth: payload?.depth ?? 1,
      })
    }
    if (method === 'knowledge.answerPack') {
      return brainRequest('knowledge.answerPack', {
        scopeId,
        question: String(payload?.question || payload?.query || ''),
        tokenBudget: payload?.tokenBudget ?? 2000,
      })
    }
    if (method === 'overview') {
      return brainRequest('overview', { scopeId })
    }
    if (method === 'listMemories') {
      return brainRequest('listMemories', { scopeId })
    }
    if (method === 'listCandidates') {
      return brainRequest('listCandidates', { scopeId })
    }
    if (method === 'decideCandidate') {
      return brainRequest('decideCandidate', payload)
    }
    return brainRequest(method as any, payload ?? {})
  })

  // On startup, mark any pre-existing queued continuations as consumed so that
  // interrupted runs from a prior session do not trigger ghost agent runs in the background.
  try {
    const staleContinuations = await brainRequest('listQueuedContinuations', {}) as Array<{ id: string }>
    for (const item of staleContinuations) {
      await brainRequest('consumeContinuation', { id: item.id })
    }
  } catch (err) {
    console.log('[FlowDesk brain] startup stale continuation clear skipped:', err)
  }

  void mirrorNotebookJobs(notebookJobQueue.list())
  // A run cannot survive a restart, so one still marked running was
  // interrupted. Agent.tsx looks for exactly this to tell the user their
  // turn died rather than leaving a spinner up forever.
  // Opt-in REST sidecar for NotebookLM; it supervises itself and the
  // capability layer falls back to the CLI worker if it never comes up.
  void startNotebookLMService(notebooklmGetActiveProfile())

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

  // Discovery harness — development only, and never in a packaged build.
  // It evaluates arbitrary JavaScript inside whatever authenticated session
  // is open, which is exactly the capability that must not ship to users or
  // reach the in-app agent (see electron/discovery/probeRunner.ts).
  if (!app.isPackaged) {
    // Debug-only IPC, exposed by preload.ts as window.electronAPI.debugAsk-
    // BrowserProviderDirect / debugInspectChatGptDom. Lets a "flowdesk"-
    // targeted discovery probe drive the real ask_<tool> browser-worker path
    // (electron/agent/browserWorkerQueue.ts's askBrowserProvider) directly
    // from the renderer, without going through the Claude Agent SDK loop —
    // so a real ChatGPT/Claude/etc call can be observed even when the SDK
    // CLI itself is unavailable (auth, rate limits, etc). Never registered
    // in a packaged build: it lets arbitrary renderer code drive a real,
    // authenticated browser session on the user's behalf.
    ipcMain.handle('debug:askBrowserProviderDirect', async (_event, tool: AITool, prompt: string, resetFirst?: boolean) => {
      if (resetFirst) {
        const win = findWorkerViewByTool(tool)
        if (win) await win.webContents.loadURL(PROVIDER_URLS[tool])
      }
      try {
        const text = await askBrowserProvider(tool, prompt)
        return { ok: true as const, text }
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
      }
    })

    ipcMain.handle('debug:inspectChatGptDom', async () => {
      const view = findWorkerViewByTool('chatgpt') ?? findAnyViewByUrl('chatgpt.com')
      if (!view) return { ok: false as const, error: 'no open ChatGPT view (worker or visible tab)' }
      const text = await getLatestAssistantText(view.webContents, 'chatgpt')
      return { ok: true as const, text }
    })

    void startProbeRunner({
      dir: join(app.getAppPath(), 'probes'),
      // browser-worker tool probes (e.g. debug-ask-chatgpt-direct.js) can
      // legitimately run for minutes — the queue's own HARD_CEILING_MS in
      // browserWorkerQueue.ts is 900s (see its own comment: real image
      // generation was directly observed producing zero capture activity for
      // 2+ minutes before eventually completing) — so the probe runner's
      // default 30s internal timeout has to be raised well past that, or it
      // would report a false "probe timed out" while the real call keeps
      // running untracked in the background.
      timeoutMs: 920_000,
      // "flowdesk" is a special-cased target for FlowDesk's own renderer
      // window (not a tracked site view), so a probe can call into
      // window.electronAPI itself — used to drive the agent's own
      // browser-worker tools directly, the same way the real agent does,
      // without needing the agent chat UI at all.
      resolveView: target => {
        if (target === 'flowdesk') return mainWindow?.webContents ?? null
        // "worker:<tool>" — the exact hidden background window
        // browserWorkerQueue.ts drives for that tool, unambiguous even when
        // a visible tab on the same site is also open (findAnyViewByUrl
        // would attach to that visible tab first, which is a different,
        // possibly idle page — confirmed by a real probe that watched the
        // wrong one for 200s while a real ask_chatgpt call ran elsewhere).
        if (target.startsWith('worker:')) return findWorkerViewByTool(target.slice('worker:'.length))?.webContents ?? null
        // "tab:<tabId>" — one exact view or background window, e.g.
        // tab:social-pinterest, when several accounts sit on the same site.
        if (target.startsWith('tab:')) return getViewById(target.slice('tab:'.length))?.webContents ?? null
        // Fallback: any other window (e.g. a social sign-in window) whose URL matches.
        return findAnyViewByUrl(target)?.webContents
          ?? webContents.getAllWebContents().find(wc => !wc.isDestroyed() && wc.getURL().includes(target))
          ?? null
      },
      onResult: (name, result) => {
        const head = result.ok ? 'ok' : `FAILED: ${result.error}`
        console.log(`[probe] ${name} (${result.target}) ${result.durationMs}ms — ${head}`)
        console.log(`[probe] -> probes/out/${name}.json`)
      },
    }).catch(error => console.log('[probe] runner did not start:', error))
  }
})
app.on('window-all-closed', () => {
  const s = store.get('settings') as Partial<AppSettings>
  // Only quit if NOT using minimize-to-tray (tray users quit via tray menu)
  if (!s?.minimizeToTray || !tray) {
    if (process.platform !== 'darwin') app.quit()
  }
})
app.on('will-quit', () => {
  void flushAllCookies()
  if (localGatewayServer) {
    void localGatewayServer.stop()
    localGatewayServer = null
  }
  brainClient?.stop()
  brainClient = null
  globalShortcut.unregisterAll()
  destroyAllViews()
  if (tray) { tray.destroy(); tray = null }
})
