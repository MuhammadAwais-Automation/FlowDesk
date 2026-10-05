// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 40000
// Read-only: shape of the explore grid cards and the item_list request.
await new Promise(r => setTimeout(r, 4000))
const list = document.querySelector('[data-e2e="explore-item-list"]')
const kids = list ? Array.from(list.children) : []
const first = kids[0]
const strip = h => h.replace(/>[^<]{1,}</g, '>#<').replace(/(src|href|srcset|poster)="[^"]*"/g, '$1="…"')
const req = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/api/explore/item_list/'))
const u = req.length ? new URL(req[req.length - 1]) : null
return {
  childCount: kids.length,
  firstShape: first ? strip(first.outerHTML).slice(0, 1500) : null,
  firstText: first ? first.innerText.split('\n').map(s => s.length) : null,
  hrefs: first ? Array.from(first.querySelectorAll('[href]')).map(a => a.getAttribute('href').replace(/\d{6,}/g, 'ID').replace(/@[^/]+/, '@U')) : null,
  reactKeys: first ? Object.keys(first).filter(k => k.startsWith('__react')) : null,
  itemListParams: u ? [...u.searchParams.keys()] : null,
}
