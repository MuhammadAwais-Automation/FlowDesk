import { session, WebContentsView, BrowserWindow, shell } from 'electron'
import { isMailHost, isOAuthPopup } from './oauthRouting'

const viewCache = new Map<string, WebContentsView>()
let activeTabId: string | null = null
let mainWindow: BrowserWindow | null = null

let NAV_WIDTH = 172       // left sidebar — updated via view:setNavWidth IPC
const TOP_HEIGHT = 124   // AIBrowser: 40px session tabs + 44px header + 40px promptbar
const TOOL_DOCK_W = 220  // right sidebar (ToolDock) — keep in sync with ToolDock.tsx

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

export function showView(tabId: string, partition: string, url: string) {
  if (!mainWindow) return

  // Hide current active view without destroying it
  if (activeTabId && activeTabId !== tabId) {
    const current = viewCache.get(activeTabId)
    if (current) {
      try { mainWindow.contentView.removeChildView(current) } catch {}
    }
  }

  // Get or create persistent view for this tab
  let view = viewCache.get(tabId)
  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        session: session.fromPartition(`persist:${partition}`),
        nodeIntegration: false,
        contextIsolation: true,
      }
    })
    viewCache.set(tabId, view)

    // ── External link / popup handling ────────────────────────
    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      const tabUrl = view!.webContents.getURL()

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
              session: view!.webContents.session,
              nodeIntegration: false,
              contextIsolation: true,
            },
          },
        }
      }

      // Other links: load in same view
      view!.webContents.loadURL(openUrl)
      return { action: 'deny' }
    })

    view.webContents.loadURL(url)
  }

  activeTabId = tabId
  try { mainWindow.contentView.addChildView(view) } catch {}
  updateBounds(view)
}

export function hideView() {
  if (!mainWindow) return
  // Remove ALL child views — ensures no stale view stays on top of React UI
  for (const [, view] of viewCache) {
    try { mainWindow.contentView.removeChildView(view) } catch {}
  }
  // Reset activeTabId so setCustomBounds / updateBounds calls made after
  // hideView (e.g. from ResizeObserver callbacks) become no-ops
  activeTabId = null
}

export function closeTabView(tabId: string) {
  if (!mainWindow) return
  const view = viewCache.get(tabId)
  if (view) {
    try { mainWindow.contentView.removeChildView(view) } catch {}
    viewCache.delete(tabId)
  }
  if (activeTabId === tabId) activeTabId = null
}

export function destroyAllViews() {
  if (!mainWindow) return
  for (const [, view] of viewCache) {
    try { mainWindow.contentView.removeChildView(view) } catch {}
  }
  viewCache.clear()
  activeTabId = null
}

export function getActiveView(): WebContentsView | null {
  if (!activeTabId) return null
  return viewCache.get(activeTabId) ?? null
}

/** Look up a view by explicit tabId — works even when the view is currently hidden */
export function getViewById(tabId: string): WebContentsView | null {
  return viewCache.get(tabId) ?? null
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
