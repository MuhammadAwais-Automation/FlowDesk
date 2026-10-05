// @target pinterest.com
// @goto https://www.pinterest.com/search/pins/?q=minimalist%20logo
// @timeout 60000
// Read-only: which GET resource serves search results; re-fetch it to see the response shape.
await new Promise(r => setTimeout(r, 7000))
const res = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/resource/') && n.includes('Search'))
const out = []
for (const n of res.slice(0, 6)) {
  const x = new URL(n)
  let data = null; try { data = JSON.parse(x.searchParams.get('data')) } catch {}
  let shape = null
  try {
    const r = await fetch(n, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01', 'X-Pinterest-PWS-Handler': 'www/search/[scope].js' }, credentials: 'include' })
    const j = await r.json()
    const rd = j?.resource_response?.data
    const results = rd?.results || (Array.isArray(rd) ? rd : null)
    const first = results?.find(p => p?.type === 'pin') || results?.[0]
    shape = { status: r.status, dataKeys: rd && typeof rd === 'object' ? Object.keys(rd).slice(0, 20) : typeof rd, nResults: results?.length ?? null,
      bookmark: !!(j?.resource?.options?.bookmarks?.[0] || j?.resource_response?.bookmark),
      firstType: first?.type, firstKeys: first ? Object.keys(first).slice(0, 80) : null,
      imagesKeys: first?.images ? Object.keys(first.images) : null,
      pinnerKeys: first?.pinner ? Object.keys(first.pinner).slice(0, 30) : null,
      boardKeys: first?.board ? Object.keys(first.board).slice(0, 30) : null }
  } catch (e) { shape = { err: String(e) } }
  out.push({ path: x.pathname, sourceUrl: x.searchParams.get('source_url'), options: data?.options, context: data?.context, shape })
}
return { n: res.length, out }
