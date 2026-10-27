import type { ActionKind } from './types'

/**
 * Actions that reach other people or money cannot be undone, so they wait for
 * the user's yes: the agent asks in chat, then repeats the call with
 * `confirm: true`. Element names come from the page and are data — a page can
 * name a button anything, so this errs towards asking.
 */
const RISKY = /\b(send|post|publish|share|reply|comment|tweet|pay|buy|purchase|order|checkout|donate|transfer|withdraw|delete|remove|discard|erase|submit|confirm|upload|subscribe|unsubscribe|follow|invite|connect|accept|decline|sign out|log ?out)\b/i
const CLICKABLE = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'generic', 'image', 'row', 'gridcell', 'cell', 'listitem'])
/** Enter in a search box only searches. */
const SEARCHY = /search|find|filter/i

export interface SafetyInput {
  action: ActionKind
  key?: string
  text?: string
}

/** Why the action needs the user's yes first, or null when it does not. */
export function confirmReason(req: SafetyInput, target?: { role: string; name: string }): string | null {
  const name = target?.name ?? ''
  const label = target ? `${target.role} "${name}"` : 'the page'
  const ask = (what: string) => `${what} — ask the user first, then repeat with confirm: true`

  if (req.action === 'upload') return ask('uploading puts local files on the site')
  if (req.action === 'click' && target && CLICKABLE.has(target.role) && RISKY.test(name)) {
    return ask(`clicking ${label} may send, post, pay or delete`)
  }
  const submitsText = (req.action === 'key' && req.key === 'Enter') || (req.action === 'type' && /[\r\n]/.test(req.text ?? ''))
  if (submitsText && !(target && (target.role === 'searchbox' || SEARCHY.test(name)))) {
    return ask(`Enter in ${label} may send the message or submit the form`)
  }
  return null
}
