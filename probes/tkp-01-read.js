// @target tiktok.com
// @goto https://www.tiktok.com/@alphapaws6
// @timeout 60000
const u = window.__UNIVERSAL_DATA_FOR_REHYDRATION__ || JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || '{}')
const ds = u.__DEFAULT_SCOPE__ || {}
const app = ds['webapp.app-context'] || {}
const ud = ds['webapp.user-detail'] || {}
const me = app.user || {}
let api = null
try {
  const r = await fetch('/api/user/detail/?aid=1988&uniqueId=' + encodeURIComponent(me.uniqueId || 'alphapaws6'), { credentials: 'include' })
  const t = await r.text(); api = { status: r.status, len: t.length, body: t.slice(0, 3000) }
} catch (e) { api = String(e) }
const btns = [...document.querySelectorAll('button,[role=button]')].map(b => (b.getAttribute('data-e2e')||'') + '|' + (b.textContent||'').trim().slice(0,30)).filter(s => /edit|profile/i.test(s))
return { url: location.href, appUser: { uid: me.uid, uniqueId: me.uniqueId, nickName: me.nickName, secUid: me.secUid, signature: me.signature }, udUser: ud.userInfo ? { user: ud.userInfo.user, stats: ud.userInfo.stats } : null, api, btns, hasSign: !!window.byted_acrawler?.frontierSign }
