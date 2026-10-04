// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 90000
let req = null
window.__LOADABLE_LOADED_CHUNKS__.push([[Symbol('fdb3')], {}, r => { req = r }])
const id = Object.keys(req.m).find(k => { try { const s = req.m[k].toString(); return s.includes('"/api/update/profile/","/api/commit/follow/user","/api/comment/publish"') && /\.d\(t,\{h:/.test(s) } catch (e) { return false } })
const h = req(id).h
const studio = async () => (await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true&_=' + Date.now(), { credentials: 'include', cache: 'no-store' }).then(r => r.json())).userExtra.profileBio
const pub = async () => { const html = await fetch('/@alphapaws6?_=' + Date.now(), { credentials: 'include', cache: 'no-store' }).then(r => r.text()); const m = html.match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/); try { return JSON.parse(m[1]).__DEFAULT_SCOPE__['webapp.user-detail'].userInfo.user.signature } catch (e) { return null } }
const set = async bio => { const r = await h.post('/api/update/profile/', { headers: { 'tt-csrf-token': h.csrfToken }, body: 'signature=' + encodeURIComponent(bio) + '&tt_csrf_token=' + encodeURIComponent(h.csrfToken) }); return { status_code: r && r.status_code, keys: r && Object.keys(r), userSig: r && r.user && r.user.signature } }
const original = await studio()
const variant = original.replace(/👇$/, '!')
const res = await set(variant)
const polls = []
for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 2000)); polls.push({ studio: (await studio()) === variant, pub: (await pub()) === variant }) }
const rev = await set(original)
await new Promise(r => setTimeout(r, 3000))
return { res: { ...res, userSigIsVariant: res.userSig === variant, userSig: undefined }, polls, rev: rev.status_code, restoredStudio: (await studio()) === original, restoredPub: (await pub()) === original }
