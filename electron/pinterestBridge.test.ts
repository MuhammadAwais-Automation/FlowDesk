import { describe, expect, it } from 'vitest'
import {
  checkBoardName, checkBoardUrl, checkBookmark, checkCountry, checkLink, checkPinId, checkPublishAt, checkTitle, checkTrendType,
  checkUsername, clampLimit, createPinScript, mapAudience, mapBoards, mapConversations, mapMe, mapPin, mapPins, mapScheduledPins,
  mapSuggestions, mapTrends, mapUser, matchTrends, nextBookmark, nicheReport, pinOutliers, resourceGetScript, resourcePostScript,
  type PinSummary,
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

describe('pinterest signed-in reads (shapes from probes/pin-40..42)', () => {
  const trend = (term: string, n: number) => ({
    term, normalizedCount: n, seasonality_score: 0.5, affinity: null,
    wow_change: { roundedPercentChange: 6, rank: 2 }, mom_change: { roundedPercentChange: 300, rank: 1 }, yoy_change: { roundedPercentChange: 10001, rank: 4 },
  })

  it('maps trend terms with their changes', () => {
    const t = mapTrends({ date: '2026-09-30', values: [trend('fall nails', 100), { term: '' }] })
    expect(t.date).toBe('2026-09-30')
    expect(t.terms).toEqual([{ term: 'fall nails', volume: 100, weekChange: 6, monthChange: 300, yearChange: 10001, seasonality: 0.5 }])
    expect(mapTrends(null)).toEqual({ date: null, terms: [] })
  })

  it('validates country and trend type before any request', () => {
    expect(checkCountry(undefined)).toBe('US')
    expect(checkCountry('gb')).toBe('GB')
    expect(() => checkCountry('USA')).toThrow(/two-letter/)
    expect(checkTrendType(undefined)).toBe('monthly')
    expect(checkTrendType('seasonal')).toBe('seasonal')
    expect(() => checkTrendType('daily')).toThrow(/invalid trend type/)
  })

  it('matches only trend terms holding every niche word', () => {
    const lists = { monthly: mapTrends({ values: [trend('minimal logo ideas', 40), trend('fall aesthetic', 90), trend('logo', 10)] }).terms }
    expect(matchTrends('minimal logo', lists).map(t => t.term)).toEqual(['minimal logo ideas'])
  })

  it('maps the own profile, audience and conversations', () => {
    expect(mapMe({ id: '9', username: 'shop', is_partner: true, follower_count: 3, pin_count: 4, board_count: 2 }))
      .toEqual({ id: '9', username: 'shop', isBusiness: true, followers: 3, pins: 4, boards: 2 })
    expect(mapMe({})).toBeNull()
    const aud = mapAudience([{
      ages: { '25-34': 0.4, '18-24': 0.3 }, genders: { FEMALE: 0.6 }, devices: { IPHONE: 0.5 },
      categories: [{ name: 'art', id: '1', value: 0.2 }, { name: 'design', id: '2', value: 0.5 }],
      metros: [{ name: 'Example City', id: '3', value: 0.1 }], countries: [],
      interestsMap: { design: [{ name: 'logo design', value: 0.3, interestId: '5', href: '/x' }] },
      pinnerCount: { value: 1000, sizeIsUpperBound: false }, targetAudienceScope: 'pinterest', targetAudienceType: 'impression_plus_engagement',
    }])
    expect(aud?.categories.map(c => c.name)).toEqual(['design', 'art'])
    expect(aud?.topInterests).toEqual([{ category: 'design', name: 'logo design', value: 0.3 }])
    expect(aud?.size).toBe(1000)
    expect(mapAudience([])).toBeNull()
    expect(mapConversations([{
      type: 'conversation', id: 'c1', unread: 2, users: [{ username: 'me' }, { username: 'buyer' }],
      last_message: { text: 'hi', sender: { username: 'buyer' }, created_at: 'Mon, 05 Oct 2026' },
    }, { type: 'other', id: 'x' }])).toEqual([{ id: 'c1', unread: 2, with: ['me', 'buyer'], lastMessage: { text: 'hi', from: 'buyer', at: 'Mon, 05 Oct 2026' } }])
  })

  it('rolls searched pins into a niche report without double counting', () => {
    const pins = mapPins([
      rawPin('1', 100, { link: 'https://www.shop.example.com/a', title: 'Minimal logo design', pinner: { username: 'ann' } }),
      rawPin('1', 100),
      rawPin('2', 10, { link: null, pinner: { username: 'bob' } }),
      rawPin('3', 12, { pinner: { username: 'ann' } }),
    ])
    const r = nicheReport(pins)
    expect(r.pinsScanned).toBe(3)
    expect(r.medianSaves).toBe(12)
    expect(r.topPins[0].id).toBe('1')
    expect(r.outliers.map(p => p.id)).toEqual(['1'])
    expect(r.topCreators[0]).toEqual({ username: 'ann', pins: 2, saves: 112 })
    expect(r.topDomains.map(d => d.domain).sort()).toEqual(['example.com', 'shop.example.com'])
    expect(r.topWords.find(w => w.word === 'logo')).toEqual({ word: 'logo', pins: 1 })
    expect(nicheReport([]).medianSaves).toBeNull()
  })
})

describe('pinterest writes (wire format from the 2026-10-05 capture)', () => {
  // The page scripts must at least parse; a syntax error would only show up live.
  const parses = (script: string) => expect(() => new Function(`return ${script}`)).not.toThrow()

  it('posts a form body with source_url, data and the csrf header', () => {
    const s = resourcePostScript({ resource: 'BoardResource', action: 'create', options: { name: 'x', privacy: 'secret' }, sourceUrl: '/me/_saved/', handler: 'www/[username]/_saved.js' })
    parses(s)
    expect(s).toContain("'/resource/' + c.resource + '/' + c.action + '/'")
    expect(s).toContain("'X-CSRFToken': csrf")
    expect(s).toContain('"resource":"BoardResource","action":"create"')
  })

  it('builds the pin-builder upload sequence and keeps user text as data', () => {
    const s = createPinScript({ boardId: '1', title: '"); alert(1); ("', description: '', link: '', altText: '', publishAt: null, image: { base64: 'AA==', mime: 'image/png', name: 'a.png' } })
    parses(s)
    for (const step of ['/v3/media/uploads/register/batch/', '/v3/media/uploads/', '/v3/storypins/', '/v3/scheduledpins/']) expect(s).toContain(step)
    expect(s).not.toContain('alert(1); ("\n')
  })

  it('validates write input before any request', () => {
    expect(checkBoardName('  Logos ')).toBe('Logos')
    expect(() => checkBoardName('')).toThrow(/empty/)
    expect(() => checkBoardName('x'.repeat(51))).toThrow(/longer than 50/)
    expect(() => checkTitle('', true)).toThrow(/title is empty/)
    expect(checkLink('https://shop.example.com/a')).toBe('https://shop.example.com/a')
    expect(checkLink(undefined)).toBe('')
    expect(() => checkLink('javascript:alert(1)')).toThrow(/http/)
    const now = Date.parse('2026-10-05T12:00:00Z')
    expect(checkPublishAt('2026-10-06T12:00:00Z', now)).toBe(Date.parse('2026-10-06T12:00:00Z') / 1000)
    expect(() => checkPublishAt('2026-10-05T12:05:00Z', now)).toThrow(/15 minutes/)
    expect(() => checkPublishAt('soon', now)).toThrow(/ISO date/)
  })

  it('maps scheduled pins', () => {
    expect(mapScheduledPins([{ id: '39', title: 'Logo pack', description: 'd', link: '', board: { name: 'Logos' }, scheduled_ts: 1791270000 }, { title: 'no id' }]))
      .toEqual([{ id: '39', title: 'Logo pack', description: 'd', link: null, board: 'Logos', publishAt: new Date(1791270000 * 1000).toISOString() }])
  })
})
