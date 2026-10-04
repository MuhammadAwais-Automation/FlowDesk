// @target tiktok.com
// @goto https://www.tiktok.com/@alphapaws6
// @timeout 60000
await new Promise(r => setTimeout(r, 4000))
const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')
let u = {}; try { u = JSON.parse(el?.textContent || '{}') } catch {}
const ds = u.__DEFAULT_SCOPE__ || {}
const app = ds['webapp.app-context'] || {}
const ud = ds['webapp.user-detail'] || {}
const out = { url: location.href, dsKeys: Object.keys(ds), appKeys: Object.keys(app), appUser: app.user, udStatus: ud.statusCode, udUser: ud.userInfo }
async function j(url) { try { const r = await fetch(url, { credentials: 'include' }); const t = await r.text(); return { s: r.status, body: t.slice(0, 2500) } } catch (e) { return String(e) } }
out.passport = await j('/passport/web/account/info/?aid=1988')
const signed = async (url) => { try { const s = window.byted_acrawler.frontierSign(url.split('?')[1] ? { url } : { url }); return s } catch (e) { return String(e) } }
out.signTry = await signed('https://www.tiktok.com/api/user/detail/?aid=1988&uniqueId=alphapaws6')
out.dom = { edit: [...document.querySelectorAll('[data-e2e]')].map(e => e.getAttribute('data-e2e')).filter(x => /edit|user|follow|like|bio|title/i.test(x)).slice(0, 40) }
return out
