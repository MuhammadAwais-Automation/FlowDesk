// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 40000
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
      var want = "🐾 9 lives, 0 losses.\n🥊 UFC Champ | Gym Bro\n🚨 Follow to see what's next👇"
      var res = await h.post('/api/update/profile/', {
        headers: { 'tt-csrf-token': h.csrfToken },
        body: 'signature=' + encodeURIComponent(want) + '&tt_csrf_token=' + encodeURIComponent(h.csrfToken),
      })
      if (!res || res.status_code !== 0) return { ok: false, error: 'profile update not confirmed', status_code: res && res.status_code, status_msg: res && res.status_msg }
      // Eventually consistent: poll until the bio reads back.
      for (var i = 0; i < 8; i++) {
        await new Promise(function (r) { setTimeout(r, 1500) })
        var j = await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true&_=' + Date.now(), { credentials: 'include', cache: 'no-store' }).then(function (r) { return r.json() }).catch(function () { return null })
        if (j && j.userExtra && j.userExtra.profileBio === want) return { ok: true, updated: true, via: 'api', bio: want }
      }
      return { ok: false, error: 'TikTok accepted the update (status_code 0) but the new bio did not read back within 12s' }
    } catch (e) {
      return { ok: false, error: e instanceof Response ? 'profile update failed: HTTP ' + e.status : String(e && e.message || e) }
    }
  })()