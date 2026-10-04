// @target linkedin.com
// @timeout 30000

return await (async function () {
  const textareas = Array.from(document.querySelectorAll('textarea')).map(el => {
    let parent = el.parentElement
    let label = ''
    while (parent && !label && parent !== document.body) {
      const prev = parent.previousElementSibling
      if (prev && prev.innerText) label = prev.innerText.trim()
      parent = parent.parentElement
    }
    return {
      tag: el.tagName,
      id: el.id,
      name: el.name,
      value: el.value,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      derivedLabel: label
    }
  })

  return { textareas }
})()
