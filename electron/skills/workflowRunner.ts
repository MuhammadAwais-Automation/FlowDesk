import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkflowRun, WorkflowStep } from './types'
import { getWorkflow } from './skillRegistry'

const MAX_RUN_HISTORY = 50
const runHistory: WorkflowRun[] = []

export function resolvePath(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined
  const parts = path.trim().replace(/\[(\w+)\]/g, '.$1').split('.')
  let current = obj
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  return current
}

export function substituteTemplates(value: any, context: Record<string, any>): any {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    const singleMatch = value.match(/^{{\s*([^}]+)\s*}}$/)
    if (singleMatch) {
      const resolved = resolvePath(context, singleMatch[1])
      return resolved !== undefined ? resolved : ''
    }

    return value.replace(/{{\s*([^}]+)\s*}}/g, (_, path) => {
      const resolved = resolvePath(context, path)
      if (resolved === undefined || resolved === null) return ''
      if (typeof resolved === 'object') return JSON.stringify(resolved)
      return String(resolved)
    })
  }

  if (Array.isArray(value)) {
    return value.map(item => substituteTemplates(item, context))
  }

  if (typeof value === 'object') {
    const result: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = substituteTemplates(v, context)
    }
    return result
  }

  return value
}

export function evaluateCondition(condStr: string, context: Record<string, any>): boolean {
  if (!condStr || !condStr.trim()) return true

  const substituted = substituteTemplates(condStr, context)
  if (typeof substituted === 'boolean') return substituted
  if (typeof substituted === 'number') return substituted !== 0

  const trimmed = String(substituted).trim()
  if (trimmed === 'false' || trimmed === 'null' || trimmed === 'undefined' || trimmed === '0' || trimmed === '') {
    return false
  }
  if (trimmed === 'true') return true

  try {
    const fn = new Function('context', `with(context) { return Boolean(${trimmed}); }`)
    return Boolean(fn(context))
  } catch {
    return Boolean(trimmed)
  }
}

export function orderStepsTopologically(steps: WorkflowStep[]): WorkflowStep[] {
  const stepMap = new Map<string, WorkflowStep>()
  for (const s of steps) {
    stepMap.set(s.id, s)
  }

  for (const s of steps) {
    if (s.dependsOn) {
      for (const dep of s.dependsOn) {
        if (!stepMap.has(dep)) {
          throw new Error(`Step "${s.id}" depends on unknown step "${dep}"`)
        }
      }
    }
  }

  // Detect cycles and sort
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const sorted: WorkflowStep[] = []

  function visit(stepId: string) {
    if (visiting.has(stepId)) {
      throw new Error(`Circular dependency detected in workflow steps: cycle involves "${stepId}"`)
    }
    if (visited.has(stepId)) return

    visiting.add(stepId)
    const step = stepMap.get(stepId)!
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        visit(dep)
      }
    }
    visiting.delete(stepId)
    visited.add(stepId)
    sorted.push(step)
  }

  for (const s of steps) {
    if (!visited.has(s.id)) {
      visit(s.id)
    }
  }

  return sorted
}

// ── run history (persisted when a directory is configured) ─────────────────

let runsDir: string | null = null

/**
 * Where runs are written, one JSON file each. Without it a run lived only in
 * memory: a restart lost every result and there was nothing to resume from.
 */
export async function configureRunStore(dir: string): Promise<void> {
  runsDir = dir
  await mkdir(dir, { recursive: true })
  const files = (await readdir(dir)).filter(f => f.endsWith('.json'))
  const loaded: WorkflowRun[] = []
  for (const f of files) {
    try { loaded.push(JSON.parse(await readFile(join(dir, f), 'utf8'))) } catch { /* skip a torn file */ }
  }
  // A run still "running" on disk was cut off by a quit or crash. Marking it
  // failed is what lets it be resumed instead of hanging as running forever.
  for (const r of loaded) {
    if (r.status !== 'running' && r.status !== 'pending') continue
    r.status = 'failed'
    r.error = 'interrupted: FlowDesk closed while this run was in progress'
    for (const s of Object.values(r.stepResults)) if (s.status === 'running') s.status = 'failed'
  }
  loaded.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
  runHistory.length = 0
  runHistory.push(...loaded.slice(0, MAX_RUN_HISTORY))
}

