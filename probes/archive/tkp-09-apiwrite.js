// @target tiktok.com
// @goto https://www.tiktok.com/@alphapaws6
// @timeout 60000
const readBio = async () => { const r = await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true', { credentials: 'include' }); return (await r.json()).userExtra?.profileBio }
const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')
const app = JSON.parse(el.textContent).__DEFAULT_SCOPE__['webapp.app-context']
const base = { aid: '1988', app_name: 'tiktok_web', device_platform: 'web_pc', region: app.region || '', priority_region: app.region || '', odinId: app.odinId || '', user_is_login: 'true', app_language: 'en', from_page: 'user' }
async function update(fields) {
  const qs = new URLSearchParams(base).toString()
  let url = location.origin + '/api/update/profile/?' + qs
  try { const s = window.byted_acrawler.frontierSign(url); if (s && s['X-Bogus']) url += '&X-Bogus=' + encodeURIComponent(s['X-Bogus']) } catch {}
  const body = new URLSearchParams(fields).toString()
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded', 'tt-csrf-token': app.csrfToken || '' }, body })
  const t = await r.text()
  return { status: r.status, body: t.slice(0, 1500) }
}
const original = await readBio()
const w1 = await update({ signature: 'FlowDesk bio test 1' })
await new Promise(r => setTimeout(r, 1500))
const after1 = await readBio()
let w2 = null, after2 = null
if (after1 !== original) { w2 = await update({ signature: original }); await new Promise(r => setTimeout(r, 1500)); after2 = await readBio() }
return { original, w1, after1, w2, after2, revertedExact: after2 === original || after1 === original }
