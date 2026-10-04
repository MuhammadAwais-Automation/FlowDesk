// @target tiktok.com
/**
 * tk-13-profile-content.js
 * Inspects the exact DOM under Videos tab and checks Creator Center upload / content manager.
 */
const main = document.querySelector('main') || document.body
const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
  href: a.href,
  text: a.textContent.trim().slice(0, 50),
}))

const uploadLink = links.find(l => l.href.includes('/upload') || l.href.includes('/creator-center'))
const videoLinks = links.filter(l => l.href.includes('/video/'))

// Also check what text is shown when 0 videos are found (e.g. "Upload your first video" or video is processing)
const emptyStateText = Array.from(document.querySelectorAll('p, div, span'))
  .map(el => el.textContent.trim())
  .filter(t => t.includes('Upload') || t.includes('videos') || t.includes('private') || t.includes('review') || t.includes('No content'))
  .slice(0, 10)

return {
  url: window.location.href,
  uploadLink,
  videoLinks,
  emptyStateText,
}
