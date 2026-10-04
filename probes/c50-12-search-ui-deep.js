// @target tiktok.com
// @goto https://www.tiktok.com/search?q=cats
// @timeout 30000

await new Promise(r => setTimeout(r, 4000))

const out = {}
out.url = location.href

// Find all buttons, links, and clickable elements near search tabs
const allButtons = Array.from(document.querySelectorAll('button, [role="button"], [data-e2e*="filter"], [data-e2e*="search"], [class*="Filter"], [class*="Sort"]')).map(el => ({
  tag: el.tagName,
  e2e: el.getAttribute('data-e2e'),
  text: el.textContent?.trim().slice(0, 40),
  className: el.className?.slice ? el.className.slice(0, 40) : '',
  ariaLabel: el.getAttribute('aria-label')
}))

out.matchedControls = allButtons.filter(b => {
  const s = (b.text + ' ' + b.e2e + ' ' + b.ariaLabel + ' ' + b.className).toLowerCase()
  return s.includes('filter') || s.includes('sort') || s.includes('date') || s.includes('time') || s.includes('video') || s.includes('tab')
}).slice(0, 20)

// Check navigation tabs: Top, Accounts, Videos
const navTabs = Array.from(document.querySelectorAll('a[href*="/search"]')).map(a => ({
  text: a.textContent?.trim(),
  href: a.getAttribute('href')
}))
out.navTabs = navTabs

// Check if /search/video endpoint or page exists
out.hasVideoTab = navTabs.some(t => t.href?.includes('/search/video'))

return out
