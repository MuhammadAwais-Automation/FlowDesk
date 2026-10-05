import { describe, expect, it } from 'vitest'
import {
  assertSafeId, candidateAccounts, checkDeadline, classifyRefusal, createSerial, exhaustedUntil, findAccount, isModelSlug, isSafeId,
  isUsable, jobsToPrune, maskEmail, mergeQuotas, pickAccount, readFailureFatal, readTurn, runWithDeadline, summarizeJobs,
  TimeoutError, withTimeout, type AccountQuota, type ConvNode, type Deadline,
} from './chatgptImageCore'

const node = (o: Partial<ConvNode> & { id: string }): ConvNode => ({
  parent: null, role: 'assistant', name: null, recipient: 'all', ctype: 'text', status: 'finished_successfully',
  endTurn: null, text: '', images: [], ...o,
})

// Shape of a real image turn (probes/out/cg-11-conv-shape.json): user → tool-call → tool image.
const earlier = [
  node({ id: 'u0', role: 'user', text: 'a red fox' }),
  node({ id: 't0', parent: 'u0', role: 'tool', name: 't2uay3k.sj1i4kz', images: [{ fileId: 'file_old', generated: true }] }),
]

describe('readTurn', () => {
  it('returns only the images below the matching user message', () => {
    const nodes = [
      ...earlier,
      node({ id: 'u1', parent: 't0', role: 'user', text: 'make the fox blue' }),
      node({ id: 'c1', parent: 'u1', recipient: 't2uay3k.sj1i4kz', ctype: 'code', endTurn: false }),
      node({ id: 't1', parent: 'c1', role: 'tool', name: 't2uay3k.sj1i4kz', images: [{ fileId: 'file_new', width: 941, height: 1672, generated: true }], title: 'Blue fox' }),
    ]
    expect(readTurn(nodes, 'make the fox blue')).toEqual({ state: 'pending', images: [{ fileId: 'file_new', width: 941, height: 1672, title: 'Blue fox' }] })
  })

  it('is done at the end_turn assistant message, with its text', () => {
    const nodes = [
      node({ id: 'u1', role: 'user', text: 'a cat' }),
      node({ id: 'a1', parent: 'u1', endTurn: true, text: 'We’re so sorry, but the prompt may violate our content policies.' }),
    ]
    const r = readTurn(nodes, 'a cat')
    expect(r.state).toBe('done')
    expect(r.images).toEqual([])
  })

  it('ignores an uploaded image on the user message itself', () => {
    const nodes = [
      node({ id: 'u1', role: 'user', text: 'edit this', images: [{ fileId: 'file_upload', generated: false }] }),
      node({ id: 't1', parent: 'u1', role: 'tool', images: [{ fileId: 'file_up_echo', generated: false }] }),
    ]
    expect(readTurn(nodes, 'edit this').images).toEqual([])
  })

  it('stays pending until the user message is saved', () => {
    expect(readTurn(earlier, 'something new')).toEqual({ state: 'pending', images: [] })
  })
})

describe('classifyRefusal', () => {
  it('treats a limit message as quota', () => {
    expect(classifyRefusal("You've hit the free plan limit for image generations. You can create more images when the limit resets in 23 hours.")).toBe('quota')
    expect(classifyRefusal('You have reached your image generation limit.')).toBe('quota')
  })
  it('treats a policy refusal or a question as a plain refusal', () => {
    expect(classifyRefusal('We’re so sorry, but the prompt may violate our content policies.')).toBe('refused')
    expect(classifyRefusal('Would you like it in portrait or landscape?')).toBe('refused')
  })

  it('treats a can-not-draw-right-now answer as unavailable (live replies, free account with quota left)', () => {
    expect(classifyRefusal("I wasn't able to generate the image due to an error on my side.")).toBe('unavailable')
    expect(classifyRefusal('It looks like image creation is temporarily unavailable. Do you want to try something else?')).toBe('unavailable')
    expect(classifyRefusal('Here is a description of a boat instead.')).toBe('refused')
  })
})

