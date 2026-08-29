/**
 * A small, deliberately boring boundary around notebooklm-py's CLI.  It keeps
 * Google session material inside notebooklm-py's named profile and never puts
 * it in IPC payloads, logs, or the renderer process.
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'

export const NOTEBOOKLM_PROFILE = 'flowdesk'
let loginProcess: ReturnType<typeof spawn> | null = null
let activeProfile = NOTEBOOKLM_PROFILE
const activeChatStreams = new Map<string, ReturnType<typeof spawn>>()

function profileForAccount(email: string | null | undefined): string {
  // UI labels may contain a human name around the address.  Profiles must
  // always be based on the canonical Google address, never display text.
  const address = email?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()
  if (!address) return NOTEBOOKLM_PROFILE
  return `flowdesk-${address.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54)}`
}

export function notebooklmSelectAccount(email: string | null) {
  const address = email?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null
  activeProfile = profileForAccount(address)
  return { email: address, profile: activeProfile }
}

export function notebooklmGetActiveProfile() { return activeProfile }

export type NotebookLMArtifactKind =
  | 'audio' | 'video' | 'cinematic-video' | 'slide-deck' | 'quiz'
  | 'flashcards' | 'infographic' | 'data-table' | 'mind-map' | 'report'

/**
 * NotebookLM's CLI uses kebab-case names while its JSON listing returns
 * `type_id` values such as `slide_deck`. Older versions also exposed display
 * labels ("Slide Deck", "Audio Overview"). Keep that upstream variation at
 * this boundary so a renderer never has to guess a download command.
 */
export function normalizeArtifactKind(value: string): NotebookLMArtifactKind {
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
  const aliases: Record<string, NotebookLMArtifactKind> = {
    audio: 'audio', 'audio-overview': 'audio', podcast: 'audio',
    video: 'video', 'video-overview': 'video',
    'cinematic-video': 'cinematic-video', 'cinematic-video-overview': 'cinematic-video',
    'slide-deck': 'slide-deck', slides: 'slide-deck', deck: 'slide-deck',
    quiz: 'quiz', quizzes: 'quiz',
    flashcard: 'flashcards', flashcards: 'flashcards', cards: 'flashcards',
    infographic: 'infographic', infographics: 'infographic',
    'data-table': 'data-table', table: 'data-table', tables: 'data-table',
    'mind-map': 'mind-map', map: 'mind-map', maps: 'mind-map',
    report: 'report', 'briefing-doc': 'report', 'study-guide': 'report', 'blog-post': 'report',
  }
  const kind = aliases[key]
  if (!kind) throw new Error('Unsupported artifact kind. Refresh the artifact list and try again.')
  return kind
}

export interface NotebookLMResult {
  ok: boolean
  data?: unknown
  error?: { message: string; code?: string }
  exitCode: number
}

function safeWorkerMessage(stderr: string, stdout: string, fallback: string): string {
  // The CLI may print local paths and Google redirect URLs. Keep only the
  // human-facing final diagnostic, and never send raw command output over IPC.
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/[A-Z]:\\|https?:\/\/|storage_state|cookie|token/i.test(line))
  const useful = lines.find(line => /error|failed|unable|cannot|already|install|browser/i.test(line))
  return useful ? useful.slice(0, 300) : fallback
}

export interface NotebookLMSourceInput {
  notebookId: string
  content: string
  type: 'text' | 'url'
  title?: string
}

export interface NotebookLMArtifactRequest {
  notebookId: string
  kind: NotebookLMArtifactKind
  instructions?: string
  sourceIds?: string[]
  options?: Record<string, string | number | boolean | undefined>
}

const sourceCountCache = new Map<string, { count: number; expiresAt: number }>()
const SOURCE_COUNT_TTL_MS = 5 * 60_000

function sourceCountCacheKey(notebookId: string) { return `${activeProfile}:${notebookId}` }
function invalidateSourceCount(notebookId: string) { sourceCountCache.delete(sourceCountCacheKey(notebookId)) }

