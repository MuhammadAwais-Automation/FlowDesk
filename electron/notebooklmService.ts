/**
 * Optional persistent notebooklm-py REST sidecar supervisor.
 *
 * The upstream REST adapter is experimental, so FlowDesk never enables it by
 * default. Set FLOWDESK_NOTEBOOKLM_ENABLE_SERVER=1 after installing
 * `notebooklm-py[server]`; when health checks fail callers retain the safe CLI
 * transport. The sidecar is loopback-only and its bearer token is ephemeral.
 */
import { randomBytes } from 'crypto'
import { spawn } from 'child_process'
import type { NotebookLMResult } from './notebooklm'

export interface NotebookLMServiceState {
  mode: 'cli-fallback' | 'service-starting' | 'service-ready'
  reason?: string
  url?: string
}

let child: ReturnType<typeof spawn> | null = null
let state: NotebookLMServiceState = { mode: 'cli-fallback', reason: 'The optional NotebookLM REST runtime is not enabled.' }
let serviceToken: string | null = null

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function notebooklmServiceState() { return { ...state } }

export async function startNotebookLMService(profile: string): Promise<NotebookLMServiceState> {
  if (state.mode === 'service-ready' || state.mode === 'service-starting') return notebooklmServiceState()
  if (process.env.FLOWDESK_NOTEBOOKLM_ENABLE_SERVER !== '1') return notebooklmServiceState()
  const port = Number(process.env.FLOWDESK_NOTEBOOKLM_SERVER_PORT ?? 8765)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    state = { mode: 'cli-fallback', reason: 'NotebookLM service port is invalid.' }
    return notebooklmServiceState()
  }
  const url = `http://127.0.0.1:${port}`
  const token = randomBytes(32).toString('hex')
  serviceToken = token
  state = { mode: 'service-starting', url }
  const startedChild = spawn(process.env.FLOWDESK_NOTEBOOKLM_SERVER ?? 'notebooklm-server', ['--host', '127.0.0.1', '--port', String(port), '--profile', profile], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NOTEBOOKLM_SERVER_TOKEN: token },
  })
  child = startedChild
  // Drain output. It can contain auth/environment diagnostics and is never logged.
  startedChild.stdout?.resume(); startedChild.stderr?.resume()
  startedChild.on('error', () => { child = null; serviceToken = null; state = { mode: 'cli-fallback', reason: 'NotebookLM REST runtime is unavailable; using the CLI worker.' } })
  startedChild.on('exit', () => {
    child = null
    if (state.mode !== 'cli-fallback') { serviceToken = null; state = { mode: 'cli-fallback', reason: 'NotebookLM REST worker stopped; using the CLI worker.' } }
  })
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        state = { mode: 'service-ready', url }
        return notebooklmServiceState()
      }
    } catch { /* startup race */ }
    await delay(250)
  }
  child?.kill(); child = null; serviceToken = null
  state = { mode: 'cli-fallback', reason: 'NotebookLM REST worker did not become healthy; using the CLI worker.' }
  return notebooklmServiceState()
}

export function stopNotebookLMService() {
  child?.kill(); child = null; serviceToken = null
  state = { mode: 'cli-fallback', reason: 'NotebookLM REST worker is stopped.' }
}

/** Uses the persistent sidecar when it is healthy. `null` means callers must
 * transparently use the isolated CLI worker instead. */
export async function notebooklmServiceRequest(path: string, init: RequestInit = {}): Promise<NotebookLMResult | null> {
  if (state.mode !== 'service-ready' || !state.url || !serviceToken) return null
  try {
    const response = await fetch(`${state.url}/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${serviceToken}`, ...(init.headers ?? {}) },
      signal: init.signal ?? AbortSignal.timeout(90_000),
    })
    const data = await response.json().catch(() => undefined) as unknown
    if (response.ok) return { ok: true, exitCode: 0, data }
    const message = data && typeof data === 'object' && 'error' in data
      ? String((data as { error?: { message?: unknown } }).error?.message ?? 'NotebookLM service rejected this operation.')
      : 'NotebookLM service rejected this operation.'
    return { ok: false, exitCode: response.status, data, error: { code: `HTTP_${response.status}`, message } }
  } catch {
    state = { mode: 'cli-fallback', reason: 'NotebookLM REST worker became unreachable; using the CLI worker.' }
    serviceToken = null
    return null
  }
}
