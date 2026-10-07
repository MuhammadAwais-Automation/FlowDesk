/**
 * Auto-update from GitHub Releases (package.json build.publish). Only the
 * installed app checks; a new version downloads in the background and is
 * installed when the user restarts (now, from the prompt, or on next quit).
 * No network or a missing release only logs; the app keeps running.
 */
import { app, dialog, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const CHECK_EVERY_MS = 6 * 60 * 60_000

export function startAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', err => console.warn('[FlowDesk Update] check failed:', err?.message ?? err))
  autoUpdater.on('update-available', info => console.log(`[FlowDesk Update] downloading ${info.version}`))
  autoUpdater.on('update-downloaded', async info => {
    const win = getWindow()
    const options = {
      type: 'info' as const,
      title: 'FlowDesk update',
      message: `FlowDesk ${info.version} is ready.`,
      detail: 'Restart now to use it, or it installs the next time you close FlowDesk.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response === 0) autoUpdater.quitAndInstall()
  })
  const check = () => { autoUpdater.checkForUpdates().catch(() => {}) }
  check()
  setInterval(check, CHECK_EVERY_MS).unref?.()
}
