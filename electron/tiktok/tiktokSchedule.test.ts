import { describe, expect, it, vi } from 'vitest'

vi.mock('./tiktok', () => ({}))
vi.mock('./tiktokUpload', () => ({ checkSchedule: vi.fn() }))
vi.mock('../keepAwake', () => ({ keepAwake: vi.fn() }))

import { carriesScheduleTime } from './tiktokSchedule'

describe('carriesScheduleTime', () => {
  it('is true only when the post body sets a schedule time', () => {
    expect(carriesScheduleTime('{"post_common_info":{},"single_post_req_list":[{"schedule_time":1792166400,"geofencing_regions":[]}]}')).toBe(true)
    expect(carriesScheduleTime('{"single_post_req_list":[{"schedule_time":"2026102017"}]}')).toBe(true)
    expect(carriesScheduleTime('{"single_post_req_list":[{"geofencing_regions":[]}]}')).toBe(false)
    expect(carriesScheduleTime('{"schedule_time":0}')).toBe(false)
    expect(carriesScheduleTime('')).toBe(false)
  })
})
