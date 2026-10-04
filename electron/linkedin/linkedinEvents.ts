/**
 * Main-process store for LinkedIn realtime events.
 *
 * The page-side watcher (linkedinRealtime.ts) pushes every event it sees over
 * IPC. This holds them so a caller that was not listening at the moment can
 * still ask "what arrived while I was away" — which is what an agent always
 * needs, since it exists only in bursts.
 *
 * Kept apart from main.ts deliberately: main.ts cannot be unit-tested without
 * an Electron runtime, and the parts worth testing here are the ones easy to
 * get wrong — deduplication, the unread cursor, and not reporting the user's
 * own messages as if someone had written to them.
 */

export interface LinkedInRealtimeEvent {
  kind: string
  at: number
  messageUrn?: string | null
  conversationUrn?: string | null
  text?: string | null
  from?: string | null
  fromUrn?: string | null
  fromMe?: boolean
  isGroup?: boolean
  participants?: { urn: string | null; name: string | null }[]
  hasAttachment?: boolean
  topic?: string
}

const MAX_EVENTS = 300

const events: LinkedInRealtimeEvent[] = []
/** Message urns already stored, so a redelivered push does not appear twice. */
const seenMessageUrns = new Set<string>()
/** Cursor for "since you last asked". Advanced only by takeNewMessages(). */
let lastReadAt = 0

export function recordLinkedInEvent(event: LinkedInRealtimeEvent): boolean {
  if (!event || typeof event.kind !== 'string') return false

  // LinkedIn can redeliver a message on reconnect. Without this the same
  // message would be reported as new twice — which for a watcher whose whole
  // job is "tell me what arrived" is the failure that matters most.
  if (event.messageUrn) {
    if (seenMessageUrns.has(event.messageUrn)) return false
    seenMessageUrns.add(event.messageUrn)
    if (seenMessageUrns.size > MAX_EVENTS * 2) {
      const oldest = seenMessageUrns.values().next().value
      if (oldest) seenMessageUrns.delete(oldest)
    }
  }

  events.push({ ...event, at: typeof event.at === 'number' ? event.at : Date.now() })
  if (events.length > MAX_EVENTS) events.shift()
  return true
}

export function recentLinkedInEvents(limit = 20, kind?: string): LinkedInRealtimeEvent[] {
  const filtered = kind ? events.filter(e => e.kind === kind) : events
  return filtered.slice(-Math.max(1, limit))
}

/**
 * Incoming messages since the last call, advancing the cursor.
 *
 * Excludes the user's own messages: they arrive on this channel too when sent
 * from another device, and reporting "you have a new message from yourself"
 * would be noise dressed up as a notification.
 */
export function takeNewMessages(): { messages: LinkedInRealtimeEvent[]; since: number } {
  const since = lastReadAt
  const fresh = events.filter(e => e.kind === 'message' && !e.fromMe && e.at > since)
  lastReadAt = Date.now()
  return { messages: fresh, since }
}

/** Everything the store knows about itself — used by the watch-status tool. */
export function linkedInEventStats() {
  const messages = events.filter(e => e.kind === 'message')
  return {
    bufferedEvents: events.length,
    messageEvents: messages.length,
    incomingMessages: messages.filter(e => !e.fromMe).length,
    lastEventAt: events.length ? events[events.length - 1].at : null,
    lastMessageAt: messages.length ? messages[messages.length - 1].at : null,
    cursorAt: lastReadAt || null,
  }
}

/** Test seam. Not called in production. */
export function resetLinkedInEvents() {
  events.length = 0
  seenMessageUrns.clear()
  lastReadAt = 0
}
