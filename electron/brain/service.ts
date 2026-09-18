import { createHash } from 'node:crypto'
import { BrainDatabase } from './database'
import { brainRequestSchema } from './protocol'
import { VaultManager } from './vault'
import { dirname, join, resolve, sep } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { BrainBackupManager } from './backup'
import { ArtifactStore } from './artifactStore'
import { socialRecipeDefinitions } from './recipeDefinitions'
import { buildDecisionBrief } from './decisionBrief'
import { MonitorScheduler, createMonitorSchedulerPort } from './scheduler'
import { CandidateStore } from './knowledge/candidates'
import { Compactor } from './knowledge/compactor'
import { DocumentStore } from './knowledge/documents'
import { ManifestBuilder } from './knowledge/manifest'
import { dailyNotePath, localDayBounds, localDayOf, renderDailyNote } from './knowledge/dailyNote'
import { EMBEDDING_MODEL, embeddingsFailed } from './knowledge/embeddings'
import { EntityStore } from './knowledge/entities'
import { EvidenceRetriever } from './knowledge/evidence'
import { migrateMemories } from './knowledge/memoriesMigration'
import { VaultImporter } from './knowledge/vaultImporter'

/**
 * Most documents a change produces at once before the automatic index refresh
 * gives up and leaves it to the Health tab's button. Sized so the automatic
 * path stays around a second at ~100ms per document.
 */
export const AUTO_VECTOR_LIMIT = 50

export class BrainService {
  readonly database: BrainDatabase
  readonly vault: VaultManager
  readonly artifacts: ArtifactStore
  /**
   * Brain v2 knowledge layer. Each module owns its own SQL against the shared
   * handle, so the four work packages in docs/brain-v2/ can be built in
   * parallel without any of them editing this file or database.ts.
   */
  readonly documents: DocumentStore
  readonly evidence: EvidenceRetriever
  readonly manifest: ManifestBuilder
  readonly vaultImporter: VaultImporter
  readonly candidates: CandidateStore
  readonly entities: EntityStore
  readonly compactor: Compactor
  private readonly maintenanceTimer: ReturnType<typeof setInterval>
  private readonly compactionTimer: ReturnType<typeof setInterval>
  private readonly monitors: MonitorScheduler

  constructor(databasePath: string) {
    this.database = new BrainDatabase(databasePath)
    this.vault = new VaultManager(this.database, join(dirname(databasePath), 'vault'))
    this.artifacts = new ArtifactStore(this.database, join(dirname(databasePath), 'artifacts'))
    this.documents = new DocumentStore(this.database.handle)
    this.evidence = new EvidenceRetriever(this.database.handle, this.documents)
    this.manifest = new ManifestBuilder(this.documents)
    this.vaultImporter = new VaultImporter(this.documents)
    this.candidates = new CandidateStore(this.database.handle, this.documents)
    this.entities = new EntityStore(this.database.handle)
    this.compactor = new Compactor(this.documents)
    // Part 1: memories are folded into knowledge_documents (see
    // knowledge/memoriesMigration.ts) rather than staying a second store this
    // vault keeps in sync with. Nothing new writes to `memories` any more, so
    // there is nothing left for this to reconcile or watch -- running it
    // unconditionally was also a real hazard: a user pointing
    // brain:chooseVaultFolder at this same directory (guarded against in
    // main.ts, but nothing stopped it before) would have re-imported the
    // entire memory ledger as knowledge_documents, or the watcher would have
    // fired on every edit under it once the folder became selectable. The
    // instance and its files stay (`vaultStatus`/`vaultSync`/backup export
    // still read `this.vault.root`); it simply never runs on its own.
    this.database.registerRecipe({ id: 'notebooklm.research', version: 1, title: 'NotebookLM Research', steps: ['capture', 'normalize', 'summarize'] })
    this.database.registerRecipe({ id: 'notebooklm.artifact', version: 1, title: 'NotebookLM Artifact', steps: ['generate', 'capture_manifest'] })
    for (const recipe of socialRecipeDefinitions) this.database.registerRecipe(recipe)
    this.database.recoverExpiredLeases()
    // Monitors are recipes registered above, so the scheduler starts only after
    // registration. It lives and dies with this utility process: no OS task.
    this.monitors = new MonitorScheduler(createMonitorSchedulerPort(this.database))
    this.monitors.start()
    this.maintenanceTimer = setInterval(() => this.runMaintenance(), 24 * 60 * 60 * 1000)
    this.maintenanceTimer.unref()
    // Same shape as maintenanceTimer: a synchronous, transactional DB sweep
    // with nothing to retry across a restart, not multi-step job/monitor work.
    this.compactionTimer = setInterval(() => this.runCompaction(), 24 * 60 * 60 * 1000)
    this.compactionTimer.unref()
  }

