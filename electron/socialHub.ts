import { session, WebContentsView, BrowserWindow, shell } from 'electron'

const SOCIAL_NAV_H  = 44
const SOCIAL_DOCK_W = 56  // right AppDock width — keep in sync with src/components/social/AppDock.tsx

const socialCache  = new Map<string, WebContentsView>()
let activeSocialId: string | null = null
let mainWindow: BrowserWindow | null = null
let navWidth = 172

export function setSocialMainWindow(win: BrowserWindow) {
  mainWindow = win
  win.on('resize', () => {
    if (activeSocialId) {
      const view = socialCache.get(activeSocialId)
      if (view) updateBounds(view)
    }
  })
}

export function setSocialNavWidth(w: number) {
  navWidth = w
  if (activeSocialId) {
    const view = socialCache.get(activeSocialId)
    if (view) updateBounds(view)
  }
}

function updateBounds(view: WebContentsView) {
  if (!mainWindow) return
  const bounds = mainWindow.getContentBounds()
  view.setBounds({
    x:      navWidth,
    y:      SOCIAL_NAV_H,
    width:  Math.max(bounds.width  - navWidth - SOCIAL_DOCK_W, 100),
    height: Math.max(bounds.height - SOCIAL_NAV_H, 100),
  })
}

export function showSocialView(id: string, partition: string, url: string) {
  if (!mainWindow) return

  // Hide current active view (keep in cache — session preserved)
  if (activeSocialId && activeSocialId !== id) {
    const current = socialCache.get(activeSocialId)
    if (current) try { mainWindow.contentView.removeChildView(current) } catch {}
  }

  let view = socialCache.get(id)
  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        session:          session.fromPartition(`persist:${partition}`),
        nodeIntegration:  false,
        contextIsolation: true,
      }
    })

    // Open links in same view (no popups)
    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      view!.webContents.loadURL(openUrl)
      return { action: 'deny' }
    })

    socialCache.set(id, view)
    view.webContents.loadURL(url)
  }

  activeSocialId = id
  try { mainWindow.contentView.addChildView(view) } catch {}
  updateBounds(view)
}

export function hideAllSocialViews() {
  if (!mainWindow) return
  for (const [, view] of socialCache) {
    try { mainWindow.contentView.removeChildView(view) } catch {}
  }
  activeSocialId = null
}

export function destroySocialView(id: string) {
  if (!mainWindow) return
  const view = socialCache.get(id)
  if (!view) return
  try { mainWindow.contentView.removeChildView(view) } catch {}
  socialCache.delete(id)
  if (activeSocialId === id) activeSocialId = null
}

export function socialGoBack() {
  if (!activeSocialId) return
  const view = socialCache.get(activeSocialId)
  if (view?.webContents.canGoBack()) view.webContents.goBack()
}

export function socialGoForward() {
  if (!activeSocialId) return
  const view = socialCache.get(activeSocialId)
  if (view?.webContents.canGoForward()) view.webContents.goForward()
}

export function socialReload() {
  if (!activeSocialId) return
  socialCache.get(activeSocialId)?.webContents.reload()
}
