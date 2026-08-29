/**
 * Where a link clicked inside FlowDesk should open.
 *
 * ── The bug this replaces ──
 *
 * Both window-open handlers ended with `loadURL(openUrl)` on the view that was
 * already showing something. Clicking a link in WhatsApp therefore navigated
 * the WhatsApp view itself to that link: WhatsApp disappeared, and with no tab
 * strip in the Social page there was no way back except reloading the platform.
 * `will-navigate` was not handled at all, so an ordinary `target="_self"` link
 * did the same thing without even going through a handler.
 *
 * ── The rule ──
 *
 * A view is opened to host one thing — WhatsApp, LinkedIn, Gmail, an AI tool.
 * Navigation that stays inside that thing belongs in the view; everything else
 * belongs in the user's own browser, where they have tabs, history and a back
 * button. "Inside that thing" is judged by registrable domain, so
 * `web.whatsapp.com` → `faq.whatsapp.com` stays put while `youtube.com` does
 * not.
 *
 * Pure functions, no Electron imports, so the decisions are testable without a
 * window.
 */

import { isMailHost, isOAuthPopup } from './oauthRouting'

export type LinkDestination =
  /** Navigate the view itself — this is part of the app the view is hosting. */
  | 'in-app'
  /** Hand to the operating system default browser. */
  | 'external'
  /** A sign-in popup that must share the view session; child window. */
  | 'oauth-popup'

/**
 * The registrable part of a hostname — `web.whatsapp.com` → `whatsapp.com`.
 *
 * Deliberately the last two labels rather than a public-suffix lookup. A real
 * PSL would be correct for `bbc.co.uk`, but it is a dependency and a data file
 * that needs updating, and every host FlowDesk hosts is a plain two-label
 * domain. The failure mode is also the safe direction: on a multi-part suffix
 * this returns something narrower than the true registrable domain, so links
 * are sent to the browser rather than wrongly kept in-app.
 */
export function registrableHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (!host) return null
    // An IP address has no registrable domain; compare it whole.
    if (/^[0-9.]+$/.test(host) || host.includes(':')) return host
    const labels = host.split('.')
    return labels.length <= 2 ? host : labels.slice(-2).join('.')
  } catch {
    return null
  }
}

/** Same app, judged by registrable domain rather than exact host. */
export function isSameApp(targetUrl: string, homeUrl: string): boolean {
  const target = registrableHost(targetUrl)
  const home = registrableHost(homeUrl)
  return !!target && !!home && target === home
}

/**
 * Schemes that are the page talking to itself rather than a navigation
 * anywhere. Sending these to the system browser would break the page.
 */
function isInternalScheme(url: string): boolean {
  return /^(about:|blob:|data:|javascript:|chrome-extension:)/i.test(url.trim())
}

/**
 * Decides where a link should open.
 *
 * `homeUrl` is what the view is currently showing, which is also what defines
 * the app it belongs to.
 */
export function routeLink(targetUrl: string, homeUrl: string): LinkDestination {
  const target = String(targetUrl ?? '').trim()
  if (!target) return 'in-app'
  if (isInternalScheme(target)) return 'in-app'

  // mailto:, tel:, and anything else the OS knows how to handle. A view cannot
  // render these, and previously they fell through to loadURL and blanked it.
  if (!/^https?:/i.test(target)) return 'external'

  // Sign-in popups are cross-domain by nature, so the same-app test would send
  // them to the browser — where they would be useless, since the session that
  // needs the cookie lives here.
  if (isOAuthPopup(target)) return 'oauth-popup'

  // Gmail keeps its stricter rule: everything that is not Gmail itself goes to
  // the browser, including other Google properties. A Docs or Drive link from
  // an email is an external link to the person reading it.
  if (isMailHost(homeUrl)) {
    return isMailHost(target) ? 'in-app' : 'external'
  }

  return isSameApp(target, homeUrl) ? 'in-app' : 'external'
}
