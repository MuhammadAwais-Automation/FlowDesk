// @target tiktok.com
/**
 * tk-15-studio-posts.js (v2)
 * Inspects TikTok Studio Posts / Content Manager page to find existing uploaded videos,
 * status, view counts, and delete/edit options.
 */
if (!window.location.href.includes('/tiktokstudio/content')) {
  window.location.href = 'https://www.tiktok.com/tiktokstudio/content'
  return { navigating: true, target: 'https://www.tiktok.com/tiktokstudio/content' }
}

// Find rows / cards representing uploaded posts
const postRows = Array.from(document.querySelectorAll('tr, [class*="post-item"], [class*="table-row"]')).map((el, i) => ({
  index: i,
  text: el.innerText.replace(/\n+/g, ' | ').trim(),
}))

const allActionButtons = Array.from(document.querySelectorAll('button, a')).map(b => ({
  text: b.textContent.trim(),
  href: b.href || null,
  role: b.getAttribute('role'),
})).filter(b => b.text.length > 0 && b.text.length < 50)

return {
  ok: true,
  url: window.location.href,
  title: document.title,
  rowsCount: postRows.length,
  sampleRows: postRows.slice(0, 10),
  actions: allActionButtons.slice(0, 25),
}
