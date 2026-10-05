// @target tab:social-pinterest
// @timeout 60000
// Read-only: open own profile, list buttons / aria-labels (no personal data).
const html = document.documentElement.innerHTML
const appVersion = (html.match(/"appVersion"\s*:\s*"([0-9a-f]{6,})"/) || [])[1] || ''
const q = new URLSearchParams({ source_url: '/business/hub/', data: JSON.stringify({ options: { url: '/v3/users/me/', data: { fields: 'user.username' } }, context: {} }), _: String(Date.now()) })
const r = await fetch('/resource/ApiResource/get/?' + q, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*, q=0.01', 'X-App-Version': appVersion, 'X-Pinterest-AppState': 'active', 'X-Pinterest-Source-Url': '/business/hub/', 'X-Pinterest-PWS-Handler': 'www/business/hub.js' } })
const me = (await r.json()).resource_response.data.username
location.href = '/' + me + '/_saved/'
return { navigating: true }
