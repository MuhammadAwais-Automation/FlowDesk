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
const date = await get('ApiResource', { url: '/v3/trends/latest_available_date/', data: {} })
out.date = { status: date.status, code: date.code, data: date.data }
const end = (date.data && date.data.date) || ''
for (const preset of [1, 2, 3, 4]) {
  const t = await get('ApiResource', { url: '/v3/trends/top/search_query/', data: { country: 'US', end_date: end, num_terms_to_return: 10, trends_preset: preset } })
  const d = t.data
  out['trends' + preset] = { status: t.status, code: t.code, msg: t.message, keys: keys(d), first: Array.isArray(d) ? d.slice(0, 3) : d && typeof d === 'object' ? Object.fromEntries(Object.entries(d).slice(0, 3).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 2) : v])) : d }
}
const me = await get('ApiResource', { url: '/v3/users/me/', data: { fields: 'user.id,user.username,user.is_partner,user.follower_count,user.pin_count,user.board_count' } })
out.me = { status: me.status, code: me.code, keys: keys(me.data) }
const meUser = (me.data && me.data.username) || ''
const meId = (me.data && me.data.id) || ''
const inter = await get('ApiResource', { url: '/v3/interactions/users/' + meId + '/', data: { page_size: 10 } })
out.interactions = { status: inter.status, code: inter.code, keys: keys(inter.data), resultKeys: inter.data && keys(inter.data.results) }
const conv = await get('ConversationsResource', { field_set_key: 'default' })
out.conversations = { status: conv.status, code: conv.code, keys: keys(conv.data) }
const badge = await get('NewsHubBadgeResource', {})
out.badge = { status: badge.status, code: badge.code, data: badge.data }
const news = await get('NewsHubDetailsResource', {})
out.news = { status: news.status, code: news.code, msg: news.message, keys: keys(news.data) }
const boards = await get('BoardsResource', { page_size: 5, privacy_filter: 'all', sort: 'last_pinned_to', username: meUser })
out.boards = { status: boards.status, code: boards.code, keys: keys(boards.data) }
const aud = await get('AudienceInsightsDataResource', { business_id: meId, audience_business_id: '0', audience_type: 'NC_IMPRESSION_PLUS_ENGAGEMENT_30d', audience_id: '0', advertiser_id: '0', should_return_comparison_audience: false, is_comparison_tab: false })
out.audience = { status: aud.status, code: aud.code, msg: aud.message, keys: keys(aud.data), sub: aud.data && typeof aud.data === 'object' ? Object.fromEntries(Object.entries(aud.data).slice(0, 12).map(([k, v]) => [k, keys(v)])) : null }
return out