// This keeps the generic full-control route structured.  It is intentionally
// not a "run any shell command" escape hatch: arguments are still an array and
// the supported subcommands are explicit, so text cannot be interpreted by a
// shell.
const MANAGE_ACTIONS: Record<string, string[]> = {
  'notebook:rename': ['rename'],
  'notebook:delete': ['delete'],
  'source:list': ['source', 'list'],
  'source:get': ['source', 'get'],
  'source:fulltext': ['source', 'fulltext'],
  'source:guide': ['source', 'guide'],
  'source:refresh': ['source', 'refresh'],
  'source:stale': ['source', 'stale'],
  'source:wait': ['source', 'wait'],
  'source:clean': ['source', 'clean'],
  'source:delete': ['source', 'delete'],
  'source:rename': ['source', 'rename'],
  'note:list': ['note', 'list'],
  'note:get': ['note', 'get'],
  'note:create': ['note', 'create'],
  'note:save': ['note', 'save'],
  'note:delete': ['note', 'delete'],
  'note:rename': ['note', 'rename'],
  'label:list': ['label', 'list'],
  'label:create': ['label', 'create'],
  'label:delete': ['label', 'delete'],
  'label:add': ['label', 'add'],
  'label:remove': ['label', 'remove'],
  'label:rename': ['label', 'rename'],
  'label:emoji': ['label', 'emoji'],
  'label:generate': ['label', 'generate'],
  'label:sources': ['label', 'sources'],
  'share:status': ['share', 'status'],
  'share:add': ['share', 'add'],
  'share:remove': ['share', 'remove'],
  'share:public': ['share', 'public'],
  'share:update': ['share', 'update'],
  'share:view-level': ['share', 'view-level'],
  'research:cancel': ['research', 'cancel'],
  'artifact:get': ['artifact', 'get'],
  'artifact:poll': ['artifact', 'poll'],
  'artifact:wait': ['artifact', 'wait'],
  'artifact:retry': ['artifact', 'retry'],
  'artifact:export': ['artifact', 'export'],
  'artifact:suggestions': ['artifact', 'suggestions'],
  'artifact:rename': ['artifact', 'rename'],
  'artifact:delete': ['artifact', 'delete'],
  'profile:list': ['profile', 'list'],
  'profile:switch': ['profile', 'switch'],
  'notebook:summary': ['summary'],
  'notebook:metadata': ['metadata'],
}

function cliPath(): string {
  // Packagers/installers can set FLOWDESK_NOTEBOOKLM_CLI to an absolute pinned
  // executable.  Falling back to PATH permits a normal pipx/uv installation.
  return process.env.FLOWDESK_NOTEBOOKLM_CLI || 'notebooklm'
}

function chatPythonPath(): string {
  const configured = process.env.FLOWDESK_NOTEBOOKLM_PYTHON
  if (configured) return configured
  const candidate = join(process.env.APPDATA || '', 'uv', 'tools', 'notebooklm-py', 'Scripts', 'python.exe')
  return candidate
}

function chatStreamScriptPath(): string {
  // electron-vite keeps this file under the project root in development. The
  // packager must copy it alongside the main bundle for production builds.
  return join(app.getAppPath(), 'electron', 'notebooklm_chat_stream.py')
}

function asText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function addOption(args: string[], flag: string, value: unknown) {
  if (value === undefined || value === null || value === false) return
  args.push(flag)
  if (value !== true) args.push(String(value))
}

async function artifactDirectory(): Promise<string> {
  const directory = join(app.getPath('userData'), 'notebooklm-artifacts')
  await mkdir(directory, { recursive: true })
  return directory
}

/** Run one JSON CLI command. stdout is parsed strictly; stderr is not exposed
 * because it can include diagnostic environment details. */
