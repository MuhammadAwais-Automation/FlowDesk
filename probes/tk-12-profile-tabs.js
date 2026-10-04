// @target tiktok.com
/**
 * tk-12-profile-tabs.js
 * Inspects tabs, video containers, private posts, and upload status on profile.
 */
const tabs = Array.from(document.querySelectorAll('[role="tab"], [data-e2e*="tab"]')).map(t => ({
  text: t.textContent.trim(),
  selected: t.getAttribute('aria-selected') || t.className.includes('active'),
  role: t.getAttribute('role'),
}))

const allContainers = Array.from(document.querySelectorAll('[data-e2e*="post"], [data-e2e*="video"], [data-e2e*="content"]')).map(el => ({
  e2e: el.getAttribute('data-e2e'),
  tag: el.tagName,
  text: el.innerText.slice(0, 100).replace(/\n/g, ' '),
}))

const allIframes = Array.from(document.querySelectorAll('iframe')).map(i => i.src)
const allButtons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean)

return {
  url: window.location.href,
  tabs,
  containersCount: allContainers.length,
  containers: allContainers.slice(0, 15),
  buttons: allButtons.slice(0, 20),
}
