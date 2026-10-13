import { describe, expect, it, vi } from 'vitest'

vi.mock('./tiktok', () => ({ getTikTokView: vi.fn() }))
const { signVod, publishBody, checkSchedule } = await import('./tiktokUpload')

describe('TikTok API upload', () => {
  const token = { access_key_id: 'AKTEST', secret_acess_key: 'SECRET', session_token: 'STS2token' }

  it('signs ApplyUploadInner with SigV4 for region gcp / service vod', () => {
    const url = new URL('https://www.tiktok.com/top/v1?Action=ApplyUploadInner&Version=2020-11-19&FileSize=10')
    const h = signVod('GET', url, token, new Date('2026-09-27T20:39:40Z'))
    expect(h['X-Amz-Date']).toBe('20260927T203940Z')
    expect(h['x-amz-security-token']).toBe('STS2token')
    expect(h.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKTEST\/20260927\/gcp\/vod\/aws4_request, SignedHeaders=x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/)
    // Deterministic: same inputs, same signature.
    expect(signVod('GET', url, token, new Date('2026-09-27T20:39:40Z')).Authorization).toBe(h.Authorization)
  })

  it('publishes private as visibility_type 1 and public as 0', () => {
    const priv = JSON.parse(publishBody('v1', 'hello', 'private'))
    expect(priv.feature_common_info_list[0].privacy_setting_info.visibility_type).toBe(1)
    expect(priv.single_post_req_list[0].video_id).toBe('v1')
    expect(priv.single_post_req_list[0].single_post_feature_info.text).toBe('hello')
    expect(JSON.parse(publishBody('v1', '', 'public')).feature_common_info_list[0].privacy_setting_info.visibility_type).toBe(0)
  })

  it('schedules with schedule_time in Unix seconds, and friends as visibility 2', () => {
    const body = JSON.parse(publishBody('v1', 'x', 'friends', 1790547900))
    expect(body.feature_common_info_list[0].schedule_time).toBe(1790547900)
    expect(body.feature_common_info_list[0].privacy_setting_info.visibility_type).toBe(2)
    expect(JSON.parse(publishBody('v1', 'x', 'public')).feature_common_info_list[0]).not.toHaveProperty('schedule_time')
  })

  it('keeps schedule times inside the window TikTok Studio allows', () => {
    const now = Date.parse('2026-09-28T00:00:00Z')
    expect(checkSchedule(undefined, 'private', now)).toEqual({})
    expect(checkSchedule('2026-09-28T01:00:00Z', 'friends', now)).toEqual({ atSeconds: Date.parse('2026-09-28T01:00:00Z') / 1000 })
    expect(checkSchedule('2026-09-28T00:05:00Z', 'public', now).error).toMatch(/15 minutes/)
    expect(checkSchedule('2026-10-20T00:00:00Z', 'public', now).error).toMatch(/10 days/)
    expect(checkSchedule('2026-09-28T01:00:00Z', 'private', now).error).toMatch(/Only you/)
    expect(checkSchedule('not a date', 'public', now).error).toMatch(/not a date/)
  })

  it('rounds a schedule up to the next 5 minutes, as the Studio picker does', () => {
    const now = Date.parse('2026-09-27T23:00:00Z')
    expect(checkSchedule('2026-09-28T01:02:30Z', 'public', now)).toEqual({ atSeconds: Date.parse('2026-09-28T01:05:00Z') / 1000 })
  })

  it('posts a schedule the way Studio does: post_type 0 and schedule_time in seconds', () => {
    const at = Date.parse('2026-09-28T01:05:00Z') / 1000
    const scheduled = JSON.parse(publishBody('v0', 'cap', 'public', at))
    expect(scheduled.post_common_info.post_type).toBe(0)
    expect(scheduled.feature_common_info_list[0].schedule_time).toBe(at)
    const now = JSON.parse(publishBody('v0', 'cap', 'public'))
    expect(now.post_common_info.post_type).toBe(3)
    expect(now.feature_common_info_list[0].schedule_time).toBeUndefined()
  })
})
