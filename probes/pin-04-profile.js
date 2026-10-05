// @target pinterest.com
// @goto https://www.pinterest.com/pinterest/
// @timeout 60000
// Read-only: resources behind a public profile page; re-fetch each GET to see its shape.
await new Promise(r => setTimeout(r, 7000))
const res = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/resource/') && n.includes('/get/')))]
const out = []
for (const n of res.slice(0, 10)) {
  const x = new URL(n)
  let data = null; try { data = JSON.parse(x.searchParams.get('data')) } catch {}
  let shape = null
  try {
    const r = await fetch(n, { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, credentials: 'include' })
    const j = await r.json()
    const rd = j?.resource_response?.data
    const arr = Array.isArray(rd) ? rd : rd?.results
    const first = Array.isArray(arr) ? arr[0] : rd
    shape = { status: r.status, isArray: Array.isArray(rd), n: Array.isArray(arr) ? arr.length : null, firstType: first?.type,
      firstKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 70) : null, bookmark: j?.resource_response?.bookmark ? 'yes' : 'no' }
  } catch (e) { shape = { err: String(e) } }
  out.push({ path: x.pathname, options: data?.options, shape })
}
const pins = document.querySelectorAll('[data-test-id="pin"], [data-grid-item="true"]').length
const pws = JSON.parse(document.getElementById('__PWS_INITIAL_PROPS__')?.textContent || '{}')
const rs = pws?.initialReduxState || {}
return { pinsOnPage: pins, reduxKeys: Object.keys(rs), reduxCounts: Object.fromEntries(Object.entries(rs).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k, Object.keys(v).length])), out }
