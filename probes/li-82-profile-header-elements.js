// @target linkedin.com
// @timeout 30000

return await (async function () {
  // Find all buttons, file inputs, images, and links in the top card / profile container
  const allInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
    id: el.id,
    name: el.name,
    accept: el.accept,
    ariaLabel: el.getAttribute('aria-label'),
    outerHTML: el.outerHTML
  }))

  const photoButtons = Array.from(document.querySelectorAll('button, a, div[role="button"]')).filter(el => {
    const txt = (el.getAttribute('aria-label') || el.innerText || el.className || '').toLowerCase()
    return txt.includes('photo') || txt.includes('picture') || txt.includes('background') || txt.includes('cover') || txt.includes('camera') || txt.includes('banner')
  }).map(el => ({
    tag: el.tagName,
    text: el.innerText,
    ariaLabel: el.getAttribute('aria-label'),
    className: el.className,
    id: el.id,
    href: el.getAttribute('href')
  }))

  return {
    allFileInputs: allInputs,
    photoButtons
  }
})()
