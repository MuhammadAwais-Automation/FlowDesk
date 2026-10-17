import { describe, expect, it } from 'vitest'
import { channelBaseUrl, encodeSearchParams, median, outlierScore, parseAgo, parseCount, parseLength, viewsPerDay } from './youtubeParse'

describe('parseCount', () => {
  it('reads exact, abbreviated and missing counts', () => {
    expect(parseCount('620,461 views')).toBe(620461)
    expect(parseCount('620K')).toBe(620000)
    expect(parseCount('1.2M views')).toBe(1200000)
    expect(parseCount('9.1B')).toBe(9100000000)
    expect(parseCount('516')).toBe(516)
    expect(parseCount('No views')).toBe(0)
    expect(parseCount('')).toBeNull()
    expect(parseCount('views')).toBeNull()
  })
})

describe('parseAgo', () => {
  it('reads short and long units', () => {
    expect(parseAgo('2d ago')).toBe(2 * 86400)
    expect(parseAgo('1mo ago')).toBe(30 * 86400)
    expect(parseAgo('3 weeks ago')).toBe(21 * 86400)
    expect(parseAgo('Streamed 1 year ago')).toBe(365 * 86400)
    expect(parseAgo('5 hours ago')).toBe(5 * 3600)
    expect(parseAgo('yesterday')).toBeNull()
  })
})

describe('parseLength', () => {
  it('reads m:ss and h:mm:ss', () => {
    expect(parseLength('9:29')).toBe(569)
    expect(parseLength('1:02:03')).toBe(3723)
    expect(parseLength('LIVE')).toBeNull()
  })
})

describe('encodeSearchParams', () => {
  it('matches the values YouTube’s own filter menu uses', () => {
    expect(encodeSearchParams({ type: 'video' })).toBe('EgIQAQ==')
    expect(encodeSearchParams({ type: 'short' })).toBe('EgIQCQ==')
    expect(encodeSearchParams({ uploaded: 'week' })).toBe('EgIIAw==')
    expect(encodeSearchParams({ duration: 'under3' })).toBe('EgIYBA==')
    expect(encodeSearchParams({ duration: 'over20' })).toBe('EgIYAg==')
    expect(encodeSearchParams({ sort: 'popularity' })).toBe('CAM=')
    expect(encodeSearchParams({})).toBeNull()
    expect(encodeSearchParams({ sort: 'relevance' })).toBeNull()
  })

  it('combines sort and filters in one message', () => {
    expect(Buffer.from(encodeSearchParams({ sort: 'popularity', uploaded: 'week', type: 'video' })!, 'base64')).toEqual(Buffer.from([0x08, 3, 0x12, 4, 0x08, 3, 0x10, 1]))
  })
})

describe('outlier arithmetic', () => {
  it('uses the median, not the average', () => {
    expect(median([10, 1000, 20])).toBe(20)
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(median([])).toBeNull()
    expect(outlierScore(500, 100)).toBe(5)
    expect(outlierScore(500, 0)).toBeNull()
    expect(outlierScore(null, 100)).toBeNull()
    expect(viewsPerDay(1000, 10 * 86400)).toBe(100)
    expect(viewsPerDay(1000, 3600)).toBe(1000)
  })
})

describe('channelBaseUrl', () => {
  it('accepts handles, ids and channel links only', () => {
    expect(channelBaseUrl('@superaichannel1')).toBe('https://www.youtube.com/@superaichannel1')
    expect(channelBaseUrl('UCDIJh7oic27YMRHaLMbMJuw')).toBe('https://www.youtube.com/channel/UCDIJh7oic27YMRHaLMbMJuw')
    expect(channelBaseUrl('https://www.youtube.com/@superaichannel1/videos')).toBe('https://www.youtube.com/@superaichannel1')
    expect(channelBaseUrl('https://www.youtube.com/channel/UCDIJh7oic27YMRHaLMbMJuw/shorts')).toBe('https://www.youtube.com/channel/UCDIJh7oic27YMRHaLMbMJuw')
    expect(channelBaseUrl('https://example.com/@x')).toBeNull()
    expect(channelBaseUrl('hello')).toBeNull()
  })
})
