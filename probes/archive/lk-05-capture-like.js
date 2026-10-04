// @target linkedin.com

// @timeout 45000
const cap = []
const hdrs = h => { const o = {}; if (!h) return o; if (h instanceof Headers) h.forEach((v, k) => o[k] = v); else if (Array.isArray(h)) h.forEach(([k, v]) => o[k] = v); else Object.assign(o, h); return o }
const of = window.fetch
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input.url
  const rec = { kind: 'fetch', url, method: (init && init.method) || (input.method) || 'GET', headers: hdrs((init && init.headers) || input.headers), body: init && typeof init.body === 'string' ? init.body.slice(0, 6000) : (init && init.body ? String(init.body).slice(0, 200) : null) }
  const res = await of.apply(this, arguments)
  if (/rsc-action|voyager|reaction/i.test(url) && rec.method !== 'GET') { try { rec.status = res.status; rec.resp = (await res.clone().text()).slice(0, 3000) } catch (e) {} ; cap.push(rec) }
  return res
}
const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send, oh = XMLHttpRequest.prototype.setRequestHeader
XMLHttpRequest.prototype.open = function (m, u) { this.__r = { kind: 'xhr', method: m, url: u, headers: {} }; return oo.apply(this, arguments) }
XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__r) this.__r.headers[k] = v; return oh.apply(this, arguments) }
XMLHttpRequest.prototype.send = function (b) { const r = this.__r; if (r && r.method !== 'GET') { r.body = typeof b === 'string' ? b.slice(0, 6000) : null; this.addEventListener('loadend', () => { r.status = this.status; r.resp = String(this.responseText || '').slice(0, 3000); cap.push(r) }) } return os.apply(this, arguments) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const find = () => [...document.querySelectorAll('button[aria-label]')].find(b => /^Reaction button state/i.test(b.getAttribute('aria-label')))
let btn
for (let i = 0; i < 30 && !(btn = find()); i++) await sleep(500)
if (!btn) return { error: 'no button' }
const before = btn.getAttribute('aria-label')
if (!/no reaction/i.test(before)) return { error: 'already reacted', before }
btn.click()
await sleep(4000)
const mid = find() && find().getAttribute('aria-label')
const likeReqs = cap.splice(0)
find().click()
await sleep(4000)
const after = find() && find().getAttribute('aria-label')
return { before, mid, after, likeReqs, unlikeReqs: cap }
