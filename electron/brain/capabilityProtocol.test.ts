import { describe, expect, it, vi } from 'vitest'
import { BrainCapabilityBridge, capabilityRequestSchema, capabilityResultSchema, executeBrainCapability, type BrainCapabilityEnvelope } from './capabilityProtocol'

const envelope: BrainCapabilityEnvelope = {
  type: 'capability:request', jobId: 'job', scopeId: 'client-a', recipeId: 'linkedin.opportunity_scan', accountId: null,
  request: { id: '1', capability: 'linkedin.search', input: { query: 'hiring developer', limit: 50 } },
}

describe('Brain capability boundary', () => {
  it('correlates capability replies and ignores malformed or unrelated messages', async () => {
    const bridge = new BrainCapabilityBridge(() => {})
    const pending = bridge.request(envelope)
    expect(bridge.receive({ type: 'capability:result', result: { id: 'other', ok: true, records: [] } })).toBe(true)
    expect(bridge.receive({ type: 'capability:result', result: { id: '1', ok: true, records: 'bad' } })).toBe(true)
    expect(bridge.receive({ id: 'normal', method: 'status' })).toBe(false)
    bridge.receive({ type: 'capability:result', result: { id: '1', ok: true, records: [{ text: 'private' }] } })
    await expect(pending).resolves.toEqual({ id: '1', ok: true, records: [{ text: 'private' }] })
    bridge.close()
  })

  it('turns capability timeouts and shutdown into bounded transient failures', async () => {
    vi.useFakeTimers()
    try {
      const bridge = new BrainCapabilityBridge(() => {})
      const pending = bridge.request(envelope)
      await vi.advanceTimersByTimeAsync(60_000)
      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'transient' } })
      const second = bridge.request(envelope)
      bridge.close()
      await expect(second).resolves.toMatchObject({ ok: false, error: { code: 'transient' } })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('accepts only the three bounded read capabilities', () => {
    expect(capabilityRequestSchema.parse(envelope.request).capability).toBe('linkedin.search')
    expect(capabilityRequestSchema.parse({ id: '2', capability: 'whatsapp.list_unread', input: { limit: 50 } }).capability).toBe('whatsapp.list_unread')
    expect(capabilityRequestSchema.parse({ id: '3', capability: 'linkedin.feed', input: { limit: 50, sort: 'RECENT' } }).capability).toBe('linkedin.feed')
    for (const value of [
      { id: '1', capability: 'shell', input: {} },
      { ...envelope.request, command: 'shell' },
      { ...envelope.request, input: { query: 'x', limit: 501 } },
      { id: '3', capability: 'linkedin.feed', input: { limit: 50, sort: 'TOP' } },
    ]) expect(() => capabilityRequestSchema.parse(value)).toThrow()
  })

  it('rejects malformed results and untyped error codes', () => {
    expect(() => capabilityResultSchema.parse({ id: '1', ok: true, records: 'raw' })).toThrow()
    expect(() => capabilityResultSchema.parse({ id: '1', ok: false, error: { code: 'shell', message: 'x' } })).toThrow()
  })

  it('checks consent for the exact scope recipe and provider before reading', async () => {
    const reads: string[] = []
    const result = await executeBrainCapability(envelope, {
      hasConsent: async (scopeId, recipeId, provider) => scopeId === 'client-b' && recipeId === envelope.recipeId && provider === 'local-brain',
      read: async request => { reads.push(request.capability); return { ok: true, posts: [] } },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'approval_required' } })
    expect(reads).toEqual([])
  })

  it('rejects recipe mismatches and explicit accounts unsupported by singleton connectors', async () => {
    for (const value of [{ ...envelope, recipeId: 'whatsapp.unread_intelligence' }, { ...envelope, accountId: 'other-account' }]) {
      const result = await executeBrainCapability(value, { hasConsent: async () => true, read: async () => { throw new Error('must not read') } })
      expect(result).toMatchObject({ ok: false, error: { code: 'permanent' } })
    }
  })

  it.each([
    ['LinkedIn is not open. Sign in, then retry.', 'login_required'],
    ['HTTP 429', 'transient'],
    ['Unsupported operation', 'permanent'],
  ])('maps connector failure %s to %s without leaking raw error text', async (message, code) => {
    const result = await executeBrainCapability(envelope, { hasConsent: async () => true, read: async () => ({ ok: false, error: message }) })
    expect(result).toMatchObject({ ok: false, error: { code } })
    expect(JSON.stringify(result)).not.toContain(message)
  })

  it('returns validated records only to the utility capability caller', async () => {
    const result = await executeBrainCapability(envelope, { hasConsent: async () => true, read: async () => ({ ok: true, posts: [{ id: 'post', text: 'Hiring' }] }) })
    expect(result).toEqual({ id: '1', ok: true, records: [{ id: 'post', text: 'Hiring' }] })
  })
})
