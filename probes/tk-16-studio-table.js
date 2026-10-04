// @target tiktok.com
/**
 * tk-16-studio-table.js
 * Inspects TikTok Studio content table items and post status after rendering.
 */
const textBlocks = Array.from(document.querySelectorAll('div, span, p'))
  .map(el => el.textContent.trim())
  .filter(t => t.length > 5 && t.length < 150)

// Find any links containing video
const videoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]')).map(a => a.href)

// Find any card or post elements
const cards = Array.from(document.querySelectorAll('[class*="item"], [class*="card"], [class*="row"], [class*="post"]'))
  .map(el => el.innerText.replace(/\n+/g, ' | ').trim())
  .filter(t => t.includes('Views') || t.includes('Likes') || t.includes('Everyone') || t.includes('Alpha Paws') || t.includes('video') || t.includes('Cat') || t.includes('Slap'))

return {
  url: window.location.href,
  videoLinks,
  matchingCards: cards.slice(0, 10),
  sampleText: textBlocks.slice(20, 50),
}
