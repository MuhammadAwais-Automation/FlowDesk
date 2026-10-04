// @target tiktok.com
// @timeout 30000
const r = await fetch('/tiktokstudio/api/web/user?needIsVerified=true&needProfileBio=true', { credentials: 'include' })
const j = await r.json()
return { url: location.href, bio: j.userExtra?.profileBio, popup: !!document.querySelector('[data-e2e="edit-profile-popup"]'), toast: [...document.querySelectorAll('[role=alert],[class*=toast],[class*=Toast]')].map(e => e.textContent.trim()).slice(0,5), bioInput: document.querySelector('[data-e2e="edit-profile-bio-input"]')?.value, fetchNative: String(window.fetch).slice(0, 120) }
