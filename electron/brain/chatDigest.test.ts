import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from './service'
import { BrainJobRunner } from './jobRunner'
import { socialRecipeDefinitions } from './recipeDefinitions'
import type { BrainCapabilityEnvelope, BrainCapabilityResult } from './capabilityProtocol'

const RECIPE = 'whatsapp.unread_intelligence'
const STEPS = socialRecipeDefinitions.find(recipe => recipe.id === RECIPE)!.steps.length

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

/** A chat as `whatsapp.list_unread` now answers it: transcript included. */
const chat = (id: string, name: string, bodies: string[]) => ({
  id, name, isGroup: false, unread: bodies.length, t: 1789059750,
  last: { msgId: 'x', type: 'protocol', fromMe: false, sender: name, body: null, caption: null },
  messages: bodies.map((body, index) => ({ msgId: `m${index}`, type: 'chat', fromMe: false, sender: name, body })),
})

/**
 * Runs the whole recipe with a scripted capability layer, so both the
 * connector read and the model call are deterministic. `digests` maps a chat
 * id to the prose the model would have written.
 */
function run(chats: Array<Record<string, unknown>>, digests: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-digest-'))
  const service = new BrainService(join(root, 'brain.sqlite'))
  cleanups.push(() => { service.close(); rmSync(root, { recursive: true, force: true }) })
  const scope = service.database.ensureScope({ type: 'client', externalRef: 'c', name: 'Client' })
  service.database.grantConsent({ scopeId: scope.id, recipeId: RECIPE, provider: 'local-brain', fields: ['message_text'] })
  const version = socialRecipeDefinitions.find(recipe => recipe.id === RECIPE)!.version
  const job = service.database.enqueueJob({ recipeId: RECIPE, recipeVersion: version, scopeId: scope.id, parameters: {} })

  const asked: BrainCapabilityEnvelope['request'][] = []
  const execute = async ({ request }: BrainCapabilityEnvelope): Promise<BrainCapabilityResult> => {
    asked.push(request)
    if (request.capability === 'whatsapp.list_unread') return { id: request.id, ok: true, records: chats }
    if (request.capability === 'model.digest_chats') {
      return {
        id: request.id,
        ok: true,
        records: request.input.chats.map(entry => ({ chatId: entry.chatId, name: entry.name, prose: digests[entry.chatId] ?? '' })),
      }
    }
    return { id: request.id, ok: false, error: { code: 'permanent', message: 'unexpected' } }
  }

  const runner = new BrainJobRunner(service.database, service.artifacts, root, service.candidates, execute)
  cleanups.push(() => runner.stop())
  return {
    service, scope, job, asked, runner,
    drain: async () => { for (let step = 0; step < STEPS; step += 1) await runner.runOnce() },
  }
}

