import { defaultUrlTransform } from 'react-markdown'

/**
 * FlowDesk's own custom protocols, both registered in electron/main.ts and
 * both serving files this app itself wrote to local disk:
 *   flowdesk-image:// — a generated image saved by the capture pipeline
 *   studio-asset://   — an image copied into a Studio document
 */
const FLOWDESK_PROTOCOL = /^(?:flowdesk-image|studio-asset):/i

/**
 * react-markdown's URL sanitizer, widened by exactly those two schemes.
 *
 * Without this, every generated image vanished silently: defaultUrlTransform
 * allows only http/https/irc/mailto/xmpp and rewrites anything else to '',
 * so a correct ![alt](flowdesk-image://….png) reached the img renderer with
 * an empty src and was dropped. Nothing errored, which is why it read as
 * "the image just doesn't show".
 *
 * Deliberately delegates to defaultUrlTransform rather than replacing it, so
 * javascript: and every other unsafe scheme stay blocked — the allowlist is
 * widened, not disabled.
 */
export function flowdeskUrlTransform(url: string): string {
  if (FLOWDESK_PROTOCOL.test(url)) return url
  return defaultUrlTransform(url)
}
