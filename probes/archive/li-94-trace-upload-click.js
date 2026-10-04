// @target linkedin.com
// @timeout 30000

return await (async function () {
  let createdInput = null
  let clickedInput = null

  // Monkey patch HTMLInputElement.prototype.click
  const originalClick = HTMLInputElement.prototype.click
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') {
      clickedInput = {
        id: this.id,
        name: this.name,
        accept: this.accept,
        outerHTML: this.outerHTML
      }
    }
    return originalClick.apply(this, arguments)
  }

  const uploadBtn = Array.from(document.querySelectorAll('button, div')).find(el => {
    return el.innerText?.trim() === 'Upload photo'
  })

  if (!uploadBtn) return { ok: false, error: 'Upload photo button not found' }

  // Click it
  uploadBtn.click()
  await new Promise(r => setTimeout(r, 800))

  return {
    ok: true,
    clickedInput,
    allFileInputsNow: Array.from(document.querySelectorAll('input[type="file"]')).map(f => f.outerHTML)
  }
})()