describe('pickAccount', () => {
  const accs = [{ email: 'a@x.com', partition: 'pa' }, { email: 'b@x.com', partition: 'pb' }, { email: 'c@x.com', partition: 'pc' }]
  const q = (o: Partial<AccountQuota>): AccountQuota => ({ loggedIn: true, remaining: 5, resetAfter: null, checkedAt: 0, ...o })
  const now = 1_000_000

  it('skips busy, signed-out, empty and parked accounts', () => {
    const quotas = new Map([
      ['pa', q({ remaining: 0 })],
      ['pb', q({ loggedIn: false })],
      ['pc', q({ exhaustedUntil: now + 1 })],
    ])
    expect(pickAccount(accs, quotas, new Set(), now)).toBeNull()
    quotas.set('pc', q({ exhaustedUntil: now - 1 }))
    expect(pickAccount(accs, quotas, new Set(), now)?.partition).toBe('pc')
    expect(pickAccount(accs, quotas, new Set(['pc']), now)).toBeNull()
  })

  it('prefers the chosen account, else the one with most images left', () => {
    const quotas = new Map([['pa', q({ remaining: 2 })], ['pb', q({ remaining: 9 })], ['pc', q({ remaining: 4 })]])
    expect(pickAccount(accs, quotas, new Set(), now)?.partition).toBe('pb')
    expect(pickAccount(accs, quotas, new Set(), now, 'C@x.com')?.partition).toBe('pc')
  })

  it('tries an unchecked account', () => {
    expect(isUsable(undefined, now)).toBe(true)
    expect(pickAccount(accs, new Map(), new Set(), now)?.partition).toBe('pa')
  })
})

describe('helpers', () => {
  it('parks until the reported reset, or an hour when there is none', () => {
    expect(exhaustedUntil('2026-09-28T16:13:14Z', Date.parse('2026-09-28T10:00:00Z'))).toBe(Date.parse('2026-09-28T16:13:14Z'))
    expect(exhaustedUntil(null, 0)).toBe(3_600_000)
  })
  it('masks emails, including the "Google Account: Name (x@y)" label form', () => {
    expect(maskEmail('awais@gmail.com')).toBe('aw***@gmail.com')
    expect(maskEmail('Google Account: Ethical Byte  \n(ethical@gmail.com)')).toBe('et***@gmail.com')
    expect(maskEmail(null)).toBe('***')
  })
})

describe('readTurn with a repeated prompt (M3)', () => {
  // The same question asked twice in one chat: the first turn is complete.
  const old = [
    node({ id: 'u1', role: 'user', text: 'what is 2+2?' }),
    node({ id: 'a1', parent: 'u1', endTurn: true, text: 'Four.' }),
  ]
  const known = new Set(old.map(n => n.id))
  it('does not return the OLD answer before the new user message is saved', () => {
    expect(readTurn(old, 'what is 2+2?', known)).toEqual({ state: 'pending', images: [] })
  })
  it('reads the NEW turn once it exists', () => {
    const now = [...old,
      node({ id: 'u2', parent: 'a1', role: 'user', text: 'what is 2+2?' }),
      node({ id: 'a2', parent: 'u2', endTurn: true, text: 'Still four.' }),
    ]
    expect(readTurn(now, 'what is 2+2?', known)).toEqual({ state: 'done', images: [], text: 'Still four.' })
  })
  it('stays pending while the new user message has no answer yet', () => {
    const now = [...old, node({ id: 'u2', parent: 'a1', role: 'user', text: 'what is 2+2?' })]
    expect(readTurn(now, 'what is 2+2?', known).state).toBe('pending')
  })
})

describe('ids in URL paths (L1)', () => {
  it('accepts conversation UUIDs and file ids', () => {
    expect(isSafeId('68e0c1f2-1a2b-8003-9c4d-0123456789ab')).toBe(true)
    expect(isSafeId('file_00000000a1b2c3d4e5f6')).toBe(true)
    expect(isSafeId('file-AbC123')).toBe(true)
  })
  it('rejects traversal, separators, queries and empty values', () => {
    for (const bad of ['', '../me', 'a/b', 'a?x=1', 'a#b', '%2e%2e', ' id', 'id\\x', '-lead', 'x'.repeat(129), null, 42]) {
      expect(isSafeId(bad)).toBe(false)
    }
    expect(() => assertSafeId('../files', 'conversation id')).toThrow(/invalid conversation id/)
  })
  it('validates model slugs', () => {
    expect(isModelSlug('gpt-4o')).toBe(true)
    expect(isModelSlug('gpt-5.1-thinking')).toBe(true)
    expect(isModelSlug('gpt 4o')).toBe(false)
    expect(isModelSlug('"; alert(1)')).toBe(false)
  })
})

describe('explicit account never fails over (M4)', () => {
  const all = [{ email: 'a@x.com', partition: 'pa' }, { email: 'b@x.com', partition: 'pb' }, { email: 'c@x.com', partition: 'pc' }]
  it('finds an account by partition or email, case-insensitively', () => {
    expect(findAccount(all, 'pb')?.partition).toBe('pb')
    expect(findAccount(all, 'C@X.com')?.partition).toBe('pc')
    expect(findAccount(all, 'nobody')).toBeNull()
    expect(findAccount(all, null)).toBeNull()
  })
  it('uses only the pinned account', () => {
    expect(candidateAccounts(all, all[1]).map(a => a.partition)).toEqual(['pb'])
  })
  it('has nothing left once the pinned account refused', () => {
    expect(candidateAccounts(all, all[1], ['pb'])).toEqual([])
  })
  it('auto-routing uses every account not yet tried', () => {
    expect(candidateAccounts(all, null, ['pa']).map(a => a.partition)).toEqual(['pb', 'pc'])
  })
})

