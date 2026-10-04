import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { actionName, canonicalAction, createActionGuard, isWriteAction, readActionLog, savePolicy, summarizeParams } from './actionPolicy'

function setup(policy?: object, requestApproval?: () => Promise<boolean>) {
  const dir = mkdtempSync(join(tmpdir(), 'fd-policy-'))
  const policyFile = join(dir, 'action-policy.json')
  const logFile = join(dir, 'action-log.jsonl')
  if (policy) writeFileSync(policyFile, JSON.stringify(policy))
  const guard = createActionGuard({ policyFile, logFile, requestApproval })
  const log = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []
  return { guard, policyFile, log }
}

describe('action policy', () => {
  it('treats an RPC method and its MCP tool name as the same action', () => {
    expect(canonicalAction('tiktok.deleteAllVideos')).toBe('tiktok_delete_all_videos')
    expect(actionName('tools.call', { name: 'linkedin_send_connection_request' })).toBe('linkedin_send_connection_request')
    expect(actionName('reddit.api_feed', {})).toBe('reddit_api_feed')
  })

  it('knows writes from reads', () => {
    expect(isWriteAction('whatsapp_send')).toBe(true)
    expect(isWriteAction('tiktok_delete_video')).toBe(true)
    expect(isWriteAction('linkedin_like_post')).toBe(true)
    expect(isWriteAction('reddit_api_feed')).toBe(false)
    expect(isWriteAction('tiktok_status')).toBe(false)
  })

  it('never stores a full message, only a cut summary', () => {
    const s = summarizeParams({ chatId: '1@c.us', message: 'x'.repeat(200) })
    expect(s.chatId).toBe('1@c.us')
    expect(s.message.length).toBeLessThan(70)
    expect(s.message).toContain('200 chars')
  })

  it('refuses a blocked action without running it, and logs the refusal', async () => {
    const { guard, log } = setup({ blocked: ['tiktok_delete_all_videos'], requireApproval: [] })
    let ran = false
    await expect(guard('tiktok.deleteAllVideos', {}, async () => { ran = true })).rejects.toThrow(/blocked/)
    expect(ran).toBe(false)
    expect(log()[0]).toMatchObject({ action: 'tiktok_delete_all_videos', outcome: 'blocked' })
  })

  it('runs an approval-listed action only when the user allows it', async () => {
    const denied = setup({ blocked: [], requireApproval: ['tiktok_update_profile'] }, async () => false)
    await expect(denied.guard('tiktok.updateProfile', { bio: 'x' }, async () => ({ ok: true }))).rejects.toThrow(/approval/)
    expect(denied.log()[0].outcome).toBe('denied')

    const allowed = setup({ blocked: [], requireApproval: ['tiktok_update_profile'] }, async () => true)
    await expect(allowed.guard('tiktok.updateProfile', { bio: 'x' }, async () => ({ ok: true }))).resolves.toEqual({ ok: true })
    expect(allowed.log()[0].outcome).toBe('ok')
  })

  it('refuses approval-listed actions when nothing can ask the user', async () => {
    const { guard } = setup({ blocked: [], requireApproval: ['tiktok_update_profile'] })
    await expect(guard('tiktok.updateProfile', {}, async () => ({ ok: true }))).rejects.toThrow(/approval/)
  })

  it('logs writes with their outcome and leaves reads out of the log', async () => {
    const { guard, log } = setup({ blocked: [], requireApproval: [] })
    await guard('reddit.api_feed', {}, async () => ({ ok: true }))
    await guard('tools.call', { name: 'whatsapp_send_message', args: { chatId: 'c', message: 'hi' } }, async () => ({ content: [], isError: true }))
    const entries = log()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ action: 'whatsapp_send_message', outcome: 'failed', chatId: 'c', message: 'hi' })
  })

  it('writes a default policy file on first use', async () => {
    const { guard, policyFile } = setup()
    await guard('reddit.status', {}, async () => ({ ok: true }))
    expect(JSON.parse(readFileSync(policyFile, 'utf8')).requireApproval).toContain('tiktok_delete_all_videos')
  })

  it('saves the Settings choice canonically, with block winning over ask', async () => {
    const { policyFile } = setup()
    const saved = await savePolicy(policyFile, { blocked: ['tiktok.deleteAllVideos', 7], requireApproval: ['tiktok_delete_all_videos', 'whatsapp_send', ''] })
    expect(saved).toEqual({ blocked: ['tiktok_delete_all_videos'], requireApproval: ['whatsapp_send'] })
    expect(JSON.parse(readFileSync(policyFile, 'utf8'))).toEqual(saved)
  })

  it('reads the newest log entries first', async () => {
    const dirGuard = setup({ blocked: [], requireApproval: [] })
    await dirGuard.guard('whatsapp.send', { chatId: 'a' }, async () => ({ ok: true }))
    await dirGuard.guard('whatsapp.send', { chatId: 'b' }, async () => ({ ok: true }))
    const logFile = dirGuard.policyFile.replace('action-policy.json', 'action-log.jsonl')
    const entries = await readActionLog(logFile, 10)
    expect(entries.map(e => e.chatId)).toEqual(['b', 'a'])
    expect(await readActionLog(logFile + '.missing')).toEqual([])
  })
})