function recordRun(run: WorkflowRun): void {
  const existingIdx = runHistory.findIndex(r => r.id === run.id)
  if (existingIdx !== -1) {
    runHistory[existingIdx] = { ...run }
  } else {
    runHistory.unshift({ ...run })
    if (runHistory.length > MAX_RUN_HISTORY) {
      const dropped = runHistory.pop()
      if (dropped && runsDir) void unlink(join(runsDir, `${dropped.id}.json`)).catch(() => {})
    }
  }
  if (runsDir) persist(runsDir, run)
}

// Writes are chained: two overlapping writeFile calls can finish out of order
// and leave an earlier "running" snapshot over the final one.
let writeChain: Promise<void> = Promise.resolve()

function persist(dir: string, run: WorkflowRun) {
  const snapshot = JSON.stringify(run, null, 2)
  writeChain = writeChain.then(() => writeFile(join(dir, `${run.id}.json`), snapshot, 'utf8')).catch(() => {})
}

/** Resolves once every run written so far is on disk. */
export function flushRunStore(): Promise<void> {
  return writeChain
}

// ── execution ───────────────────────────────────────────────────────────────

export type ToolResolver = (toolName: string, params: any) => Promise<any>

export interface RunOptions {
  /** True when the executor has this tool. Unknown tools fail the run before any step runs. */
  hasTool?: (toolName: string) => boolean
  /** Test hook: replaces the wait between retries. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * A tool that answers instead of throwing still failed when it says so:
 * `{ ok: false }` from an RPC handler, `{ isError: true }` from an agent tool.
 * Counting those as completed is how a failed upload read as a published video.
 */
export function resultFailure(result: any): string | null {
  if (!result || typeof result !== 'object') return null
  if (result.ok === false || result.isError === true) {
    const text = Array.isArray(result.content) ? result.content.map((c: any) => c?.text).filter(Boolean).join(' ') : ''
    return String(result.error || text || 'the tool reported failure')
  }
  return null
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function fail(run: WorkflowRun, error: string): WorkflowRun {
  run.status = 'failed'
  run.error = error
  run.completedAt = new Date().toISOString()
  recordRun(run)
  return run
}

async function executeSteps(run: WorkflowRun, steps: WorkflowStep[], resolver: ToolResolver | undefined, options: RunOptions): Promise<WorkflowRun> {
  const stepResults = run.stepResults
  const initialInputs = run.inputs ?? {}
  const sleep = options.sleep ?? defaultSleep

  for (const step of steps) {
    // Resume: a step that already finished keeps its result.
    const prior = stepResults[step.id]
    if (prior && (prior.status === 'completed' || prior.status === 'skipped')) continue

    if (step.dependsOn && step.dependsOn.length > 0) {
      const failedDep = step.dependsOn.find(depId => {
        const depResult = stepResults[depId]
        return !depResult || depResult.status === 'failed'
      })
      if (failedDep) {
        stepResults[step.id] = { status: 'failed', error: `Dependency "${failedDep}" failed or did not execute`, durationMs: 0 }
        return fail(run, `Step "${step.title}" (${step.id}) aborted because dependency "${failedDep}" failed`)
      }
    }

    const context: Record<string, any> = { inputs: initialInputs, steps: stepResults, ...stepResults }

    if (step.condition && !evaluateCondition(step.condition, context)) {
      stepResults[step.id] = { status: 'skipped', result: { skipped: true, reason: 'Condition evaluated to false' }, durationMs: 0 }
      recordRun(run)
      continue
    }

    const stepStart = Date.now()
    stepResults[step.id] = { status: 'running', durationMs: 0 }
    recordRun(run)

    const evaluatedParams = substituteTemplates(step.params || {}, context)
    const maxAttempts = 1 + Math.max(0, Math.floor(step.retries ?? 0))
    let lastError = ''

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) await sleep((step.retryDelayMs ?? 5000) * 2 ** (attempt - 2))
      try {
        let result: any
        if (step.actionTool) {
          // No executor means nothing can actually run; saying "ok" here is
          // what made UI-started workflows report every step as done.
          if (!resolver) throw new Error(`no tool executor is available to run "${step.actionTool}"`)
          result = await resolver(step.actionTool, evaluatedParams)
          const failure = resultFailure(result)
          if (failure) throw new Error(failure)
        } else {
          result = { ok: true, params: evaluatedParams }
        }
        stepResults[step.id] = { status: 'completed', result, durationMs: Date.now() - stepStart, attempts: attempt }
        recordRun(run)
        lastError = ''
        break
      } catch (err: any) {
        lastError = err?.message || String(err)
      }
    }

    if (lastError) {
      stepResults[step.id] = { status: 'failed', error: lastError, durationMs: Date.now() - stepStart, attempts: maxAttempts }
      return fail(run, `Step "${step.title}" (${step.id}) failed: ${lastError}`)
    }
  }

