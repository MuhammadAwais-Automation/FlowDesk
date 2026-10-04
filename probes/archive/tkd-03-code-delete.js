// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 30000
return await (async function () {
    
  function tiktokClient() {
    var req = null
    window.__LOADABLE_LOADED_CHUNKS__.push([[Symbol('fd')], {}, function (r) { req = r }])
    if (!req) return null
    var id = Object.keys(req.m).find(function (k) {
      try { var s = req.m[k].toString(); return s.indexOf('"/api/update/profile/","/api/commit/follow/user","/api/comment/publish"') >= 0 && /\.d\(t,\{h:/.test(s) } catch (e) { return false }
    })
    return id ? req(id).h : null
  }

    try {
      var h = tiktokClient()
      if (!h) return { ok: false, error: 'TikTok page client not found — is a www.tiktok.com page loaded?' }
      var res = await h.post('/api/aweme/delete/', { query: { aweme_id: "7690329947239501078", tt_csrf_token: h.csrfToken }, headers: { 'tt-csrf-token': h.csrfToken } })
      if (!res || res.status_code !== 0) return { ok: false, error: 'delete not confirmed', status_code: res && res.status_code, status_msg: res && res.status_msg }
      return { ok: true, deleted: true, via: 'api', itemId: "7690329947239501078" }
    } catch (e) {
      return { ok: false, error: e instanceof Response ? 'delete request failed: HTTP ' + e.status : String(e && e.message || e) }
    }
  })()