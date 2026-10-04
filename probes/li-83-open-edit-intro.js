// @target linkedin.com
// @goto https://www.linkedin.com/in/mushtaq-assi-573a5a275/edit/intro/
// @timeout 30000

return await (async function () {
  await new Promise(r => setTimeout(r, 2500))

  const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    value: el.value,
    ariaLabel: el.getAttribute('aria-label')
  }))

  const modalTitle = document.querySelector('h1, h2, [role="heading"]')?.innerText

  const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.innerText,
    ariaLabel: b.getAttribute('aria-label'),
    disabled: b.disabled
  }))

  return {
    modalTitle,
    inputs,
    buttons: buttons.filter(b => b.text || b.ariaLabel)
  }
})()
