// @target linkedin.com
// @timeout 30000

return await (async function () {
  let intercepted = []
  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (method, url) {
    this._method = method
    this._url = url
    return origOpen.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function (body) {
    if (this._url && (this._url.includes('voyager') || this._url.includes('graphql') || this._url.includes('identity'))) {
      intercepted.push({
        method: this._method,
        url: this._url,
        body: typeof body === 'string' ? body.slice(0, 1500) : String(body)
      })
    }
    return origSend.apply(this, arguments)
  }

  // Type in First Name input to make form dirty
  const fnInput = document.getElementById('«r7»') || Array.from(document.querySelectorAll('input')).find(i => i.value === 'Mushtaq')
  if (fnInput) {
    fnInput.focus()
    fnInput.value = 'Mushtaq'
    fnInput.dispatchEvent(new Event('input', { bubbles: true }))
    fnInput.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // Click Save button
  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')
  if (saveBtn) {
    saveBtn.click()
    await new Promise(r => setTimeout(r, 2000))
  }

  // restore
  XMLHttpRequest.prototype.open = origOpen
  XMLHttpRequest.prototype.send = origSend

  return {
    interceptedCount: intercepted.length,
    intercepted
  }
})()
