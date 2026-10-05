// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 40000
// Read-only: key/type shape of listInfo.items[0] (no values).
await new Promise(r => setTimeout(r, 4000))
const el = document.querySelector('[data-e2e="explore-item-list"]').children[0]
let f = el[Object.keys(el).find(k => k.startsWith('__reactFiber'))]
for (let i = 0; f && i < 11; i++) f = f.return
const l = f.memoizedProps.listInfo
const t = v => Array.isArray(v) ? 'array(' + v.length + ')' : v === null ? 'null' : typeof v
const keysOf = o => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).slice(0, 60).map(([k, v]) => [k, t(v)])) : t(o)
const it = l.items[0]
return {
  items: l.items.length, list: l.list.length,
  idsMatch: l.items.filter(x => l.list.includes(String(x.id))).length,
  item: keysOf(it), author: keysOf(it.author), stats: keysOf(it.stats), statsV2: keysOf(it.statsV2), video: keysOf(it.video), music: keysOf(it.music),
  preload: keysOf(l.preloadList[0]),
}
