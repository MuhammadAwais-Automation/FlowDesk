/**
 * The shell's link policy, as a pure decision.
 *
 * This lives under src/lib rather than beside `attachShellLinkPolicy` in
 * electron/ for one reason: BOTH processes need it. The main process enforces
 * it (a click that reaches Electron must not open a window or hit the OS),
 * and the renderer needs it too, because a URL the policy would refuse should
 * never have been painted as a clickable link in the first place. Two copies
 * of the allowlist would drift, and the half that drifted looser would be the
 * one that matters. So there is exactly one `EXTERNAL_SCHEMES` in the repo and
 * `electron/shellLinkPolicy.ts` re-exports this function rather than
 * redefining it.
 *
 * See electron/shellLinkPolicy.ts for the threat model this encodes.
 */

export type ShellLinkDecision =
  /** Hand to the operating system default browser. */
  | 'external'
  /** The shell navigating within itself — the app's own routes, dev-server reloads. */
  | 'allow-in-shell'
  /** Neither, and not safe to hand to the OS. Nothing happens. */
  | 'block'

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Decides what the shell should do with a URL.
 *
 * Pure, so the decisions can be tested without a window — which matters here
 * because the interesting cases (a `javascript:` URL from a message, an
 * `about:blank` popup) are exactly the ones that are awkward to reproduce by
 * hand in a running app.
 */
export function shellLinkDecision(targetUrl: string, shellUrl: string): ShellLinkDecision {
  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return 'block'
  }

  // The shell's own pages: the dev server during development, a file:// bundle
  // when packaged. Same origin means this is the app routing itself and must
  // not be deflected — deflecting it would send the app's own reload to Chrome.
  let shellOrigin = ''
  try {
    shellOrigin = new URL(shellUrl).origin
  } catch { /* no URL yet — treat as no origin, which matches nothing below */ }

  if (shellOrigin && shellOrigin !== 'null' && target.origin === shellOrigin) return 'allow-in-shell'

  // A packaged build loads from file://, where every page shares the opaque
  // "null" origin, so origin comparison cannot separate the app's own bundle
  // from an arbitrary local file. Compared by scheme instead, and only for the
  // shell's own scheme — a file: link arriving from a message still blocks,
  // because the shell is not a file: page in that case.
  if (target.protocol === 'file:' && shellUrl.startsWith('file:')) return 'allow-in-shell'

  return EXTERNAL_SCHEMES.has(target.protocol) ? 'external' : 'block'
}

/**
 * The href to paint for a stored citation, or `null` when there is none.
 *
 * A citation's `sourceRef` is captured verbatim from external social content
 * and is never scheme-validated on write, so it is attacker-controlled text.
 * Unlike a link the shell itself produced, a citation can only ever point
 * outward — the app is not the source of the evidence — so `allow-in-shell` is
 * not a legitimate answer here and only `external` yields an href. Callers
 * render the `null` case as inert text: a ref that cannot be opened safely
 * should not look openable.
 */
export function citationHref(sourceRef: string | null | undefined): string | null {
  if (!sourceRef) return null
  return shellLinkDecision(sourceRef, '') === 'external' ? sourceRef : null
}
