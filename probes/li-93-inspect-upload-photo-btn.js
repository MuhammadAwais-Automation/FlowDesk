// @target linkedin.com
// @timeout 30000

return await (async function () {
  const uploadBtn = Array.from(document.querySelectorAll('button, label, div')).find(el => {
    return el.innerText?.trim() === 'Upload photo'
  })

  if (!uploadBtn) return { ok: false, error: 'Upload photo button not found' }

  return {
    tag: uploadBtn.tagName,
    className: uploadBtn.className,
    parentHtml: uploadBtn.parentElement?.outerHTML?.slice(0, 500),
    forAttr: uploadBtn.getAttribute('for')
  }
})()
