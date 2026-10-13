/**
 * Auto-update from GitHub Releases (package.json build.publish). Only the
 * installed app checks; a new version downloads in the background while the
 * sidebar shows its progress, then installs silently on "Restart to update"
 * or the next time FlowDesk closes. No network or a missing release only logs.
 */
import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const CHECK_EVERY_MS = 6 * 60 * 60_000

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }

let status: UpdateStatus = { state: 'idle' }

export function startAutoUpdate(getWindow: () => BrowserWindow | null): void {
  const { autoUpdater } = electronUpdater
  const publish = (next: UpdateStatus) => {
    status = next
    getWindow()?.webContents.send('update:status', status)
  }
  ipcMain.handle('update:getStatus', () => status)
  // Silent: no installer wizard, and FlowDesk opens again when done.
  ipcMain.handle('update:install', () => { if (status.state === 'ready') autoUpdater.quitAndInstall(true, true) })
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', err => {
    console.warn('[FlowDesk Update] check failed:', err?.message ?? err)
    if (status.state === 'downloading') publish({ state: 'idle' })
  })
  autoUpdater.on('update-available', info => publish({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', p => {
    const version = status.state === 'downloading' ? status.version : ''
    publish({ state: 'downloading', version, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', info => publish({ state: 'ready', version: info.version }))
  const check = () => { autoUpdater.checkForUpdates().catch(() => {}) }
  check()
  setInterval(check, CHECK_EVERY_MS).unref?.()
}
