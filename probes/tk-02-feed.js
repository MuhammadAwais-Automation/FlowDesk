// @target tiktok.com
/**
 * tk-02-feed.js
 *
 * Probe 2: TikTok Feed Reverse-Engineering
 * Inspects video items in the current feed (FYP / Explore / Following).
 * Extracts video IDs, view counts, likes, comments, shares, descriptions, and hashtags.
 */

try {
  // Find all cards containing video links
  const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'))
  
  const extracted = []
  for (const a of videoLinks) {
    const card = a.closest('[class*="Card"], [class*="Container"], [class*="Item"]') || a.parentElement
    const href = a.href
    const match = href.match(/@([^/]+)\/video\/(\d+)/)
    const author = match ? match[1] : null
    const videoId = match ? match[2] : null

    // Look for text, views, titles inside card
    const allText = card ? card.innerText.split('\n').map(t => t.trim()).filter(Boolean) : []
    const img = card ? card.querySelector('img') : null

    extracted.push({
      author,
      videoId,
      url: href,
      cardText: allText,
      coverImg: img ? img.src : null,
    })
  }

  return {
    url: window.location.href,
    count: extracted.length,
    videos: extracted.slice(0, 10),
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}


