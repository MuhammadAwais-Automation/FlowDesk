import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { WebContents } from 'electron'
import { PROBE_TOOLKIT_SCRIPT, type HostInjectedFile } from './probeToolkit'

/**
 * Discovery probe runner — the autonomous harness for reverse-engineering a web app
 * from inside a live, logged-in session.
 *
 * The problem it removes: a probe used to live inside the app's own source,
 * so changing one question meant rebuilding, relaunching, waiting for login
 * and history sync, and hand-copying terminal output. Two to three minutes
 * per question, on a task that needs dozens of questions.
 *
 * Nothing about that was necessary. A probe is just a string of JavaScript
 * evaluated in a page that is already open — which whatsapp_diagnose already
 * proved by running the same probes with no restart at all. It was baked
 * into the source only because that is where it happened to be written.
 * Here it lives in a file instead: save the file, the result appears.
 *
 * Deliberately generic — no site names anywhere in this module. It takes a
 * view resolver and a directory, and knows nothing about what is being
 * probed. That is what makes it liftable into another Electron app later
 * (copy this folder, wire three lines) rather than something that has to be
 * rewritten per platform.
 *
 * In addition to raw evaluation, the harness injects an autonomous action toolkit
 * (`window.probe`) providing primitives for:
 * - Smart typing across regular inputs and rich contenteditable editors (Draft.js, Lexical)
 * - Synthetic pointer and mouse event dispatching (`probe.click`)
 * - Switch / checkbox toggling (`probe.setSwitch`)
 * - Virtual file injection (`probe.injectFile` using DataTransfer + File)
 * - Host-assisted file loading via `// @file <alias> <path>`
 * - Action-scoped network interception (`probe.captureNetwork`)
 * - In-page DOM waiting (`probe.waitFor`)
 *
 * NOT exposed to the in-app agent, and it must stay that way. This evaluates
 * arbitrary JavaScript inside an authenticated session; the agent reads
 * message and post content written by strangers, and a tool of this shape
 * cannot be meaningfully gated — there is nothing to show in an approval
 * dialog that a user could reasonably judge. The narrow tools (send one
 * message to one chat) can be gated precisely because their parameters say
 * what they will do. This one cannot.
 *
 * ── Probe file format ──────────────────────────────────────────────
 *
 *   // @target linkedin.com
 *   // @file resume ../assets/resume.pdf
 *   // @timeout 45000
 *   await probe.waitFor('input[type="file"]')
 *   await probe.injectFile('input[type="file"]', probe.files.resume)
 *   return { uploaded: true }
 *
 * The `@target` directive picks which open view to run in, matched as a URL
 * substring. The rest is the body of an async function, so `await` works and
 * `return` is how a result comes back.
 */

export interface ProbeRunnerOptions {
  /** Directory holding probe .js files. Results are written to `<dir>/out`. */
  dir: string
  /** Resolves a `@target` substring to a live page, or null if none is open. */
  resolveView: (targetMatch: string) => WebContents | null
  /** Per-probe time limit. A hung probe writes a timeout result rather than stalling. */
  timeoutMs?: number
  /** Called for every finished run — used for terminal output. */
  onResult?: (name: string, result: ProbeResult) => void
}

export interface ProbeResult {
  ok: boolean
  probe: string
  target: string
  /** The URL actually matched — proves the probe hit the page you meant. */
  url?: string
  ranAt: string
  durationMs: number
  result?: unknown
  error?: string
  stack?: string
  filesInjected?: string[]
}

