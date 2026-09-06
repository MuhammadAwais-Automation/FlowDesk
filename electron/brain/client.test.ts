import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { BrainClient, type BrainUtilityChild } from './client'

class FakeChild extends EventEmitter implements BrainUtilityChild {
  sent: unknown[] = []
  postMessage(message: unknown) {
    this.sent.push(message)
  }
  kill() {}
}

class ExitedChild extends FakeChild {
  override postMessage(message: unknown) {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'capability:result') {
      this.emit('exit', 1)
      throw new Error('utility port closed')
    }
    super.postMessage(message)
  }
}

describe('BrainClient', () => {
  it('routes validated capability requests without forwarding raw records as events', async () => {
    const child = new FakeChild()
    const client = new BrainClient(() => child, { capabilityHandler: async envelope => ({ id: envelope.request.id, ok: true, records: [{ text: 'private' }] }) })
    const events: unknown[] = []
    client.on('event', value => events.push(value))
    client.start()
    child.emit('message', { type: 'capability:request', jobId: 'job', scopeId: 'scope', recipeId: 'linkedin.opportunity_scan', accountId: null,
      request: { id: 'read', capability: 'linkedin.search', input: { query: 'hiring', limit: 10 } } })
    await Promise.resolve()
    await Promise.resolve()
    expect(child.sent).toEqual([{ type: 'capability:result', result: { id: 'read', ok: true, records: [{ text: 'private' }] } }])
    expect(events).toEqual([])
    child.emit('message', { type: 'capability:request', request: { id: 'bad', capability: 'shell', input: {} } })
    await Promise.resolve()
    expect(child.sent).toHaveLength(1)
    expect(events).toEqual([])
    client.stop()
  })

  it('discards a capability result when its requesting utility has exited', async () => {
    let finish!: (value: { id: string; ok: true; records: [] }) => void
    const child = new FakeChild()
    const client = new BrainClient(() => child, { capabilityHandler: () => new Promise(resolve => { finish = resolve }) })
    client.start()
    child.emit('message', { type: 'capability:request', jobId: 'job', scopeId: 'scope', recipeId: 'linkedin.opportunity_scan', accountId: null,
      request: { id: 'read', capability: 'linkedin.search', input: { query: 'hiring', limit: 10 } } })
    client.stop()
    finish({ id: 'read', ok: true, records: [] })
    await Promise.resolve()
    expect(child.sent).toEqual([])
  })

  it('contains a utility-exit race while posting a capability result', async () => {
    const child = new ExitedChild()
    const client = new BrainClient(() => child, {
      restartDelaysMs: [],
      capabilityHandler: async envelope => ({ id: envelope.request.id, ok: true, records: [] }),
    })
    client.start()
    child.emit('message', { type: 'capability:request', jobId: 'job', scopeId: 'scope', recipeId: 'linkedin.opportunity_scan', accountId: null,
      request: { id: 'read', capability: 'linkedin.search', input: { query: 'hiring', limit: 10 } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(client.getRuntimeStatus().state).toBe('degraded')
    client.stop()
  })

  it('matches utility responses to requests', async () => {
    const child = new FakeChild()
    const client = new BrainClient(() => child, { requestTimeoutMs: 1000, restartDelaysMs: [5, 30, 120] })
    client.start()
    const pending = client.request('status', {})
    const request = child.sent[0] as { id: string }
    child.emit('message', { id: request.id, ok: true, result: { ready: true } })
    await expect(pending).resolves.toEqual({ ready: true })
    client.stop()
  })

  it('enters degraded state after three failed restarts', async () => {
    vi.useFakeTimers()
    const children: FakeChild[] = []
    const client = new BrainClient(() => {
      const child = new FakeChild()
      children.push(child)
      return child
    }, { requestTimeoutMs: 1000, restartDelaysMs: [5, 30, 120] })
    client.start()
    children[0].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(5)
    children[1].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(30)
    children[2].emit('exit', 1)
    await vi.advanceTimersByTimeAsync(120)
    children[3].emit('exit', 1)
    expect(client.getRuntimeStatus()).toMatchObject({ state: 'degraded', restartAttempts: 3 })
    client.stop()
    vi.useRealTimers()
  })
})
