// @target chatgpt.com
// @timeout 60000
// Read-only (GET only) survey of ChatGPT backend features that have no button on the page.
const s = await fetch('/api/auth/session').then(r => r.json())
const h = { Authorization: 'Bearer ' + s.accessToken }
const out = {}
const shape = (v, d = 0) => {
  if (Array.isArray(v)) return { array: v.length, first: v.length && d < 2 ? shape(v[0], d + 1) : undefined }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, d < 2 ? shape(x, d + 1) : typeof x]))
  return typeof v
}
async function t(name, url) {
  try {
    const r = await fetch(url, { credentials: 'include', headers: h })
    const txt = await r.text()
    let j = null
    try { j = JSON.parse(txt) } catch {}
    out[name] = { status: r.status, shape: j ? shape(j) : undefined, text: j ? undefined : txt.slice(0, 200) }
  } catch (e) { out[name] = { err: String(e) } }
}
await t('recent_image_gen', '/backend-api/my/recent/image_gen?limit=5')
await t('image_gen_library', '/backend-api/images/library?limit=5')
await t('files', '/backend-api/files?limit=5')
await t('memories', '/backend-api/memories?include_memory_entries=true')
await t('custom_instructions', '/backend-api/user_system_messages')
await t('settings', '/backend-api/settings/user')
await t('accounts_check', '/backend-api/accounts/check/v4-2023-04-27')
await t('projects', '/backend-api/gizmos/snorlax/sidebar?limit=5')
await t('gizmos_pinned', '/backend-api/gizmos/pinned')
await t('shared', '/backend-api/shared_conversations?order=created')
await t('archived', '/backend-api/conversations?offset=0&limit=3&is_archived=true')
await t('starred', '/backend-api/conversations?offset=0&limit=3&is_starred=true')
await t('search', '/backend-api/conversations/search?query=pong&limit=3')
await t('tasks', '/backend-api/tasks')
await t('connectors', '/backend-api/aip/connectors/list_accessible?skip_actions=true')
await t('prompt_library', '/backend-api/prompt_library?limit=3')
await t('suggestions', '/backend-api/experimental/prompt_suggestions')
return out