  /** Folds orphan captures/*.md notes into the real documents they're about,
   *  scope by scope. Public for the same reason runMaintenance() is. */
  runCompaction() {
    for (const scope of this.database.listScopes()) this.compactor.compact(scope.id)
  }

  /**
   * The ancestor chain for a knowledge read, nearest scope first. A document
   * imported at the global scope must still be visible from a project scope
   * — `DocumentStorePort` has no notion of scope topology of its own (by
   * design, so the knowledge modules stay decoupled from `BrainDatabase`),
   * so this is the one place that expands a caller's single scope id into
   * the chain the store's `scopeIds` parameters expect.
   */
  private knowledgeScopeChain(scopeId: string): string[] {
    return this.database.scopePath(scopeId).map(scope => scope.id)
  }

  /**
   * Keeps the embedding index current after documents change, without ever
   * turning it on by itself.
   *
   * Two guards, both load-bearing. It runs only when vectors already exist --
   * meaning the user opted in and accepted the model download -- so a
   * lexical-only install never silently pulls 118MB. And it runs only when the
   * backlog is small, because `buildVectors` is incremental: a handful of new
   * documents is about a second, while re-pointing at a different vault could
   * be a minute, and a minute hidden inside an import call is a hang as far as
   * the user is concerned. Past the cap the Health tab's button stays the way
   * to catch up, and its "X / Y indexed" line is what makes the gap visible.
   */
  private async refreshVectorsIfEnabled(scopeId: string): Promise<void> {
    try {
      const scopeIds = this.knowledgeScopeChain(scopeId)
      const { documents, vectors } = this.documents.vectorCoverage(scopeIds)
      if (vectors === 0) return
      const missing = documents - vectors
      if (missing <= 0 || missing > AUTO_VECTOR_LIMIT) return
      await this.documents.buildVectors(scopeIds)
    } catch (error) {
      // Never fail the write that triggered this. A missing vector degrades
      // retrieval to lexical; a thrown error would lose the import itself.
      console.log(`[FlowDesk brain] vector refresh skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Renders one day's timeline into a Library document and returns it.
   *
   * Reads events through the scope chain but writes to the exact scope asked
   * for, the same split every other knowledge write uses. Idempotent twice
   * over: the renderer is deterministic, so an unchanged day produces the same
   * content hash and `upsert` no-ops.
   *
   * A day with no activity is not written at all -- an empty note is a document
   * that has to be read to learn it says nothing.
   */
  private materialiseDailyNote(scopeId: string, date?: string) {
    const day = date ?? localDayOf(new Date().toISOString())
    const { from, to } = localDayBounds(day)
    const events = this.database.listEvents({ scopeIds: this.knowledgeScopeChain(scopeId), from, to })
    const note = renderDailyNote(day, events)
    if (note.isEmpty) return { date: day, path: dailyNotePath(day), written: false, eventCount: 0, body: note.body }

    this.documents.upsert({
      scopeId,
      path: note.path,
      type: 'note',
      title: note.title,
      summary: note.summary,
      body: note.body,
      origin: 'curated',
      contentHash: createHash('sha256').update(note.body).digest('hex'),
      updatedAt: new Date().toISOString(),
      // Derived from events, not authored -- deriving links from the body would
      // re-resolve the wiki links the renderer just wrote, which is exactly what
      // we want, so leave `links` undefined rather than passing [].
    })
    return { date: day, path: note.path, written: true, eventCount: events.length, body: note.body }
  }

  /**
   * Retention sweep: expired raw captures leave the ledger and their artifact
   * files leave the disk. Public so the release-gate acceptance test can run it
   * at a chosen clock instead of waiting out the 24-hour interval timer; the
   * scheduled caller is still the constructor's own timer.
   */
  runMaintenance() {
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
      case 'countOpportunities': return this.database.countOpportunities(request.payload)
      case 'getOpportunityEvidence': return this.database.getOpportunityEvidence(request.payload)
      case 'reviewOpportunity': return this.database.reviewOpportunity(request.payload)
      case 'buildDecisionBrief': return buildDecisionBrief({
        question: request.payload.question,
        tokenBudget: request.payload.tokenBudget,
        opportunities: this.database.listOpportunities({ scopeId: request.payload.scopeId, limit: 100 }).map(opportunity => ({
          opportunity,
          evidence: this.database.getOpportunityEvidence({ id: opportunity.id, scopeId: request.payload.scopeId }),
        })),
      })
      case 'listSourceMetrics': return this.database.listSourceMetrics(request.payload)
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
        // Validated first, with this utility's own database still open and
        // serving: every rejection an archive can earn (unsafe entry, missing
        // or incompatible manifest, a database that fails its health probe)
        // happens here. Closing first and validating afterwards left a rejected
        // import with a live process holding a closed database — no restart,
        // and every later Brain call failing with nothing to explain it.
        const staged = BrainBackupManager.stageArchive(request.payload.inputPath, brainRoot)
        try {
          const backupDir = join(brainRoot, 'backups')
          mkdirSync(backupDir, { recursive: true })
          BrainBackupManager.exportArchive(this.database, this.vault.root, join(backupDir, `pre-import-${Date.now()}.flowdesk-brain.zip`))
          this.vault.stop()
          this.database.checkpoint()
          this.database.close()
          const restored = { manifest: staged.manifest, ...BrainBackupManager.commitStaged(staged.staging, brainRoot) }
          // The database is closed and replaced, so this process cannot serve
          // anything more; the supervisor restarts it onto the restored file.
          setTimeout(() => process.exit(0), 50)
          return restored
        } finally {
          rmSync(staged.staging, { recursive: true, force: true })
        }
      }
      case 'recordConversationTurn': return this.database.recordConversationTurn(request.payload)
      case 'createMonitor': return this.database.createMonitor(request.payload)
      case 'listMonitors': return this.database.listMonitors(request.payload.scopeId)
      case 'setMonitorStatus': return this.database.setMonitorStatus(request.payload.id, request.payload.scopeId, request.payload.status)
      case 'deleteMonitor': return this.database.deleteMonitor(request.payload.id, request.payload.scopeId)
      case 'listQueuedContinuations': return this.database.listQueuedContinuations()
      case 'consumeContinuation': return this.database.consumeContinuation(request.payload.id)
      case 'listEntities': return this.database.listEntities(request.payload.scopeId)
      case 'getGraph': return this.database.getGraph(request.payload.scopeId)
      case 'ingestCaptureBatch': {
        this.assertProtocolMayMutateJob(request.payload.jobId)
        return this.artifacts.ingestBatch({ ...request.payload, accountId: request.payload.accountId ?? null })
      }
      case 'knowledge.manifest': return this.manifest.build({ ...request.payload, scopeIds: this.knowledgeScopeChain(request.payload.scopeId) })
      case 'knowledge.read': {
        const stored = this.documents.read(this.knowledgeScopeChain(request.payload.scopeId), request.payload.path)
        if (!stored) return null
        const characterLimit = (request.payload.tokenBudget ?? 4000) * 4
        const truncated = stored.body.length > characterLimit
        const text = truncated ? stored.body.slice(0, characterLimit) : stored.body
        return {
          path: stored.document.path,
          title: stored.document.title,
          type: stored.document.type,
          text,
          updatedAt: stored.document.updatedAt,
          estimatedTokens: Math.ceil(text.length / 4),
          truncated,
        }
      }
      case 'knowledge.search': return this.documents.search({ ...request.payload, scopeIds: this.knowledgeScopeChain(request.payload.scopeId) })
      case 'knowledge.answerPack':
        return this.evidence.answerPack({
          scopeIds: this.knowledgeScopeChain(request.payload.scopeId),
          question: request.payload.question,
          tokenBudget: request.payload.tokenBudget,
          maxSections: request.payload.maxSections,
        })
      case 'knowledge.buildVectors':
        // Writes to the exact scope, reads through the chain -- an ancestor's
        // documents are the ones a project scope will be searching.
        return this.documents.buildVectors(this.knowledgeScopeChain(request.payload.scopeId))
      case 'knowledge.vectorStatus':
        return {
          ...this.documents.vectorCoverage(this.knowledgeScopeChain(request.payload.scopeId)),
          model: EMBEDDING_MODEL,
          failed: embeddingsFailed(),
        }
      case 'knowledge.graph':
        return this.documents.graph(this.knowledgeScopeChain(request.payload.scopeId))
      case 'knowledge.neighbors':
        return this.documents.neighbors(
          this.knowledgeScopeChain(request.payload.scopeId),
          request.payload.path,
          request.payload.depth ?? 1,
        )
      case 'entity.list':
        return this.entities.list(this.knowledgeScopeChain(request.payload.scopeId), request.payload.type)
      case 'entity.get':
        return this.entities.get(this.knowledgeScopeChain(request.payload.scopeId), request.payload.entityId)
      case 'entity.mentions': {
        // Reading through the chain, like every other knowledge read: an
        // ancestor's entity is one this scope is entitled to see.
        const scopeIds = this.knowledgeScopeChain(request.payload.scopeId)
        return this.entities.get(scopeIds, request.payload.entityId) === null
          ? []
          : this.entities.mentionsOf(request.payload.entityId, request.payload.targetKind)
      }
      case 'entity.backfill':
        return this.entities.backfillFromDocuments(this.knowledgeScopeChain(request.payload.scopeId))
      case 'entity.listProposals':
        return this.entities.listProposals(this.knowledgeScopeChain(request.payload.scopeId))
      case 'entity.decideProposal':
        return this.entities.decideProposal(request.payload.id, request.payload.decision)
      case 'knowledge.dailyNote':
        return this.materialiseDailyNote(request.payload.scopeId, request.payload.date)
      case 'recordEvent':
        this.database.recordEvent(request.payload)
        return true
      case 'listEvents':
        return this.database.listEvents({
          scopeIds: this.knowledgeScopeChain(request.payload.scopeId),
          from: request.payload.from,
          to: request.payload.to,
          limit: request.payload.limit,
        })
      case 'knowledge.list': return this.documents.list({ ...request.payload, scopeIds: this.knowledgeScopeChain(request.payload.scopeId) })
      case 'knowledge.importVault': {
        const report = this.vaultImporter.import(request.payload)
        this.database.recordEvent({
          scopeId: request.payload.scopeId,
          action: 'knowledge.imported',
          metadata: { imported: report.imported, skipped: report.skipped, failures: report.failures.length },
        })
        return this.refreshVectorsIfEnabled(request.payload.scopeId).then(() => report)
      }
      case 'knowledge.proposeCandidate': return this.candidates.propose(request.payload)
      case 'knowledge.listCandidates': return this.candidates.list(request.payload.scopeId)
      case 'knowledge.decideCandidate': {
        const decided = this.candidates.decide(request.payload)
        if (request.payload.decision === 'accept' && decided?.document) {
          this.database.recordEvent({
            scopeId: decided.document.scopeId,
            action: 'knowledge.accepted',
            targetId: decided.document.id,
            metadata: { path: decided.document.path, title: decided.document.title, type: decided.document.type },
          })
        }
        // The payload carries no scope -- a candidate is addressed by id -- so
        // the scope comes from the document that was actually written. A reject
        // writes nothing, so there is nothing to index.
        const writtenScope = decided?.document?.scopeId
        return writtenScope === undefined
          ? decided
          : this.refreshVectorsIfEnabled(writtenScope).then(() => decided)
      }
      case 'knowledge.compact': {
        const report = this.compactor.compact(request.payload.scopeId)
        if (report.merged > 0) {
          this.database.recordEvent({
            scopeId: request.payload.scopeId,
            action: 'knowledge.compacted',
            metadata: { merged: report.merged, scanned: report.scanned },
          })
        }
        return this.refreshVectorsIfEnabled(request.payload.scopeId).then(() => report)
      }
      case 'knowledge.migrateMemories':
        return migrateMemories(this.documents, { memories: this.database.listMemories(), dryRun: request.payload.dryRun })
      case 'knowledge.listUnresolvedLinks': return this.documents.listUnresolvedLinks(this.knowledgeScopeChain(request.payload.scopeId))
      case 'shutdown': {
        this.close()
        return { closed: true }
      }
    }
  }

  close() {
    clearInterval(this.maintenanceTimer)
    clearInterval(this.compactionTimer)
    this.monitors.stop()
    this.vault.stop()
    this.database.checkpoint()
    this.database.close()
  }
}
