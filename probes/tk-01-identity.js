// @target tiktok.com
/**
 * tk-01-identity.js
 *
 * Probe 1: TikTok Identity & Session Health
 * Checks whether user is signed into TikTok, extracts username, avatar, and core metrics.
 */

try {
  // Check NEXT_DATA or TikTok client state first
  const nextDataEl = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__') || document.getElementById('SIGI_STATE')
  let state = null
  if (nextDataEl) {
    try {
      state = JSON.parse(nextDataEl.textContent || '{}')
    } catch {}
  }

  // Also check window context or cookies
  const cookies = document.cookie
  const isLoggedIn = cookies.includes('sessionid') || cookies.includes('sid_guard') || Boolean(state?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo)

  // Extract user info if available
  const userDetail = state?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo || state?.UserModule?.users
  
  // Try finding DOM profile element
  const avatarImg = document.querySelector('img[data-e2e="user-avatar"], [data-e2e="profile-icon"] img')
  const profileLink = document.querySelector('a[data-e2e="profile-icon"]')

  return {
    isLoggedIn,
    cookiesPresent: {
      hasSessionId: cookies.includes('sessionid'),
      hasTtWebId: cookies.includes('ttwid') || cookies.includes('tt_webid'),
      hasCsrfToken: cookies.includes('csrf_session_id') || cookies.includes('passport_csrf_token'),
    },
    url: window.location.href,
    title: document.title,
    userDetail: userDetail || null,
    domHints: {
      avatarSrc: avatarImg ? avatarImg.src : null,
      profileHref: profileLink ? profileLink.href : null,
    }
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
