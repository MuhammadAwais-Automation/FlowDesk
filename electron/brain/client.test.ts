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

describe('BrainClient', () => {
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
