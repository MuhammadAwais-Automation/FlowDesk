// @target tiktok.com
/**
 * tk-05-manage.js
 *
 * Probe 5: TikTok Video Management & Analytics
 * Inspects creator video list, individual video analytics (views, shares, retention),
 * and delete controls.
 */

try {
  // Check if we are on user profile or creator content management page
  const isProfile = window.location.href.includes('/@') || window.location.href.includes('/creator-center/content')
  
  // Videos on profile
  const videoItems = Array.from(document.querySelectorAll('[data-e2e="user-post-item"]')).map((el, idx) => {
    const link = el.querySelector('a')
    const viewCount = el.querySelector('[data-e2e="video-views"]')
    return {
      index: idx,
      href: link ? link.href : null,
      views: viewCount ? viewCount.textContent.trim() : null,
    }
  })

  // Check delete modal or options menu
  const moreMenus = Array.from(document.querySelectorAll('[data-e2e="video-more-menu"], [aria-label="More options"]')).length

  return {
    isProfile,
    url: window.location.href,
    userVideosCount: videoItems.length,
    videos: videoItems.slice(0, 15),
    moreMenusCount: moreMenus,
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