  run.status = 'completed'
  run.error = undefined
  run.completedAt = new Date().toISOString()
  recordRun(run)
  return run
}

function prepare(workflowId: string, run: WorkflowRun, options: RunOptions): WorkflowStep[] | null {
  const workflow = getWorkflow(workflowId)
  if (!workflow) { fail(run, `Workflow "${workflowId}" not found in registry`); return null }
  let ordered: WorkflowStep[]
  try {
    ordered = orderStepsTopologically(workflow.steps)
  } catch (err: any) {
    fail(run, err.message || 'Failed to order steps')
    return null
  }
  if (options.hasTool) {
    const unknown = [...new Set(ordered.map(s => s.actionTool).filter((t): t is string => !!t && !options.hasTool!(t)))]
    if (unknown.length) {
      fail(run, `Workflow "${workflowId}" uses tools that do not exist: ${unknown.join(', ')}`)
      return null
    }
  }
  return ordered
}

export async function runWorkflow(
  workflowId: string,
  initialInputs: Record<string, any> = {},
  contextResolver?: ToolResolver,
  options: RunOptions = {},
): Promise<WorkflowRun> {
  const run: WorkflowRun = {
    id: randomUUID(),
    workflowId,
    inputs: initialInputs,
    status: 'running',
    stepResults: {},
    startedAt: new Date().toISOString(),
  }
  recordRun(run)
  const steps = prepare(workflowId, run, options)
  if (!steps) return run
  return executeSteps(run, steps, contextResolver, options)
}

/**
 * Continues a failed run from the step that failed: finished steps keep their
 * results (a rendered video is not rendered again), the rest run now.
 */
export async function resumeWorkflowRun(runId: string, contextResolver?: ToolResolver, options: RunOptions = {}): Promise<WorkflowRun> {
  const run = runHistory.find(r => r.id === runId)
  if (!run) throw new Error(`No workflow run "${runId}"`)
  if (run.status !== 'failed') throw new Error(`Run "${runId}" is ${run.status}; only a failed run can be resumed`)
  for (const [id, r] of Object.entries(run.stepResults)) {
    if (r.status === 'failed' || r.status === 'running') delete run.stepResults[id]
  }
  run.status = 'running'
  run.error = undefined
  run.completedAt = undefined
  recordRun(run)
  const steps = prepare(run.workflowId, run, options)
  if (!steps) return run
  return executeSteps(run, steps, contextResolver, options)
}

export function getWorkflowRun(runId: string): WorkflowRun | undefined {
  return runHistory.find(r => r.id === runId)
}

export function listWorkflowRuns(workflowId?: string): WorkflowRun[] {
  if (!workflowId) return [...runHistory]
  return runHistory.filter(r => r.workflowId === workflowId)
}

export function clearWorkflowRuns(): void {
  runHistory.length = 0
}
