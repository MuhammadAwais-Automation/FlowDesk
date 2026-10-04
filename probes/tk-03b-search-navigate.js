// @target tiktok.com
// Timestamp: 2026-09-20 09:40
try {
  // If already on search page, extract cards
  const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
  const cards = []

  for (const a of videoLinks) {
    const card = a.closest('[class*="Card"], [class*="Container"], [class*="Item"], [data-e2e*="search"]') || a.parentElement
    const href = a.href
    const match = href.match(/@([^/]+)\/video\/(\d+)/)
    const author = match ? match[1] : null
    const videoId = match ? match[2] : null
    const textLines = card ? card.innerText.split('\n').map(t => t.trim()).filter(Boolean) : []
    const img = card ? card.querySelector('img') : null

    cards.push({
      author,
      videoId,
      url: href,
      textLines,
      coverImg: img ? img.src : null,
    })
  }

  return {
    url: window.location.href,
    count: cards.length,
    cards: cards.slice(0, 10),
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
