import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('./youtube', () => ({}))
vi.mock('../keepAwake', () => ({ whileAwake: vi.fn() }))

import { heatPeaks, titleFacts, velocity } from './youtubeResearch'

describe('heatPeaks', () => {
  it('keeps the strongest moments, spaced apart, in time order', () => {
    const points = [0, 10, 20, 30, 40, 50, 60].map((s, i) => ({ startSeconds: s, endSeconds: s + 10, intensity: [0.2, 0.9, 0.95, 0.1, 0.5, 0.8, 0.3][i] }))
    // By strength: 20 (.95), then 10 (.9) is too close to 20, 50 (.8) is kept,
    // 40 and 60 are too close to 50, and 0 (.2) is exactly 20 s from 20.
    expect(heatPeaks(points, 3, 20).map(p => p.startSeconds)).toEqual([0, 20, 50])
  })
})

describe('titleFacts', () => {
  it('reads the packaging facts of a title', () => {
    const f = titleFacts('I Tried AI Cartoons for 30 DAYS?! 😱 (Shocking)')
    expect(f.hasNumber).toBe(true)
    expect(f.isQuestion).toBe(true)
    expect(f.hasEmoji).toBe(true)
    expect(f.capsWords).toContain('DAYS?!')
    expect(f.brackets).toEqual(['(Shocking)'])
    expect(f.keyWords).toContain('cartoons')
  })
})

describe('velocity', () => {
  it('is views gained per hour between two checks', () => {
    expect(velocity({ at: '2026-10-16T10:00:00Z', views: 1000, likes: null }, { at: '2026-10-16T12:00:00Z', views: 3000, likes: null })).toBe(1000)
    expect(velocity(undefined, { at: '2026-10-16T12:00:00Z', views: 3000, likes: null })).toBeNull()
    expect(velocity({ at: '2026-10-16T12:00:00Z', views: 1, likes: null }, { at: '2026-10-16T12:00:00Z', views: 2, likes: null })).toBeNull()
  })
})
