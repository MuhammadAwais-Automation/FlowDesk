/**
 * Renders one day's activity as a markdown document.
 *
 * No model call. Every line is a projection of rows already in the timeline, so
 * the note is reproducible, auditable, and free — and re-rendering the same day
 * twice yields byte-identical output, which is what lets `upsert` no-op on an
 * unchanged content hash instead of rewriting history.
 *
 * Verbatim rows beat extracted summaries in the memory literature (arXiv
 * 2601.00821), and an LLM pass here would cost a call per day to produce
 * something less checkable.
 */

import type { BrainEvent } from '../../../src/types/brainKnowledge'

/** Daily notes live under this prefix and are excluded from the agent's index. */
export const DAILY_NOTE_PREFIX = 'daily/'

export function dailyNotePath(date: string): string {
  return `${DAILY_NOTE_PREFIX}${date}.md`
}

/** Local calendar day for an ISO instant — the day the user experienced, not UTC. */
export function localDayOf(iso: string): string {
  const at = new Date(iso)
  const month = `${at.getMonth() + 1}`.padStart(2, '0')
  const day = `${at.getDate()}`.padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/** Half-open [from, to) bounds of a local day, as ISO instants for SQL. */
export function localDayBounds(date: string): { from: string; to: string } {
  const [year, month, day] = date.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  const end = new Date(year, month - 1, day + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

function timeOf(iso: string): string {
  const at = new Date(iso)
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function oneLine(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > 0 ? text : fallback
}

function truncate(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`
}

/** `[[wiki/clients/yasir-bhai.md]]` — the link form the rest of the store already parses. */
function wikiLink(path: string): string {
  return `[[${path}]]`
}

export interface DailyNote {
  date: string
  path: string
  title: string
  summary: string
  body: string
  /** Empty when the day has no activity worth a document. */
  isEmpty: boolean
}

export function renderDailyNote(date: string, events: BrainEvent[]): DailyNote {
  const turns = events.filter(event => event.action === 'agent.turn')
  const accepted = events.filter(event => event.action === 'knowledge.accepted')
  const imports = events.filter(event => event.action === 'knowledge.imported')
  const compactions = events.filter(event => event.action === 'knowledge.compacted')
  const jobs = events.filter(event => event.action === 'job.completed')
  const actions = events.filter(event => event.action === 'tool.action')

  const costUsd = turns.reduce((sum, event) => sum + asNumber(event.metadata.totalCostUsd), 0)
  const tokens = turns.reduce(
    (sum, event) => sum + asNumber(event.metadata.inputTokens) + asNumber(event.metadata.outputTokens),
    0,
  )
  const documentsRead = new Set(turns.flatMap(event => asStrings(event.metadata.documentsRead)))

  const lines: string[] = [`# ${date}`, '']

  const counts = [
    turns.length > 0 ? `${turns.length} agent turn${turns.length === 1 ? '' : 's'}` : null,
    actions.length > 0 ? `${actions.length} action${actions.length === 1 ? '' : 's'}` : null,
    accepted.length > 0 ? `${accepted.length} saved to Library` : null,
    jobs.length > 0 ? `${jobs.length} job${jobs.length === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => part !== null)
  if (counts.length > 0) lines.push(counts.join(' · '), '')

  if (turns.length > 0) {
    lines.push('## Conversations', '')
    for (const event of turns) {
      const ask = truncate(oneLine(event.metadata.prompt, '(no prompt recorded)'), 140)
      lines.push(`- **${timeOf(event.createdAt)}** ${ask}`)
      const read = asStrings(event.metadata.documentsRead)
      if (read.length > 0) lines.push(`  - read ${read.map(wikiLink).join(', ')}`)
      const tools = asStrings(event.metadata.tools)
      if (tools.length > 0) lines.push(`  - used ${tools.join(', ')}`)
    }
    lines.push('')
  }

  if (actions.length > 0) {
    lines.push('## Actions', '')
    for (const event of actions) {
      const label = oneLine(event.metadata.label, 'Action')
      lines.push(`- **${timeOf(event.createdAt)}** ${label}${event.metadata.failed === true ? ' — failed' : ''}`)
    }
    lines.push('')
  }

  if (accepted.length > 0) {
    lines.push('## Added to the Library', '')
    for (const event of accepted) {
      const path = oneLine(event.metadata.path, '')
      const title = oneLine(event.metadata.title, path || '(untitled)')
      lines.push(`- ${path ? `${wikiLink(path)} — ` : ''}${title}`)
    }
    lines.push('')
  }

  if (imports.length > 0 || compactions.length > 0) {
    lines.push('## Maintenance', '')
    for (const event of imports) {
      lines.push(`- Imported ${asNumber(event.metadata.imported)} documents from the vault`)
    }
    for (const event of compactions) {
      lines.push(`- Compaction folded ${asNumber(event.metadata.merged)} captures into existing documents`)
    }
    lines.push('')
  }

  if (jobs.length > 0) {
    lines.push('## Jobs', '')
    for (const event of jobs) {
      lines.push(`- ${oneLine(event.metadata.recipeId, 'job')} — ${oneLine(event.metadata.status, 'completed')}`)
    }
    lines.push('')
  }

  if (turns.length > 0) {
    lines.push('## Cost', '')
    lines.push(`- ${tokens.toLocaleString('en-US')} tokens across ${turns.length} turn${turns.length === 1 ? '' : 's'}`)
    if (costUsd > 0) lines.push(`- $${costUsd.toFixed(4)}`)
    lines.push('')
  }

  const summaryParts = [
    counts.join(' · '),
    documentsRead.size > 0 ? `${documentsRead.size} document${documentsRead.size === 1 ? '' : 's'} consulted` : null,
  ].filter((part): part is string => part !== null && part.length > 0)

  return {
    date,
    path: dailyNotePath(date),
    title: date,
    summary: truncate(summaryParts.join(' · '), 110),
    body: lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    isEmpty: events.length === 0,
  }
}
