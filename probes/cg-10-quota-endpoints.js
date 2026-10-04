// @target chatgpt.com
// @timeout 30000
const s = await fetch('/api/auth/session').then(r => r.json())
const h = { Authorization: 'Bearer ' + s.accessToken, 'Content-Type': 'application/json' }
const out = {}
async function t(name, url, opts) {
  try {
    const r = await fetch(url, { credentials: 'include', ...opts, headers: { ...h, ...(opts && opts.headers) } })
    const txt = await r.text()
    out[name] = { status: r.status, body: txt.slice(0, 1500) }
  } catch (e) { out[name] = { err: String(e) } }
}
await t('init', '/backend-api/conversation/init', { method: 'POST', body: JSON.stringify({ gizmo_id: null, requested_default_model: null, conversation_id: null, timezone_offset_min: new Date().getTimezoneOffset() }) })
await t('models', '/backend-api/models?history_and_training_disabled=false')
await t('me', '/backend-api/me')
await t('limits', '/backend-api/limits')
return out
