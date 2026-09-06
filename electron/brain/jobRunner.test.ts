import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainService } from './service'
import { BrainJobRunner } from './jobRunner'
import type { BrainCapabilityEnvelope, BrainCapabilityResult } from './capabilityProtocol'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers() })

function setup(execute: (request: BrainCapabilityEnvelope) => Promise<BrainCapabilityResult>, recipeId = 'linkedin.opportunity_scan') {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-runner-'))
  const service = new BrainService(join(root, 'brain.sqlite'))
  cleanups.push(() => { service.close(); rmSync(root, { recursive: true, force: true }) })
  const scope = service.database.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
  service.database.grantConsent({ scopeId: scope.id, recipeId, provider: 'local-brain', fields: ['post_text'] })
  const job = service.database.enqueueJob({ recipeId, recipeVersion: 1, scopeId: scope.id, parameters: {} })
  const runner = new BrainJobRunner(service.database, service.artifacts, root, execute)
  cleanups.push(() => runner.stop())
  return { root, service, db: service.database, job, runner }
}

const success = async ({ request }: BrainCapabilityEnvelope): Promise<BrainCapabilityResult> => ({ id: request.id, ok: true, records: [
  { id: 'lead', text: 'Hiring a developer for an urgent project', url: 'https://example.test/post' },
  { id: 'noise', text: 'Good morning' },
] })

