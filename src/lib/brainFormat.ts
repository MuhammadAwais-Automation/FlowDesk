import type { BrainEvent } from '@/types/brainKnowledge'

/** Local-day bounds for the events query — the day the user is having, not UTC. */
export function todayBounds(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function eventTime(iso: string): string {
  const at = new Date(iso)
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`
}

export function describeEvent(event: BrainEvent): string {
  const meta = event.metadata
  const text = (key: string) => typeof meta[key] === 'string' ? meta[key] as string : ''
  const count = (key: string) => typeof meta[key] === 'number' ? meta[key] as number : 0
  switch (event.action) {
    case 'agent.turn': {
      const prompt = text('prompt').replace(/\s+/g, ' ').trim()
      return prompt.length > 0 ? prompt : 'Agent turn'
    }
    case 'knowledge.accepted': return `Saved ${text('title') || text('path')} to the Library`
    case 'knowledge.imported': return `Imported ${count('imported')} documents from the vault`
    case 'knowledge.compacted': return `Folded ${count('merged')} captures into existing documents`
    case 'job.completed': return `${text('recipeId') || 'Job'} — ${text('status') || 'completed'}`
    case 'tool.action': return `${text('label') || 'Action'}${meta.failed === true ? ' — failed' : ''}`
  }
}

/**
 * Whether a timeline row has anything behind it to open.
 *
 * Only an agent turn does: it carries a sessionId, and the conversation is
 * still on disk. An import or a compaction is fully described by its own line,
 * and a button that opens nothing is worse than plain text.
 */
export function isOpenableEvent(event: BrainEvent): boolean {
  return event.action === 'agent.turn'
}

/** Document paths an agent turn read, as recorded on the event. */
export function documentsRead(event: BrainEvent): string[] {
  const read = event.metadata.documentsRead
  return Array.isArray(read) ? read.filter((path): path is string => typeof path === 'string') : []
}
