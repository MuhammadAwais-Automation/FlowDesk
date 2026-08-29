import { describe, expect, it, beforeEach } from 'vitest'
import {
  recordProviderUsage, getProviderUsage, getAllProviderUsage,
  clearProviderUsage, formatUsage,
} from './providerUsage'

beforeEach(() => clearProviderUsage())

const NOW = 1_800_000_000_000

describe('recording and reading back', () => {
  it('returns null for a provider that has not answered yet', () => {
    // The distinction that matters: "not measured" must never be reported as
    // "no quota left", or the agent would refuse work the account can do.
    expect(getProviderUsage('chatgpt')).toBeNull()
  })

  it('keeps only the latest snapshot per provider', () => {
    recordProviderUsage('chatgpt', [{ feature: 'image_gen', remaining: 5, resetAfter: 'x' }], NOW)
    recordProviderUsage('chatgpt', [{ feature: 'image_gen', remaining: 2, resetAfter: 'y' }], NOW + 1000)
    const snap = getProviderUsage('chatgpt')
    expect(snap?.limits).toEqual([{ feature: 'image_gen', remaining: 2, resetAfter: 'y' }])
    expect(snap?.capturedAt).toBe(NOW + 1000)
  })

  it('lists every provider, newest first', () => {
    recordProviderUsage('chatgpt', [{ feature: 'a', remaining: 1, resetAfter: 'x' }], NOW)
    recordProviderUsage('gemini', [{ feature: 'b', remaining: 3, resetAfter: 'y' }], NOW + 5000)
    expect(getAllProviderUsage().map(s => s.tool)).toEqual(['gemini', 'chatgpt'])
  })
})

describe('formatUsage', () => {
  it('reports a real ChatGPT limits_progress snapshot', () => {
    // Shape confirmed against a live conversation_detail_metadata event.
    const text = formatUsage({
      tool: 'chatgpt',
      capturedAt: NOW - 30_000,
      limits: [{ feature: 'image_gen', remaining: 3, resetAfter: '2026-08-28T10:00:00Z' }],
    }, NOW)
    expect(text).toContain('chatgpt')
    expect(text).toContain('image_gen: 3 remaining')
    expect(text).toContain('2026-08-28T10:00:00Z')
    expect(text).toContain('30s ago')
  })

  it('says so explicitly when a provider reported no limits, rather than implying zero', () => {
    const text = formatUsage({ tool: 'chatgpt', capturedAt: NOW, limits: [] }, NOW)
    expect(text).toContain('no quota limits reported')
    expect(text).not.toContain('0 remaining')
  })

  it('renders Claude rolling windows as percentages', () => {
    const text = formatUsage({
      tool: 'claude',
      capturedAt: NOW,
      limits: [{ window: 'five_hour', status: 'ok', utilization: 0.42, resetsAt: null }],
    }, NOW)
    expect(text).toContain('five_hour: 42% used (ok)')
  })

  it('renders Qwen token counts', () => {
    const text = formatUsage({
      tool: 'qwen',
      capturedAt: NOW,
      limits: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }, NOW)
    expect(text).toContain('30 total')
  })

  it('describes age in minutes and hours as it grows', () => {
    const base = { tool: 'chatgpt', limits: [] as never[] }
    expect(formatUsage({ ...base, capturedAt: NOW - 300_000 }, NOW)).toContain('5m ago')
    expect(formatUsage({ ...base, capturedAt: NOW - 7_200_000 }, NOW)).toContain('2h ago')
  })
})