export function runNotebookLM(args: string[], timeoutMs = 45_000, json = true): Promise<NotebookLMResult> {
  return new Promise((resolve) => {
    const child = spawn(cliPath(), ['--profile', activeProfile, ...args, ...(json ? ['--json'] : [])], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    const finish = (result: NotebookLMResult) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, exitCode: -1, error: { code: 'TIMEOUT', message: 'NotebookLM operation timed out. You can check its status and resume.' } })
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      const errorCode = (error as NodeJS.ErrnoException).code
      const message = errorCode === 'ENOENT'
        ? 'NotebookLM CLI was not found. Install the pinned notebooklm-py runtime or configure FLOWDESK_NOTEBOOKLM_CLI.'
        : 'NotebookLM worker could not start.'
      finish({ ok: false, exitCode: -1, error: { code: errorCode, message } })
    })
    child.on('close', (exitCode) => {
      try {
        const data = stdout.trim() ? (json ? JSON.parse(stdout) : undefined) : undefined
        if (exitCode === 0 && !(data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error)) {
          finish({ ok: true, exitCode: exitCode ?? 0, data })
        } else {
          const fromData = data && typeof data === 'object' ? (data as { message?: unknown; code?: unknown }).message : undefined
          finish({ ok: false, exitCode: exitCode ?? 1, data, error: {
            code: data && typeof data === 'object' ? String((data as { code?: unknown }).code || 'CLI_ERROR') : 'CLI_ERROR',
            message: typeof fromData === 'string' ? fromData : safeWorkerMessage(stderr, stdout, 'NotebookLM rejected this operation.'),
          } })
        }
      } catch {
        // Do not return raw CLI output. It may contain local paths or auth diagnostics.
        finish({ ok: false, exitCode: exitCode ?? 1, error: { code: 'INVALID_JSON', message: 'NotebookLM returned an unexpected response.' } })
      }
      void stderr // retained only so child stderr is drained, never logged.
    })
  })
}

export const notebooklmStatus = () => runNotebookLM(['auth', 'check', '--test'], 20_000)
export const notebooklmDoctor = () => runNotebookLM(['doctor'], 30_000)
export const notebooklmListNotebooks = () => runNotebookLM(['list'])
export const notebooklmCreateNotebook = (title: string) => runNotebookLM(['create', asText(title, 'title')])

