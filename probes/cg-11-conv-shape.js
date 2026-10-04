// @target chatgpt.com
// @timeout 30000
const s = await fetch('/api/auth/session').then(r => r.json())
const h = { Authorization: 'Bearer ' + s.accessToken }
const list = await fetch('/backend-api/conversations?offset=0&limit=8&order=updated', { headers: h }).then(r => r.json())
const conv = await fetch('/backend-api/conversation/' + list.items[0].id, { headers: h }).then(r => r.json())
const nodes = Object.values(conv.mapping || {}).filter(n => n.message).map(n => {
  const m = n.message
  const parts = (m.content && m.content.parts || []).map(p => typeof p === 'string' ? { str: p.slice(0, 160) } : { ct: p.content_type, ap: p.asset_pointer, w: p.width, h: p.height, meta: p.metadata ? Object.keys(p.metadata) : null, gen: p.metadata && p.metadata.generation ? JSON.stringify(p.metadata.generation).slice(0, 300) : null })
  return { id: m.id, parent: n.parent, role: m.author.role, name: m.author.name, recipient: m.recipient, ctype: m.content.content_type, status: m.status, end_turn: m.end_turn, parts, metaKeys: Object.keys(m.metadata || {}).slice(0, 40), attachments: (m.metadata && m.metadata.attachments || []).map(a => ({ id: a.id, name: a.name, mime: a.mime_type })) }
})
return { title: conv.title, current: conv.current_node, keys: Object.keys(conv), nodes }
