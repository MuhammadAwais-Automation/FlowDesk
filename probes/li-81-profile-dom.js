// @target linkedin.com
// @timeout 30000

return await (async function () {
  function csrf() {
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/)
    return m ? m[1] : null
  }

  // Check what buttons exist on the profile page right now
  const editButtons = Array.from(document.querySelectorAll('button, a')).filter(el => {
    const txt = (el.getAttribute('aria-label') || el.innerText || '').toLowerCase()
    return txt.includes('edit intro') || txt.includes('edit profile') || txt.includes('add profile photo') || txt.includes('camera')
  }).map(el => ({
    tag: el.tagName,
    text: el.innerText,
    ariaLabel: el.getAttribute('aria-label'),
    href: el.getAttribute('href'),
    className: el.className,
    id: el.id
  }))

  // Also check all forms or modals if any
  const forms = Array.from(document.querySelectorAll('form')).map(f => ({
    action: f.action,
    method: f.method,
    inputs: Array.from(f.querySelectorAll('input, textarea')).map(i => ({ name: i.name, id: i.id, placeholder: i.placeholder, value: i.value }))
  }))

  return {
    currentUrl: window.location.href,
    editButtons,
    forms
  }
})()
