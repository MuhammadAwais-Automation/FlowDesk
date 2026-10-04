// @target tiktok.com
// @goto https://www.tiktok.com/@alphapaws6
// @timeout 60000
await probe.waitFor('[data-e2e="edit-profile-entrance"]', { timeoutMs: 20000 })
await probe.click('[data-e2e="edit-profile-entrance"]', { waitAfterMs: 1000 })
await probe.waitFor(() => document.querySelector('textarea'), { timeoutMs: 10000 }).catch(() => {})
const fields = [...document.querySelectorAll('input,textarea')].map(e => ({ tag: e.tagName, type: e.type, name: e.name, ph: e.placeholder, e2e: e.getAttribute('data-e2e'), val: (e.value||'').slice(0,120) }))
const e2es = [...document.querySelectorAll('[data-e2e]')].map(e => e.getAttribute('data-e2e')).filter(x => /edit|save|cancel|bio|name|avatar|photo/i.test(x))
const buttons = [...document.querySelectorAll('button')].map(b => ({ e2e: b.getAttribute('data-e2e'), t: b.textContent.trim().slice(0,30), dis: b.disabled })).filter(b => /save|cancel|edit/i.test(b.t + b.e2e))
return { fields, e2es, buttons }
