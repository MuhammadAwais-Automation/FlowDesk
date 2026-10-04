// @target tiktok.com
// @goto https://www.tiktok.com/tiktokstudio/upload?from=flowdesk
// @file video ./out/tkw/tkw_test.mp4
// @timeout 120000
const seen = []
const want = u => /upload\/auth|ApplyUpload|CommitUpload|\/upload\/v1\//.test(u)
const of = window.fetch
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input.url
  const res = await of.apply(this, arguments)
  if (want(url)) {
    const h = init && init.headers ? (init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers) : (input.headers ? Object.fromEntries(input.headers) : {})
    let t = ''; try { t = await res.clone().text() } catch (e) {}
    seen.push({ via: 'fetch', m: (init && init.method) || input.method || 'GET', url, h, bodyType: init && init.body ? Object.prototype.toString.call(init.body) : null, status: res.status, resp: t.slice(0, 400) })
  }
  return res
}
const OO = XMLHttpRequest.prototype.open, OS = XMLHttpRequest.prototype.setRequestHeader, OSend = XMLHttpRequest.prototype.send
XMLHttpRequest.prototype.open = function (m, u) { this.__r = { via: 'xhr', m, url: String(u), h: {} }; return OO.apply(this, arguments) }
XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__r) this.__r.h[k] = String(v); return OS.apply(this, arguments) }
XMLHttpRequest.prototype.send = function (b) { const r = this.__r; if (r && want(r.url)) { r.bodyType = b ? Object.prototype.toString.call(b) : null; this.addEventListener('loadend', () => { r.status = this.status; r.resp = String(this.responseText || '').slice(0, 400); seen.push(r) }) } return OSend.apply(this, arguments) }
await probe.waitFor('input[type="file"]', { timeoutMs: 30000 })
await probe.injectFile('input[type="file"]', probe.files.video)
await probe.waitFor(() => seen.some(s => /\/upload\/v1\//.test(s.url) && s.status), { timeoutMs: 60000 }).catch(() => {})
await probe.sleep(2000)
const red = h => { const o = {}; for (const k in h) o[k] = /authorization|token|secret/i.test(k) ? String(h[k]).slice(0, 90) + '…' : h[k]; return o }
return seen.map(s => ({ ...s, h: red(s.h || {}) }))
