// @target chatgpt.com
// Structure of an image-generation turn: which message carries the tool-call
// args JSON that leaked into captured text, and how it differs from both the
// real answer and the image message. Decides the correct filter.
function short(s, n) { return String(s == null ? '' : s).slice(0, n || 200) }
const out = {}
let tok = null
try { const j = await (await fetch('/api/auth/session', { credentials: 'include' })).json(); tok = j.accessToken } catch (e) {}
const H = { Authorization: 'Bearer ' + tok }

const list = await (await fetch('/backend-api/conversations?offset=0&limit=8&order=updated', { credentials: 'include', headers: H })).json()
for (const item of (list.items || [])) {
  const r = await fetch('/backend-api/conversation/' + item.id, { credentials: 'include', headers: H })
  if (!r.ok) continue
  const conv = await r.json()
  const raw = JSON.stringify(conv)
  if (raw.indexOf('image_asset_pointer') === -1) continue

  out.conversation = { id: item.id, title: item.title }
  out.messages = Object.keys(conv.mapping || {})
    .map(function (k) { return conv.mapping[k].message })
    .filter(Boolean)
    .map(function (m) {
      const parts = (m.content && m.content.parts) || []
      return {
        role: m.author && m.author.role,
        authorName: m.author && m.author.name,
        recipient: m.recipient,
        channel: m.channel,
        contentType: m.content && m.content.content_type,
        partTypes: parts.map(function (p) { return typeof p === 'string' ? 'string' : (p && p.content_type) }),
        preview: parts.map(function (p) { return typeof p === 'string' ? short(p, 120) : short((p && p.asset_pointer) || '', 60) }),
      }
    })
  break
}
if (!out.messages) out.note = 'no image conversation found'
return out
