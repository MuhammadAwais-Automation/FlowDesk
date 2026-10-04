// @target linkedin.com
// @timeout 30000

return await (async function () {
  let clickedInput = null
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

  // Dismiss any open modal first
  const dismissBtn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Dismiss')
  if (dismissBtn) dismissBtn.click()
  await new Promise(r => setTimeout(r, 600))

  // Find background image button
  const bgBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(el => {
    const txt = el.getAttribute('aria-label') || el.innerText || ''
    return txt.includes('background image') || txt.includes('cover image') || txt.includes('Enhance cover image')
  })

  if (!bgBtn) return { ok: false, error: 'Background button not found' }

  bgBtn.click()
  await new Promise(r => setTimeout(r, 1000))

  const modalButtons = Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.innerText.trim(),
    ariaLabel: b.getAttribute('aria-label')
  })).filter(b => b.text || b.ariaLabel)

  return {
    ok: true,
    bgBtnText: bgBtn.innerText,
    clickedInput,
    modalTitle: document.querySelector('[role="dialog"] h1, [role="dialog"] h2, h2, h1')?.innerText,
    modalButtons: modalButtons.slice(0, 15),
    allFileInputsNow: Array.from(document.querySelectorAll('input[type="file"]')).map(f => f.outerHTML)
  }
})()