export interface ProbeDirectives {
  target: string | null
  timeoutMs?: number
  goto?: string
  files: Array<{ alias: string; path: string }>
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Everything crossing back from the page is flattened to primitives first.
 *
 * executeJavaScript structured-clones its result, and a single un-cloneable
 * value — a function, a Blob, a DOM node — fails the WHOLE call with "An
 * object could not be cloned". That is worse than a plain failure: during the
 * WhatsApp work a diagnostic built to explain a bug included a method rather
 * than a value, and destroyed its own report. Probes are exploratory by
 * nature and will routinely return objects nobody has inspected yet, so this
 * has to happen here rather than being each probe author's problem.
 */
const SAFE_SERIALIZER = `
  function __fdSafe(v, depth) {
    depth = depth || 0
    if (v === null || v === undefined) return null
    var t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') return v
    if (t === 'function') return '[function ' + (v.name || 'anonymous') + ']'
    if (t === 'symbol' || t === 'bigint') return String(v)
    if (depth >= 6) return '[' + t + ' — depth limit]'
    try {
      if (v instanceof Error) return { __error: v.message, stack: String(v.stack || '').slice(0, 2000) }
      if (typeof Blob !== 'undefined' && v instanceof Blob) return '[Blob ' + v.size + 'b type=' + v.type + ']'
      if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return '[ArrayBuffer ' + v.byteLength + 'b]'
      if (typeof Node !== 'undefined' && v instanceof Node) return '[' + v.nodeName + ']'
      if (Array.isArray(v)) return v.slice(0, 200).map(function (x) { return __fdSafe(x, depth + 1) })
      var out = {}
      var keys = Object.keys(v).slice(0, 120)
      for (var i = 0; i < keys.length; i++) {
        try { out[keys[i]] = __fdSafe(v[keys[i]], depth + 1) } catch (e) { out[keys[i]] = '[unreadable]' }
      }
      return out
    } catch (e) { return '[' + t + ' — ' + String(e && e.message) + ']' }
  }
`

function lookupMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.mp4': return 'video/mp4'
    case '.webm': return 'video/webm'
    case '.mov': return 'video/quicktime'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.json': return 'application/json'
    case '.txt': return 'text/plain'
    case '.csv': return 'text/csv'
    case '.pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}

/** Reads the directives (// @target, // @file, // @timeout, // @goto). */
export function parseDirectives(source: string): ProbeDirectives {
  const targetMatch = source.match(/^\s*(?:\/\/|\/\*)\s*@target\s+(\S+)/m)
  const timeoutMatch = source.match(/^\s*(?:\/\/|\/\*)\s*@timeout\s+(\d+)/m)
  const gotoMatch = source.match(/^\s*(?:\/\/|\/\*)\s*@goto\s+(\S+)/m)

  const files: Array<{ alias: string; path: string }> = []
  const fileRegex = /^\s*(?:\/\/|\/\*)\s*@file\s+([a-zA-Z0-9_$]+)\s+([^\r\n]+)$/gm
  let m: RegExpExecArray | null
  while ((m = fileRegex.exec(source)) !== null) {
    const alias = m[1].trim()
    const rawPath = m[2].trim().replace(/^['"]|['"]$/g, '')
    files.push({ alias, path: rawPath })
  }

  return {
    target: targetMatch ? targetMatch[1] : null,
    timeoutMs: timeoutMatch ? parseInt(timeoutMatch[1], 10) : undefined,
    goto: gotoMatch ? gotoMatch[1] : undefined,
    files,
  }
}

/** Backward-compatible helper to parse @target directive. */
export function parseTarget(source: string): string | null {
  return parseDirectives(source).target
}

/** Wraps probe source so `await` and `return` work, toolkit is injected, and nothing throws across boundary. */
export function buildProbeScript(source: string, files: Record<string, HostInjectedFile> = {}): string {
  const filesJson = JSON.stringify(files)
  return `(async function () {
${SAFE_SERIALIZER}
${PROBE_TOOLKIT_SCRIPT}
  try {
    if (window.probe) {
      window.probe.files = ${filesJson};
    }
    var __fdRun = async function () {
${source}
    }
    return { ok: true, value: __fdSafe(await __fdRun()) }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 4000) }
  }
})()`
}

export async function runProbeFile(
  filePath: string,
  options: ProbeRunnerOptions,
): Promise<ProbeResult> {
  const name = basename(filePath, extname(filePath))
  const startedAt = Date.now()
  const base = { probe: name, ranAt: new Date().toISOString() }

  let source: string
  try {
    source = await readFile(filePath, 'utf8')
  } catch (e) {
    return { ...base, ok: false, target: '', durationMs: 0, error: `could not read probe: ${String(e)}` }
  }

  const directives = parseDirectives(source)
  const target = directives.target
  if (!target) {
    return {
      ...base, ok: false, target: '', durationMs: Date.now() - startedAt,
      error: 'probe has no "// @target <url-substring>" directive, so there is no way to know which page to run it in',
    }
  }

  const view = options.resolveView(target)
  if (!view) {
    return {
      ...base, ok: false, target, durationMs: Date.now() - startedAt,
      error: `no open view matching "${target}" — open that site in FlowDesk and sign in, then save this file again`,
    }
  }

  // Load any host files specified via @file directives
  const loadedFiles: Record<string, HostInjectedFile> = {}
  for (const { alias, path: targetPath } of directives.files) {
    try {
      const resolved = isAbsolute(targetPath)
        ? targetPath
        : resolve(dirname(filePath), targetPath)
      const buf = await readFile(resolved)
      loadedFiles[alias] = {
        name: basename(resolved),
        type: lookupMimeType(resolved),
        size: buf.length,
        base64: buf.toString('base64'),
      }
    } catch (e) {
      return {
        ...base, ok: false, target, durationMs: Date.now() - startedAt,
        error: `could not load @file "${alias}" from "${targetPath}": ${String(e)}`,
      }
    }
  }

  // Handle optional @goto navigation
  if (directives.goto && typeof (view as any).loadURL === 'function') {
    try {
      const currentUrl = view.getURL()
      if (currentUrl !== directives.goto) {
        await (view as any).loadURL(directives.goto)
      }
    } catch (e) {
      return {
        ...base, ok: false, target, durationMs: Date.now() - startedAt,
        error: `failed to navigate to @goto "${directives.goto}": ${String(e)}`,
      }
    }
  }

  let url = ''
  try { url = view.getURL() } catch { /* destroyed mid-run */ }

  const timeoutMs = directives.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const evaluation = view.executeJavaScript(buildProbeScript(source, loadedFiles)) as Promise<{
      ok: boolean; value?: unknown; error?: string; stack?: string
    }>
    // A probe that never settles must not wedge the watcher for every later
    // probe — exploratory code hangs (an unresolved fetch, a promise nobody
    // resolves) far more often than finished code does.
    const outcome = await Promise.race([
      evaluation,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs)),
    ])

    const filesInjected = Object.keys(loadedFiles)
    return outcome.ok
      ? { ...base, ok: true, target, url, durationMs: Date.now() - startedAt, result: outcome.value, ...(filesInjected.length ? { filesInjected } : {}) }
      : { ...base, ok: false, target, url, durationMs: Date.now() - startedAt, error: outcome.error, stack: outcome.stack, ...(filesInjected.length ? { filesInjected } : {}) }
  } catch (e) {
    return {
      ...base, ok: false, target, url, durationMs: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

async function writeResult(dir: string, name: string, result: ProbeResult): Promise<string> {
  const outDir = join(dir, 'out')
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${name}.json`)
  await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8')
  return outPath
}

/**
 * Watches `dir` and runs any probe whose file changes.
 *
 * Returns a stop function. Safe to call when the directory does not exist —
 * it is created, so a fresh checkout does not need a setup step.
 */
export async function startProbeRunner(options: ProbeRunnerOptions): Promise<() => void> {
  const { dir } = options
  await mkdir(join(dir, 'out'), { recursive: true })

  const running = new Set<string>()
  // Editors write a file in several operations, so one save can fire multiple
  // change events. Without this, a probe with a side effect could run twice
  // from a single save.
  const debounce = new Map<string, NodeJS.Timeout>()

  // Content hash per probe, seeded with every file already present at startup.
  // Watch events and mtimes are not proof of an edit: twice in one session
  // something touched the whole folder (restart / resume) and ~200 probes ran at
  // once — including ones that post LinkedIn comments. Only a real change of
  // content runs a probe now.
  const lastHash = new Map<string, string>()
  const hashOf = async (filePath: string) => {
    const text = await readFile(filePath, 'utf8').catch(() => null)
    return text === null ? null : createHash('sha1').update(text).digest('hex')
  }
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith('.js')) continue
    const h = await hashOf(join(dir, f))
    if (h) lastHash.set(f, h)
  }

  async function run(fileName: string) {
    if (!fileName.endsWith('.js')) return
    const filePath = join(dir, fileName)
    if (running.has(filePath)) return
    const hash = await hashOf(filePath)
    if (!hash || lastHash.get(fileName) === hash) return // deleted, or not actually changed
    lastHash.set(fileName, hash)
    running.add(filePath)
    try {
      const result = await runProbeFile(filePath, options)
      const outPath = await writeResult(dir, basename(fileName, '.js'), result)
      options.onResult?.(basename(fileName, '.js'), { ...result, url: result.url })
      if (!options.onResult) console.log(`[probe] ${fileName} -> ${outPath}`)
    } finally {
      running.delete(filePath)
    }
  }

  function schedule(fileName: string) {
    const key = String(fileName)
    clearTimeout(debounce.get(key))
    debounce.set(key, setTimeout(() => { debounce.delete(key); void run(key) }, 150))
  }

  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dir, (_event, fileName) => { if (fileName) schedule(fileName) })
  } catch (e) {
    console.log(`[probe] could not watch ${dir}: ${String(e)}`)
  }

  // Belt-and-braces mtime poll alongside fs.watch.
  const seenMtimes = new Map<string, number>()
  let firstPoll = true
  const poll = setInterval(async () => {
    const files = await readdir(dir).catch(() => [] as string[])
    for (const file of files) {
      if (!file.endsWith('.js')) continue
      const stats = await stat(join(dir, file)).catch(() => null)
      if (!stats) continue
      const mtime = stats.mtimeMs
      const previous = seenMtimes.get(file)
      seenMtimes.set(file, mtime)
      if (firstPoll || previous === undefined || previous === mtime) continue
      schedule(file)
    }
    firstPoll = false
  }, 1000)

  const existing = (await readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith('.js'))
  console.log(`[probe] watching ${dir}`)
  if (existing.length) {
    console.log(`[probe] ready: ${existing.join(', ')}`)
    console.log('[probe] change a probe file content (or add a new file) to run it — an unchanged save no longer re-runs it')
  } else {
    console.log('[probe] no probe files yet — add a .js file with a "// @target <url-substring>" first line')
  }

  return () => {
    watcher?.close()
    clearInterval(poll)
    for (const timer of debounce.values()) clearTimeout(timer)
    debounce.clear()
  }
}
