import { randomUUID } from 'crypto'
import type { NotebookCapabilities, GenerateArtifactInput, StartResearchInput } from './notebooklmCapabilities'

export type NotebookJobKind = 'research' | 'artifact'
export type NotebookJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface NotebookJob {
  id: string
  kind: NotebookJobKind
  status: NotebookJobStatus
  notebookId: string
  /** Account that owns the remote notebook. Prevents cross-profile polling. */
  accountEmail?: string
  providerJobId?: string
  /** notebooklm-py can return one id for the operation and another for polling. */
  providerTaskId?: string
  providerPollId?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  error?: string
  lastCheckedAt?: string
  /** Credential-free remote observations retained for restart recovery. */
  remote?: { status?: string; sourceCount?: number; artifactCount?: number; data?: unknown }
  request: StartResearchInput | GenerateArtifactInput
}

export interface NotebookJobStore {
  get(key: 'notebooklmJobs'): NotebookJob[] | undefined
  set(key: 'notebooklmJobs', value: NotebookJob[]): void
}

const REMOTE_DATA_MAX_DEPTH = 4
const REMOTE_DATA_MAX_KEYS = 24
const REMOTE_DATA_MAX_ITEMS = 24
const REMOTE_DATA_MAX_STRING = 1_000

/**
 * NotebookLM's status endpoint can occasionally include the entire generated
 * research report.  A job record is durable operational state, not a report
 * archive: retaining that payload bloats electron-store and, when surfaced to
 * an agent tool, can exhaust its context window.  Keep only a small,
 * credential-free diagnostic preview here.  The actual research is consumed
 * through ready notebook sources / grounded chat, never through job polling.
 */
function compactRemoteData(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return value.length <= REMOTE_DATA_MAX_STRING
      ? value
      : `${value.slice(0, REMOTE_DATA_MAX_STRING)}… [truncated ${value.length - REMOTE_DATA_MAX_STRING} characters]`
  }
  if (depth >= REMOTE_DATA_MAX_DEPTH) return '[nested data omitted]'
  if (Array.isArray(value)) {
    const items = value.slice(0, REMOTE_DATA_MAX_ITEMS).map(item => compactRemoteData(item, depth + 1))
    if (value.length > REMOTE_DATA_MAX_ITEMS) items.push(`[${value.length - REMOTE_DATA_MAX_ITEMS} additional items omitted]`)
    return items
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .slice(0, REMOTE_DATA_MAX_KEYS)
      .map(([key, item]) => [key, compactRemoteData(item, depth + 1)] as const)
    const compact = Object.fromEntries(entries) as Record<string, unknown>
    if (Object.keys(value as Record<string, unknown>).length > REMOTE_DATA_MAX_KEYS) {
      compact._truncated = `${Object.keys(value as Record<string, unknown>).length - REMOTE_DATA_MAX_KEYS} additional fields omitted`
    }
    return compact
  }
  return String(value)
}

function collectProviderIds(data: unknown, output: { taskId?: string; pollId?: string; jobId?: string } = {}, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 5) return output
  if (Array.isArray(data)) {
    for (const item of data) collectProviderIds(item, output, depth + 1)
    return output
  }
  for (const [key, candidate] of Object.entries(data as Record<string, unknown>)) {
    if (typeof candidate === 'string' && candidate) {
      if (key === 'task_id' || key === 'taskId') output.taskId ??= candidate
      else if (key === 'poll_id' || key === 'poll_task_id' || key === 'pollId') output.pollId ??= candidate
      else if (key === 'report_id' || key === 'artifact_id' || key === 'artifactId') output.jobId ??= candidate
    } else if (candidate && typeof candidate === 'object') collectProviderIds(candidate, output, depth + 1)
  }
  return output
}

function statusFrom(data: unknown, depth = 0): NotebookJobStatus | undefined {
  if (!data || typeof data !== 'object' || depth > 4) return undefined
  if (Array.isArray(data)) {
    for (const item of data) {
      const status = statusFrom(item, depth + 1)
      if (status) return status
    }
    return undefined
  }

  const record = data as Record<string, unknown>
  // Only trust explicit lifecycle fields. Searching the whole report text for
  // words such as "complete" previously let report prose mark a running job
  // as complete.
  for (const key of ['status', 'state', 'phase']) {
    const candidate = record[key]
    if (typeof candidate !== 'string') continue
    const text = candidate.toLowerCase()
    if (/cancelled|canceled/.test(text)) return 'cancelled'
    if (/failed|error/.test(text)) return 'failed'
    if (/completed|complete|ready|success/.test(text)) return 'completed'
    if (/running|pending|queued|processing|in.progress/.test(text)) return 'running'
  }
  for (const candidate of Object.values(record)) {
    if (candidate && typeof candidate === 'object') {
      const status = statusFrom(candidate, depth + 1)
      if (status) return status
    }
  }
  return undefined
}

function collectionCount(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = data as Record<string, unknown>
  if (typeof value.count === 'number') return value.count
  for (const key of ['sources', 'artifacts', 'items', 'data']) if (Array.isArray(value[key])) return value[key].length
  return undefined
}

function normalizedResearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/** Persistent history plus a short, supervised operation queue.  Long-running
 * NotebookLM generation itself remains server-side; FlowDesk stores the job ID
 * and polls it instead of holding a child process open. */
export class NotebookJobQueue {
  private jobs: NotebookJob[]
  private readonly capabilities: NotebookCapabilities
  private readonly store: NotebookJobStore
  private readonly getAccountEmail: () => string | null

  constructor(store: NotebookJobStore, capabilities: NotebookCapabilities, getAccountEmail: () => string | null = () => null) {
    this.store = store
    this.capabilities = capabilities
    this.getAccountEmail = getAccountEmail
    const accountEmail = getAccountEmail()
    this.jobs = (store.get('notebooklmJobs') ?? []).slice(-200).map(job =>
      !job.accountEmail && accountEmail ? { ...job, accountEmail } : job)
    if (accountEmail && this.jobs.some(job => job.accountEmail === accountEmail)) this.persist()
  }

  list(notebookId?: string, accountEmail: string | null = this.getAccountEmail()): NotebookJob[] {
    return this.jobs
      .filter(job => (!notebookId || job.notebookId === notebookId) && (!accountEmail || !job.accountEmail || job.accountEmail === accountEmail))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): NotebookJob | undefined { return this.jobs.find(job => job.id === id) }

  async startResearch(request: StartResearchInput): Promise<NotebookJob> {
    const normalized = normalizedResearchQuery(request.query)
    const existing = this.jobs.find((job) =>
      job.kind === 'research' && job.notebookId === request.notebookId &&
      (job.status === 'queued' || job.status === 'running') &&
      normalizedResearchQuery((job.request as StartResearchInput).query) === normalized,
    )
    // Do not submit indistinguishable research twice: it wastes quota and
    // makes sources impossible for the user to distinguish later.
    if (existing) return existing
    return this.start('research', request, () => this.capabilities.startResearch(request))
  }

  async generateArtifact(request: GenerateArtifactInput): Promise<NotebookJob> {
    const signature = JSON.stringify({
      kind: request.kind,
      instructions: request.instructions?.trim().replace(/\s+/g, ' ') ?? '',
      sourceIds: [...(request.sourceIds ?? [])].sort(),
      options: request.options ?? {},
    })
    const existing = this.jobs.find((job) =>
      job.kind === 'artifact' && job.notebookId === request.notebookId &&
      (job.status === 'queued' || job.status === 'running') &&
      JSON.stringify({
        kind: (job.request as GenerateArtifactInput).kind,
        instructions: (job.request as GenerateArtifactInput).instructions?.trim().replace(/\s+/g, ' ') ?? '',
        sourceIds: [...((job.request as GenerateArtifactInput).sourceIds ?? [])].sort(),
        options: (job.request as GenerateArtifactInput).options ?? {},
      }) === signature,
    )
    if (existing) return existing
    return this.start('artifact', request, () => this.capabilities.generateArtifact(request))
  }

  async refresh(id: string): Promise<NotebookJob> {
    const job = this.require(id)
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return job
    this.assertCurrentAccount(job)
    const artifactPollId = job.providerPollId ?? job.providerJobId ?? job.providerTaskId
    const result = job.kind === 'research'
      ? await this.capabilities.researchStatus(job.notebookId)
      : artifactPollId
        ? await this.capabilities.manage('artifact:poll', { notebookId: job.notebookId, args: [artifactPollId] })
        : await this.capabilities.listArtifacts(job.notebookId)
    const remote = await this.reconcileRemoteEvidence(job)
    const ids = collectProviderIds(result.data)
    const inferredStatus = job.kind === 'artifact' && !artifactPollId
      ? job.remote?.artifactCount !== undefined && remote.artifactCount !== undefined && remote.artifactCount > job.remote.artifactCount
        ? 'completed'
        : 'running'
      : statusFrom(result.data) ?? 'running'
    this.update(job, {
      // A timeout, expired login, or temporary network failure says nothing
      // about a server-side job. Keep it recoverable until NotebookLM returns
      // an explicit terminal lifecycle state.
      status: result.ok ? inferredStatus : job.status,
      error: result.ok ? undefined : result.error?.message ?? 'NotebookLM status could not be refreshed.',
      providerTaskId: ids.taskId ?? job.providerTaskId,
      providerPollId: ids.pollId ?? job.providerPollId,
      providerJobId: ids.jobId ?? job.providerJobId,
      lastCheckedAt: new Date().toISOString(),
      remote: { ...remote, data: result.ok ? compactRemoteData(result.data) : undefined },
    })
    return job
  }

  /** Reattach to server-side operations saved before an app restart. */
  async reconcileActiveJobs(): Promise<NotebookJob[]> {
    const accountEmail = this.getAccountEmail()
    const active = this.jobs.filter(job =>
      (job.status === 'queued' || job.status === 'running') &&
      (!accountEmail || !job.accountEmail || job.accountEmail === accountEmail),
    )
    await Promise.all(active.map(async (job) => {
      try { await this.refresh(job.id) } catch (error) {
        this.update(job, { error: error instanceof Error ? error.message : String(error), lastCheckedAt: new Date().toISOString() })
      }
    }))
    return this.list()
  }

