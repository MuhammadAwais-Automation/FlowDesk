import { describe, expect, it } from 'vitest'
import { DEGRADED_AFTER, FailureLedger, failedResult, platformOf, selfHealHint } from './selfHeal'

describe('selfHeal', () => {
  it('maps RPC methods and mirrored tool names to platforms', () => {
    expect(platformOf('tiktok.uploadVideo')).toBe('tiktok')
    expect(platformOf('whatsapp_download_media')).toBe('whatsapp')
    expect(platformOf('browser.act')).toBeNull()
  })

  it('reads failure from ok:false, isError and content text', () => {
    expect(failedResult({ ok: false, error: 'selector gone' })).toBe('selector gone')
    expect(failedResult({ isError: true, content: [{ type: 'text', text: 'no chat' }] })).toBe('no chat')
    expect(failedResult({ ok: true })).toBeNull()
    expect(failedResult('x')).toBeNull()
  })

  it('marks a tool degraded after repeated failures and clears it on success', () => {
    const l = new FailureLedger()
    l.record('tiktok.uploadVideo', 'button not found', 1000)
    expect(selfHealHint('tiktok.uploadVideo', l.recent('tiktok.uploadVideo', 1000).length)).toBeNull()
    l.record('tiktok.uploadVideo', 'button not found', 2000)
    l.record('browser.act', 'ignored', 2000)
    expect(l.degraded(3000)).toEqual([expect.objectContaining({ method: 'tiktok.uploadVideo', failures: DEGRADED_AFTER })])
    expect(selfHealHint('tiktok.uploadVideo', 2)?.fallback).toMatch(/browser_open https:\/\/www\.tiktok\.com/)
    l.record('linkedin.send', '[{"code": "invalid_type", "path": ["chatId"]}]', 2000)
    l.record('linkedin.send', 'unknown account "9"', 2000)
    expect(l.recent('linkedin.send', 2000)).toEqual([])
    l.ok('tiktok.uploadVideo')
    expect(l.degraded(3000)).toEqual([])
  })
})
