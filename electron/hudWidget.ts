import { BrowserWindow, screen, app } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'

let hudWindow: BrowserWindow | null = null

export interface HudWidgetOptions {
  app?: 'tiktok' | 'flow' | 'whatsapp' | 'social' | 'workflow' | 'brain'
  title?: string
  width?: number
  height?: number
  alwaysOnTop?: boolean
}

const APP_FILES: Record<string, string> = {
  tiktok: 'tiktok-dashboard.html',
  flow: 'flow-studio.html',
  whatsapp: 'whatsapp-inbox.html',
  social: 'social-radar.html',
  workflow: 'workflow-pipeline.html',
  brain: 'brain-atlas.html',
}

export function openHudWidget(options: HudWidgetOptions = {}): { ok: boolean; app: string; status: string } {
  const appKey = (options.app || 'tiktok').toLowerCase()
  const fileName = APP_FILES[appKey] || 'tiktok-dashboard.html'

  // Resolve HTML path in dev or production
  const candidatePaths = [
    resolve(process.cwd(), 'src', 'mcp-apps', fileName),
    join(app.getAppPath(), 'src', 'mcp-apps', fileName),
  ]

  let resolvedPath = candidatePaths.find(p => existsSync(p))

  if (hudWindow && !hudWindow.isDestroyed()) {
    if (resolvedPath) {
      hudWindow.loadFile(resolvedPath)
    }
    hudWindow.show()
    hudWindow.focus()
    return { ok: true, app: appKey, status: 'focused' }
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  const winWidth = options.width || Math.min(1080, Math.round(screenWidth * 0.72))
  const winHeight = options.height || Math.min(720, Math.round(screenHeight * 0.78))

  // Position nicely centered
  const x = Math.round((screenWidth - winWidth) / 2)
  const y = Math.round((screenHeight - winHeight) / 2)

  hudWindow = new BrowserWindow({
    x,
    y,
    width: winWidth,
    height: winHeight,
    minWidth: 420,
    minHeight: 400,
    title: options.title || `FlowDesk Floating HUD • ${appKey.toUpperCase()}`,
    backgroundColor: '#090c15',
    autoHideMenuBar: true,
    alwaysOnTop: options.alwaysOnTop ?? true,
    show: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  try {
    hudWindow.setAlwaysOnTop(options.alwaysOnTop ?? true, 'screen-saver')
  } catch {}

  hudWindow.show()
  hudWindow.focus()

  hudWindow.on('closed', () => {
    hudWindow = null
  })

  console.log(`[HUD] Opening app "${appKey}" at path: ${resolvedPath}`)

  if (resolvedPath) {
    hudWindow.loadFile(resolvedPath).catch(err => {
      console.error('[HUD] loadFile error:', err)
    })
  } else {
    hudWindow.loadURL(`data:text/html,<html><body style="background:#090c15;color:#fff;font-family:sans-serif;padding:30px;"><h2>FlowDesk HUD • ${appKey}</h2><p>Template file not found.</p></body></html>`)
  }

  return { ok: true, app: appKey, status: 'opened' }
}

export function closeHudWidget(): { ok: boolean; status: string } {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.close()
    hudWindow = null
    return { ok: true, status: 'closed' }
  }
  return { ok: true, status: 'not_running' }
}

export function getHudStatus(): { active: boolean } {
  const active = hudWindow !== null && !hudWindow.isDestroyed()
  return { active }
}
