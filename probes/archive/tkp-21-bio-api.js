// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 60000
let req = null
window.__LOADABLE_LOADED_CHUNKS__.push([[Symbol('fdb2')], {}, r => { req = r }])
const id = Object.keys(req.m).find(k => { try { const s = req.m[k].toString(); return s.includes('"/api/update/profile/","/api/commit/follow/user","/api/comment/publish"') && /\.d\(t,\{h:/.test(s) } catch (e) { return false } })
const h = req(id).h
const read = async () => (await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true', { credentials: 'include' }).then(r => r.json())).userExtra.profileBio
const set = async bio => { try { const r = await h.post('/api/update/profile/', { headers: { 'tt-csrf-token': h.csrfToken }, body: 'signature=' + encodeURIComponent(bio) + '&tt_csrf_token=' + encodeURIComponent(h.csrfToken) }); return { status_code: r && r.status_code, sig: r && r.user && r.user.signature } } catch (e) { return { threw: e instanceof Response ? e.status : String(e) } } }
const original = await read()
const same = await set(original)
const variant = original.replace(/👇$/, '!')
const changed = await set(variant)
const afterChange = await read()
const reverted = await set(original)
const afterRevert = await read()
return { same, changed: { ...changed, sig: undefined }, changeApplied: afterChange === variant, variantDiffers: variant !== original, reverted: { ...reverted, sig: undefined }, restored: afterRevert === original }
