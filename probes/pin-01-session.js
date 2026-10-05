// @target pinterest.com
// @timeout 40000
// Read-only: is this session really signed in, and which resource API calls does the home page make?
await new Promise(r => setTimeout(r, 3000))
const ck = Object.fromEntries(document.cookie.split('; ').map(c => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)] }))
const res = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/resource/') || n.includes('/_ngjs/') || n.includes('/v3/'))
const paths = [...new Set(res.map(n => { const u = new URL(n); return u.pathname }))]
const pws = document.getElementById('__PWS_INITIAL_PROPS__') || document.getElementById('__PWS_DATA__')
let me = null
try {
  const d = JSON.parse(pws.textContent)
  const u = d?.initialReduxState?.users || d?.props?.initialReduxState?.users
  const viewer = d?.context?.user || d?.props?.context?.user
  me = viewer ? { keys: Object.keys(viewer).slice(0, 30), isAuth: viewer.is_auth ?? viewer.isAuth, hasUsername: !!viewer.username } : { pwsKeys: Object.keys(d).slice(0, 20), usersCount: u ? Object.keys(u).length : null }
} catch (e) { me = { err: String(e), pwsId: pws?.id ?? null } }
return {
  url: location.href,
  authCookie: ck._auth ?? null,
  hasCsrf: !!ck.csrftoken,
  cookieNames: Object.keys(ck),
  me,
  resourcePaths: paths.slice(0, 40),
}
