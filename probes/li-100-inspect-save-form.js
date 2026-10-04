// @target linkedin.com
// @timeout 30000

return await (async function () {
  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')
  if (!saveBtn) return { ok: false, error: 'Save button not found' }

  const form = saveBtn.closest('form')

  return {
    saveBtnTag: saveBtn.tagName,
    saveBtnType: saveBtn.type,
    saveBtnClass: saveBtn.className,
    hasForm: !!form,
    formAction: form?.action,
    formMethod: form?.method,
    formOuter: form?.outerHTML?.slice(0, 300)
  }
})()
