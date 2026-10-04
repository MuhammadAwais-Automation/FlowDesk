// @target linkedin.com
// @goto https://www.linkedin.com/in/mushtaq-assi-573a5a275/
// @timeout 30000

return await (async function () {
  await new Promise(r => setTimeout(r, 2000))

  // Find the "Add photo" element
  const addPhotoEl = Array.from(document.querySelectorAll('a, button, div')).find(el => {
    return el.getAttribute('aria-label') === 'Add photo' || el.innerText?.trim() === 'Add photo'
  })

  // Find the background image element
  const bgImageEl = Array.from(document.querySelectorAll('a, button, div')).find(el => {
    const lbl = el.getAttribute('aria-label') || el.innerText || ''
    return lbl.includes('background') || lbl.includes('cover image') || lbl.includes('banner')
  })

  return {
    addPhotoFound: !!addPhotoEl,
    addPhotoTag: addPhotoEl?.tagName,
    addPhotoHref: addPhotoEl?.getAttribute('href'),
    bgImageFound: !!bgImageEl,
    bgImageText: bgImageEl?.innerText,
    bgImageAria: bgImageEl?.getAttribute('aria-label')
  }
})()
