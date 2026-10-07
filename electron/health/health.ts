/**
 * Tool health: one call that says, per platform, whether FlowDesk's tools
 * still work, without posting, sending or spending anything.
 *
 *   L1  session + one read: the platform's own status/list call answers ok,
 *       and the answer's SHAPE (key paths and types, never values) is hashed
 *       and compared with the last good run.
 *   L2  bundle check: the ids our tools send are looked up in the JS the page
 *       already loaded; a changed Google build label or an id that was seen
 *       before and is now gone means "re-verify".
 *   L3  rehearsal (only when asked): a write tool builds its real request and
 *       it is blocked before it leaves (rehearsal.ts). Each rehearsal is chosen
 *       so that even a leaked request would change nothing visible.
 *
 * Everything the platforms see is ordinary page traffic (L1) or nothing at
 * all (L2 re-reads cached scripts, L3 requests never leave).
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlatformSpec, RehearsalSpec } from './spec'

export type Status = 'ok' | 'warn' | 'fail' | 'skipped'

export interface CheckResult { level: 'L1' | 'L2' | 'L3'; name: string; status: Status; note: string }
export interface PlatformReport { platform: string; status: Status; checks: CheckResult[] }
export interface HealthReport { ranAt: string; status: Status; platforms: PlatformReport[] }

/** What one platform looked like on its last good run. */
export interface Baseline { shape?: string; versions?: string[]; found?: string[]; checkedAt?: string }

interface ScanAnswer { ok?: boolean; error?: string; versions?: string[]; needles?: { needle: string; found: boolean }[] }
interface RehearseAnswer { ok?: boolean; error?: string; blocked?: { url: string }[]; result?: unknown }

export interface HealthDeps {
  /** Runs one gateway RPC and returns its result (throws on transport errors). */
  invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>
  /** Folder for baseline.json and last.json. */
  dir: string
  now?: () => Date
}

const RANK: Record<Status, number> = { skipped: 0, ok: 1, warn: 2, fail: 3 }
export const worst = (all: readonly Status[]): Status => all.reduce<Status>((a, b) => (RANK[b] > RANK[a] ? b : a), 'skipped')

