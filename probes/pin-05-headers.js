// @target pinterest.com
// @goto https://www.pinterest.com/pinterest/_created/
// @timeout 60000
// Read-only: record the request headers the page itself sends to /resource/ (scroll triggers paging GETs).
await new Promise(r => setTimeout(r, 5000))
const seen = []
const oOpen = XMLHttpRequest.prototype.open, oSet = XMLHttpRequest.prototype.setRequestHeader, oSend = XMLHttpRequest.prototype.send
XMLHttpRequest.prototype.open = function (m, u) { this.__p = { m, u: String(u), h: {} }; return oOpen.apply(this, arguments) }
XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__p) this.__p.h[k] = /csrf/i.test(k) ? '<csrf>' : v; return oSet.apply(this, arguments) }
XMLHttpRequest.prototype.send = function () { if (this.__p && this.__p.u.includes('/resource/')) seen.push(this.__p); return oSend.apply(this, arguments) }
const oFetch = window.fetch
window.fetch = function (i, init) { const u = String(i?.url || i); if (u.includes('/resource/')) { const h = {}; new Headers(init?.headers || i?.headers || {}).forEach((v, k) => { h[k] = /csrf/i.test(k) ? '<csrf>' : v }); seen.push({ m: init?.method || 'GET', u, h, via: 'fetch' }) } return oFetch.apply(this, arguments) }
for (let i = 0; i < 6; i++) { window.scrollBy(0, 2500); await new Promise(r => setTimeout(r, 1500)) }
XMLHttpRequest.prototype.open = oOpen; XMLHttpRequest.prototype.setRequestHeader = oSet; XMLHttpRequest.prototype.send = oSend; window.fetch = oFetch
return seen.slice(0, 8).map(s => ({ m: s.m, via: s.via || 'xhr', path: new URL(s.u, location.href).pathname, h: s.h }))
