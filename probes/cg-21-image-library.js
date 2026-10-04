// @target chatgpt.com
// @timeout 60000
// Read-only: real shape of the image library and chat search items (strings truncated).
const s = await fetch('/api/auth/session').then(r => r.json())
const h = { Authorization: 'Bearer ' + s.accessToken }
const cut = v => Array.isArray(v) ? v.slice(0, 2).map(cut) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)])) : typeof v === 'string' ? v.slice(0, 90) : v
const get = async u => { const r = await fetch(u, { headers: h }); return { status: r.status, json: await r.json().catch(() => null) } }
const lib = await get('/backend-api/my/recent/image_gen?limit=3')
const page2 = await get('/backend-api/my/recent/image_gen?limit=3&after=' + encodeURIComponent((lib.json && lib.json.cursor) || ''))
const search = await get('/backend-api/conversations/search?query=pong&limit=2')
return { libTop: cut({ ...lib.json, items: undefined }), libItem: cut(lib.json && lib.json.items && lib.json.items[0]), page2Status: page2.status, page2Keys: page2.json && Object.keys(page2.json), searchTop: cut({ ...search.json, items: undefined }), searchItem: cut(search.json && search.json.items && search.json.items[0]) }
