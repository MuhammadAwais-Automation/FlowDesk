import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { redactHeaders, rehearse } from './rehearsal'

/** A fake webContents.debugger that answers sendCommand and lets the test emit Fetch.requestPaused. */
function fakeDebugger() {
  const em = new EventEmitter() as EventEmitter & Record<string, unknown>
  const sent: { method: string; params?: Record<string, unknown> }[] = []
  let attached = false
  Object.assign(em, {
    isAttached: () => attached,
    attach: () => { attached = true },
    detach: () => { attached = false },
    sendCommand: async (method: string, params?: Record<string, unknown>) => { sent.push({ method, params }); return {} },
  })
  const pause = (requestId: string, method: string, url: string, postData?: string) =>
    em.emit('message', {}, 'Fetch.requestPaused', { requestId, request: { method, url, headers: { Cookie: 'secret', Accept: '*/*' }, postData } })
  return { wc: { debugger: em } as never, sent, pause, isAttached: () => attached }
}

describe('rehearsal', () => {
  it('blocks matching writes, lets other methods through, and detaches after', async () => {
    const d = fakeDebugger()
    const r = await rehearse(d.wc, { urlPattern: '*://x.com/links/*', method: 'POST' }, async () => {
      d.pause('1', 'GET', 'https://x.com/links/a')
      d.pause('2', 'POST', 'https://x.com/links/a', '{"name":"n"}')
      return 'done'
    })
    expect(r.result).toBe('done')
    expect(r.blocked).toEqual([{ method: 'POST', url: 'https://x.com/links/a', headers: { Cookie: '[redacted]', Accept: '*/*' }, postData: '{"name":"n"}', bodyNotInlined: false }])
    expect(r.passed).toEqual([{ method: 'GET', url: 'https://x.com/links/a' }])
    expect(d.sent.map(s => s.method)).toEqual(['Fetch.enable', 'Fetch.continueRequest', 'Fetch.failRequest', 'Fetch.disable'])
    expect(d.sent[2].params).toMatchObject({ requestId: '2', errorReason: 'BlockedByClient' })
    expect(d.isAttached()).toBe(false)
  })

  it('reports the inner error instead of throwing, and still disables Fetch', async () => {
    const d = fakeDebugger()
    const r = await rehearse(d.wc, { urlPattern: '*' }, async () => { throw new Error('Failed to fetch') })
    expect(r.error).toBe('Failed to fetch')
    expect(d.sent.at(-1)?.method).toBe('Fetch.disable')
  })

  it('redacts credential headers by name', () => {
    expect(redactHeaders({ Authorization: 'Bearer x', 'X-CSRF-Token': 't', 'Content-Type': 'a' })).toEqual({ Authorization: '[redacted]', 'X-CSRF-Token': '[redacted]', 'Content-Type': 'a' })
  })
})
