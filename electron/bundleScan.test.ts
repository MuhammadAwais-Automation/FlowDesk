import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
const { shortName, versionMarkers } = await import('./bundleScan')

describe('bundleScan', () => {
  it('reads Google boq build labels from page text and script URLs', () => {
    expect(versionMarkers(['https://x/_/a/boq_labs-ai-sandbox-frontend_20261005.07_p0/m=1'], 'bl=boq_labs-ai-sandbox-frontend_20261004.06_p0&'))
      .toEqual(['boq_labs-ai-sandbox-frontend_20261004.06_p0', 'boq_labs-ai-sandbox-frontend_20261005.07_p0'])
  })
  it('names a script by host and path only', () => {
    expect(shortName('https://s.pinimg.com/webapp/41822-d6f2.mjs?x=1')).toBe('s.pinimg.com/webapp/41822-d6f2.mjs')
  })
})
