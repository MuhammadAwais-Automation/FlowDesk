// @target linkedin.com
// @timeout 30000

return await (async function () {
  const container = document.querySelector('div.cf8121e6._0fbca0ec._34589592._398a5a3d') || document.body
  const buttons = Array.from(container.querySelectorAll('button')).map(b => ({
    text: b.innerText.trim(),
    ariaLabel: b.getAttribute('aria-label'),
    disabled: b.disabled,
    className: b.className
  }))

  return {
    buttons
  }
})()
