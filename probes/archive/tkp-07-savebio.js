// @target tiktok.com
// @goto https://www.tiktok.com/@alphapaws6
// @timeout 60000
const cap = []
const of = window.fetch
window.fetch = async function (i, init) {
  const url = typeof i === 'string' ? i : i.url
  const r = await of.apply(this, arguments)
  if (/update|profile|passport|commit/i.test(url)) { let t = ''; try { t = await r.clone().text() } catch {} ; cap.push({ via: 'fetch', url, method: init?.method, headers: init?.headers, body: typeof init?.body === 'string' ? init.body : String(init?.body), status: r.status, resp: t.slice(0, 1500) }) }
  return r
}
const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send, oh = XMLHttpRequest.prototype.setRequestHeader
XMLHttpRequest.prototype.open = function (m, u) { this.__c = { via: 'xhr', method: m, url: String(u), headers: {} }; return oo.apply(this, arguments) }
XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__c) this.__c.headers[k] = v; return oh.apply(this, arguments) }
XMLHttpRequest.prototype.send = function (b) { const c = this.__c; if (c && /update|profile|passport|commit/i.test(c.url)) { c.body = typeof b === 'string' ? b : (b instanceof FormData ? [...b.entries()].map(e => e.join('=')).join('&') : String(b)); this.addEventListener('loadend', () => { c.status = this.status; c.resp = String(this.responseText).slice(0, 1500) }); cap.push(c) } return os.apply(this, arguments) }
try {
  if (!document.querySelector('[data-e2e="edit-profile-bio-input"]')) {
    await probe.waitFor('[data-e2e="edit-profile-entrance"]', { timeoutMs: 20000 })
    await probe.click('[data-e2e="edit-profile-entrance"]', { waitAfterMs: 1000 })
    await probe.waitFor('[data-e2e="edit-profile-bio-input"]', { timeoutMs: 10000 })
  }
  const before = document.querySelector('[data-e2e="edit-profile-bio-input"]').value
  await probe.type('[data-e2e="edit-profile-bio-input"]', 'FlowDesk bio test 1', { clear: true, waitAfterMs: 800 })
  const saveBtn = document.querySelector('[data-e2e="edit-profile-save"]')
  const disabled = saveBtn.disabled
  await probe.click(saveBtn, { waitAfterMs: 5000 })
  return { before, disabled, cap, popupOpen: !!document.querySelector('[data-e2e="edit-profile-popup"]'), bioDom: document.querySelector('[data-e2e="user-bio"]')?.textContent }
} finally { window.fetch = of; XMLHttpRequest.prototype.open = oo; XMLHttpRequest.prototype.send = os; XMLHttpRequest.prototype.setRequestHeader = oh }
