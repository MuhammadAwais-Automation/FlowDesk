// @target tab:social-pinterest
// @timeout 60000
// r2
// Read-only: are a scheduled pin and the FlowDesk Test board still there? Titles of test items only.
const html = document.documentElement.innerHTML
const appVersion = (html.match(/"appVersion"\s*:\s*"([0-9a-f]{6,})"/) || [])[1] || ''
async function get(resource, options) {
  const q = new URLSearchParams({ source_url: '/business/hub/', data: JSON.stringify({ options, context: {} }), _: String(Date.now()) })
  const r = await fetch('/resource/' + resource + '/get/?' + q, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01', 'X-App-Version': appVersion, 'X-Pinterest-AppState': 'active', 'X-Pinterest-Source-Url': '/business/hub/', 'X-Pinterest-PWS-Handler': 'www/business/hub.js' } })
  try { const j = (await r.json()).resource_response; return { status: r.status, code: j.code, message: j.message, data: j.data } } catch { return { status: r.status } }
}
const me = (await get('ApiResource', { url: '/v3/users/me/', data: { fields: 'user.id,user.username' } })).data
const sched = await get('ScheduledPinsResource', { field_set_key: 'default' })
const boards = await get('BoardsResource', { username: me.username, page_size: 25, privacy_filter: 'all', sort: 'last_pinned_to' })
const pins = await get('UserPinsResource', { username: me.username, page_size: 25, field_set_key: 'grid_item' })
const t = p => ({ id: p.id, title: (p.title || p.grid_title || '').slice(0, 40), board: p.board && p.board.name, scheduled: p.scheduled_ts || null })
return {
  scheduled: { status: sched.status, code: sched.code, msg: sched.message, n: Array.isArray(sched.data) ? sched.data.length : typeof sched.data, items: Array.isArray(sched.data) ? sched.data.slice(0, 5).map(t) : null },
  boards: Array.isArray(boards.data) ? boards.data.map(b => ({ name: b.name, privacy: b.privacy, pins: b.pin_count })) : boards,
  myPins: Array.isArray(pins.data) ? pins.data.slice(0, 10).map(t) : { status: pins.status, code: pins.code },
}
