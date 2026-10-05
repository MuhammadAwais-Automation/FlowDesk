// @target pinterest.com
// @goto https://trends.pinterest.com/?country=US
// @timeout 90000
// Read-only: give the page time to load its data so the CDP recorder sees it.
await new Promise(r => setTimeout(r, 20000))
window.scrollBy(0, 2500)
await new Promise(r => setTimeout(r, 5000))
return { path: location.pathname, host: location.host, text: (document.body.innerText || '').replace(/\d/g, '#').slice(0, 300) }
