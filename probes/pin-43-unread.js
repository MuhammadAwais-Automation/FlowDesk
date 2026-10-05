// @target pinterest.com
// @goto https://www.pinterest.com/business/hub/
// @timeout 90000
// Read-only GETs of the endpoints captured on the business hub. Returns shapes,
// counts and public trend terms only — no personal data.
await new Promise(r => setTimeout(r, 6000))
const html = document.documentElement.innerHTML
const appVersion = (html.match(/"appVersion"\s*:\s*"([0-9a-f]{6,})"/) || [])[1] || ''
async function get(resource, options, sourceUrl = '/business/hub/', handler = 'www/business/hub.js') {
  const q = new URLSearchParams({ source_url: sourceUrl, data: JSON.stringify({ options, context: {} }), _: String(Date.now()) })
  const r = await fetch('/resource/' + resource + '/get/?' + q, { credentials: 'include', headers: {
    'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01',
    'X-App-Version': appVersion, 'X-Pinterest-AppState': 'active',
    'X-Pinterest-Source-Url': sourceUrl, 'X-Pinterest-PWS-Handler': handler } })
  const t = await r.text()
  try { const j = JSON.parse(t).resource_response || {}; return { status: r.status, code: j.code, message: j.message, data: j.data, bookmark: j.bookmark } } catch { return { status: r.status, text: t.slice(0, 120) } }
}
const keys = v => Array.isArray(v) ? ['[' + v.length + ']', ...(v[0] && typeof v[0] === 'object' ? Object.keys(v[0]).slice(0, 40) : [])] : v && typeof v === 'object' ? Object.keys(v).slice(0, 60) : typeof v
const me = await get('ApiResource', { url: '/v3/users/me/', data: { fields: 'user.id' } })
const i = await get('ApiResource', { url: '/v3/interactions/users/' + me.data.id + '/', data: { page_size: 10 } })
return { code: i.code, unreadType: typeof (i.data && i.data.unread), unread: i.data && i.data.unread, results: i.data && Array.isArray(i.data.results) ? i.data.results.length : typeof (i.data && i.data.results) }
