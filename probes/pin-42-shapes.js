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
const K = v => v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, Array.isArray(x) ? 'arr' + x.length : x && typeof x === 'object' ? Object.keys(x).slice(0, 12) : typeof x])) : typeof v
const me = await get('ApiResource', { url: '/v3/users/me/', data: { fields: 'user.id,user.username' } })
const aud = await get('AudienceInsightsDataResource', { business_id: me.data.id, audience_business_id: '0', audience_type: 'NC_IMPRESSION_PLUS_ENGAGEMENT_30d', audience_id: '0', advertiser_id: '0', should_return_comparison_audience: false, is_comparison_tab: false })
const a = aud.data[0]
out.cat = K(a.categories[0]); out.metro = K(a.metros[0]); out.im = K(a.interestsMap['design']); out.ageType = typeof a.ages['25-34']; out.scope = [a.targetAudienceScope, a.targetAudienceType]
out.catSample = { name: a.categories[0].name, keys: Object.keys(a.categories[0]) }
const conv = await get('ConversationsResource', { field_set_key: 'default' })
const c = conv.data[0]
out.user = Object.keys(c.users[0]); out.sender = c.last_message.sender && Object.keys(c.last_message.sender); out.type = c.type; out.lmType = c.last_message.type
const tr = await get('ApiResource', { url: '/v3/trends/top/search_query/', data: { country: 'GB', end_date: '2026-09-30', num_terms_to_return: 3, trends_preset: 1 } })
out.gb = { status: tr.status, code: tr.code, n: tr.data && tr.data.values && tr.data.values.length }
const ca = await get('ApiResource', { url: '/v3/trends/top/search_query/', data: { country: 'PK', end_date: '2026-09-30', num_terms_to_return: 3, trends_preset: 1 } })
out.pkRaw = { status: ca.status, code: ca.code, message: ca.message, text: ca.text }
return out
