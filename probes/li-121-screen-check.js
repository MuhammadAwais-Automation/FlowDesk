// @target linkedin.com
// @timeout 30000

return await (async function () {
  const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.innerText.trim(),
    ariaLabel: b.getAttribute('aria-label'),
    disabled: b.disabled,
    className: b.className
  }))

  const alerts = Array.from(document.querySelectorAll('[role="alert"], .error, [aria-invalid="true"]')).map(el => el.innerText.trim())

  return {
    url: window.location.href,
    title: document.title,
    alerts,
    buttons: allButtons.filter(b => b.text || b.ariaLabel).slice(0, 10),
    bodySnippet: document.body.innerText.slice(0, 600)
  }
})()
