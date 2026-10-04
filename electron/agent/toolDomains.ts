/**
 * Which families of worker tools a turn actually needs.
 *
 * Measured reason this exists: after the claude_code preset was dropped, one
 * first message still sent 37,532 tokens, and roughly 31,000 of those were the
 * 91 worker tool schemas -- every LinkedIn, Studio and Flow tool shipped on a
 * question about the owner's own profile. Tool schemas render before the system
 * prompt and the messages, so they are paid on every fresh session whether or
 * not a single one is called.
 *
 * The routing is deliberately keyword-shaped and deliberately generous. It runs
 * before the model sees anything, so it cannot ask what the user meant; a false
 * positive costs tokens, while a false negative costs the agent an ability it
 * cannot even discover it is missing. When in doubt, load it.
 */

export type ToolDomain =
  | 'whatsapp'
  | 'linkedin'
  | 'reddit'
  | 'facebook'
  | 'flow'
  | 'notebooklm'
  | 'project'

/**
 * Domains that are never routed away.
 *
 * The five ask_* providers are the agent's whole purpose, the Brain answers
 * questions about the owner (which rarely name the Brain -- "tum mere baray
 * mein kya jaante ho" contains no keyword any router would catch), and the two
 * image tools are small enough that gating them would save nothing.
 */
export const ALWAYS_LOADED = ['workers', 'brain', 'image'] as const

const TRIGGERS: Record<ToolDomain, RegExp> = {
  whatsapp: /\b(whatsapp|wa|chat|message|msg|paigham|unread|contact|send to|bhej)/i,
  linkedin: /\b(linkedin|post|feed|connection|profile|outreach|dm|comment|lead)/i,
  reddit: /\b(reddit|subreddit|upvote|downvote|karma|r\/)\b/i,
  facebook: /\b(facebook|fb|meta|page|reel|group)/i,
  flow: /\b(flow|image|video|generate|banao|picture|thumbnail|render|veo|imagen)/i,
  notebooklm: /\b(notebook|notebooklm|research|source|deep research|cite|paper)/i,
  project: /\b(project|workspace|repo|file|folder|code|build|directory)/i,
}

/**
 * Domains the text asks for. Matching is on the whole recent conversation, not
 * just the newest message, because "ab usay bhej do" names nothing at all.
 */
export function selectToolDomains(text: string): Set<ToolDomain> {
  const selected = new Set<ToolDomain>()
  for (const [domain, pattern] of Object.entries(TRIGGERS) as [ToolDomain, RegExp][]) {
    if (pattern.test(text)) selected.add(domain)
  }
  return selected
}

/**
 * Grows a session's domain set; never shrinks it.
 *
 * Tool definitions sit ahead of the system prompt and the messages in the
 * cached prefix, so changing the set invalidates the whole cache. A set that
 * only ever grows means a session pays that once per newly-needed domain
 * instead of every time the subject drifts -- and it also means an ability the
 * agent used on turn 2 is still there on turn 7, when the user says "do that
 * again" and names nothing.
 */
export function widenDomains(existing: Iterable<ToolDomain>, text: string): Set<ToolDomain> {
  const next = new Set(existing)
  for (const domain of selectToolDomains(text)) next.add(domain)
  return next
}
