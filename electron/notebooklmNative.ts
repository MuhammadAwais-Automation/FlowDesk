/**
 * Native NotebookLM session boundary.
 *
 * This is deliberately separate from the notebooklm-py worker: it owns the
 * FlowDesk Google identity and never serialises cookies into the renderer or
 * worker.  Today it provides session health and a same-partition native
 * NotebookLM window.  The narrow `NativeNotebookCapability` result is the
 * safe seam for a future direct RPC adapter after its protocol matrix has
 * been verified against a disposable notebook.
 */
import { BrowserWindow, session } from 'electron'

export interface FlowDeskGoogleAccount {
  email: string
  partition: string
}

export interface NativeNotebookCapability {
  available: boolean
  email: string | null
  partition: string | null
  sessionState: 'missing-account' | 'no-google-session' | 'ready'
  directRpc: 'not-implemented'
}

let notebookWindow: BrowserWindow | null = null

function accountFor(email: string | null, accounts: FlowDeskGoogleAccount[]) {
  if (email) return accounts.find(account => account.email.toLowerCase() === email.toLowerCase()) ?? null
  return accounts[0] ?? null
}

/** Cookie names/values are intentionally neither returned nor logged. */
export async function getNativeNotebookCapability(email: string | null, accounts: FlowDeskGoogleAccount[]): Promise<NativeNotebookCapability> {
  const account = accountFor(email, accounts)
  if (!account) {
    return { available: false, email: null, partition: null, sessionState: 'missing-account', directRpc: 'not-implemented' }
  }
  const googleSession = session.fromPartition(`persist:${account.partition}`)
  const cookies = await googleSession.cookies.get({ domain: '.google.com' })
  const hasGoogleSession = cookies.some(cookie => /^(SID|HSID|SSID|APISID|SAPISID|__Secure-1PSID)$/.test(cookie.name))
  return {
    available: hasGoogleSession,
    email: account.email,
    partition: account.partition,
    sessionState: hasGoogleSession ? 'ready' : 'no-google-session',
    directRpc: 'not-implemented',
  }
}

/** Opens NotebookLM inside the exact selected FlowDesk Google partition. */
export async function openNativeNotebook(email: string | null, accounts: FlowDeskGoogleAccount[]) {
  const account = accountFor(email, accounts)
  if (!account) throw new Error('Select a FlowDesk Google account before opening NotebookLM.')
  if (notebookWindow && !notebookWindow.isDestroyed()) {
    notebookWindow.show()
    notebookWindow.focus()
    return { opened: true, reused: true, email: account.email }
  }
  notebookWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    title: 'NotebookLM — FlowDesk',
    webPreferences: {
      session: session.fromPartition(`persist:${account.partition}`),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  notebookWindow.on('closed', () => { notebookWindow = null })
  await notebookWindow.loadURL('https://notebooklm.google.com/')
  return { opened: true, reused: false, email: account.email }
}

export function closeNativeNotebook() {
  if (notebookWindow && !notebookWindow.isDestroyed()) notebookWindow.close()
  notebookWindow = null
}
