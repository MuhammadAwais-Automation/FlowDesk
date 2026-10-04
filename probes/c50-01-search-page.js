// @target tiktok.com
// @goto https://www.tiktok.com/search?q=cat
// @timeout 45000

await new Promise(r => setTimeout(r, 4000))

const out = {}
out.url = location.href
out.title = document.title

// Check tabs and filter buttons in DOM
const tabs = Array.from(document.querySelectorAll('[role="tab"], [data-e2e*="tab"], a[href*="/search/"]')).map(el => ({
  text: el.textContent?.trim(),
  href: el.getAttribute('href'),
  e2e: el.getAttribute('data-e2e'),
  role: el.getAttribute('role'),
  className: el.className
}))
out.tabs = tabs.slice(0, 15)

// Check for filter button / dropdowns
const filterButtons = Array.from(document.querySelectorAll('button, div[role="button"], span')).filter(el => {
  const t = (el.textContent || '').toLowerCase()
  const e2e = (el.getAttribute('data-e2e') || '').toLowerCase()
  return (t.includes('filter') || t.includes('sort') || t.includes('date') || t.includes('relevance') || t.includes('all time') || e2e.includes('filter')) && t.length < 30
}).map(el => ({
  text: el.textContent?.trim(),
  e2e: el.getAttribute('data-e2e'),
  tag: el.tagName
}))
out.filterButtons = filterButtons.slice(0, 15)

// Check if rehydration data exists
let hydrationKeys = []
const script = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__')
if (script) {
  try {
    const raw = JSON.parse(script.textContent || '{}')
    hydrationKeys = Object.keys(raw['__DEFAULT_SCOPE__'] || {})
    out.searchDataSample = Object.keys(raw['__DEFAULT_SCOPE__']?.['webapp.search-detail'] || raw['__DEFAULT_SCOPE__']?.['webapp.search'] || {})
  } catch (e) {
    out.hydrationErr = String(e)
  }
}
out.hydrationKeys = hydrationKeys

return out
