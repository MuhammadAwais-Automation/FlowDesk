// @target tiktok.com
// @goto https://www.tiktok.com/tag/ai
// @timeout 45000

await new Promise(r => setTimeout(r, 4000))

const out = {}
out.url = location.href
out.title = document.title

// Check video cards on tag page
const cards = Array.from(document.querySelectorAll('[data-e2e="challenge-item"], [data-e2e*="video"], a[href*="/video/"]')).map(el => {
  const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href')
  const views = el.querySelector('[data-e2e*="views"], [data-e2e*="count"], strong')?.textContent?.trim()
  return { href, views }
}).filter(c => c.href && c.href.includes('/video/'))

out.cardCount = cards.length
out.sampleCards = cards.slice(0, 5)

// Check header stats on tag page
const h1 = document.querySelector('h1')?.textContent?.trim()
const viewCountEl = Array.from(document.querySelectorAll('h2, h3, h4, span, div')).find(el => {
  const t = el.textContent?.trim() || ''
  return t.includes('views') || t.includes('videos')
})?.textContent?.trim()

out.tagHeader = {
  title: h1,
  statsText: viewCountEl
}

return out
