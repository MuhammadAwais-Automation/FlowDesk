// @target tiktok.com
const txt = el => (el.innerText || '').trim()
const label = [...document.querySelectorAll('*')].find(e => e.children.length < 3 && /who can watch/i.test(txt(e)))
let box = label; for (let i = 0; i < 4 && box && box.parentElement; i++) box = box.parentElement
return {
  url: location.href,
  label: label && txt(label),
  html: box && box.outerHTML.replace(/\s+/g, ' ').slice(0, 1800),
}
