// @target tiktok.com
// @timeout 40000
let req = null
window.__LOADABLE_LOADED_CHUNKS__.push([[Symbol('fdd1')], {}, r => { req = r }])
// TikTok's own request client: the module whose protected-path list starts with update/profile.
const id = Object.keys(req.m).find(k => { try { const s = req.m[k].toString(); return s.includes('"/api/update/profile/","/api/commit/follow/user","/api/comment/publish"') && /\.d\(t,\{h:/.test(s) } catch (e) { return false } })
if (!id) return { error: 'client module not found' }
const h = req(id).h
let res = null, err = null
try {
  res = await h.post('/api/aweme/delete/', { query: { aweme_id: '7690329157154393347', tt_csrf_token: h.csrfToken }, headers: { 'tt-csrf-token': h.csrfToken } })
} catch (e) { err = e instanceof Response ? { status: e.status, ct: e.headers.get('content-type') } : String(e) }
return { id, res: res && typeof res === 'object' ? { status_code: res.status_code, status_msg: res.status_msg } : res, err }