  async cancel(id: string): Promise<NotebookJob> {
    const job = this.require(id)
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return job
    this.assertCurrentAccount(job)
    if (job.kind === 'research' && job.providerJobId) {
      const result = await this.capabilities.manage('research:cancel', { notebookId: job.notebookId, args: [job.providerJobId] })
      if (!result.ok) throw new Error(result.error?.message ?? 'NotebookLM could not cancel research.')
    }
    // NotebookLM has no general cancellation endpoint for Studio artifacts.
    // We stop tracking it locally; it may still finish remotely and be listed.
    this.update(job, { status: 'cancelled', completedAt: new Date().toISOString() })
    return job
  }

  async retry(id: string): Promise<NotebookJob> {
    const job = this.require(id)
    this.assertCurrentAccount(job)
    if (job.kind === 'research') return this.startResearch(job.request as StartResearchInput)
    if (job.providerJobId) {
      const result = await this.capabilities.manage('artifact:retry', { notebookId: job.notebookId, args: [job.providerJobId] })
      if (!result.ok) throw new Error(result.error?.message ?? 'NotebookLM could not retry this artifact.')
    }
    return this.generateArtifact(job.request as GenerateArtifactInput)
  }

  private async start(kind: NotebookJobKind, request: StartResearchInput | GenerateArtifactInput, operation: () => Promise<{ ok: boolean; data?: unknown; error?: { message: string; code?: string } }>): Promise<NotebookJob> {
    const now = new Date().toISOString()
    const job: NotebookJob = {
      id: randomUUID(), kind, status: 'queued', notebookId: request.notebookId,
      accountEmail: this.getAccountEmail() ?? undefined,
      request, createdAt: now, updatedAt: now,
    }
    this.jobs.push(job); this.persist()
    this.update(job, { status: 'running' })
    if (kind === 'artifact') {
      try {
        const artifacts = await this.capabilities.listArtifacts(request.notebookId)
        if (artifacts.ok) this.update(job, { remote: { artifactCount: collectionCount(artifacts.data) } })
      } catch {
        // A baseline improves lost-response recovery, but generation remains
        // usable when the library endpoint is temporarily unavailable.
      }
    }
    let result: Awaited<ReturnType<typeof operation>>
    try {
      result = await operation()
    } catch (error) {
      // Submission may have reached NotebookLM before the transport failed.
      // Preserve the durable checkpoint so restart reconciliation can find it.
      this.update(job, {
        error: error instanceof Error ? error.message : String(error),
        lastCheckedAt: new Date().toISOString(),
      })
      throw error
    }
    const ids = collectProviderIds(result.data)
    const uncertainSubmission = !result.ok && result.error?.code === 'TIMEOUT'
    this.update(job, result.ok
      ? {
          status: statusFrom(result.data) ?? 'running',
          providerTaskId: ids.taskId,
          providerPollId: ids.pollId,
          providerJobId: ids.jobId,
          lastCheckedAt: new Date().toISOString(),
          remote: { data: compactRemoteData(result.data) },
        }
      : {
          status: uncertainSubmission ? 'running' : 'failed',
          error: result.error?.message,
          lastCheckedAt: new Date().toISOString(),
          ...(uncertainSubmission ? {} : { completedAt: new Date().toISOString() }),
        })
    return job
  }

  private async reconcileRemoteEvidence(job: NotebookJob): Promise<NonNullable<NotebookJob['remote']>> {
    // Evidence is supplementary. A source-list transport hiccup must not hide
    // the actual task-status result or turn a recoverable job into a thrown
    // refresh call.
    const [sources, artifacts] = await Promise.all([
      this.capabilities.listSources(job.notebookId).catch(() => undefined),
      this.capabilities.listArtifacts(job.notebookId).catch(() => undefined),
    ])
    return {
      sourceCount: sources?.ok ? collectionCount(sources.data) : job.remote?.sourceCount,
      artifactCount: artifacts?.ok ? collectionCount(artifacts.data) : job.remote?.artifactCount,
    }
  }

  private require(id: string): NotebookJob {
    const job = this.get(id)
    if (!job) throw new Error('NotebookLM job was not found.')
    return job
  }

  private assertCurrentAccount(job: NotebookJob) {
    const current = this.getAccountEmail()
    if (job.accountEmail && current && job.accountEmail !== current) {
      throw new Error(`Switch to ${job.accountEmail} to refresh this NotebookLM job.`)
    }
  }

  private update(job: NotebookJob, changes: Partial<NotebookJob>) {
    Object.assign(job, changes, { updatedAt: new Date().toISOString() })
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') job.completedAt ??= new Date().toISOString()
    this.persist()
  }

  private persist() { this.store.set('notebooklmJobs', this.jobs.slice(-200)) }
}
