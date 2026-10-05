// @target pinterest.com
// @goto https://www.pinterest.com/
// @timeout 120000
// Read-only: every /resource/<Name>/ the web app's own JS knows about (catalog), plus who is signed in (shape only).
await new Promise(r => setTimeout(r, 6000))
const scripts = [...new Set([...document.scripts].map(s => s.src).filter(Boolean)
  .concat(performance.getEntriesByType('resource').map(e => e.name).filter(n => /\.js(\?|$)/.test(n))))]
  .filter(u => /pinimg\.com|pinterest\.com/.test(u))
const names = new Map()
let scanned = 0
for (const u of scripts.slice(0, 120)) {
  try {
    const t = await (await fetch(u)).text(); scanned++
    for (const m of t.matchAll(/["'`]([A-Z][A-Za-z0-9]{2,60}Resource)["'`]/g)) names.set(m[1], (names.get(m[1]) || 0) + 1)
  } catch {}
}
const d = JSON.parse(document.getElementById('__PWS_INITIAL_PROPS__')?.textContent || '{}')
const viewer = d?.initialReduxState?.users ? Object.values(d.initialReduxState.users).find(u => u && u.username) : null
return { scripts: scripts.length, scanned, count: names.size, viewerHasUsername: !!viewer, viewerFields: viewer ? Object.keys(viewer).length : 0, resources: [...names.keys()].sort() }
// rerun 1791197246
// rerun2 1791197405
