// @target linkedin.com
// @timeout 30000

return await (async function () {
  const inputs = Array.from(document.querySelectorAll('input, textarea')).map(el => {
    // find nearest text before or label
    let parent = el.parentElement
    let label = ''
    while (parent && !label && parent !== document.body) {
      const prev = parent.previousElementSibling
      if (prev && prev.innerText) label = prev.innerText.trim()
      parent = parent.parentElement
    }
    return {
      tag: el.tagName,
      type: el.type,
      id: el.id,
      name: el.name,
      value: el.value,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      derivedLabel: label
    }
  })

  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')

  return {
    inputsCount: inputs.length,
    inputs,
    saveBtn: saveBtn ? { text: saveBtn.innerText, disabled: saveBtn.disabled, className: saveBtn.className } : null
  }
})()
