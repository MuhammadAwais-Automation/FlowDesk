// @target linkedin.com
// @timeout 30000

return (function () {
  const buttons = Array.from(document.querySelectorAll('button, a')).map(el => ({
    tag: el.tagName,
    text: el.innerText.trim(),
    ariaLabel: el.getAttribute('aria-label'),
    classes: el.className
  })).filter(b => b.text.includes('more') || b.text.includes('Next') || b.text.includes('Show') || b.text.includes('Load') || b.text.includes('See'))

  return {
    url: window.location.href,
    buttons
  }
})()
