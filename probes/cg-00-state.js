// @target chatgpt.com
// @timeout 20000
const eds = [...document.querySelectorAll('[contenteditable="true"], textarea, input[type=file]')].map(e => ({
  tag: e.tagName, id: e.id, name: e.getAttribute('name'), cls: String(e.className).slice(0, 80),
  aria: e.getAttribute('aria-label'), ph: e.getAttribute('placeholder') || e.getAttribute('data-placeholder'),
  testid: e.getAttribute('data-testid'), accept: e.getAttribute('accept'), multiple: e.multiple,
}))
const btns = [...document.querySelectorAll('button')].filter(b => /send|submit|attach|upload|add|plus|composer/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-testid') || ''))).map(b => ({ aria: b.getAttribute('aria-label'), testid: b.getAttribute('data-testid'), id: b.id }))
return { url: location.href, vis: document.visibilityState, eds, btns, main: !!document.querySelector('main'), form: !!document.querySelector('form') }
