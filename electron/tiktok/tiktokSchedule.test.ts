import { describe, expect, it, vi } from 'vitest'

vi.mock('./tiktok', () => ({}))
vi.mock('./tiktokUpload', () => ({ checkSchedule: vi.fn() }))
vi.mock('../keepAwake', () => ({ keepAwake: vi.fn() }))

import { carriesScheduleTime, findScheduledPost, judgePostAnswer, pickCalendarDay, pickerTarget, scheduleTimeIn } from './tiktokSchedule'

describe('carriesScheduleTime', () => {
  it('is true only when the post body sets a schedule time', () => {
    expect(carriesScheduleTime('{"post_common_info":{},"single_post_req_list":[{"schedule_time":1792166400,"geofencing_regions":[]}]}')).toBe(true)
    expect(carriesScheduleTime('{"single_post_req_list":[{"schedule_time":"2026102017"}]}')).toBe(true)
    expect(carriesScheduleTime('{"single_post_req_list":[{"geofencing_regions":[]}]}')).toBe(false)
    expect(carriesScheduleTime('{"schedule_time":0}')).toBe(false)
    expect(carriesScheduleTime('')).toBe(false)
  })
})

describe('pickerTarget', () => {
  it('reads the moment in the given zone, so a late-night PKT time lands on the right day', () => {
    // 2026-10-17 21:00 UTC is 2026-10-18 02:00 in Karachi.
    const t = pickerTarget(Date.UTC(2026, 9, 17, 21, 0) / 1000, 'Asia/Karachi')
    expect(t).toMatchObject({ year: 2026, month: 10, day: 18, hour: '02', minute: '00', label: '2026-10-18 02:00' })
  })
  it('falls back to the machine zone for an unknown zone name', () => {
    expect(pickerTarget(0, 'Not/AZone').label).toBe(pickerTarget(0).label)
  })
})

describe('pickCalendarDay', () => {
  // Trailing days of the previous month, then this month, then the next month's start.
  const cells = ['29', '30', '1', '2', '3', '30', '31', '1', '2'].map((text, i) => ({ text, cls: i === 3 ? 'day disabled' : 'day valid' }))
  it('picks the cell inside this month, not the trailing one', () => {
    expect(pickCalendarDay(cells, 30)).toEqual({ index: 5 })
    expect(pickCalendarDay(cells, 1)).toEqual({ index: 2 })
  })
  it('names a greyed-out day instead of clicking it', () => {
    expect(pickCalendarDay(cells, 2)).toMatchObject({ error: expect.stringMatching(/greyed out/) })
  })
})

describe('judgePostAnswer', () => {
  const at = 1792166400
  const ok = { status_code: 0, single_post_resp_list: [{ item_id: '74', status_code: 0 }] }
  it('scheduled only when the sent body carries this time', () => {
    expect(scheduleTimeIn('{"schedule_time":1792166400000}')).toBe(at)
    expect(judgePostAnswer({ body: ok, sent: `{"schedule_time":${at}}` }, at)).toMatchObject({ verdict: 'scheduled', itemId: '74' })
    expect(judgePostAnswer({ body: ok, sent: `{"schedule_time":${at + 3600}}` }, at).verdict).toBe('wrong-time')
    expect(judgePostAnswer({ body: ok, sent: '{"schedule_time":0}' }, at).verdict).toBe('posted-now')
    expect(judgePostAnswer({ body: ok }, at).verdict).toBe('body-unread')
    expect(judgePostAnswer({ body: { status_code: 5 } }, at).verdict).toBe('refused')
    expect(judgePostAnswer(undefined, at).verdict).toBe('no-answer')
  })
})

describe('findScheduledPost', () => {
  const at = 1792166400
  const posts = [{ id: 'old', scheduledAt: new Date(at * 1000).toISOString() }, { id: 'new', scheduledAt: new Date((at + 30) * 1000).toISOString() }]
  it('finds only a post that was not there before, at this time', () => {
    expect(findScheduledPost(posts, at, { notIn: new Set(['old']) })).toBe('new')
    expect(findScheduledPost(posts, at, { id: 'old' })).toBe('old')
    expect(findScheduledPost(posts, at + 7200, { notIn: new Set() })).toBeNull()
  })
  it('never guesses without an id or a before-list', () => {
    expect(findScheduledPost(posts, at, {})).toBeNull()
  })
})
