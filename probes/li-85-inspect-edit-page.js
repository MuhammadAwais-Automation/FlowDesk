// @target linkedin.com
// @timeout 30000

return await (async function () {
  const container = document.querySelector('main') || document.body
  const labels = Array.from(container.querySelectorAll('label')).map(l => {
    const forId = l.getAttribute('for')
    const target = forId ? document.getElementById(forId) : l.querySelector('input, textarea, select')
    return {
      label: l.innerText.trim(),
      forId,
      tag: target?.tagName,
      type: target?.type,
      value: target?.value,
      id: target?.id
    }
  })

  // All textareas and inputs
  const allControls = Array.from(container.querySelectorAll('input, textarea, select')).map(el => ({
    tag: el.tagName,
    type: el.type,
    id: el.id,
    name: el.name,
    value: el.value,
    placeholder: el.placeholder,
    ariaLabel: el.getAttribute('aria-label')
  }))

  return {
    url: window.location.href,
    labels,
    allControls
  }
})()
