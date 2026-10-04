// @target tiktok.com
// @timeout 60000
const cap = []
const oj = Response.prototype.json, ot = Response.prototype.text
Response.prototype.json = async function () { const v = await oj.call(this); if (/update\/profile/.test(this.url)) cap.push({ url: this.url.split('?')[0], json: v }); return v }
Response.prototype.text = async function () { const v = await ot.call(this); if (/update\/profile/.test(this.url)) cap.push({ url: this.url.split('?')[0], text: v.slice(0, 1500) }); return v }
const readBio = async () => { const r = await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true', { credentials: 'include' }); return JSON.parse(await ot.call(r)).userExtra?.profileBio }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function uiSave(text) {
  if (!document.querySelector('[data-e2e="edit-profile-bio-input"]')) {
    await probe.waitFor('[data-e2e="edit-profile-entrance"]', { timeoutMs: 20000 })
    await probe.click('[data-e2e="edit-profile-entrance"]', { waitAfterMs: 1000 })
    await probe.waitFor('[data-e2e="edit-profile-bio-input"]', { timeoutMs: 10000 })
  }
  await probe.type('[data-e2e="edit-profile-bio-input"]', text, { clear: true, waitAfterMs: 600 })
  const btn = document.querySelector('[data-e2e="edit-profile-save"]')
  const dis = btn.disabled
  await probe.click(btn, { waitAfterMs: 4000 })
  return { dis, popupAfter: !!document.querySelector('[data-e2e="edit-profile-popup"]'), dialogs: [...document.querySelectorAll('[role=dialog]')].map(d => d.textContent.trim().slice(0, 200)) }
}
try {
  const original = await readBio()
  const s1 = await uiSave('FlowDesk bio test 1')
  await sleep(1000)
  const after1 = await readBio()
  const cap1 = cap.splice(0)
  let s2 = null, after2 = null, cap2 = null
  if (after1 !== original) { s2 = await uiSave(original); await sleep(1000); after2 = await readBio(); cap2 = cap.splice(0) }
  return { original, s1, cap1, after1, s2, cap2, after2, finalMatchesOriginal: (after2 ?? after1) === original }
} finally { Response.prototype.json = oj; Response.prototype.text = ot }
