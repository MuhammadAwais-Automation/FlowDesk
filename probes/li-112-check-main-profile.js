// @target linkedin.com
// @goto https://www.linkedin.com/in/mushtaq-assi-573a5a275/
// @timeout 30000

return await (async function () {
  await new Promise(r => setTimeout(r, 2500))

  const h1 = document.querySelector('h1')?.innerText?.trim()
  const headlineEl = document.querySelector('div.text-body-medium') || Array.from(document.querySelectorAll('div, p')).find(el => el.innerText && el.innerText.includes('Developer'))

  return {
    name: h1,
    headlineFound: headlineEl?.innerText?.trim(),
    bodySnippet: document.body.innerText.slice(0, 1000)
  }
})()
