import { session, WebContentsView, BrowserWindow, shell, type WebContents } from 'electron'
import { join } from 'path'
import { isMailHost, isOAuthPopup } from './oauthRouting'
import { CHATGPT_CAPTURE_SRC, CLAUDE_CAPTURE_SRC, GEMINI_CAPTURE_SRC, GROK_CAPTURE_SRC, PERPLEXITY_CAPTURE_SRC, QWEN_CAPTURE_SRC } from './captureInject'

const WEBVIEW_PRELOAD = join(__dirname, '../preload/webviewPreload.js')

// PoC: per-provider fetch-tee capture, matched by hostname.
const CAPTURE_RULES: { match: (url: string) => boolean; src: string }[] = [
  { match: url => url.includes('chatgpt.com'), src: CHATGPT_CAPTURE_SRC },
  { match: url => url.includes('claude.ai'), src: CLAUDE_CAPTURE_SRC },
  { match: url => url.includes('gemini.google.com'), src: GEMINI_CAPTURE_SRC },
  { match: url => url.includes('grok.com'), src: GROK_CAPTURE_SRC },
  { match: url => url.includes('perplexity.ai'), src: PERPLEXITY_CAPTURE_SRC },
  { match: url => url.includes('chat.qwen.ai'), src: QWEN_CAPTURE_SRC },
]

const viewCache = new Map<string, WebContentsView>()
// Universal Chat's / the Agent orchestrator's per-provider worker
// windows — see ensureBackgroundView() for why each provider gets its own
// dedicated BrowserWindow rather than sharing viewCache/mainWindow at all.
const backgroundWindows = new Map<string, BrowserWindow>()
let activeTabId: string | null = null
let mainWindow: BrowserWindow | null = null

let NAV_WIDTH = 172       // left sidebar — updated via view:setNavWidth IPC
const TOP_HEIGHT = 124   // AIBrowser: 40px session tabs + 44px header + 40px promptbar
let TOOL_DOCK_W = 230    // right sidebar (ToolDock) — updated via view:setDockWidth IPC

export function setMainWindow(win: BrowserWindow) {
  mainWindow = win
  win.on('resize', () => {
    if (activeTabId) {
      const view = viewCache.get(activeTabId)
      if (view) updateBounds(view)
    }
  })
}

export function setNavWidth(w: number) {
  NAV_WIDTH = w
  // Re-apply bounds immediately so the active WebContentsView resizes with the sidebar
  if (activeTabId) {
    const view = viewCache.get(activeTabId)
    if (view) updateBounds(view)
  }
}

export function setToolDockWidth(w: number) {
  TOOL_DOCK_W = w
  if (activeTabId) {
    const view = viewCache.get(activeTabId)
    if (view) updateBounds(view)
  }
}

function updateBounds(view: WebContentsView) {
  if (!mainWindow) return
  const bounds = mainWindow.getContentBounds()
  view.setBounds({
    x: NAV_WIDTH,
    y: TOP_HEIGHT,
    width: Math.max(bounds.width - NAV_WIDTH - TOOL_DOCK_W, 100),
    height: Math.max(bounds.height - TOP_HEIGHT, 100),
  })
}

/**
 * Shared view-creation logic — used by both showView() (visible AI Browser /
 * Social Hub / etc tabs) and ensureBackgroundView() (Universal Chat's
 * invisible per-provider worker tabs). Wires capture-injection and
 * OAuth/external-link handling identically either way; the only difference
 * is whether the caller ever attaches it to the window's contentView.
 */
