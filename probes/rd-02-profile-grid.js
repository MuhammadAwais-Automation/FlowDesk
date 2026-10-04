// @target tiktok.com
// @goto https://www.tiktok.com/@sr_kittyyyy
// @timeout 45000
await new Promise(r => setTimeout(r, 8000))
const cards = [...document.querySelectorAll('a[href*="/video/"]')]
const seen = new Set()
const items = []
for (const a of cards) {
  const id = (a.href.match(/\/video\/(\d+)/) || [])[1]
  if (!id || seen.has(id)) continue
  seen.add(id)
  const box = a.closest('[data-e2e="user-post-item"]') || a
  const views = (box.querySelector('[data-e2e="video-views"]') || {}).textContent || null
  const created = Number(BigInt(id) >> 32n)
  items.push({ id, views, ageH: +((Date.now() / 1000 - created) / 3600).toFixed(1), pinned: /pinned/i.test(box.textContent) })
}
return { url: location.href, n: items.length, items: items.slice(0, 20) }
