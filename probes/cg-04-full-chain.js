// @target chatgpt.com
// End-to-end: asset pointer -> download_url -> ACTUAL IMAGE BYTES.
// This is the exact chain resolveAndSaveChatGptImage must perform.
function short(s, n) { return String(s == null ? '' : s).slice(0, n || 300) }
const out = {}

let tok = null
try {
  const r = await fetch('/api/auth/session', { credentials: 'include' })
  const j = await r.json()
  tok = j && j.accessToken
  out.who = { status: r.status, email: j && j.user && j.user.email, hasToken: !!tok }
} catch (e) { out.who = { error: String(e) } }
if (!tok) { out.fatal = 'no accessToken from /api/auth/session'; return out }
const H = { Authorization: 'Bearer ' + tok }

// find newest image
let convId = null, fileId = null
try {
  const list = await (await fetch('/backend-api/conversations?offset=0&limit=10&order=updated', { credentials: 'include', headers: H })).json()
  for (const item of (list.items || [])) {
    const cRes = await fetch('/backend-api/conversation/' + item.id, { credentials: 'include', headers: H })
    if (!cRes.ok) continue
    const m = JSON.stringify(await cRes.json()).match(/sediment:\/\/(file_[a-z0-9]+)/i)
    if (m) { convId = item.id; fileId = m[1]; out.found = { convId, title: item.title, fileId }; break }
  }
} catch (e) { out.findError = String(e) }
if (!fileId) { out.fatal = 'no image found'; return out }

// step 1: metadata
let downloadUrl = null
try {
  const q = 'conversation_id=' + encodeURIComponent(convId) + '&inline=false&download_intent=false'
  const r = await fetch('/backend-api/files/download/' + fileId + '?' + q, { credentials: 'include', headers: H })
  const j = await r.json()
  downloadUrl = j.download_url
  out.step1 = { status: r.status, hasDownloadUrl: !!downloadUrl, fileName: j.file_name, fileSize: j.file_size_bytes }
} catch (e) { out.step1 = { error: String(e) } }
if (!downloadUrl) { out.fatal = 'no download_url'; return out }

// step 2: the actual bytes — WITH token
try {
  const r = await fetch(downloadUrl, { credentials: 'include', headers: H })
  const ct = r.headers.get('content-type') || ''
  if (ct.indexOf('image/') === 0) {
    const b = await r.blob()
    out.step2_withToken = { status: r.status, contentType: ct, bytes: b.size, OK: true }
  } else {
    out.step2_withToken = { status: r.status, contentType: ct, body: short(await r.text().catch(function(){return ''}), 300) }
  }
} catch (e) { out.step2_withToken = { error: String(e) } }

// step 2b: the actual bytes — cookies only (is the token even needed here?)
try {
  const r = await fetch(downloadUrl, { credentials: 'include' })
  const ct = r.headers.get('content-type') || ''
  if (ct.indexOf('image/') === 0) {
    const b = await r.blob()
    out.step2_cookiesOnly = { status: r.status, contentType: ct, bytes: b.size, OK: true }
  } else {
    out.step2_cookiesOnly = { status: r.status, contentType: ct, body: short(await r.text().catch(function(){return ''}), 300) }
  }
} catch (e) { out.step2_cookiesOnly = { error: String(e) } }

return out
