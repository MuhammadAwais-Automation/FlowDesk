// @target tiktok.com
// @timeout 30000
window.scrollTo(0, 800)
await new Promise(r => setTimeout(r, 5000))
const main = document.querySelector('main') || document.body
return { url: location.href, vis: document.visibilityState, text: main.innerText.slice(0, 700), e2e: [...new Set([...document.querySelectorAll('[data-e2e]')].map(e => e.getAttribute('data-e2e')))].slice(0, 60) }
