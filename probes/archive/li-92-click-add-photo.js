// @target linkedin.com
// @timeout 30000

return await (async function () {
  const addPhotoEl = Array.from(document.querySelectorAll('a, button, div')).find(el => {
    return el.getAttribute('aria-label') === 'Add photo' || el.innerText?.trim() === 'Add photo'
  })

  if (!addPhotoEl) return { ok: false, error: 'Add photo element not found' }

  // click it
  addPhotoEl.click()
  await new Promise(r => setTimeout(r, 1500))

  // Find all file inputs or dialog content
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(f => ({
    id: f.id,
    name: f.name,
    accept: f.accept,
    outerHTML: f.outerHTML
  }))

  const modalButtons = Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.innerText.trim(),
    ariaLabel: b.getAttribute('aria-label')
  })).filter(b => b.text || b.ariaLabel)

  return {
    modalTitle: document.querySelector('[role="dialog"] h1, [role="dialog"] h2, h2, h1')?.innerText,
    fileInputs,
    modalButtons: modalButtons.slice(0, 15)
  }
})()
