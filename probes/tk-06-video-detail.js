// @target tiktok.com
// Navigate to video page to test full detail extraction - Pass 2
try {
  const descEl = document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]')
  const musicEl = document.querySelector('[data-e2e="browse-music"], [data-e2e="video-music"]')
  const likeEl = document.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"]')
  const commentEl = document.querySelector('[data-e2e="comment-count"], [data-e2e="browse-comment-count"]')
  const shareEl = document.querySelector('[data-e2e="share-count"], [data-e2e="browse-share-count"]')
  const authorEl = document.querySelector('[data-e2e="browse-username"], [data-e2e="user-title"]')

  // Extract comments if visible
  const commentItems = Array.from(document.querySelectorAll('[data-e2e="comment-level-1"]')).map(c => {
    const u = c.querySelector('[data-e2e="comment-username"]')
    return {
      user: u ? u.innerText.trim() : null,
      text: c.innerText.trim(),
    }
  }).slice(0, 5)

  return {
    url: window.location.href,
    author: authorEl ? authorEl.innerText.trim() : null,
    caption: descEl ? descEl.innerText.trim() : null,
    music: musicEl ? musicEl.innerText.trim() : null,
    likes: likeEl ? likeEl.innerText.trim() : null,
    comments: commentEl ? commentEl.innerText.trim() : null,
    shares: shareEl ? shareEl.innerText.trim() : null,
    commentSample: commentItems,
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
