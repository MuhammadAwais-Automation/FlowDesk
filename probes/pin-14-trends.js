// @target pinterest.com
// @goto https://trends.pinterest.com/
// @timeout 90000
// Read-only: which /resource/ calls this page makes (names, method, option keys) and new Resource names in its JS.
await new Promise(r => setTimeout(r, 8000))
const ent = performance.getEntriesByType('resource').map(e => e.name)
const calls = {}
for (const n of ent.filter(n => n.includes('/resource/') || n.includes('/_/graphql') || n.includes('/v3/') || n.includes('api.pinterest.com'))) {
  let u; try { u = new URL(n) } catch { continue }
  let opts = null; try { const d = u.searchParams.get('data'); opts = d ? Object.keys(JSON.parse(d).options || {}) : null } catch {}
  const k = u.host + u.pathname
  if (!calls[k]) calls[k] = opts
}
const names = new Set()
for (const s of ent.filter(n => /\.js(\?|$)/.test(n) && /pinimg|pinterest/.test(n)).slice(0, 150)) {
  try { const t = await (await fetch(s)).text(); for (const m of t.matchAll(/["'`]([A-Z][A-Za-z0-9]{2,60}Resource)["'`]/g)) names.add(m[1]) } catch {}
}
return { url: location.pathname, title: document.title, calls, jsResources: [...names].sort() }
