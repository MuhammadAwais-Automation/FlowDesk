// @target tiktok.com
// @goto https://www.tiktok.com/@alphapaws6
// @timeout 60000
await probe.waitFor('[data-e2e="edit-profile-entrance"]', { timeoutMs: 20000 })
await probe.click('[data-e2e="edit-profile-entrance"]', { waitAfterMs: 2500 })
const dlg = document.querySelector('[role="dialog"]') || document.body
const fields = [...dlg.querySelectorAll('input,textarea,[contenteditable="true"]')].map(e => ({ tag: e.tagName, type: e.type, name: e.name, ph: e.placeholder, e2e: e.getAttribute('data-e2e'), val: (e.value||'').slice(0,120), cls: String(e.className).slice(0,60) }))
const buttons = [...dlg.querySelectorAll('button')].map(b => ({ e2e: b.getAttribute('data-e2e'), t: b.textContent.trim().slice(0,30), dis: b.disabled }))
const e2es = [...dlg.querySelectorAll('[data-e2e]')].map(e => e.getAttribute('data-e2e'))
return { hasDialog: !!document.querySelector('[role="dialog"]'), fields, buttons, e2es }