describe('the digest step', () => {
  it('queues one candidate per digested chat, for review rather than straight into the library', async () => {
    const context = run(
      [chat('92300@c.us', 'Yasir Bhai', ['Scope thora barha dein', 'Budget wahi rakhein'])],
      { '92300@c.us': 'Yasir bhai asked to widen the scope while holding the budget. Undecided.' },
    )
    await context.drain()

    const candidates = context.service.candidates.list(context.scope.id)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ origin: 'machine-inferred', status: 'pending', type: 'note' })
    expect(candidates[0].title).toContain('Yasir Bhai')
    expect(candidates[0].body).toContain('widen the scope')
    // Provenance is written by the step, not the model.
    expect(candidates[0].body).toContain('Source: WhatsApp chat `92300@c.us`')
    // Nothing reaches the library until a human accepts it.
    expect(context.service.documents.list({ scopeIds: [context.scope.id] })).toHaveLength(0)
  })

  it('becomes a searchable document once accepted', async () => {
    const context = run(
      [chat('92300@c.us', 'Yasir Bhai', ['Scope thora barha dein'])],
      { '92300@c.us': 'Yasir bhai asked to widen the zapzone scope.' },
    )
    await context.drain()
    const [candidate] = context.service.candidates.list(context.scope.id)
    context.service.candidates.decide({ id: candidate.id, decision: 'accept' })

    const hits = context.service.documents.search({ scopeIds: [context.scope.id], query: 'zapzone', limit: 10 })
    expect(hits.map(hit => hit.path)).toEqual([candidate.targetPath])
  })

  // The model is told to answer SKIP for a thread with nothing in it. An empty
  // answer must leave no trace rather than queue a note about "Ok".
  it('writes nothing for a chat the model declined to summarise', async () => {
    const context = run([chat('ali@c.us', 'Ali Haider', ['Ok'])], { 'ali@c.us': '' })
    await context.drain()

    expect(context.service.candidates.list(context.scope.id)).toEqual([])
    expect(context.service.database.getJob(context.job.id)?.status).toBe('completed')
  })

  // A scan that captured only chat-list rows — the state every capture was in
  // before transcripts existed — has nothing to send, so it must not spend a
  // model call at all.
  it('skips the model entirely when no chat has a transcript', async () => {
    const context = run([{ id: 'x@c.us', name: 'Quiet', unread: 1, last: { body: null, type: 'protocol' } }], {})
    await context.drain()

    expect(context.asked.map(request => request.capability)).toEqual(['whatsapp.list_unread'])
    expect(context.service.database.getJob(context.job.id)?.status).toBe('completed')
  })

  it('sends only chats that have something to read, longest first', async () => {
    const context = run([
      chat('short@c.us', 'Short', ['Ok']),
      { id: 'silent@c.us', name: 'Silent', unread: 1, last: { body: null, type: 'protocol' } },
      chat('long@c.us', 'Long', ['A much longer message about the project scope and the budget']),
    ], {})
    await context.drain()

    const digest = context.asked.find(request => request.capability === 'model.digest_chats')
    expect(digest && 'chats' in digest.input ? digest.input.chats.map(entry => entry.chatId) : [])
      .toEqual(['long@c.us', 'short@c.us'])
  })

  it('does not queue the same chat twice when the step runs again', async () => {
    const context = run(
      [chat('92300@c.us', 'Yasir Bhai', ['Scope thora barha dein'])],
      { '92300@c.us': 'Yasir bhai asked to widen the scope.' },
    )
    await context.drain()
    // Re-running the handler is what a retry before the checkpoint saved would do.
    const job = context.service.database.getJob(context.job.id)!
    const capability = context.asked.find(request => request.capability === 'model.digest_chats')!
    const repeated: BrainCapabilityResult = {
      id: capability.id, ok: true,
      records: [{ chatId: '92300@c.us', name: 'Yasir Bhai', prose: 'Yasir bhai asked to widen the scope.' }],
    }
    ;(context.runner as unknown as { handlers: { digest: (job: unknown, result: unknown, prior: unknown) => unknown } })
      .handlers.digest(job, repeated, undefined)

    expect(context.service.candidates.list(context.scope.id)).toHaveLength(1)
  })

  it('passes the scored artifact through so summarize still finds it', async () => {
    const context = run(
      [chat('92300@c.us', 'Yasir Bhai', ['We need a developer for the support backlog'])],
      { '92300@c.us': 'Yasir bhai raised a support backlog.' },
    )
    await context.drain()

    const stages = context.service.database.listCheckpoints(context.job.id)
      .map(row => JSON.parse(String(row.checkpoint_json)) as { stage: string })
    expect(stages.map(entry => entry.stage)).toEqual(['capture', 'normalize', 'classify', 'score', 'digest', 'summarize'])
    expect(context.service.database.getJob(context.job.id)).toMatchObject({ status: 'completed' })
    expect(context.service.database.listOpportunities({ scopeId: context.scope.id }).length).toBeGreaterThan(0)
  })

  // The guard that stops a recipe reaching a capability its consent never covered.
  it('refuses model.digest_chats for a recipe that has no digest step', async () => {
    const { executeBrainCapability } = await import('./capabilityProtocol')
    const result = await executeBrainCapability({
      type: 'capability:request', jobId: 'j', scopeId: 's', recipeId: 'linkedin.community_scan', accountId: null,
      request: { id: 'r', capability: 'model.digest_chats', input: { chats: [{ chatId: 'c', name: 'C', transcript: 'hi' }] } },
    }, { hasConsent: async () => true, read: async () => ({ ok: true, results: [] }) })

    expect(result).toMatchObject({ ok: false, error: { code: 'permanent' } })
  })
})
