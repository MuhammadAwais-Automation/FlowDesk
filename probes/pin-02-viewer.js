// @target pinterest.com
// @goto https://www.pinterest.com/
// @timeout 45000
// Read-only: who is the viewer (field names only) and which resources load the home feed.
await new Promise(r => setTimeout(r, 6000))
const d = JSON.parse(document.getElementById('__PWS_INITIAL_PROPS__')?.textContent || document.getElementById('__PWS_DATA__')?.textContent || '{}')
const users = d?.initialReduxState?.users || {}
const u = Object.values(users)[0] || null
const res = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/resource/'))
const calls = res.map(n => { const x = new URL(n); const data = x.searchParams.get('data'); let opts = null; try { opts = data ? Object.keys(JSON.parse(data).options || {}) : null } catch {} return { path: x.pathname, params: [...x.searchParams.keys()], optionKeys: opts } })
const pins = document.querySelectorAll('[data-test-id="pin"], [data-grid-item="true"]').length
return {
  title: document.title,
  isLanding: !!document.querySelector('[data-test-id="unauth-home"], [data-test-id="simple-login-button"], [data-test-id="login-button"]'),
  userFields: u ? Object.keys(u).slice(0, 60) : null,
  hasUsername: !!(u && u.username),
  pinsOnPage: pins,
  calls: calls.slice(0, 40),
}
