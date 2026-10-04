// @target tiktok.com
/**
 * tk-17-upload-fields.js (v2)
 * Inspects all input fields, buttons, dropzones, and textareas on the upload page.
 */
if (!window.location.href.includes('/tiktokstudio/upload')) {
  window.location.href = 'https://www.tiktok.com/tiktokstudio/upload'
  return { navigating: true, target: 'https://www.tiktok.com/tiktokstudio/upload' }
}

const fileInput = document.querySelector('input[type="file"]')
const fileInputInfo = fileInput ? {
  accept: fileInput.accept,
  id: fileInput.id,
  className: fileInput.className,
  parentElement: fileInput.parentElement?.tagName,
} : null

// Check for dropzone
const dropzones = Array.from(document.querySelectorAll('[class*="drop"], [class*="upload-container"], [class*="stage"]')).map(el => ({
  className: el.className,
  text: el.innerText.replace(/\n+/g, ' | ').slice(0, 150),
}))

// Check caption / description editor
const editors = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).map(el => ({
  tagName: el.tagName,
  placeholder: el.getAttribute('placeholder'),
  className: el.className,
}))

// Check post / submit buttons
const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
  text: b.textContent.trim(),
  disabled: b.disabled,
  className: b.className,
})).filter(b => b.text.length > 0)

return {
  url: window.location.href,
  fileInput: fileInputInfo,
  dropzones: dropzones.slice(0, 5),
  editors,
  buttons,
}