function createView(tabId: string, partition: string, url: string): { view: WebContentsView; created: boolean } {
  const existing = viewCache.get(tabId)
  if (existing) return { view: existing, created: false }

  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
      preload: WEBVIEW_PRELOAD,
      // Universal Chat's worker tabs live permanently off-screen, which
      // Chromium treats as hidden — and per Electron's own source, a hidden
      // renderer gets throttled to the point where "input processing can
      // stall". That silently breaks prompt injection into a background
      // tab, so opt every view out of the throttling.
      backgroundThrottling: false,
    }
  })
  viewCache.set(tabId, view)


  // PoC: capture the streamed response as it arrives, live.
  view.webContents.on('dom-ready', () => {
    const currentUrl = view.webContents.getURL()
    const rule = CAPTURE_RULES.find(r => r.match(currentUrl))
    if (rule) view.webContents.executeJavaScript(rule.src).catch(() => {})
  })

  // ── External link / popup handling ────────────────────────
  view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    const tabUrl = view.webContents.getURL()

    // Gmail tab: external links → system browser
    if (isMailHost(tabUrl)) {
      shell.openExternal(openUrl)
      return { action: 'deny' }
    }

    // AI tool tab: OAuth popups → same-session child window
    if (isOAuthPopup(openUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 660,
          webPreferences: {
            session: view.webContents.session,
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      }
    }

    // Other links: load in same view
    view.webContents.loadURL(openUrl)
    return { action: 'deny' }
  })

  view.webContents.loadURL(url)
  return { view, created: true }
}

export function showView(tabId: string, partition: string, url: string) {
  if (!mainWindow) return

  // Hide current active view without destroying it
  if (activeTabId && activeTabId !== tabId) {
    const current = viewCache.get(activeTabId)
    if (current) {
      try { mainWindow.contentView.removeChildView(current) } catch {}
    }
  }

  const { view } = createView(tabId, partition, url)

  activeTabId = tabId
  try { mainWindow.contentView.addChildView(view) } catch {}
  updateBounds(view)
}

/**
 * Universal Chat's / the Agent orchestrator's per-provider worker windows:
 * invisible to the user, but real enough to drive with CDP input.
 *
 * Getting this right took ruling out three cheaper arrangements, each of
 * which broke a different half of the problem:
 *
 *  - Never attaching the view to any window at all leaves it with a
 *    0x0 layout no matter what setBounds() says. Claude's composer
 *    measured 0px wide, and its UI doesn't render a Send button at that
 *    width, so a message could be typed but never submitted.
 *  - Attaching it but parking it far off-screen (x:-3000) has the same
 *    effect — outside the window's canvas there is no real layout.
 *  - Attaching it on-screen and calling setVisible(false) fixes layout but
 *    breaks input: CDP's Input.dispatchKeyEvent goes through the
 *    RenderWidgetHost pipeline, which a hidden widget never services, so
 *    not one typed character arrived. (Input.insertText does still land,
 *    but only in the DOM — ProseMirror ignores it, so it's no use here.)
 *
 * What satisfies both is a real, shown window that the user simply cannot
 * see: full size, but fully transparent, click-through, and kept out of the
 * taskbar and the focus order.
 *
 * A FOURTH thing had to be ruled out too, once the Agent orchestrator
 * started sending several providers at once: putting every provider's view
 * as a sibling child of ONE shared hidden host window. Confirmed via real
 * terminal logs — firing CDP-typed input at several sibling
 * WebContentsViews concurrently made the typing silently fail ("typed text
 * did not land") on every one but whichever went first, while the exact
 * same calls made one at a time always landed. This matches a documented
 * Electron bug (WebContentsView children of one window steal each other's
 * focus on load) — so each provider now gets its OWN independent hidden
 * BrowserWindow instead of sharing one host, which gives each its own
 * real window-level focus and lets true concurrent typing actually work.
 */
function createHiddenWindow(partition: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,        // must genuinely be shown — see above
    opacity: 0,        // ...but completely invisible
    skipTaskbar: true,
    focusable: false,  // never steals focus from the real window
    frame: false,
    transparent: true,
    webPreferences: {
      session: session.fromPartition(`persist:${partition}`),
      nodeIntegration: false,
      contextIsolation: true,
      preload: WEBVIEW_PRELOAD,
      backgroundThrottling: false,
    }
  })
  win.setIgnoreMouseEvents(true) // clicks pass through to whatever's underneath
  return win
}

