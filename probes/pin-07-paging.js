// @target pinterest.com
// @timeout 90000
// Read-only: board pins, bookmark paging, typeahead item shape.
const appVersion = (document.documentElement.innerHTML.match(/"appVersion"\s*:\s*"([0-9a-f]{6,})"/) || [])[1] || ''
async function get(resource, options, sourceUrl, handler) {
  const q = new URLSearchParams({ source_url: sourceUrl, data: JSON.stringify({ options, context: {} }), _: String(Date.now()) })
  const r = await fetch(`/resource/${resource}/get/?${q}`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01', 'X-App-Version': appVersion, 'X-Pinterest-AppState': 'active', 'X-Pinterest-Source-Url': sourceUrl, 'X-Pinterest-PWS-Handler': handler } })
  const j = await r.json().catch(() => null)
  return { status: r.status, rr: j?.resource_response, bookmarkInResource: j?.resource?.options?.bookmarks }
}
const out = {}
const b = await get('BoardsFeedResource', { username: 'pinterest', field_set_key: 'profile_grid_item', sort: 'last_pinned_to', filter_stories: false, page_size: 5 }, '/pinterest/', 'www/[username].js')
const own = (b.rr?.data || []).find(x => x.owner?.username === 'pinterest') || b.rr?.data?.[0]
out.boardsBookmark = b.rr?.bookmark ? b.rr.bookmark.slice(0, 12) + '…' : null
out.board = own ? { id: own.id, url: own.url, pin_count: own.pin_count, owner: own.owner?.username } : null
if (own) {
  const bf = await get('BoardFeedResource', { board_id: own.id, board_url: own.url, page_size: 5, field_set_key: 'react_grid_pin', filter_section_pins: true, layout: 'default', redux_normalize_feed: true, sort: 'default' }, own.url, 'www/[username]/[slug].js')
  out.boardFeed = { status: bf.status, code: bf.rr?.code, n: bf.rr?.data?.length, types: [...new Set((bf.rr?.data || []).map(x => x.type))], bookmark: !!bf.rr?.bookmark }
}
const p1 = await get('UserActivityPinsResource', { username: 'pinterest', field_set_key: 'grid_item', is_own_profile_pins: false, page_size: 5 }, '/pinterest/_created/', 'www/[username]/_created.js')
const bm = p1.rr?.bookmark
out.page1 = { n: p1.rr?.data?.length, ids: (p1.rr?.data || []).map(x => x.id), bookmark: bm ? 'yes' : null }
if (bm) {
  const p2 = await get('UserActivityPinsResource', { username: 'pinterest', field_set_key: 'grid_item', is_own_profile_pins: false, page_size: 5, bookmarks: [bm] }, '/pinterest/_created/', 'www/[username]/_created.js')
  out.page2 = { status: p2.status, code: p2.rr?.code, n: p2.rr?.data?.length, overlap: (p2.rr?.data || []).filter(x => out.page1.ids.includes(x.id)).length }
}
const t = await get('AdvancedTypeaheadResource', { term: 'minimal', pin_scope: 'pins', count: 5 }, '/', 'www/index.js')
const items = t.rr?.data?.items || []
out.typeahead = { n: items.length, first: items[0] ? Object.keys(items[0]) : null, firstQuery: items[0]?.query ?? items[0]?.label ?? null }
const bad = await get('UserResource', { username: 'zz-no-such-user-xq9', field_set_key: 'profile' }, '/zz-no-such-user-xq9/', 'www/[username].js')
out.badUser = { status: bad.status, code: bad.rr?.code, msg: bad.rr?.message }
const badPin = await get('PinResource', { id: '1', field_set_key: 'detailed' }, '/pin/1/', 'www/pin/[id].js')
out.badPin = { status: badPin.status, code: badPin.rr?.code, msg: badPin.rr?.message }
return out
