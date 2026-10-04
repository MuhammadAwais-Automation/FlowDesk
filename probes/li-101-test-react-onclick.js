// @target linkedin.com
// @timeout 30000

return await (async function () {
  const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Save')
  if (!saveBtn) return { ok: false, error: 'Save button not found' }

  const propsKey = Object.keys(saveBtn).find(k => k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers'))
  const props = propsKey ? saveBtn[propsKey] : null

  let triggered = false
  if (props && typeof props.onClick === 'function') {
    props.onClick({ preventDefault() {}, stopPropagation() {} })
    triggered = true
  }

  await new Promise(r => setTimeout(r, 2500))

  return {
    ok: true,
    propsKey,
    hasOnClick: !!(props && props.onClick),
    triggered,
    currentUrl: window.location.href
  }
})()
