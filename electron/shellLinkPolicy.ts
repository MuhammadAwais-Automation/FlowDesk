/**
 * Link handling for FlowDesk's own UI — the React shell, not a hosted site.
 *
 * ── The gap this closes ──
 *
 * linkRouting.ts + sessions.ts already route links inside the site views
 * (WhatsApp, LinkedIn, Gmail): anything leaving the hosted app goes to the
 * system browser. Nothing covered the shell itself. So when the agent printed a
 * post link in chat and it was clicked, Electron did its default thing and
 * opened a bare popup window inside FlowDesk — a LinkedIn page with no session,
 * showing a sign-in wall, with no address bar and no way back.
 *
 * ── Why this is a separate policy, not the same one ──
 *
 * `routeLink` asks "is this still part of the app this view is hosting?", which
 * is the right question for a view opened to host WhatsApp. The shell hosts no
 * website. Its own origin is a dev server or a file:// bundle, and EVERY
 * http(s) link that appears in it — in agent output, in a rendered message, in
 * a tool result — came from somewhere else and belongs in the user's browser.
 * There is no in-app destination to weigh it against, so weighing is the wrong
 * shape: the shell navigates to nothing but itself.
 *
 * ── Why the scheme is checked ──
 *
 * `shell.openExternal` hands the string to the operating system, which will
 * launch whatever is registered for that scheme. The links reaching this code
 * are frequently written by strangers — a LinkedIn comment, a WhatsApp message,
 * a page the agent summarised — so the set of schemes is an allowlist rather
 * than a blocklist. `file:`, `javascript:` and application protocol handlers do
 * not get to leave through here.
 */

import { shell, type WebContents } from 'electron'

// One policy, one allowlist. The pure decision is shared with the renderer,
// which must not paint a link the main process would refuse to open.
import { shellLinkDecision } from '../src/lib/shellLinkDecision'

export { shellLinkDecision } from '../src/lib/shellLinkDecision'
export type { ShellLinkDecision } from '../src/lib/shellLinkDecision'

/**
 * Applies the policy to the shell's webContents.
 *
 * Both halves are needed and they catch different things: `window.open` and
 * `target="_blank"` go through the window-open handler, while an ordinary
 * `<a href>` never reaches it and would navigate the whole app away from
 * itself — leaving a user staring at a website where their app used to be,
 * with no address bar to escape with.
 */
export function attachShellLinkPolicy(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (shellLinkDecision(url, webContents.getURL()) === 'external') {
      void shell.openExternal(url)
    }
    // Denied in every case. The shell never opens a child window: one would
    // have no session, no address bar and no way back, which is precisely the
    // sign-in wall this replaced.
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, targetUrl) => {
    const decision = shellLinkDecision(targetUrl, webContents.getURL())
    if (decision === 'allow-in-shell') return

    // Prevented even when blocked. Letting a navigation the policy refused to
    // classify proceed anyway would make the refusal decorative.
    event.preventDefault()
    if (decision === 'external') void shell.openExternal(targetUrl)
  })
}
