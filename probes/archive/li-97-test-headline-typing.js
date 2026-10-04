// @target linkedin.com
// @timeout 30000

return await (async function () {
  const headlineEl = document.querySelector('.tiptap.ProseMirror[role="textbox"]')
  if (!headlineEl) return { ok: false, error: 'Headline editor not found' }

  // Check how to set content in ProseMirror
  // 1. Focus
  headlineEl.focus()
  // 2. Select all
  const range = document.createRange()
  range.selectNodeContents(headlineEl)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)

  // 3. Use execCommand or replace text
  document.execCommand('insertText', false, 'Full-Stack AI Developer | AI Agents & Automations')

  // Listen to network when clicking Save
  let capturedNetwork = []
  const origFetch = window.fetch
  window.fetch = async function (url, opts = {}) {
    const u = String(url)
    capturedNetwork.push({
      url: u,
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body ? String(opts.body).slice(0, 1500) : null
    })
    return origFetch.apply(this, arguments)
  }

  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')
  if (saveBtn) {
    saveBtn.click()
    await new Promise(r => setTimeout(r, 2000))
  }

  window.fetch = origFetch

  return {
    typedText: headlineEl.innerText.trim(),
    capturedNetwork: capturedNetwork.filter(n => n.url.includes('voyager') || n.url.includes('graphql') || n.url.includes('identity'))
  }
})()
