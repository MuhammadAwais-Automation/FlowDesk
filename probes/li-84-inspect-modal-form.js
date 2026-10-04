// @target linkedin.com
// @timeout 30000

return await (async function () {
  const modal = document.querySelector('[role="dialog"]') || document.querySelector('.artdeco-modal')
  if (!modal) return { ok: false, error: 'No modal found' }

  const fields = []
  const labels = Array.from(modal.querySelectorAll('label'))
  for (const l of labels) {
    const forId = l.getAttribute('for')
    const target = forId ? document.getElementById(forId) : l.querySelector('input, textarea, select')
    fields.push({
      labelText: l.innerText.trim(),
      forId,
      targetTag: target?.tagName,
      targetType: target?.type,
      targetValue: target?.value,
      targetId: target?.id
    })
  }

  // Also check all inputs inside modal directly
  const modalInputs = Array.from(modal.querySelectorAll('input, textarea, select')).map(el => ({
    tag: el.tagName,
    id: el.id,
    value: el.value,
    placeholder: el.placeholder,
    ariaLabel: el.getAttribute('aria-label')
  }))

  return {
    modalFound: true,
    title: modal.querySelector('h1, h2, [role="heading"]')?.innerText,
    fields,
    modalInputs
  }
})()
