import { BrainDatabase } from './database'
import { brainRequestSchema } from './protocol'
import { VaultManager } from './vault'
import { dirname, join, resolve, sep } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { BrainBackupManager } from './backup'
import { ArtifactStore } from './artifactStore'
import { socialRecipeDefinitions } from './recipeDefinitions'

export class BrainService {
  readonly database: BrainDatabase
  readonly vault: VaultManager
  readonly artifacts: ArtifactStore
  private readonly maintenanceTimer: ReturnType<typeof setInterval>

  constructor(databasePath: string) {
    this.database = new BrainDatabase(databasePath)
    this.vault = new VaultManager(this.database, join(dirname(databasePath), 'vault'))
    this.artifacts = new ArtifactStore(this.database, join(dirname(databasePath), 'artifacts'))
    this.vault.reconcileAll()
    this.vault.start()
    this.database.registerRecipe({ id: 'notebooklm.research', version: 1, title: 'NotebookLM Research', steps: ['capture', 'normalize', 'summarize'] })
    this.database.registerRecipe({ id: 'notebooklm.artifact', version: 1, title: 'NotebookLM Artifact', steps: ['generate', 'capture_manifest'] })
    for (const recipe of socialRecipeDefinitions) this.database.registerRecipe(recipe)
    this.database.recoverExpiredLeases()
    this.maintenanceTimer = setInterval(() => this.runMaintenance(), 24 * 60 * 60 * 1000)
    this.maintenanceTimer.unref()
  }

  private runMaintenance() {
    const brainRoot = dirname(this.vault.root)
    const artifactRoot = resolve(brainRoot, 'artifacts')
    for (const reference of this.database.purgeExpiredCaptures()) {
      if (!reference.startsWith('artifact://')) continue
      const url = new URL(reference)
      const target = resolve(artifactRoot, url.hostname, url.pathname.replace(/^\/+/, ''))
      if (target.startsWith(`${artifactRoot}${sep}`)) rmSync(target, { force: true })
    }
  }

  private assertProtocolMayMutateJob(jobId: string) {
    const job = this.database.getJob(jobId)
    if (job && socialRecipeDefinitions.some(recipe => recipe.id === job.recipeId)) {
      throw new Error('Social recipe lifecycle is runner-owned')
    }
  }

  handle(input: unknown): unknown {
    const request = brainRequestSchema.parse(input)
    switch (request.method) {
      case 'status': return this.database.getStatus()
      case 'overview': {
        const memories = this.database.listMemories(request.payload.scopeId)
        const candidates = this.database.listCandidates(request.payload.scopeId)
        const jobs = this.database.listJobs().filter(job => !request.payload.scopeId || job.scopeId === request.payload.scopeId)
        return {
          memories: memories.length,
          candidates: candidates.length,
          jobs: jobs.length,
          activeJobs: jobs.filter(job => !['completed', 'failed', 'cancelled'].includes(job.status)).length,
        }
      }
      case 'ensureScope': return this.database.ensureScope(request.payload)
      case 'listScopes': return this.database.listScopes(request.payload.types)
      case 'search': return this.database.search(request.payload)
      case 'remember': {
        const memory = this.database.remember(request.payload)
        this.vault.writeMemory(memory.id)
        return memory
      }
      case 'ingestMemory': return this.database.ingestMemory(request.payload)
      case 'getMemory': return this.database.getMemory(request.payload.id)
      case 'forget': return this.database.forget(request.payload.id)
      case 'listMemories': return this.database.listMemories(request.payload.scopeId)
      case 'listCandidates': return this.database.listCandidates(request.payload.scopeId)
      case 'decideCandidate': {
        const memory = this.database.decideCandidate(request.payload.id, request.payload.decision, request.payload.editedText)
        if (memory) this.vault.writeMemory(memory.id)
        return memory
      }
      case 'listJobs': return this.database.listJobs()
      case 'listOpportunities': return this.database.listOpportunities(request.payload)
      case 'getOpportunityEvidence': return this.database.getOpportunityEvidence(request.payload)
      case 'reviewOpportunity': return this.database.reviewOpportunity(request.payload)
      case 'getArtifactManifest': return this.database.getArtifactManifest(request.payload.jobId)
      case 'registerRecipe': return this.database.registerRecipe(request.payload)
      case 'enqueueJob': return this.database.enqueueJob(request.payload)
      case 'completeJob': {
        this.assertProtocolMayMutateJob(request.payload.id)
        return this.database.completeJob(request.payload.id, request.payload.result)
      }
      case 'controlJob': return request.payload.action === 'cancel' ? this.database.cancelJob(request.payload.id) : this.database.retryJob(request.payload.id)
      case 'failJob': {
        this.assertProtocolMayMutateJob(request.payload.id)
        return this.database.failJob(request.payload.id, request.payload.error)
      }
      case 'vaultStatus': return this.vault.getStatus()
      case 'vaultSync': return { files: this.vault.writeAll(), reconciled: this.vault.reconcileAll() }
      case 'listVaultConflicts': return this.database.listVaultConflicts(request.payload.scopeId)
      case 'resolveVaultConflict': {
        const memory = this.database.resolveVaultConflict(request.payload.id, request.payload.resolution, request.payload.scopeId)
        if (memory) this.vault.writeMemory(memory.id)
        return memory
      }
      case 'getConsent': return this.database.hasConsent(request.payload.scopeId, request.payload.recipeId, request.payload.provider)
      case 'grantConsent': return this.database.grantConsent(request.payload)
      case 'revokeConsent': return this.database.revokeConsent(request.payload.scopeId, request.payload.recipeId, request.payload.provider)
      case 'exportBackup': return BrainBackupManager.exportArchive(this.database, this.vault.root, request.payload.outputPath)
      case 'importBackup': {
        const brainRoot = dirname(this.vault.root)
        const backupDir = join(brainRoot, 'backups')
        mkdirSync(backupDir, { recursive: true })
        BrainBackupManager.exportArchive(this.database, this.vault.root, join(backupDir, `pre-import-${Date.now()}.flowdesk-brain.zip`))
        this.vault.stop()
        this.database.checkpoint()
        this.database.close()
        const restored = BrainBackupManager.restoreAtomic(request.payload.inputPath, brainRoot)
        setTimeout(() => process.exit(0), 50)
        return restored
      }
      case 'recordConversationTurn': return this.database.recordConversationTurn(request.payload)
      case 'listQueuedContinuations': return this.database.listQueuedContinuations()
      case 'consumeContinuation': return this.database.consumeContinuation(request.payload.id)
      case 'listEntities': return this.database.listEntities(request.payload.scopeId)
      case 'getGraph': return this.database.getGraph(request.payload.scopeId)
      case 'ingestCaptureBatch': {
        this.assertProtocolMayMutateJob(request.payload.jobId)
        return this.artifacts.ingestBatch({ ...request.payload, accountId: request.payload.accountId ?? null })
      }
      case 'shutdown': {
        this.close()
        return { closed: true }
      }
    }
  }

  close() {
    clearInterval(this.maintenanceTimer)
    this.vault.stop()
    this.database.checkpoint()
    this.database.close()
  }
}
