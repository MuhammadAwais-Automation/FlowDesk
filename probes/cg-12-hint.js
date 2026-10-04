// @target chatgpt.com
// @goto https://chatgpt.com/?hints=picture_v2
// @timeout 30000
await new Promise(r => setTimeout(r, 5000))
const comp = document.querySelector('div.ProseMirror[contenteditable="true"]')
let form = comp; for (let i = 0; i < 8 && form && form.tagName !== 'FORM'; i++) form = form.parentElement
const btns = [...(form || document).querySelectorAll('button')].map(b => ({ aria: b.getAttribute('aria-label'), testid: b.getAttribute('data-testid'), id: b.id, text: b.innerText.slice(0, 30), dis: b.disabled }))
return { url: location.href, formText: form ? form.innerText.slice(0, 300) : null, ph: comp && comp.querySelector('[data-placeholder]') ? comp.querySelector('[data-placeholder]').getAttribute('data-placeholder') : null, btns }
