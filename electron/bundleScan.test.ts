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

describe('endpointsIn', () => {
  it('finds API paths, same-site urls and GraphQL operations, skips assets and other sites', async () => {
    const { endpointsIn } = await import('./bundleScan')
    const js = `fetch("/api/v2/listings/{id}");x="https://www.etsy.com/api/v3/shops";y="https://evil.com/api/x";z="/static/app.js";w="/w/api.php";q=\`query ShopListings($id: ID) {\``
    const r = endpointsIn(js, 'www.etsy.com')
    expect(r.endpoints).toEqual(['/api/v2/listings/{id}', '/w/api.php', 'https://www.etsy.com/api/v3/shops'])
    expect(r.operations).toEqual(['ShopListings'])
  })
})
