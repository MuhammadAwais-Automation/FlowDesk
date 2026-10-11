import { describe, expect, it } from 'vitest'
import { callContext, contextFromHeaders, describeCall, withLedger, type LedgerArgs } from './capture'

const ctx = { sessionId: 's1', client: 'claude-code', contentId: 'c-1' }

describe('ledger capture', () => {
  it('reads session, client and content from the MCP headers, and skips rehearsals', () => {
    expect(contextFromHeaders({ 'x-flowdesk-session': 's1', 'x-flowdesk-client': 'claude-code' }, 'pinterest.createPin')).toEqual({ sessionId: 's1', client: 'claude-code', contentId: undefined, skip: false })
    expect(contextFromHeaders({}, 'dev.rehearse').skip).toBe(true)
  })

  it('describes a write with its target and content, keeping argument names only', () => {
    // The live result shape: the pin carries its board id next to its own id.
    const row = describeCall(ctx, 'pinterest.createPin', { account: 'Account 1', title: 'Secret title', boardId: 'b' }, { result: { ok: true, account: '1', pin: { id: '987', url: 'https://www.pinterest.com/pin/987/', boardId: 'b' } } })
    expect(row).toEqual({
      sessionId: 's1', client: 'claude-code', platform: 'pinterest', account: 'Account 1', tool: 'pinterest.createPin',
      kind: 'write', outcome: 'ok', targetId: '987', targetUrl: 'https://www.pinterest.com/pin/987/', contentId: 'c-1', error: null,
      summary: 'account, title, boardId', assets: [],
    })
    expect(JSON.stringify(row)).not.toContain('Secret title')
  })

  it('collects generated images as assets, not as a placement', () => {
    const row = describeCall(ctx, 'chatgpt.generateImage', { prompt: 'p' }, { result: { ok: true, images: [{ url: 'flowdesk-image://a.png', path: 'C:\\x\\a.png' }, { path: 'C:\\x\\b.png' }] } })
    expect(row).toMatchObject({ kind: 'write', targetUrl: null, assets: ['flowdesk-image://a.png', 'C:\\x\\b.png'] })
  })

  it('treats { ok: false } and thrown errors as failures and masks them', () => {
    expect(describeCall(ctx, 'tiktok.uploadVideo', {}, { result: { ok: false, error: 'login as me@x.com expired' } })).toMatchObject({ outcome: 'error', error: 'login as ***@*** expired', targetId: null })
    expect(describeCall(ctx, 'tools.call', { name: 'facebook_comment', args: { account: 'fb1' } }, { error: new Error('blocked') })).toMatchObject({ tool: 'facebook_comment', platform: 'facebook', kind: 'write', outcome: 'error', account: 'fb1' })
  })

  it('records nothing without an MCP context, inside a rehearsal, or for bookkeeping methods', () => {
    expect(describeCall(undefined, 'pinterest.createPin', {}, { result: {} })).toBeNull()
    expect(describeCall({ ...ctx, skip: true }, 'pinterest.createPin', {}, { result: {} })).toBeNull()
    expect(describeCall(ctx, 'brain.start', {}, { result: {} })).toBeNull()
    expect(describeCall(ctx, 'reddit.apiSearch', {}, { result: { posts: [] } })).toMatchObject({ kind: 'read', outcome: 'ok' })
  })

  it('offers every finished guarded call to the ledger, including nested workflow steps', async () => {
    const rows: LedgerArgs[] = []
    const guard = withLedger(async (_m, _p, run) => run(), row => rows.push(row))
    await callContext.run(ctx, async () => {
      await guard('workflows.run', {}, async () => guard('pinterest.createPin', { account: 'a' }, async () => ({ id: '5' })))
      await expect(guard('tiktok.uploadVideo', {}, async () => { throw new Error('quota') })).rejects.toThrow('quota')
    })
    await guard('pinterest.createPin', {}, async () => ({ id: '6' }))
    expect(rows.map(r => [r.tool, r.outcome, r.targetId])).toEqual([['pinterest.createPin', 'ok', '5'], ['tiktok.uploadVideo', 'error', null]])
  })
})
