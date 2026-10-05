// @target tab:social-pinterest
// @timeout 60000
// r1
// Read-only: list clickable controls on the current page (labels only).
await new Promise(r => setTimeout(r, 12000))
const els = [...document.querySelectorAll('button, [role=button], a[aria-label], [data-test-id]')]
const seen = new Set()
const items = els.map(e => ({ tag: e.tagName, aria: e.getAttribute('aria-label'), test: e.getAttribute('data-test-id'), text: (e.innerText || '').trim().slice(0, 30) }))
  .filter(x => (x.aria || x.test || x.text) && !seen.has(JSON.stringify(x)) && seen.add(JSON.stringify(x)))
return { path: location.pathname.replace(/^\/[^/]+\//, '/<me>/'), items: items.slice(0, 120) }
