/**
 * Parser for LinkedIn's realtime event stream.
 *
 * Deliberately plain TypeScript with no Electron or CDP dependency, so it can
 * be tested against real captured frames. The first version of this logic lived
 * inside an injected page-script string, where TypeScript could not check it
 * and no test could reach it — and the injection turned out not to work at all,
 * which took a live experiment to discover rather than a test run.
 *
 * Frame format (verified against a real capture, see probes/FINDINGS-linkedin.md):
 *
 *   data: {"com.linkedin.realtimefrontend.DecoratedEvent":{
 *     "topic":"urn:li-realtime:messagesTopic:urn:li-realtime:myself",
 *     "leftServerAt":1787372227428,
 *     "payload":{"data":{"doDecorateMessageMessengerRealtimeDecoration":{"result":{…}}}}
 *   }}
 */

import type { LinkedInRealtimeEvent } from './linkedinEvents'

interface NameLike { text?: string }
interface Member { firstName?: NameLike | string; lastName?: NameLike | string; headline?: NameLike | string }
interface Participant { hostIdentityUrn?: string; entityUrn?: string; participantType?: { member?: Member } }

function textOf(value: NameLike | string | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.text ?? null
}

export function nameOf(participant: Participant | undefined): string | null {
  if (!participant) return null
  const member = participant.participantType?.member
  if (!member) return null
  const name = [textOf(member.firstName), textOf(member.lastName)].filter(Boolean).join(' ')
  return name || null
}

/**
 * The mailbox owner is the first component of every message urn:
 *   urn:li:msg_message:(urn:li:fsd_profile:<SELF>,<id>)
 * which is how "did I send this?" is answered without an extra API call.
 */
export function selfFromMessageUrn(urn: string | null | undefined): string | null {
  const match = /^urn:li:msg_message:\((urn:li:fsd_profile:[^,]+),/.exec(urn ?? '')
  return match ? match[1] : null
}

/** `urn:li-realtime:messagesTopic:urn:li-realtime:myself` → `messagesTopic`. */
export function shortTopic(topic: string | undefined): string {
  const match = /urn:li-realtime:([A-Za-z0-9]+):/.exec(topic ?? '')
  return match ? match[1] : topic || 'unknown'
}

interface DecoratedEvent {
  topic?: string
  leftServerAt?: number
  payload?: { data?: Record<string, { result?: Record<string, unknown> }> }
}

export function parseDecoratedEvent(decorated: DecoratedEvent): LinkedInRealtimeEvent | null {
  if (!decorated || typeof decorated !== 'object') return null

  const topic = decorated.topic ?? ''
  const kind = shortTopic(topic)
  const data = decorated.payload?.data ?? {}
  // The decoration key is query-specific and changes with LinkedIn's build, so
  // it is discovered rather than hardcoded.
  const decorationKey = Object.keys(data).find(key => key.startsWith('doDecorate'))
  const result = decorationKey ? data[decorationKey]?.result : undefined

  if (kind !== 'messagesTopic' || !result) {
    // Everything else is kept thin: useful as signal ("they are typing", "they
    // read it"), not worth carrying a full payload for.
    return { kind, at: decorated.leftServerAt ?? Date.now(), topic }
  }

  const conversation = (result.conversation ?? {}) as {
    entityUrn?: string
    groupChat?: boolean
    conversationParticipants?: Participant[]
  }
  const actor = result.actor as Participant | undefined
  const messageUrn = (result.entityUrn as string | undefined) ?? null
  const self = selfFromMessageUrn(messageUrn)
  const actorUrn = actor?.hostIdentityUrn ?? null
  const body = result.body as { text?: string } | undefined
  const renderContent = result.renderContent as unknown[] | undefined

  return {
    kind: 'message',
    at: (result.deliveredAt as number | undefined) ?? decorated.leftServerAt ?? Date.now(),
    messageUrn,
    conversationUrn: conversation.entityUrn ?? null,
    text: typeof body?.text === 'string' ? body.text : null,
    from: nameOf(actor),
    fromUrn: actorUrn,
    // A message the user sent from another device arrives here too, so this
    // decides whether it is worth surfacing as "someone messaged you" at all.
    fromMe: !!(self && actorUrn && self === actorUrn),
    isGroup: !!conversation.groupChat,
    participants: (conversation.conversationParticipants ?? []).map(p => ({
      urn: p.hostIdentityUrn ?? null,
      name: nameOf(p),
    })),
    hasAttachment: Array.isArray(renderContent) && renderContent.length > 0,
  }
}

export interface StreamParseResult {
  events: LinkedInRealtimeEvent[]
  /** Bytes left over, to be prepended to the next chunk. */
  remainder: string
  parseErrors: number
}

/**
 * Feeds raw stream text through, returning whole events and whatever is left
 * mid-line.
 *
 * Chunk boundaries fall anywhere — a single decorated event runs to ~18KB — so
 * a parser that assumed each chunk was one complete frame would drop or corrupt
 * most of them.
 */
export function parseStreamChunk(buffer: string): StreamParseResult {
  const events: LinkedInRealtimeEvent[] = []
  let parseErrors = 0
  let rest = buffer

  for (;;) {
    const index = rest.indexOf('\n')
    if (index === -1) break
    const line = rest.slice(0, index)
    rest = rest.slice(index + 1)
    if (!line.startsWith('data:')) continue

    const json = line.slice(5).trim()
    if (!json) continue
    try {
      const parsed = JSON.parse(json) as Record<string, DecoratedEvent>
      const decorated = parsed['com.linkedin.realtimefrontend.DecoratedEvent']
      if (!decorated) continue
      const event = parseDecoratedEvent(decorated)
      if (event) events.push(event)
    } catch {
      // A truncated or unexpected frame is counted, never thrown: one bad frame
      // must not stop a channel that stays open for the whole session.
      parseErrors++
    }
  }

  return { events, remainder: rest, parseErrors }
}
