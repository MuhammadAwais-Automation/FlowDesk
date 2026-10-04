// @target tiktok.com
/**
 * tk-07-video-download.js
 * Inspect video elements to extract direct MP4 streaming URL
 */
try {
  const videoEl = document.querySelector('video')
  const src = videoEl ? (videoEl.currentSrc || videoEl.src) : null
  const sourceEl = document.querySelector('video source')
  const sourceSrc = sourceEl ? sourceEl.src : null

  return {
    found: Boolean(videoEl),
    src,
    sourceSrc,
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
