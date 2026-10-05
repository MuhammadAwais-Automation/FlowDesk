// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 40000
// Read-only: is the explore card data reachable from React props?
await new Promise(r => setTimeout(r, 4000))
const list = document.querySelector('[data-e2e="explore-item-list"]')
const kids = list ? Array.from(list.children) : []
const shape = o => o && typeof o === 'object' ? Object.keys(o).slice(0, 40) : typeof o
const out = []
for (const el of kids.slice(0, 2)) {
  const fk = Object.keys(el).find(k => k.startsWith('__reactFiber'))
  let f = fk ? el[fk] : null
  const hops = []
  for (let i = 0; f && i < 12; i++, f = f.return) {
    const p = f.memoizedProps || {}
    const hit = Object.keys(p).find(k => p[k] && typeof p[k] === 'object' && ('id' in p[k]) && ('author' in p[k] || 'stats' in p[k] || 'video' in p[k]))
    hops.push({ i, propKeys: Object.keys(p).slice(0, 15), hit: hit || null, hitShape: hit ? shape(p[hit]) : null })
    if (hit) break
  }
  out.push(hops)
}
return { count: kids.length, out }
