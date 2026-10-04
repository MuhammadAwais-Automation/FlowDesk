// @target tiktok.com
/**
 * tk-11-my-profile.js
 * Inspects user's own profile page: bio, followers, following, likes, and uploaded videos.
 */
if (!window.location.href.includes('/@alphapaws6')) {
  window.location.href = 'https://www.tiktok.com/@alphapaws6'
  return { navigating: true, target: 'https://www.tiktok.com/@alphapaws6' }
}

const followingEl = document.querySelector('[data-e2e="following-count"]')
const followersEl = document.querySelector('[data-e2e="followers-count"]')
const likesEl = document.querySelector('[data-e2e="likes-count"]')
const userBioEl = document.querySelector('[data-e2e="user-bio"]')
const userTitleEl = document.querySelector('[data-e2e="user-title"], h1[data-e2e="user-title"]')
const userSubtitleEl = document.querySelector('[data-e2e="user-subtitle"], h2[data-e2e="user-subtitle"]')

// Look for video items
const videoElements = Array.from(document.querySelectorAll('[data-e2e="user-post-item"]'))
const videos = []

for (const item of videoElements) {
  const link = item.querySelector('a')
  const viewsEl = item.querySelector('[data-e2e="video-views"]')
  const img = item.querySelector('img')
  videos.push({
    url: link ? link.href : null,
    views: viewsEl ? viewsEl.textContent.trim() : null,
    poster: img ? (img.currentSrc || img.src) : null,
  })
}

const allVideoLinks = Array.from(document.querySelectorAll('a[href*="/video/"]')).map(a => a.href)

return {
  ok: true,
  url: window.location.href,
  title: document.title,
  name: userTitleEl ? userTitleEl.textContent.trim() : null,
  username: userSubtitleEl ? userSubtitleEl.textContent.trim() : null,
  bio: userBioEl ? userBioEl.textContent.trim() : null,
  stats: {
    following: followingEl ? followingEl.textContent.trim() : null,
    followers: followersEl ? followersEl.textContent.trim() : null,
    likes: likesEl ? likesEl.textContent.trim() : null,
  },
  postCount: videoElements.length,
  videos,
  allVideoLinks: [...new Set(allVideoLinks)],
}