/** `login` opens the library's isolated browser and waits only until it exits. */
export async function notebooklmLogin(browser: 'chromium' | 'chrome' | 'msedge' = 'chromium') {
  if (!['chromium', 'chrome', 'msedge'].includes(browser)) throw new Error('Unsupported login browser')
  // Login owns a visible browser and may legitimately take several minutes.
  // Do not keep an IPC invocation pending for that whole time: Electron will
  // surface a misleading handler failure if the user changes focus/closes the
  // Studio while authenticating. The Studio polls `auth check` instead.
  if (loginProcess && !loginProcess.killed) {
    return { ok: true, exitCode: 0, data: { launched: true, alreadyRunning: true } } satisfies NotebookLMResult
  }
  const child = spawn(cliPath(), ['--profile', activeProfile, 'login', '--browser', browser], {
    shell: false,
    windowsHide: true,
    // Keep pipes open and retain the child reference. `stdio: ignore` plus a
    // detached child made notebooklm-py exit before it could persist the
    // Playwright storage state on Windows.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  loginProcess = child
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  child.on('error', (error) => {
    console.error('[FlowDesk NotebookLM] login worker failed to launch:', (error as NodeJS.ErrnoException).code ?? error.name)
    loginProcess = null
  })
  child.on('close', (code) => {
    const outcome = code === 0 ? 'completed' : safeWorkerMessage(stderr, stdout, `ended with exit code ${code ?? 'unknown'}`)
    console.info('[FlowDesk NotebookLM] login worker', outcome)
    loginProcess = null
  })
  return { ok: true, exitCode: 0, data: { launched: true } } satisfies NotebookLMResult
}

export function notebooklmAddSource(input: NotebookLMSourceInput) {
  if (input.type !== 'text' && input.type !== 'url') throw new Error('Source type must be text or url')
  const args = ['source', 'add', asText(input.content, 'content'), '--notebook', asText(input.notebookId, 'notebookId'), '--type', input.type]
  if (input.title) args.push('--title', input.title)
  invalidateSourceCount(input.notebookId)
  return runNotebookLM(args, 90_000)
}

export function notebooklmStartResearch(notebookId: string, query: string, mode: 'fast' | 'deep' = 'deep') {
  return runNotebookLM(['source', 'add-research', asText(query, 'query'), '--notebook', asText(notebookId, 'notebookId'), '--mode', mode, '--no-wait'], 45_000)
}

export const notebooklmResearchStatus = (notebookId: string) => runNotebookLM(['research', 'status', '--notebook', asText(notebookId, 'notebookId')])
export const notebooklmAsk = (notebookId: string, question: string) => runNotebookLM(['ask', asText(question, 'question'), '--notebook', asText(notebookId, 'notebookId')], 90_000)

export type NotebookLMChatStreamEvent = {
  requestId: string
  type: 'queued' | 'thinking' | 'delta' | 'citations' | 'done' | 'error'
  text?: string
  citations?: unknown[]
  error?: string
}

/** Start a single JSONL chat stream. Google auth remains in the worker's named
 * profile; the renderer only receives answer text and citation metadata. */
export function notebooklmStartChatStream(notebookId: string, question: string, onEvent: (event: NotebookLMChatStreamEvent) => void, requestedId?: string) {
  const python = chatPythonPath()
  const script = chatStreamScriptPath()
  if (!existsSync(python)) throw new Error('NotebookLM Python runtime was not found. Reinstall the pinned notebooklm-py runtime.')
  if (!existsSync(script)) throw new Error('NotebookLM chat streaming helper is missing from this FlowDesk build.')
  const requestId = typeof requestedId === 'string' && /^chat-[a-zA-Z0-9-]{6,100}$/.test(requestedId)
    ? requestedId
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const child = spawn(python, [script, '--profile', activeProfile, '--notebook', asText(notebookId, 'notebookId'), '--question', asText(question, 'question')], {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeChatStreams.set(requestId, child)
  let pending = ''
  let ended = false
  type StreamPayload =
    | { type: 'queued' }
    | { type: 'thinking' }
    | { type: 'delta'; text: string }
    | { type: 'citations'; citations: unknown[] }
    | { type: 'done'; text?: string }
    | { type: 'error'; error: string }
  const send = (event: StreamPayload) => onEvent({ ...event, requestId })
  send({ type: 'queued' })
  const consume = (chunk: Buffer) => {
    pending += chunk.toString('utf8')
    const lines = pending.split(/\r?\n/); pending = lines.pop() || ''
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { type?: string; text?: unknown; answer?: unknown; citations?: unknown[]; conversationId?: unknown; message?: unknown }
        if (event.type === 'started') send({ type: 'thinking' })
        else if (event.type === 'delta' && typeof event.text === 'string') send({ type: 'delta', text: event.text })
        else if (event.type === 'done' && typeof event.answer === 'string') { ended = true; if (event.citations?.length) send({ type: 'citations', citations: event.citations }); send({ type: 'done', text: event.answer }) }
        else if (event.type === 'cancelled') { ended = true; send({ type: 'done' }) }
        else if (event.type === 'error') { ended = true; send({ type: 'error', error: typeof event.message === 'string' ? event.message : 'NotebookLM chat failed.' }) }
      } catch { /* Ignore non-protocol output. It is never forwarded to renderer. */ }
    }
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', () => { /* drain only; errors are sanitized JSONL */ })
  child.on('error', () => { if (!ended) send({ type: 'error', error: 'NotebookLM chat worker could not start.' }) })
  child.on('close', () => { activeChatStreams.delete(requestId); if (!ended) send({ type: 'error', error: 'NotebookLM chat ended before a response was received.' }) })
  return { requestId }
}

export function notebooklmCancelChatStream(requestId: string) {
  const child = activeChatStreams.get(asText(requestId, 'requestId'))
  if (!child) return { cancelled: false }
  activeChatStreams.delete(requestId)
  child.kill()
  return { cancelled: true }
}

export function cancelAllNotebookLMChatStreams() {
  for (const child of activeChatStreams.values()) child.kill()
  activeChatStreams.clear()
}
export const notebooklmListSources = (notebookId: string) => runNotebookLM(['source', 'list', '--notebook', asText(notebookId, 'notebookId')])
export const notebooklmListArtifacts = (notebookId: string) => runNotebookLM(['artifact', 'list', '--notebook', asText(notebookId, 'notebookId')])

/**
 * `notebooklm list` intentionally omits source counts. Fetching them lazily
 * avoids a misleading hard-coded zero while the small cache prevents the
 * sidebar from spawning a new CLI process on every render.
 */
export async function notebooklmGetSourceCounts(notebookIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(notebookIds.map(id => asText(id, 'notebookId')))].slice(0, 100)
  const counts: Record<string, number> = {}
  const pending: string[] = []
  const now = Date.now()
  for (const id of ids) {
    const cached = sourceCountCache.get(sourceCountCacheKey(id))
    if (cached && cached.expiresAt > now) counts[id] = cached.count
    else pending.push(id)
  }
  // Three parallel source-list calls keep the UI responsive without asking
  // Google to process every notebook at once.
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      const id = pending[cursor++]
      const result = await notebooklmListSources(id)
      if (!result.ok) continue
      const data = result.data as { count?: unknown; sources?: unknown } | undefined
      const count = typeof data?.count === 'number' ? data.count : Array.isArray(data?.sources) ? data.sources.length : 0
      counts[id] = count
      sourceCountCache.set(sourceCountCacheKey(id), { count, expiresAt: Date.now() + SOURCE_COUNT_TTL_MS })
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker))
  return counts
}

