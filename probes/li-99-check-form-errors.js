// @target linkedin.com
// @timeout 30000

return await (async function () {
  const errors = Array.from(document.querySelectorAll('[role="alert"], .artdeco-inline-feedback--error, .error, [aria-invalid="true"]')).map(el => ({
    tag: el.tagName,
    text: el.innerText,
    ariaLive: el.getAttribute('aria-live')
  }))

  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')

  return {
    errors,
    saveBtnDisabled: saveBtn?.disabled,
    allButtons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean)
  }
})()
