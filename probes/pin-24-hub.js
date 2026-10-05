// @target pinterest.com
// @goto https://www.pinterest.com/business/hub/
// @timeout 60000
// Read-only: open the page and let the CDP recorder see its traffic; scroll once to load more.
await new Promise(r => setTimeout(r, 7000))
window.scrollBy(0, 3000)
await new Promise(r => setTimeout(r, 4000))
return { path: location.pathname, host: location.host, title: document.title }
// r 1791197606864530400
