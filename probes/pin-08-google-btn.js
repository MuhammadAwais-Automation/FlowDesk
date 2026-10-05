// @target pinterest.com/login
// @timeout 40000
// Read-only: what is the "Continue with Google" button (plain button, GSI iframe, FedCM?).
await new Promise(r => setTimeout(r, 3000))
const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({ src: (f.src || '').replace(/client_id=[^&]+/, 'client_id=…').slice(0, 160), w: f.width || f.offsetWidth, h: f.height || f.offsetHeight }))
const btn = Array.from(document.querySelectorAll('button, div[role="button"], a')).find(e => /Continue with Google/i.test(e.innerText || ''))
return {
  url: location.href,
  iframes,
  btn: btn ? { tag: btn.tagName, testId: btn.getAttribute('data-test-id'), html: btn.outerHTML.slice(0, 400) } : null,
  hasFedCM: typeof window.IdentityCredential !== 'undefined',
  gsi: typeof window.google !== 'undefined' && !!window.google?.accounts?.id,
}
