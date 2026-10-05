import { describe, expect, it } from 'vitest'
import {
  checkBoardUrl, checkBookmark, checkPinId, checkUsername, clampLimit, mapBoards, mapPin, mapPins,
  mapSuggestions, mapUser, nextBookmark, pinOutliers, resourceGetScript, type PinSummary,
} from './pinterestBridge'

const rawPin = (id: string, saves: number | null, extra: Record<string, unknown> = {}) => ({
  type: 'pin', id, title: `t${id}`, description: 'd', link: 'https://example.com', repin_count: 3, comment_count: 1,
  created_at: 'Mon, 01 Sep 2026 10:00:00 +0000',
  images: { '236x': { url: 'https://i.pinimg.com/236x/a.jpg' }, orig: { url: 'https://i.pinimg.com/originals/a.jpg' } },
  aggregated_pin_data: { aggregated_stats: saves === null ? {} : { saves } },
  pinner: { username: 'maker' }, board: { name: 'Ideas', url: '/maker/ideas/' }, ...extra,
})

describe('pinterest input checks', () => {
  it('accepts usernames with or without @ and rejects paths', () => {
    expect(checkUsername('@pinterest')).toBe('pinterest')
    expect(() => checkUsername('../etc')).toThrow(/invalid pinterest username/)
    expect(() => checkUsername('a/b')).toThrow()
  })

  it('takes a pin id from digits or a pin URL only', () => {
    expect(checkPinId('424605071145711021')).toBe('424605071145711021')
    expect(checkPinId('https://www.pinterest.com/pin/424605071145711021/')).toBe('424605071145711021')
    expect(() => checkPinId('../x')).toThrow(/invalid pin id/)
  })

  it('normalises board URLs and refuses pin URLs or bare names', () => {
    expect(checkBoardUrl('https://www.pinterest.com/pinterest/girls-night-in/')).toBe('/pinterest/girls-night-in/')
    expect(checkBoardUrl('pinterest/girls-night-in')).toBe('/pinterest/girls-night-in/')
    expect(() => checkBoardUrl('/pin/123/')).toThrow()
    expect(() => checkBoardUrl('pinterest')).toThrow()
  })

  it('passes bookmarks through and refuses anything that is not one', () => {
    expect(checkBookmark(undefined)).toBeNull()
    expect(checkBookmark('LT40MjQ2fDEwfA==')).toBe('LT40MjQ2fDEwfA==')
    expect(() => checkBookmark('a"b')).toThrow(/invalid bookmark/)
    expect(() => checkBookmark('x'.repeat(2001))).toThrow()
  })

  it('clamps page size and treats -end- as the last page', () => {
    expect(clampLimit(undefined)).toBe(25)
    expect(clampLimit(500)).toBe(50)
    expect(clampLimit(0)).toBe(1)
    expect(nextBookmark('-end-')).toBeNull()
    expect(nextBookmark('abc')).toBe('abc')
  })
})

describe('pinterest page script', () => {
  it('sends the headers the web app sends and embeds options as data', () => {
    const s = resourceGetScript({ resource: 'PinResource', options: { id: '1' }, sourceUrl: '/pin/1/', handler: 'www/pin/[id].js' })
    expect(s).toContain("'X-Pinterest-PWS-Handler': call.handler")
    expect(s).toContain("'X-App-Version': appVersion")
    expect(s).toContain('"resource":"PinResource"')
    expect(() => new Function(`return ${s}`)).not.toThrow()
  })
})

describe('pinterest mapping', () => {
  it('maps a pin with saves from aggregated stats and the largest image', () => {
    const p = mapPin(rawPin('9', 48))
    expect(p).toMatchObject({ id: '9', saves: 48, repins: 3, image: 'https://i.pinimg.com/originals/a.jpg', pinner: 'maker', url: 'https://www.pinterest.com/pin/9/' })
    expect(p?.board).toEqual({ name: 'Ideas', url: '/maker/ideas/' })
  })

  it('falls back to repins when saves are missing and skips non-pins', () => {
    expect(mapPin(rawPin('9', null))?.saves).toBe(3)
    expect(mapPins([{ type: 'story', id: 's' }, rawPin('1', 1)]).map(p => p.id)).toEqual(['1'])
    expect(mapPins({ results: [rawPin('2', 2)] })).toHaveLength(1)
    expect(mapPins(null)).toEqual([])
  })

  it('maps boards, users and suggestions', () => {
    expect(mapBoards([{ type: 'board', id: '5', name: 'B', url: '/u/b/', pin_count: 3, owner: { username: 'u' } }])[0])
      .toMatchObject({ id: '5', url: 'https://www.pinterest.com/u/b/', pinCount: 3, owner: 'u' })
    expect(mapUser({ type: 'user', username: 'u', follower_count: 10, is_private_profile: false })).toMatchObject({ username: 'u', followers: 10, url: 'https://www.pinterest.com/u/' })
    expect(mapUser({ type: 'board' })).toBeNull()
    expect(mapSuggestions({ items: [{ query: 'minimal logo', type: 'query' }, { label: '' }] })).toEqual([{ query: 'minimal logo', type: 'query' }])
  })

  it('finds pins far above the median saves', () => {
    const pins = [1, 2, 2, 3, 30].map((s, i) => mapPin(rawPin(String(i), s)) as PinSummary)
    const out = pinOutliers(pins, 3)
    expect(out.map(p => p.id)).toEqual(['4'])
    expect(out[0].multiplier).toBe(15)
    expect(pinOutliers([], 3)).toEqual([])
  })
})
