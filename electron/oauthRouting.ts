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

    // OpenAI's own identity provider (Auth0-based) — confirmed via a real
    // capture: clicking "Continue with Google" on chatgpt.com/auth/login
    // navigates (via will-navigate, not window.open) to
    // auth.openai.com/api/accounts/authorize?...&connection=google-oauth2
    // FIRST, before ever reaching accounts.google.com. That first hop is a
    // different registrable domain (openai.com, not chatgpt.com), so without
    // this it was classified 'external' and sent to the OS browser — where
    // the resulting cookie lands in a session the app never sees, and the
    // login never completes back in the app. auth.openai.com itself then
    // redirects on to accounts.google.com, already covered above.
    if (host === 'auth.openai.com') return true

    return false
  } catch {
    return false
  }
}
