// @target tiktok.com
/**
 * tk-09-after-post.js
 *
 * Check TikTok Studio state after clicking Post.
 */

try {
  // Check modal or success dialogs
  const modalText = Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="success"], [class*="toast"], [class*="notify"]')).map(el => el.innerText.slice(0, 200)).filter(Boolean)

  const bodyText = document.body ? document.body.innerText.slice(0, 600) : ''

  return {
    url: window.location.href,
    title: document.title,
    modalText,
    bodySnippet: bodyText
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
