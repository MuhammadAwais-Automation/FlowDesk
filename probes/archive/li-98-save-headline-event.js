// @target linkedin.com
// @goto https://www.linkedin.com/in/mushtaq-assi-573a5a275/edit/intro/
// @timeout 30000

return await (async function () {
  await new Promise(r => setTimeout(r, 2000))

  const headlineEl = document.querySelector('.tiptap.ProseMirror[role="textbox"]')
  if (!headlineEl) return { ok: false, error: 'Headline editor not found' }

  // Use probe.type if available or exact event sequence
  if (window.probe && typeof window.probe.type === 'function') {
    await window.probe.type(headlineEl, 'Full-Stack AI Developer | Automations & AI Agents', { clear: true })
  } else {
    headlineEl.focus()
    const range = document.createRange()
    range.selectNodeContents(headlineEl)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
    document.execCommand('insertText', false, 'Full-Stack AI Developer | Automations & AI Agents')
    headlineEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    headlineEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  }

  await new Promise(r => setTimeout(r, 800))

  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')
  if (!saveBtn) return { ok: false, error: 'Save button not found' }

  if (window.probe && typeof window.probe.click === 'function') {
    await window.probe.click(saveBtn)
  } else {
    const opts = { bubbles: true, cancelable: true, view: window }
    saveBtn.dispatchEvent(new MouseEvent('mousedown', opts))
    saveBtn.dispatchEvent(new MouseEvent('mouseup', opts))
    saveBtn.dispatchEvent(new MouseEvent('click', opts))
  }

  await new Promise(r => setTimeout(r, 2500))

  return {
    ok: true,
    urlAfterSave: window.location.href,
    headlineText: document.querySelector('.tiptap.ProseMirror')?.innerText?.trim()
  }
})()
