// @target chatgpt.com
// Full survey of ChatGPT's backend-api auth + conversation + file endpoints,
// run inside the real logged-in page. Goal: find how to fetch image BYTES.

function short(s, n) { return String(s == null ? '' : s).slice(0, n || 300) }

const out = { href: location.href, cookieNames: document.cookie.split(';').map(c => c.split('=')[0].trim()) }

// 1. Who am I / is there a bearer token?
try {
  const r = await fetch('/api/auth/session', { credentials: 'include' })
  const j = await r.json()
  out.session = {
    status: r.status,
    email: j && j.user && j.user.email,
    hasAccessToken: !!(j && j.accessToken),
    accessTokenPrefix: j && j.accessToken ? short(j.accessToken, 24) : null,
    expires: j && j.expires,
  }
  window.__fdToken = j && j.accessToken
} catch (e) { out.session = { error: String(e) } }

const tok = window.__fdToken
const authHeaders = tok ? { Authorization: 'Bearer ' + tok } : {}

// 2. Latest conversation list — proves backend-api works at all with this auth
try {
  const r = await fetch('/backend-api/conversations?offset=0&limit=3&order=updated', {
    credentials: 'include', headers: authHeaders,
  })
  const body = await r.text()
  out.conversationsList = { status: r.status, body: short(body, 600) }
  try {
    const j = JSON.parse(body)
    out.latestConvIds = (j.items || []).map(i => ({ id: i.id, title: i.title }))
  } catch (e) {}
} catch (e) { out.conversationsList = { error: String(e) } }

return out
