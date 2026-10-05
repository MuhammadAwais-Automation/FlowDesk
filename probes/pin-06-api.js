// @target pinterest.com
// @goto https://www.pinterest.com/pinterest/
// @timeout 90000
// Read-only: replay page-shaped GETs against several resources and record response shapes.
await new Promise(r => setTimeout(r, 5000))
const html = document.documentElement.innerHTML
const appVersion = (html.match(/"appVersion"\s*:\s*"([0-9a-f]{6,})"/) || html.match(/app_version["']?\s*[:=]\s*["']([0-9a-f]{6,})/) || [])[1] || null
async function get(resource, options, sourceUrl, handler) {
  const q = new URLSearchParams({ source_url: sourceUrl, data: JSON.stringify({ options, context: {} }), _: String(Date.now()) })
  const r = await fetch(`/resource/${resource}/get/?${q}`, { credentials: 'include', headers: {
    'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01',
    'X-App-Version': appVersion || '', 'X-Pinterest-AppState': 'active', 'X-Pinterest-Source-Url': sourceUrl, 'X-Pinterest-PWS-Handler': handler } })
  const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {}
  const d = j?.resource_response?.data
  const arr = Array.isArray(d) ? d : d?.results
  const first = Array.isArray(arr) ? arr.find(x => x && x.type !== 'story') || arr[0] : d
  return { status: r.status, text: j ? undefined : t.slice(0, 60), code: j?.resource_response?.code, msg: j?.resource_response?.message, n: Array.isArray(arr) ? arr.length : null,
    bookmark: !!j?.resource_response?.bookmark, firstType: first?.type, keys: first && typeof first === 'object' ? Object.keys(first).slice(0, 90) : null,
    sub: first && typeof first === 'object' ? Object.fromEntries(['images', 'pinner', 'board', 'owner', 'aggregated_pin_data', 'rich_summary', 'videos', 'story_pin_data'].filter(k => first[k] && typeof first[k] === 'object').map(k => [k, Object.keys(first[k]).slice(0, 30)])) : null,
    pinId: first?.type === 'pin' ? first.id : undefined, boardUrl: first?.type === 'board' ? first.url : undefined }
}
const out = { appVersion }
out.user = await get('UserResource', { username: 'pinterest', field_set_key: 'profile' }, '/pinterest/', 'www/[username].js')
out.boards = await get('BoardsFeedResource', { username: 'pinterest', field_set_key: 'profile_grid_item', sort: 'last_pinned_to', filter_stories: false, page_size: 10 }, '/pinterest/', 'www/[username].js')
out.userPins = await get('UserActivityPinsResource', { username: 'pinterest', field_set_key: 'grid_item', is_own_profile_pins: false }, '/pinterest/_created/', 'www/[username]/_created.js')
const pinId = out.userPins.pinId
if (pinId) {
  out.pin = await get('PinResource', { id: pinId, field_set_key: 'detailed' }, `/pin/${pinId}/`, 'www/pin/[id].js')
  out.related = await get('RelatedModulesResource', { pin_id: pinId, context_pin_ids: [], search_query: '', source: 'deep_linking', top_level_source: 'deep_linking', top_level_source_depth: 1, is_pdp: false }, `/pin/${pinId}/`, 'www/pin/[id].js')
}
const bu = out.boards.boardUrl
if (bu) out.boardMeta = await get('BoardResource', { slug: bu.split('/').filter(Boolean)[1], username: 'pinterest', field_set_key: 'detailed' }, bu, 'www/[username]/[slug].js')
out.search = await get('BaseSearchResource', { query: 'minimalist logo', scope: 'pins', page_size: 10, rs: 'typed', source_url: '/search/pins/?q=minimalist%20logo&rs=typed' }, '/search/pins/?q=minimalist%20logo&rs=typed', 'www/search/[scope].js')
out.typeahead = await get('AdvancedTypeaheadResource', { term: 'minimal', pin_scope: 'pins', count: 5 }, '/', 'www/index.js')
return out
