// @target tiktok.com
// Pass 2: Extract cards from creator search
try {
  const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
  const seen = new Set()
  const videos = []

  for (const a of videoLinks) {
    const href = a.href
    const match = href.match(/@([^/]+)\/video\/(\d+)/)
    if (!match) continue
    const author = match[1]
    const videoId = match[2]
    if (seen.has(videoId)) continue
    seen.add(videoId)

    const card = a.closest('[class*="Card"], [class*="Container"], [class*="Item"], [data-e2e*="search"]') || a.parentElement
    const textLines = card ? card.innerText.split('\n').map(t => t.trim()).filter(Boolean) : []
    const viewLine = textLines.find(l => /^[\d.]+[KMB]?$/i.test(l)) || null

    videos.push({
      author,
      videoId,
      url: href,
      views: viewLine,
      textLines,
    })
  }

  return {
    url: window.location.href,
    count: videos.length,
    videos: videos.slice(0, 10),
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
