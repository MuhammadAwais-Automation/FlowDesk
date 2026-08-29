// @target chatgpt.com
// Takes the most recent conversation that contains an image_asset_pointer,
// then tries EVERY plausible way to turn that pointer into real bytes.
// Reports exact status + body for each, so nothing is guessed.

function short(s, n) { return String(s == null ? '' : s).slice(0, n || 400) }

const out = {}
let tok = null
try {
  const r = await fetch('/api/auth/session', { credentials: 'include' })
  const j = await r.json()
  tok = j && j.accessToken
  out.who = { status: r.status, email: j && j.user && j.user.email, hasToken: !!tok }
} catch (e) { out.who = { error: String(e) } }
const H = tok ? { Authorization: 'Bearer ' + tok } : {}

// --- find a conversation with an image ---
let convId = null, fileId = null, assetPointer = null
try {
  const listRes = await fetch('/backend-api/conversations?offset=0&limit=10&order=updated', { credentials: 'include', headers: H })
  const list = await listRes.json()
  out.listStatus = listRes.status
  for (const item of (list.items || [])) {
    const cRes = await fetch('/backend-api/conversation/' + item.id, { credentials: 'include', headers: H })
    if (!cRes.ok) continue
    const conv = await cRes.json()
    const raw = JSON.stringify(conv)
    const m = raw.match(/sediment:\/\/(file_[a-z0-9]+)/i) || raw.match(/(file-service:\/\/file[-_][A-Za-z0-9]+)/i)
    if (m) {
      convId = item.id
      assetPointer = m[0]
      fileId = m[1].replace(/^file-service:\/\//, '')
      out.foundIn = { convId, title: item.title, assetPointer, fileId }
      break
    }
  }
} catch (e) { out.findError = String(e) }

if (!fileId) { out.note = 'no image asset pointer found in the 10 most recent conversations'; return out }

// --- try every candidate endpoint ---
const attempts = []
async function tryUrl(label, url, opts) {
  try {
    const r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}))
    const ct = r.headers.get('content-type') || ''
    let body = ''
    if (ct.indexOf('image/') === 0) {
      const b = await r.blob()
      body = '[IMAGE BLOB ' + b.size + ' bytes type=' + b.type + ']'
    } else {
      body = short(await r.text().catch(function () { return '' }), 400)
    }
    attempts.push({ label, url: short(url, 160), status: r.status, contentType: ct, body })
  } catch (e) {
    attempts.push({ label, url: short(url, 160), error: String(e) })
  }
}

const q = 'conversation_id=' + encodeURIComponent(convId) + '&inline=false&download_intent=false'
await tryUrl('files/download + token', '/backend-api/files/download/' + fileId + '?' + q, { headers: H })
await tryUrl('files/download cookies only', '/backend-api/files/download/' + fileId + '?' + q, {})
await tryUrl('files/download no query', '/backend-api/files/download/' + fileId, { headers: H })
await tryUrl('files/{id}/download', '/backend-api/files/' + fileId + '/download?' + q, { headers: H })
await tryUrl('files/{id}', '/backend-api/files/' + fileId, { headers: H })

out.attempts = attempts
out.convId = convId
out.fileId = fileId
return out
