// @target tiktok.com
/**
 * tk-14-tiktok-studio.js (v2)
 * Navigates to TikTok Studio content and upload to analyze video upload and management mechanisms.
 */
if (!window.location.href.includes('/tiktokstudio/upload')) {
  window.location.href = 'https://www.tiktok.com/tiktokstudio/upload'
  return { navigating: true, target: 'https://www.tiktok.com/tiktokstudio/upload' }
}

const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(inp => ({
  accept: inp.accept,
  name: inp.name,
  id: inp.id,
  className: inp.className,
}))

const allButtons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(Boolean)
const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src)

return {
  ok: true,
  url: window.location.href,
  title: document.title,
  fileInputs,
  buttons: allButtons.slice(0, 20),
  iframes,
}
