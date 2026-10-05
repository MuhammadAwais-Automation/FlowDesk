// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 40000
// Read-only: shape of itemList / detailInfo on the explore grid (no values).
await new Promise(r => setTimeout(r, 4000))
const el = document.querySelector('[data-e2e="explore-item-list"]').children[0]
let f = el[Object.keys(el).find(k => k.startsWith('__reactFiber'))]
const hops = []
for (let i = 0; f && i < 12; i++, f = f.return) hops.push(f.memoizedProps || {})
const t = v => Array.isArray(v) ? 'array(' + v.length + ')<' + (v.length ? typeof v[0] : '') + '>' : v === null ? 'null' : typeof v
const keysOf = o => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).slice(0, 40).map(([k, v]) => [k, t(v)])) : t(o)
const il = hops[9].itemList
const d = hops[11].detailInfo, l = hops[11].listInfo
const firstId = Array.isArray(il) ? il[0] : null
const sample = d && typeof d === 'object' ? (d[firstId] || Object.values(d)[0]) : null
return {
  itemList: t(il), firstIsId: typeof firstId === 'string' && /^\d+$/.test(firstId),
  listInfo: keysOf(l), detailInfo: t(d), detailInfoKeysAreIds: d ? Object.keys(d).slice(0, 3).every(k => /^\d+$/.test(k)) : null,
  sample: keysOf(sample), sampleAuthor: keysOf(sample && sample.author), sampleStats: keysOf(sample && (sample.stats || sample.statsV2)),
  sampleVideo: keysOf(sample && sample.video),
}
