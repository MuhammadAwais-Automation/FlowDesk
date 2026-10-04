// @target chatgpt.com
// @timeout 30000
// Read-only: shape of GET /backend-api/conversation/{id}/stream_status for a chat whose
// answer never started (model rejected) and for a finished chat.
const s = await fetch('/api/auth/session').then(r => r.json())
const h = { Authorization: 'Bearer ' + s.accessToken }
const get = async id => { const r = await fetch('/backend-api/conversation/' + id + '/stream_status', { headers: h }); return { status: r.status, body: (await r.text()).slice(0, 600) } }
return {
  stuck: await get('6ac1eef7-1f78-83ee-b27c-b895875a6805'),
  finished: await get('6ac1d1ce-8544-83ee-8bc4-677d41b23f28'),
}