describe('BrainJobRunner', () => {
  it.each(['linkedin.opportunity_scan', 'whatsapp.unread_intelligence', 'linkedin.community_scan'])('executes %s with compact checkpoints and metadata-only completion', async recipeId => {
    const { runner, db, job } = setup(success, recipeId)
    for (let i = 0; i < 5; i++) expect(await runner.runOnce()).toBe(true)
    expect(db.getJob(job.id)).toMatchObject({ status: 'completed', result: { recordCount: 2, actionableCount: 1, actionable: true } })
    const checkpoints = db.listCheckpoints(job.id)
    expect(checkpoints.map(row => JSON.parse(String(row.checkpoint_json)).stage)).toEqual(['capture', 'normalize', 'classify', 'score', 'summarize'])
    expect(JSON.stringify(checkpoints)).not.toContain('Hiring a developer')
    expect(JSON.stringify(db.getJob(job.id))).not.toContain('Hiring a developer')
    expect(await runner.runOnce()).toBe(false)
  })

  it('renews the claimed step lease every ten seconds', async () => {
    vi.useFakeTimers()
    let finish!: (value: BrainCapabilityResult) => void
    const { runner, db, job } = setup(() => new Promise(resolve => { finish = resolve }))
    const pending = runner.runOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(db.getJob(job.id)?.updatedAt).toBe(new Date().toISOString())
    await vi.advanceTimersByTimeAsync(30_000)
    expect(db.recoverExpiredLeases()).toBe(0)
    finish({ id: 'ignored', ok: true, records: [] })
    await pending
  })

  it('resumes an expired lease from its saved checkpoint without repeating capture', async () => {
    vi.useFakeTimers()
    let reads = 0
    const { runner, db, job, root, service } = setup(async request => { reads++; return success(request) })
    await runner.runOnce()
    const claimed = db.claimNextJob()!
    const checkpoint = { stage: 'normalize', count: 2, dataRef: String(JSON.parse(String(db.listCheckpoints(job.id)[0].checkpoint_json)).dataRef) }
    expect(db.saveCheckpoint(job.id, claimed.id, checkpoint)).toBe(db.saveCheckpoint(job.id, claimed.id, checkpoint))
    await vi.advanceTimersByTimeAsync(31_000)
    const restarted = new BrainJobRunner(db, service.artifacts, root, async request => { reads++; return success(request) })
    cleanups.push(() => restarted.stop())
    expect(await restarted.runOnce()).toBe(true)
    expect(reads).toBe(1)
    expect(db.listCheckpoints(job.id)).toHaveLength(2)
  })

  it('persists retries at five seconds thirty seconds and two minutes then fails', async () => {
    vi.useFakeTimers()
    const { runner, db, job, service, root } = setup(async ({ request }) => ({ id: request.id, ok: false, error: { code: 'transient', message: 'Retry' } }))
    await runner.runOnce()
    expect(db.getJob(job.id)?.status).toBe('retry_scheduled')
    const restarted = new BrainJobRunner(db, service.artifacts, root, async ({ request }) => ({ id: request.id, ok: false, error: { code: 'transient', message: 'Retry' } }))
    cleanups.push(() => restarted.stop())
    for (const delay of [5_000, 30_000, 120_000]) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(await restarted.runOnce()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await restarted.runOnce()).toBe(true)
    }
    expect(db.getJob(job.id)?.status).toBe('failed')
  })

  it.each([['login_required', 'waiting_for_login'], ['approval_required', 'waiting_for_approval']] as const)('parks %s until an explicit retry', async (code, state) => {
    let ready = false
    const { runner, db, job } = setup(async request => ready ? success(request) : { id: request.request.id, ok: false, error: { code, message: 'Required' } })
    await runner.runOnce()
    expect(db.getJob(job.id)?.status).toBe(state)
    expect(await runner.runOnce()).toBe(false)
    ready = true
    expect(db.retryJob(job.id)).toBe(true)
    await runner.runOnce()
    expect(db.getJob(job.id)?.status).toBe('queued')
  })

  it('requires scope recipe provider consent even for jobs enqueued directly', async () => {
    let reads = 0
    const { runner, db, job } = setup(async request => { reads++; return success(request) })
    db.revokeConsent(job.scopeId, job.recipeId, 'local-brain')
    await runner.runOnce()
    expect(db.getJob(job.id)?.status).toBe('waiting_for_approval')
    expect(reads).toBe(0)
  })

  it('does not commit a late capture or execute the next step after cancellation', async () => {
    let finish!: (value: BrainCapabilityResult) => void
    const { runner, db, job } = setup(() => new Promise(resolve => { finish = resolve }))
    const pending = runner.runOnce()
    db.cancelJob(job.id)
    finish({ id: 'ignored', ok: true, records: [{ text: 'private' }] })
    await pending
    expect(db.getJob(job.id)?.status).toBe('cancelled')
    expect(db.listCheckpoints(job.id)).toEqual([])
    expect(db.getArtifactManifest(job.id)).toBeNull()
    expect(await runner.runOnce()).toBe(false)
  })

  it('fences stale completions after cancellation and retry', async () => {
    let finish!: (value: BrainCapabilityResult) => void
    const { runner, db, job, root, service } = setup(() => new Promise(resolve => { finish = resolve }))
    const pending = runner.runOnce()
    db.cancelJob(job.id)
    db.retryJob(job.id)
    let finishCurrent!: (value: BrainCapabilityResult) => void
    const current = new BrainJobRunner(db, service.artifacts, root, () => new Promise(resolve => { finishCurrent = resolve }))
    cleanups.push(() => current.stop())
    const currentPending = current.runOnce()
    finish({ id: 'ignored', ok: true, records: [] })
    await pending
    expect(db.listCheckpoints(job.id)).toHaveLength(0)
    finishCurrent({ id: 'current', ok: true, records: [{ text: 'one' }, { text: 'two' }] })
    await currentPending
    expect(db.listCheckpoints(job.id)).toHaveLength(1)
    expect(JSON.parse(String(db.listCheckpoints(job.id)[0].checkpoint_json)).count).toBe(2)
  })

  it('does not claim recipes owned by other executors', async () => {
    const { runner, db, job } = setup(success)
    db.cancelJob(job.id)
    const external = db.enqueueJob({ scopeId: job.scopeId, recipeId: 'notebooklm.research', recipeVersion: 1, parameters: {} })
    expect(await runner.runOnce()).toBe(false)
    expect(db.getJob(external.id)?.status).toBe('queued')
  })

  it('starts polling queued work and stops scheduling after shutdown', async () => {
    vi.useFakeTimers()
    const { runner, db, job } = setup(success)
    runner.start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(db.getJob(job.id)?.status).toBe('completed')
    runner.stop()
    const next = db.enqueueJob({ scopeId: job.scopeId, recipeId: job.recipeId, recipeVersion: 1, parameters: { query: 'other' } })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(db.getJob(next.id)?.status).toBe('queued')
  })

  it('retries a thrown connector transport error without storing its text', async () => {
    const { runner, db, job } = setup(async () => { throw new Error('private transport payload') })
    await runner.runOnce()
    expect(db.getJob(job.id)?.status).toBe('retry_scheduled')
    expect(JSON.stringify(db.getJob(job.id))).not.toContain('private transport payload')
  })

  it('clears heartbeat timers immediately on shutdown during capture', async () => {
    vi.useFakeTimers()
    let finish!: (value: BrainCapabilityResult) => void
    const { runner, db, job } = setup(() => new Promise(resolve => { finish = resolve }))
    const before = vi.getTimerCount()
    const pending = runner.runOnce()
    runner.stop()
    expect(vi.getTimerCount()).toBe(before)
    finish({ id: 'stopped', ok: true, records: [] })
    await pending
    expect(db.listCheckpoints(job.id)).toEqual([])
  })

  it('rejects unfinished legacy layouts instead of skipping classify or score', async () => {
    const { runner, db, job } = setup(success)
    db.cancelJob(job.id)
    db.registerRecipe({ id: job.recipeId, version: 1, title: 'Legacy', steps: ['capture', 'normalize', 'score', 'summarize'] })
    const legacy = db.enqueueJob({ scopeId: job.scopeId, recipeId: job.recipeId, recipeVersion: 1, parameters: { query: 'legacy' } })
    await runner.runOnce()
    expect(db.getJob(legacy.id)).toMatchObject({ status: 'failed', result: { error: 'incompatible_recipe_layout' } })
    expect(db.listCheckpoints(legacy.id)).toEqual([])
  })

  it('normalizes real WhatsApp last-message previews and scores their evidence', async () => {
    const { runner, db, job } = setup(async ({ request }) => ({ id: request.id, ok: true, records: [
      { id: 'chat', name: 'Client', unread: 2, last: { body: ' Hiring   a developer ', type: 'chat' } },
    ] }), 'whatsapp.unread_intelligence')
    for (let i = 0; i < 5; i++) await runner.runOnce()
    const normalize = JSON.parse(String(db.listCheckpoints(job.id)[1].checkpoint_json))
    expect(JSON.parse(gunzipSync(readFileSync(normalize.dataRef)).toString())).toEqual([
      { id: 'chat', text: 'Hiring a developer', sourceRef: `artifact://${job.id}/derived/normalize.json.gz#0` },
    ])
    expect(db.getJob(job.id)?.result).toMatchObject({ actionableCount: 1 })
  })

  it('fails permanent connector errors without scheduling another attempt', async () => {
    const { runner, db, job } = setup(async ({ request }) => ({ id: request.id, ok: false, error: { code: 'permanent', message: 'Unsupported' } }))
    await runner.runOnce()
    expect(db.getJob(job.id)?.status).toBe('failed')
    expect(await runner.runOnce()).toBe(false)
  })

  it('resumes persisted capture after closing and reopening the utility database', async () => {
    vi.useFakeTimers()
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-runner-restart-'))
    const path = join(root, 'brain.sqlite')
    let service = new BrainService(path)
    cleanups.push(() => { service.close(); rmSync(root, { recursive: true, force: true }) })
    const scope = service.database.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
    const recipeId = 'linkedin.opportunity_scan'
    service.database.grantConsent({ scopeId: scope.id, recipeId, provider: 'local-brain', fields: ['post_text'] })
    const job = service.database.enqueueJob({ scopeId: scope.id, recipeId, recipeVersion: 1, parameters: {} })
    const first = new BrainJobRunner(service.database, service.artifacts, root, success)
    await first.runOnce()
    service.database.claimNextJob()
    first.stop()
    service.close()
    await vi.advanceTimersByTimeAsync(31_000)
    service = new BrainService(path)
    let reads = 0
    const second = new BrainJobRunner(service.database, service.artifacts, root, async request => { reads++; return success(request) })
    cleanups.push(() => second.stop())
    for (let i = 0; i < 4; i++) await second.runOnce()
    expect(service.database.getJob(job.id)?.status).toBe('completed')
    expect(reads).toBe(0)
    expect(service.database.listCheckpoints(job.id)).toHaveLength(5)
  })
})
