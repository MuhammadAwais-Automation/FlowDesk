/**
 * URL classification helpers for Electron's setWindowOpenHandler.
 *
 * Pure functions. No Electron / Node-specific imports — testable in vitest.
 */

/** True if the URL belongs to Google Mail (or a subdomain thereof). */
export function isMailHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'mail.google.com' || host.endsWith('.mail.google.com')
  } catch {
    return false
  }
}

/**
 * True if the URL looks like an OAuth popup that needs to share the parent
 * session. Any window.open() to these endpoints should land in a child
 * BrowserWindow with the same partition so cookies / tokens persist.
 */
export function isOAuthPopup(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()

    // Google OAuth (consent screen, signin, OAuth flow)
    if (host === 'accounts.google.com') return true

    // GitHub OAuth (used by Anthropic / Claude in some flows)
    if (host === 'github.com' && u.pathname.startsWith('/login/oauth')) return true

    return false
  } catch {
    return false
  }
}
