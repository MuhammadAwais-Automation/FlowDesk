// @target tiktok.com
// Arms a page-level recorder for the user's manual click; read back by tkm-02.
if (!window.__fdCap) {
  window.__fdCap = []
  const want = u => !/monitor|slardar|\/log|mcs|webcast|abtest|mssdk|\.(js|css|png|webp)/.test(u)
  const of = window.fetch
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url
    const m = (init && init.method) || (input && input.method) || 'GET'
    const res = await of.apply(this, arguments)
    if (want(url) && m !== 'GET') { let t = ''; try { t = await res.clone().text() } catch (e) {} window.__fdCap.push({ via: 'fetch', m, url, headers: init && init.headers ? JSON.stringify(init.headers).slice(0, 600) : null, body: init && typeof init.body === 'string' ? init.body.slice(0, 3000) : String(init && init.body), status: res.status, resp: t.slice(0, 800) }) }
    return res
  }
  const OO = XMLHttpRequest.prototype.open, OS = XMLHttpRequest.prototype.setRequestHeader, OSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u) { this.__r = { via: 'xhr', m, url: String(u), headers: {} }; return OO.apply(this, arguments) }
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__r) this.__r.headers[k] = String(v).slice(0, 120); return OS.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function (b) { const r = this.__r; if (r && r.m !== 'GET' && want(r.url)) { r.body = typeof b === 'string' ? b.slice(0, 3000) : (b instanceof FormData ? JSON.stringify([...b.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 500) : '[blob]'])) : String(b)); this.addEventListener('loadend', () => { r.status = this.status; r.resp = String(this.responseText || '').slice(0, 800); window.__fdCap.push(r) }) } return OSend.apply(this, arguments) }
}
return { armed: true, url: location.href }
