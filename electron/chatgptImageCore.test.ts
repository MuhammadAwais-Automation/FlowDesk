import { describe, expect, it } from 'vitest'
import { classifyRefusal, exhaustedUntil, isUsable, maskEmail, pickAccount, readTurn, type AccountQuota, type ConvNode } from './chatgptImageCore'

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
