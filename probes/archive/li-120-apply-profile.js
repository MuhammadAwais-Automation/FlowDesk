// @target linkedin.com
// @goto https://www.linkedin.com/in/mushtaq-assi-573a5a275/edit/intro/
// @timeout 30000

return await (async function () {
  await new Promise(r => setTimeout(r, 2500))

  const newHeadline = "Full-Stack AI Developer | Building Autonomous AI Agents · Desktop Automations · LLM Systems | Solo Builder"

  // 1. First Name
  const fnInput = Array.from(document.querySelectorAll('input')).find(i => {
    return i.value === 'Mushtaq' || (i.getAttribute('aria-label') || '').toLowerCase().includes('first name')
  })
  if (fnInput) {
    fnInput.focus()
    fnInput.value = 'Mushtaq'
    fnInput.dispatchEvent(new Event('input', { bubbles: true }))
    fnInput.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // 2. Last Name
  const lnInput = Array.from(document.querySelectorAll('input')).find(i => {
    return i.value === 'Assi' || (i.getAttribute('aria-label') || '').toLowerCase().includes('last name')
  })
  if (lnInput) {
    lnInput.focus()
    lnInput.value = 'Assi'
    lnInput.dispatchEvent(new Event('input', { bubbles: true }))
    lnInput.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // 3. Headline in ProseMirror
  const headlineEl = document.querySelector('.tiptap.ProseMirror[role="textbox"]')
  if (headlineEl) {
    headlineEl.focus()
    const range = document.createRange()
    range.selectNodeContents(headlineEl)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.execCommand('insertText', false, newHeadline)
    headlineEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    headlineEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  }

  await new Promise(r => setTimeout(r, 800))

  // 4. Click Save button via BOTH synthetic click AND React props onClick
  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.trim() === 'Save')
  if (!saveBtn) return { ok: false, error: 'Save button not found' }

  // Dispatch pointer events
  const opts = { bubbles: true, cancelable: true, view: window }
  saveBtn.dispatchEvent(new MouseEvent('mousedown', opts))
  saveBtn.dispatchEvent(new MouseEvent('mouseup', opts))
  saveBtn.dispatchEvent(new MouseEvent('click', opts))

  // React fiber onClick
  const propsKey = Object.keys(saveBtn).find(k => k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers'))
  if (propsKey && saveBtn[propsKey]?.onClick) {
    try {
      saveBtn[propsKey].onClick({ preventDefault() {}, stopPropagation() {} })
    } catch {}
  }

  await new Promise(r => setTimeout(r, 3000))

  return {
    ok: true,
    appliedHeadline: newHeadline,
    currentUrl: window.location.href
  }
})()
