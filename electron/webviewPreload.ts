import { ipcRenderer } from 'electron'

/**
 * Bridges window.postMessage from the main-world capture script
 * (captureInject.ts) across the context-isolation boundary into IPC.
 */
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as { __flowdeskCapture?: unknown; __flowdeskSniff?: unknown; __flowdeskGrokRaw?: unknown; __flowdeskWhatsApp?: unknown } | undefined
  if (!data || typeof data !== 'object') return
  if ('__flowdeskCapture' in data) ipcRenderer.send('capture:chunk', data.__flowdeskCapture)
  if ('__flowdeskSniff' in data) ipcRenderer.send('capture:sniff', data.__flowdeskSniff)
  if ('__flowdeskGrokRaw' in data) ipcRenderer.send('capture:grokRaw', data.__flowdeskGrokRaw)
  if ('__flowdeskWhatsApp' in data) ipcRenderer.send('whatsapp:event', data.__flowdeskWhatsApp)
})