export function ensureBackgroundView(tabId: string, partition: string, url: string): Promise<{ webContents: WebContents }> {
  const existing = backgroundWindows.get(tabId)
  if (existing) return Promise.resolve(existing)

  const win = createHiddenWindow(partition)
  backgroundWindows.set(tabId, win)

  // Forward this background window's own console.log calls to our
  // terminal — there's no visible DevTools to check on an invisible
  // window, and this is how injectPrompt's diagnostic logging (submit
  // method used, button found or not) actually becomes observable.
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log(`[bg:${tabId}]`, message)
  })

  // PoC: capture the streamed response as it arrives, live.
  win.webContents.on('dom-ready', () => {
    const currentUrl = win.webContents.getURL()
    const rule = CAPTURE_RULES.find(r => r.match(currentUrl))
    if (rule) win.webContents.executeJavaScript(rule.src).catch(() => {})
  })

  // Same OAuth/external-link handling as createView() — a background
  // provider tab can still hit an OAuth popup or an external link.
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (isOAuthPopup(openUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 660,
          webPreferences: {
            session: win.webContents.session,
            nodeIntegration: false,
            contextIsolation: true,
          },
        },
      }
    }
    win.webContents.loadURL(openUrl)
    return { action: 'deny' }
  })

  win.loadURL(url)

  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(win), 15000) // don't hang forever on a slow/broken load
    win.webContents.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve(win)
    })
  })
}

export function hideView() {
  if (!mainWindow) return
  // Remove all VISIBLE child views — ensures no stale view stays on top of
  // React UI. Background worker windows aren't in mainWindow's contentView
  // at all anymore (each is its own independent BrowserWindow), so there's
  // nothing to skip here.
  for (const [, view] of viewCache) {
    try { mainWindow.contentView.removeChildView(view) } catch {}
  }
  // Reset activeTabId so setCustomBounds / updateBounds calls made after
  // hideView (e.g. from ResizeObserver callbacks) become no-ops
  activeTabId = null
}

export function closeTabView(tabId: string) {
  const view = viewCache.get(tabId)
  if (view) {
    try { mainWindow?.contentView.removeChildView(view) } catch {}
    viewCache.delete(tabId)
  }
  const bgWin = backgroundWindows.get(tabId)
  if (bgWin) {
    if (!bgWin.isDestroyed()) bgWin.destroy()
    backgroundWindows.delete(tabId)
  }
  if (activeTabId === tabId) activeTabId = null
}

export function destroyAllViews() {
  for (const [, view] of viewCache) {
    try { mainWindow?.contentView.removeChildView(view) } catch {}
  }
  viewCache.clear()
  for (const [, win] of backgroundWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  backgroundWindows.clear()
  activeTabId = null
}

export function getActiveView(): WebContentsView | null {
  if (!activeTabId) return null
  return viewCache.get(activeTabId) ?? null
}

/** Look up a view/background window by explicit tabId — works even when hidden */
export function getViewById(tabId: string): { webContents: WebContents } | null {
  return viewCache.get(tabId) ?? backgroundWindows.get(tabId) ?? null
}

export function setCustomBounds(x: number, y: number, w: number, h: number) {
  if (!mainWindow || !activeTabId) return
  const view = viewCache.get(activeTabId)
  if (view) view.setBounds({ x, y, width: w, height: h })
}

export function goBack() {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  if (view?.webContents.canGoBack()) view.webContents.goBack()
}

export function goForward() {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  if (view?.webContents.canGoForward()) view.webContents.goForward()
}

export function reloadActive() {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  view?.webContents.reload()
}

export function navigateActive(url: string) {
  if (!activeTabId) return
  const view = viewCache.get(activeTabId)
  if (view) view.webContents.loadURL(url)
}
