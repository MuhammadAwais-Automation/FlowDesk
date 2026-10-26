import { describe, expect, it, vi } from 'vitest'

vi.mock('../keepAwake', () => ({ whileAwake: vi.fn() }))

import { keyDef, parseActRequest, settle, targetMismatch } from './actions'

describe('parseActRequest', () => {
  it('accepts a valid click and normalises the ref', () => {
    expect(parseActRequest({ action: 'click', ref: ' @e12 ' })).toEqual({ action: 'click', ref: 'e12', clear: false, confirm: false })
  })

  it('rejects unknown actions, bad refs and missing fields', () => {
    expect(parseActRequest({ action: 'hover' })).toMatch(/action must be/)
    expect(parseActRequest({ action: 'click', ref: 'button' })).toMatch(/ref must look like/)
    expect(parseActRequest({ action: 'click' })).toMatch(/needs a ref/)
    expect(parseActRequest({ action: 'type', ref: 'e1' })).toMatch(/needs text/)
    expect(parseActRequest({ action: 'type', ref: 'e1', text: 'x'.repeat(10_001) })).toMatch(/longer/)
    expect(parseActRequest({ action: 'select', ref: 'e1' })).toMatch(/needs value/)
    expect(parseActRequest({ action: 'key', key: 'Hyper' })).toMatch(/key must be/)
  })

  it('needs no ref for scroll and key, and only takes confirm when it is exactly true', () => {
    expect(parseActRequest({ action: 'scroll', direction: 'up' })).toMatchObject({ direction: 'up' })
    expect(parseActRequest({ action: 'scroll' })).toMatchObject({ direction: 'down' })
    expect(parseActRequest({ action: 'key', key: 'Escape', confirm: 'yes' })).toMatchObject({ key: 'Escape', confirm: false })
  })
})

describe('keyDef', () => {
  it('maps named keys and single characters to CDP fields', () => {
    expect(keyDef('Enter')).toEqual({ key: 'Enter', code: 'Enter', vk: 13, text: '\r' })
    expect(keyDef('Space')).toMatchObject({ key: ' ', vk: 32 })
    expect(keyDef('a')).toEqual({ key: 'a', code: 'KeyA', vk: 65, text: 'a' })
    expect(keyDef('7')).toMatchObject({ code: 'Digit7', vk: 55 })
    expect(keyDef('ab')).toBeNull()
  })
})

describe('targetMismatch', () => {
  const entry = { role: 'button', name: 'Send' }

  it('passes the same element, also when its name grew or comes from a shadow host', () => {
    expect(targetMismatch(entry, { role: 'button', name: 'Send' })).toBeNull()
    expect(targetMismatch(entry, { role: 'button', name: 'send message' })).toBeNull()
    expect(targetMismatch({ role: 'textbox', name: 'Search' }, { role: 'textbox', name: '' })).toBeNull()
    expect(targetMismatch({ role: 'link', name: 'A very long title cut…' }, { role: 'link', name: 'A very long title cut here' })).toBeNull()
  })

  it('fails closed when the element is gone or is something else', () => {
    expect(targetMismatch(entry, null)).toMatch(/gone/)
    expect(targetMismatch(entry, { role: 'link', name: 'Send' })).toMatch(/changed/)
    expect(targetMismatch(entry, { role: 'button', name: 'Delete' })).toMatch(/changed/)
  })
})

describe('settle', () => {
  const fast = { firstMs: 1, quietMs: 1, capMs: 200 }

  it('returns once two reads agree', async () => {
    const reads = ['a', 'b', 'c', 'c', 'd']
    let i = 0
    expect(await settle(async () => reads[i++], (x, y) => x === y, fast)).toBe('c')
    expect(i).toBe(4)
  })

  it('gives up at the cap with the latest read', async () => {
    let i = 0
    const out = await settle(async () => i++, (x, y) => x === y, { firstMs: 1, quietMs: 5, capMs: 20 })
    expect(out).toBeGreaterThan(0)
  })
})
