import { randomUUID } from 'node:crypto'
import type { BrainDatabase } from './database'
import type { ArtifactStore } from './artifactStore'
import { capabilityResultSchema, type BrainCapabilityExecutor, type BrainCapabilityResult } from './capabilityProtocol'
import { RecipeStepError, RecipeStepHandlers, socialRecipeDefinitions } from './recipeDefinitions'
import type { CandidateStore } from './knowledge/candidates'

const retries = [5_000, 30_000, 120_000]

export class BrainJobRunner {
  private stopped = false
  private active = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private readonly handlers: RecipeStepHandlers

  constructor(private readonly database: BrainDatabase, artifacts: ArtifactStore, brainRoot: string, candidates: CandidateStore, private readonly execute: BrainCapabilityExecutor) {
    this.handlers = new RecipeStepHandlers(artifacts, brainRoot, database, candidates)
  }

  start() {
    if (this.timer || this.active) return
    this.stopped = false
    const poll = async () => {
      if (this.stopped) return
      try { await this.runOnce() } catch { /* A database failure leaves the lease recoverable. Never log raw payloads. */ }
      if (!this.stopped) {
        this.timer = setTimeout(() => { this.timer = null; void poll() }, 250)
        this.timer.unref()
      }
    }
    void poll()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.timer = null
  }

  async runOnce(): Promise<boolean> {
    if (this.stopped || this.active) return false
    this.database.recoverExpiredLeases()
    const step = this.database.claimNextJob(undefined, undefined, socialRecipeDefinitions.map(recipe => ({ id: recipe.id, version: recipe.version })))
    if (!step) return false
    this.active = true
    const owns = () => !this.stopped && this.database.ownsJobStep(step.jobId, step.id, step.attempts)
    const heartbeat = setInterval(() => {
      if (owns()) this.database.heartbeatJob(step.jobId, step.id)
    }, 10_000)
    heartbeat.unref()
    this.heartbeat = heartbeat
    try {
      const job = this.database.getJob(step.jobId)!
      const definition = socialRecipeDefinitions.find(recipe => recipe.id === job.recipeId)!
      if (JSON.stringify(this.database.getJobStepNames(job.id)) !== JSON.stringify(definition.steps)) {
        if (owns()) this.database.failJob(job.id, 'incompatible_recipe_layout')
        return true
      }
      if (!this.database.hasConsent(job.scopeId, job.recipeId, 'local-brain')) throw new RecipeStepError('approval_required')
      const checkpoints = this.database.listCheckpoints(job.id)
      const saved = checkpoints.find(row => row.step_id === step.id)
      const prior = checkpoints.find(row => (JSON.parse(String(row.checkpoint_json)) as { stage?: unknown }).stage === definition.steps[step.stepIndex - 1])
      let checkpoint: Record<string, unknown>
      if (saved) checkpoint = JSON.parse(String(saved.checkpoint_json)) as Record<string, unknown>
      else {
        const priorCheckpoint = prior ? JSON.parse(String(prior.checkpoint_json)) as Record<string, unknown> : undefined
        // Two steps reach outside this process: `capture` for the connector
        // and `digest` for the model. Both re-check consent after the call —
        // it can be revoked while a capability is in flight.
        const request = this.handlers.capabilityRequestFor(job, step.name, randomUUID())
        let result: BrainCapabilityResult | null = null
        if (request) {
          result = capabilityResultSchema.parse(await this.execute({
            type: 'capability:request', jobId: job.id, scopeId: job.scopeId, recipeId: job.recipeId, accountId: job.accountId,
            request,
          }).catch(() => { throw new RecipeStepError('transient') }))
          if (!owns()) return true
          if (!this.database.hasConsent(job.scopeId, job.recipeId, 'local-brain')) throw new RecipeStepError('approval_required')
        }
        if (step.name === 'capture') {
          // A capture with no request to make is a programming error, not a
          // quiet scan: the connector read is what the whole job is for.
          if (!result) throw new RecipeStepError('permanent')
          checkpoint = this.handlers.capture(job, step.id, result)
        } else if (step.name === 'digest') checkpoint = this.handlers.digest(job, result, priorCheckpoint)
        else checkpoint = this.handlers.execute(job, step.name, priorCheckpoint)
      }
      if (!owns()) return true
      if (step.name === 'summarize') {
        // If interrupted between these writes the running lease is reclaimed, and
        // the saved summary is committed without repeating connector execution.
        this.database.saveCheckpoint(job.id, step.id, checkpoint)
        this.database.completeJob(job.id, checkpoint)
      } else this.database.completeJobStep(job.id, step.id, checkpoint)
    } catch (error) {
      if (!owns()) return true
      const code = error instanceof RecipeStepError ? error.code : 'permanent'
      if (code === 'login_required' || code === 'approval_required') {
        this.database.deferJobStep(step.jobId, step.id, step.attempts, code === 'login_required' ? 'waiting_for_login' : 'waiting_for_approval', null, code)
      } else if (code === 'transient' && step.attempts <= retries.length) {
        this.database.deferJobStep(step.jobId, step.id, step.attempts, 'retry_scheduled', new Date(Date.now() + retries[step.attempts - 1]).toISOString(), code)
      } else this.database.failJob(step.jobId, code)
    } finally {
      clearInterval(heartbeat)
      this.heartbeat = null
      this.active = false
    }
    return true
  }
}