export function notebooklmGenerateArtifact(request: NotebookLMArtifactRequest) {
  const kind = normalizeArtifactKind(request.kind)
  const args = ['generate', kind, '--notebook', asText(request.notebookId, 'notebookId')]
  if (request.instructions) args.push(request.instructions)
  for (const sourceId of request.sourceIds ?? []) args.push('--source', asText(sourceId, 'sourceId'))
  for (const [key, value] of Object.entries(request.options ?? {})) {
    // Options are deliberately constrained to normal CLI flags, no raw args.
    if (!/^[a-z][a-z-]*$/.test(key)) throw new Error('Invalid artifact option')
    addOption(args, `--${key}`, value)
  }
  return runNotebookLM(args, 60_000)
}

export async function notebooklmDownloadArtifact(
  notebookId: string,
  kind: NotebookLMArtifactKind,
  artifactId?: string,
  format?: 'pdf' | 'pptx' | 'json' | 'markdown' | 'html',
) {
  kind = normalizeArtifactKind(kind)
  const directory = await artifactDirectory()
  const extension: Record<NotebookLMArtifactKind, string> = {
    audio: 'mp3', video: 'mp4', 'cinematic-video': 'mp4', 'slide-deck': 'pdf',
    quiz: 'json', flashcards: 'json', infographic: 'png', 'data-table': 'csv',
    'mind-map': 'json', report: 'md',
  }
  const allowedFormats: Partial<Record<NotebookLMArtifactKind, readonly string[]>> = {
    'slide-deck': ['pdf', 'pptx'], quiz: ['json', 'markdown', 'html'], flashcards: ['json', 'markdown', 'html'],
  }
  if (format && !allowedFormats[kind]?.includes(format)) {
    throw new Error(`The ${kind} artifact cannot be saved as ${format}.`)
  }
  const safeId = (artifactId || `${kind}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_')
  const output = join(directory, `${safeId}.${format ?? extension[kind]}`)
  const args = ['download', kind, output, '--notebook', asText(notebookId, 'notebookId'), '--no-clobber']
  if (artifactId) args.push('--artifact', asText(artifactId, 'artifactId'))
  if (format) args.push('--format', format)
  return runNotebookLM(args, 5 * 60_000)
}

/** Full CLI capability for the agent, restricted to a known command map. */
export function notebooklmManage(action: string, payload: { notebookId?: string; args?: string[] } = {}) {
  const base = MANAGE_ACTIONS[action]
  if (!base) throw new Error(`Unsupported NotebookLM management action: ${action}`)
  const args = [...base]
  for (const arg of payload.args ?? []) args.push(asText(arg, 'argument'))
  if (payload.notebookId) args.push('--notebook', asText(payload.notebookId, 'notebookId'))
  return runNotebookLM(args)
}
