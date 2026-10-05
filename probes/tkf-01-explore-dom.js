// @target tiktok.com
// @goto https://www.tiktok.com/explore
// @timeout 40000
// Read-only: why does tiktok_feed find 0 a[href*="/video/"] on /explore?
await new Promise(r => setTimeout(r, 5000))
const e2e = {}
document.querySelectorAll('[data-e2e]').forEach(el => { const k = el.getAttribute('data-e2e'); e2e[k] = (e2e[k] || 0) + 1 })
const ud = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')
let scopeKeys = null
try { scopeKeys = Object.keys(JSON.parse(ud.textContent).__DEFAULT_SCOPE__ || {}) } catch (e) {}
const item = document.querySelector('[data-e2e="explore-item"]')
return {
  url: location.href,
  videoAnchors: document.querySelectorAll('a[href*="/video/"]').length,
  anyAnchors: document.querySelectorAll('a').length,
  e2e,
  scopeKeys,
  exploreItemHtmlShape: item ? item.outerHTML.replace(/>[^<]+</g, '><').slice(0, 600) : null,
  apiEntries: performance.getEntriesByType('resource').map(e => e.name.split('?')[0]).filter(n => n.includes('/api/')).slice(-25),
}