const short = (s: unknown) => String(s ?? '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '***').slice(0, 200)

/** Key paths with value types, arrays collapsed to their first item. Values never leave this function. */
export function shapeOf(value: unknown, depth = 6): string[] {
  const out = new Set<string>()
  const walk = (v: unknown, path: string, d: number) => {
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
    out.add(`${path}:${t}`)
    if (d <= 0) return
    if (Array.isArray(v)) { if (v.length) walk(v[0], `${path}[]`, d - 1); return }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${/^\d+$/.test(k) ? '#' : k}`, d - 1)
  }
  walk(value, '$', depth)
  return [...out].sort()
}

export const shapeHash = (value: unknown) => createHash('sha1').update(shapeOf(value).join('\n')).digest('hex').slice(0, 12)

function signedOut(r: Record<string, unknown>): boolean {
  return r.signedIn === false || r.loggedIn === false || /signed out|not signed in/i.test(String(r.error ?? ''))
}

async function readCheck(spec: PlatformSpec, deps: HealthDeps, base: Baseline, next: Baseline): Promise<CheckResult> {
  const name = spec.read.rpc
  try {
    const r = await deps.invoke(spec.read.rpc, spec.read.params) as Record<string, unknown> | null
    if (!r || r.ok === false) return { level: 'L1', name, status: 'fail', note: signedOut(r ?? {}) ? 'signed out' : short(r?.error ?? 'no answer') }
    if (signedOut(r)) return { level: 'L1', name, status: 'fail', note: 'signed out' }
    next.shape = shapeHash(r)
    if (base.shape && base.shape !== next.shape) return { level: 'L1', name, status: 'warn', note: 'answer shape changed since last good run; check the parser' }
    return { level: 'L1', name, status: 'ok', note: base.shape ? 'same shape as last good run' : 'first run: shape recorded' }
  } catch (e) {
    return { level: 'L1', name, status: 'fail', note: short(e instanceof Error ? e.message : e) }
  }
}

async function bundleCheck(spec: PlatformSpec, deps: HealthDeps, base: Baseline, next: Baseline): Promise<CheckResult | null> {
  if (!spec.bundle) return null
  try {
    const r = await deps.invoke('dev.bundleScan', { ...spec.bundle.view, needles: spec.bundle.needles }) as ScanAnswer
    if (!r?.ok) return { level: 'L2', name: 'bundle ids', status: 'skipped', note: short(r?.error ?? 'no answer') }
    const versions = r.versions ?? []
    const found = (r.needles ?? []).filter(n => n.found).map(n => n.needle)
    next.versions = versions
    next.found = found
    const lost = (base.found ?? []).filter(n => !found.includes(n))
    const changedBuild = !!base.versions?.length && !!versions.length && base.versions.join() !== versions.join()
    const notes = [`${found.length}/${spec.bundle.needles.length} ids in loaded code`]
    if (versions.length) notes.push(`build ${versions[0]}`)
    if (changedBuild) notes.push(`build changed from ${base.versions![0]}`)
    if (lost.length) notes.push(`no longer found: ${lost.join(', ')}`)
    return { level: 'L2', name: 'bundle ids', status: changedBuild || lost.length ? 'warn' : 'ok', note: notes.join('; ') }
  } catch (e) {
    return { level: 'L2', name: 'bundle ids', status: 'skipped', note: short(e instanceof Error ? e.message : e) }
  }
}

async function rehearsalCheck(r: RehearsalSpec, deps: HealthDeps): Promise<CheckResult> {
  try {
    const params = r.prepare ? await r.prepare(deps.invoke) : r.params
    if (!params) return { level: 'L3', name: r.tool, status: 'skipped', note: 'nothing safe to rehearse with' }
    const a = await deps.invoke('dev.rehearse', { ...r.view, urlPattern: r.urlPattern, method: r.method, call: { method: r.rpc, params }, timeoutMs: 90_000 }) as RehearseAnswer
    if (!a?.ok) return { level: 'L3', name: r.tool, status: 'fail', note: short(a?.error ?? 'no answer') }
    const blocked = a.blocked ?? []
    if (!blocked.length) return { level: 'L3', name: r.tool, status: 'fail', note: 'the tool never built its request (it failed earlier, or the endpoint moved)' }
    return { level: 'L3', name: r.tool, status: 'ok', note: `built ${blocked.length} request(s) to ${new URL(blocked[0].url).pathname}; blocked, nothing sent` }
  } catch (e) {
    return { level: 'L3', name: r.tool, status: 'fail', note: short(e instanceof Error ? e.message : e) }
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T } catch { return fallback }
}

export async function runHealth(specs: readonly PlatformSpec[], opts: { platforms?: string[]; rehearse?: boolean }, deps: HealthDeps): Promise<HealthReport> {
  const wanted = opts.platforms?.length ? specs.filter(s => opts.platforms!.includes(s.id)) : specs
  const baseFile = join(deps.dir, 'baseline.json')
  const baselines = await readJson<Record<string, Baseline>>(baseFile, {})
  const now = (deps.now ?? (() => new Date()))()
  const platforms: PlatformReport[] = []
  for (const spec of wanted) {
    const base = baselines[spec.id] ?? {}
    const next: Baseline = { ...base }
    const checks: CheckResult[] = [await readCheck(spec, deps, base, next)]
    if (checks[0].status !== 'fail') {
      const b = await bundleCheck(spec, deps, base, next)
      if (b) checks.push(b)
      if (opts.rehearse) for (const r of spec.rehearsals ?? []) checks.push(await rehearsalCheck(r, deps))
    }
    const status = worst(checks.map(c => c.status))
    // Only a good run becomes the new baseline, so a drift keeps warning until someone looks at it.
    if (status === 'ok') baselines[spec.id] = { ...next, checkedAt: now.toISOString() }
    platforms.push({ platform: spec.id, status, checks })
  }
  const report: HealthReport = { ranAt: now.toISOString(), status: worst(platforms.map(p => p.status)), platforms }
  await mkdir(deps.dir, { recursive: true })
  await writeFile(baseFile, JSON.stringify(baselines, null, 2))
  await writeFile(join(deps.dir, 'last.json'), JSON.stringify(report, null, 2))
  return report
}
