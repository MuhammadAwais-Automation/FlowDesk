// @target tiktok.com
/**
 * tk-08-publish.js
 *
 * Click the Post button to publish Video #2 to TikTok!
 */

try {
  const postBtn = document.querySelector('button[data-e2e="post_video_button"]')
  if (!postBtn) {
    return { ok: false, error: 'Post button not found' }
  }

  if (postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true') {
    return { ok: false, error: 'Post button is currently disabled' }
  }

  postBtn.click()

  return {
    ok: true,
    clicked: true,
    text: postBtn.innerText.trim(),
    time: new Date().toISOString(),
    note: 'Post button clicked! Video submitted to TikTok.'
  }
} catch (err) {
  return { ok: false, error: err.message, stack: err.stack }
}
