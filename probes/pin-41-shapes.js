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
const out = {}
const shape = (v, d = 0) => d > 2 ? typeof v : Array.isArray(v) ? (v.length ? [v.length, shape(v[0], d + 1)] : []) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, shape(x, d + 1)])) : typeof v
const date = await get('ApiResource', { url: '/v3/trends/latest_available_date/', data: {} })
const end = date.data.date
const big = await get('ApiResource', { url: '/v3/trends/top/search_query/', data: { country: 'US', end_date: end, num_terms_to_return: 50, trends_preset: 1 } })
out.big = { code: big.code, n: big.data && big.data.values && big.data.values.length }
const pk = await get('ApiResource', { url: '/v3/trends/top/search_query/', data: { country: 'PK', end_date: end, num_terms_to_return: 5, trends_preset: 2 } })
out.pk = { code: pk.code, msg: pk.message, n: pk.data && pk.data.values && pk.data.values.length }
const me = await get('ApiResource', { url: '/v3/users/me/', data: { fields: 'user.id,user.username' } })
const conv = await get('ConversationsResource', { field_set_key: 'default' })
out.conv = shape(conv.data)
const boards = await get('BoardsResource', { page_size: 5, privacy_filter: 'all', sort: 'last_pinned_to', username: me.data.username, field_set_key: 'detailed' })
out.boards = shape(boards.data)
const aud = await get('AudienceInsightsDataResource', { business_id: me.data.id, audience_business_id: '0', audience_type: 'NC_IMPRESSION_PLUS_ENGAGEMENT_30d', audience_id: '0', advertiser_id: '0', should_return_comparison_audience: false, is_comparison_tab: false })
out.aud = shape(aud.data)
out.audN = aud.data && aud.data[0] && Object.fromEntries(Object.entries(aud.data[0]).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]))
return out
