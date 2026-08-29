import { ipcMain, BrowserWindow, WebContents } from 'electron'
import type { NotebookLMStreamChunk } from '../../src/types/notebooklm'

let notebooklmWebContents: WebContents | null = null

export function setNotebookLMWebContents(contents: WebContents | null) {
  notebooklmWebContents = contents
}

export function getNotebookLMWebContents(): WebContents | null {
  return notebooklmWebContents
}

export function registerNotebookLMIpc(mainWindow: BrowserWindow) {
  // Register webContents when webview mounts
  ipcMain.on('notebooklm:register-webview', (event) => {
    const webContents: WebContents = event.sender
    setNotebookLMWebContents(webContents)
  })

  // Forward stream chunks from webview to React renderer
  ipcMain.on('notebooklm:stream-chunk', (_event, chunk: NotebookLMStreamChunk) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notebooklm:on-stream-chunk', chunk)
    }
  })
}