describe('time limits (H2)', () => {
  it('withTimeout rejects a promise that never settles', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'upload hung')).rejects.toThrow('upload hung')
  })
  it('withTimeout passes a value through', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'x')).resolves.toBe(7)
  })
  it('runWithDeadline rejects on time and marks the run aborted so it stops at its next step', async () => {
    let seen: Deadline | undefined
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const run = runWithDeadline(20, 'job timed out', async d => { seen = d; await gate; checkDeadline(d); return 'late' })
    await expect(run).rejects.toBeInstanceOf(TimeoutError)
    expect(seen?.aborted).toBe(true)
    release()
    expect(() => checkDeadline(seen)).toThrow('job timed out')
  })
  it('a timed-out run frees the per-account queue for the next one', async () => {
    const serial = createSerial()
    const hung = serial('acc', () => runWithDeadline(20, 'hung', () => new Promise<never>(() => {})))
    const next = serial('acc', async () => 'next ran')
    await expect(hung).rejects.toThrow('hung')
    await expect(next).resolves.toBe('next ran')
  })
  it('serial runs one at a time per key, in order (H1)', async () => {
    const serial = createSerial()
    const order: string[] = []
    const slow = serial('k', async () => { await new Promise(r => setTimeout(r, 15)); order.push('first') })
    const fast = serial('k', async () => { order.push('second') })
    await Promise.all([slow, fast])
    expect(order).toEqual(['first', 'second'])
  })
})

describe('bounded failed reads (M2)', () => {
  it('keeps waiting while reads are not failing', () => {
    expect(readFailureFatal(null, 1e9, 'conversation HTTP 404')).toBe(false)
  })
  it('gives up on a missing / forbidden / signed-out chat after a minute', () => {
    expect(readFailureFatal(0, 59_000, 'conversation HTTP 404')).toBe(false)
    expect(readFailureFatal(0, 61_000, 'conversation HTTP 404')).toBe(true)
    expect(readFailureFatal(0, 61_000, 'signed out')).toBe(true)
  })
  it('allows other errors three minutes', () => {
    expect(readFailureFatal(0, 61_000, 'conversation HTTP 502')).toBe(false)
    expect(readFailureFatal(0, 181_000, undefined)).toBe(true)
  })
})

describe('mergeQuotas (M1)', () => {
  it('fills accounts not read yet but never overwrites a fresher in-memory reading', () => {
    const fresh: AccountQuota = { loggedIn: true, remaining: 5, resetAfter: null, checkedAt: 2000 }
    const target = new Map<string, AccountQuota>([['pa', fresh]])
    mergeQuotas(target, {
      pa: { loggedIn: false, remaining: 0, resetAfter: null, checkedAt: 1000 },
      pb: { loggedIn: true, remaining: 2, resetAfter: '2026-10-05T10:00:00Z', checkedAt: 1000, exhaustedUntil: 99 },
    })
    expect(target.get('pa')).toBe(fresh)
    expect(target.get('pb')).toMatchObject({ loggedIn: true, remaining: 2, exhaustedUntil: 99 })
  })
  it('drops malformed entries and ignores a non-object file', () => {
    const target = new Map<string, AccountQuota>()
    mergeQuotas(target, { pa: 'x', pb: { loggedIn: 'yes', checkedAt: 1 }, pc: null })
    mergeQuotas(target, [1, 2])
    mergeQuotas(target, null)
    expect(target.size).toBe(0)
  })
})

describe('summarizeJobs (M8)', () => {
  it('jobs still running are accepted, not failed', () => {
    expect(summarizeJobs(['running', 'queued'])).toMatchObject({ ok: true, state: 'running' })
  })
  it('all done is done; some done and some failed is partial', () => {
    expect(summarizeJobs(['done', 'done'])).toMatchObject({ ok: true, state: 'done' })
    expect(summarizeJobs(['done', 'failed'])).toMatchObject({ ok: true, state: 'partial' })
  })
  it('ok is false only when every job failed', () => {
    expect(summarizeJobs(['failed', 'failed'])).toMatchObject({ ok: false, state: 'failed', progress: { total: 2, failed: 2 } })
  })
})

describe('jobsToPrune', () => {
  it('forgets only finished jobs beyond the newest N', () => {
    const jobs = [
      { id: 'a', status: 'done' as const, createdAt: 1 },
      { id: 'b', status: 'failed' as const, createdAt: 2 },
      { id: 'c', status: 'running' as const, createdAt: 0 },
      { id: 'd', status: 'done' as const, createdAt: 3 },
    ]
    expect(jobsToPrune(jobs, 2)).toEqual(['a'])
  })
})
