// @target pinterest.com
// @goto https://www.pinterest.com/search/pins/?q=minimal%20logo
// @timeout 60000
// Read-only: open the page and let the CDP recorder see its traffic; scroll once to load more.
await new Promise(r => setTimeout(r, 7000))
window.scrollBy(0, 3000)
await new Promise(r => setTimeout(r, 4000))
return { path: location.pathname, host: location.host, title: document.title }
// r 1791197637509353500
