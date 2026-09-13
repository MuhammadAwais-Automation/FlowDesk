/**
 * One-time migration: folds the old `memories` store into
 * `knowledge_documents`, so there is one knowledge store instead of two that
 * nothing keeps in sync with each other. Old rows are left in place —
 * `memories`/`memory_candidates` are not dropped — this only stops being the
 * write destination going forward (see `brainTools.ts`'s `brain_remember`).
 *
 * Idempotent: the destination path and content hash are both fully
 * determined by the memory's own id/text, so re-running finds nothing new to
 * write the second time (`DocumentStorePort.upsert` already no-ops on an
 * unchanged content hash).
 */

import { createHash } from 'node:crypto'
import type { BrainMemory } from '../../../src/types/brain'
import type { KnowledgeDocType } from '../../../src/types/brainKnowledge'
import type { DocumentStorePort } from './ports'

export interface MigrateMemoriesInput {
  memories: BrainMemory[]
  dryRun?: boolean
}

export interface MigrateMemoriesReport {
  scanned: number
  migrated: number
  unchanged: number
  dryRun: boolean
}

const TITLE_MAX_LENGTH = 80

function truncateAtWordBoundary(text: string, maximumLength: number): string {
  if (text.length <= maximumLength) return text
  const prefix = text.slice(0, maximumLength + 1)
  const boundary = prefix.search(/\s+\S*$/)
  return (boundary > 0 ? prefix.slice(0, boundary) : text.slice(0, maximumLength)).trimEnd()
}

function deriveTitle(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return truncateAtWordBoundary(firstLine.length > 0 ? firstLine : text.trim(), TITLE_MAX_LENGTH) || '(untitled memory)'
}

/**
 * `KnowledgeDocType` has no 1:1 equivalent for every `MemoryKind` (no
 * "goal"/"organization"/"preference"/"procedure"/"opportunity" type) — those
 * fold into 'note' rather than forcing an inaccurate mapping. `decision` and
 * `person` do have exact matches.
 */
/** Exported for brain_remember (brainTools.ts), which proposes new memory-shaped
 *  knowledge with the same kind vocabulary this migration folds the old ones from. */
export function toDocType(kind: BrainMemory['kind']): KnowledgeDocType {
  if (kind === 'decision') return 'decision'
  if (kind === 'person') return 'person'
  return 'note'
}

function toPath(memory: BrainMemory): string {
  return `memories/${memory.kind}/${memory.id}.md`
}

function toBody(memory: BrainMemory): string {
  const metadata = [
    `Source: ${memory.sourceRef}`,
    memory.subject ? `Subject: ${memory.subject}` : null,
    memory.predicate ? `Predicate: ${memory.predicate}` : null,
  ].filter((line): line is string => line !== null)
  return [...metadata, '', memory.text].join('\n')
}

function contentHashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

export function migrateMemories(documents: DocumentStorePort, input: MigrateMemoriesInput): MigrateMemoriesReport {
  const dryRun = input.dryRun ?? false
  // Only accepted memories become knowledge — a rejected/deleted/superseded
  // row was never a fact worth carrying forward, and 'candidate' rows belong
  // to the review flow, not the migrated corpus.
  const accepted = input.memories.filter(memory => memory.status === 'accepted')
  let migrated = 0
  let unchanged = 0

  for (const memory of accepted) {
    const body = toBody(memory)
    const contentHash = contentHashOf(body)
    if (dryRun) {
      const existing = documents.read([memory.scopeId], toPath(memory))
      if (existing?.document.contentHash === contentHash) unchanged += 1
      else migrated += 1
      continue
    }
    const before = documents.read([memory.scopeId], toPath(memory))
    documents.upsert({
      scopeId: memory.scopeId,
      path: toPath(memory),
      type: toDocType(memory.kind),
      title: deriveTitle(memory.text),
      summary: '',
      body,
      origin: 'curated',
      contentHash,
      updatedAt: memory.updatedAt,
    })
    if (before?.document.contentHash === contentHash) unchanged += 1
    else migrated += 1
  }

  return { scanned: accepted.length, migrated, unchanged, dryRun }
}
