// @target tab:social-pinterest
// @timeout 60000
// Read-only: page shape — visible text (digits masked) and all data-test-ids.
const ids = [...new Set([...document.querySelectorAll('[data-test-id]')].map(e => e.getAttribute('data-test-id')))]
return { path: location.pathname.replace(/^\/[^/]+\//, '/<me>/'), vis: document.visibilityState, w: innerWidth, h: innerHeight, textLen: document.body.innerText.length, text: document.body.innerText.replace(/\d/g, '#').slice(0, 600), ids: ids.slice(0, 150) }
