/**
 * The entity spine — who and what, as opposed to the documents that talk about them.
 *
 * The Brain could retrieve well and still not answer "show me everything about
 * Yasir Bhai", because nothing knew that a vault document, a WhatsApp thread and
 * an Intelligence lead were about one person. Entities are that missing noun;
 * `entity_mentions` is how everything else points at them.
 *
 * The tables are not new. `entities`, `entity_aliases` and `entity_edges` have
 * been in the schema since v1 with working writers and zero rows. This module is
 * what finally drives them.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

type SqlRow = Record<string, unknown>

export type EntityType = 'person' | 'org' | 'project' | 'opportunity' | 'topic'

/** What a mention can point at. Open by design — a new target costs no schema. */
export type MentionTarget = 'document' | 'opportunity' | 'episode'

export interface EntityIdentifier {
  /** How this identity was established: 'handle', 'phone', 'email', 'urn'. */
  kind: string
  value: string
}

export interface BrainEntity {
  id: string
  scopeId: string
  type: EntityType
  name: string
  createdAt: string
  updatedAt: string
}

export interface EntityMention {
  entityId: string
  targetKind: MentionTarget
  targetId: string
  sourceRef: string
  createdAt: string
}

export interface EntityMergeProposal {
  id: string
  scopeId: string
  keepEntityId: string
  keepName: string
  mergeEntityId: string
  mergeName: string
  reason: string
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

export interface ResolveInput {
  scopeId: string
  type: EntityType
  name: string
  /** Present only when something trustworthy established the identity. */
  identifier?: EntityIdentifier
}

/**
 * Names are compared with case and surrounding space removed, and nothing else.
 *
 * Deliberately shallow. Anything cleverer -- stripping honorifics, collapsing
 * "Bhai", fuzzy distance -- starts merging people who merely sound alike, and a
 * wrong merge is the one failure this module is built to avoid.
 */
function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

/** Both halves are lowercased: 'PHONE' and 'phone' name the same kind of proof. */
function aliasKey(identifier: EntityIdentifier): string {
  return `${identifier.kind.trim().toLocaleLowerCase()}:${identifier.value.trim().toLocaleLowerCase()}`
}

function toEntity(row: SqlRow): BrainEntity {
  return {
    id: String(row.id),
    scopeId: String(row.scope_id),
    type: String(row.type) as EntityType,
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}


/**
 * Which document types name a thing rather than describe one.
 *
 * A `client` document is a company; a `research` document is *about* something
 * and naming an entity after it would fill the graph with nodes called
 * "Zapzone proposal blueprint". `decision`, `note`, `skill`, `source` and
 * `research` deliberately map to nothing.
 */
const DOCUMENT_ENTITY_TYPE: Partial<Record<string, EntityType>> = {
  client: 'org',
  person: 'person',
  project: 'project',
  me: 'person',
}

export interface BackfillReport {
  scanned: number
  created: number
  linked: number
}

export class EntityStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Finds or creates the entity this input names.
   *
   * The rule that matters: **an identifier merges, a name never does.** A phone
   * number or a verified handle is evidence that two mentions are one person; a
   * matching display name is a coincidence waiting to happen. So when an
   * identifier resolves to one entity while the same name already belongs to
   * another, this records a proposal and leaves both standing rather than
   * choosing. A duplicate is visible and fixable; a wrong merge quietly mixes
   * two clients' facts and may never be noticed.
   */
  resolve(input: ResolveInput): BrainEntity {
    const name = input.name.trim()
    if (name.length === 0) throw new Error('An entity needs a name')

    const byName = this.findByName(input.scopeId, name)
    if (!input.identifier) {
      // No identifier to trust, so a name match is all there is -- and it is
      // enough to find what a name created in the first place.
      return byName ?? this.create(input, undefined)
    }

    const byIdentifier = this.findByAlias(input.scopeId, input.identifier)
    if (byIdentifier) {
      if (byName && byName.id !== byIdentifier.id) {
        this.proposeMerge(byIdentifier, byName, `same name "${name}", different ${input.identifier.kind}`)
      }
      return byIdentifier
    }

    // The identifier is new. Attaching it to a same-named entity would be
    // exactly the unverified merge this module refuses, so the name match only
    // becomes a proposal.
    const created = this.create(input, input.identifier)
    if (byName) this.proposeMerge(created, byName, `same name "${name}", unverified match`)
    return created
  }

  /** Records that `targetId` talks about this entity. Idempotent, so backfills are free. */
  mention(entityId: string, targetKind: MentionTarget, targetId: string, sourceRef = ''): void {
    this.db.prepare(
      'INSERT OR IGNORE INTO entity_mentions(entity_id, target_kind, target_id, source_ref, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(entityId, targetKind, targetId, sourceRef, new Date().toISOString())
  }

  /** Everything that mentions this entity, newest first. */
  mentionsOf(entityId: string, targetKind?: MentionTarget): EntityMention[] {
    const rows = targetKind
      ? this.db.prepare('SELECT * FROM entity_mentions WHERE entity_id = ? AND target_kind = ? ORDER BY created_at DESC').all(entityId, targetKind)
      : this.db.prepare('SELECT * FROM entity_mentions WHERE entity_id = ? ORDER BY created_at DESC').all(entityId)
    return (rows as SqlRow[]).map(row => ({
      entityId: String(row.entity_id),
      targetKind: String(row.target_kind) as MentionTarget,
      targetId: String(row.target_id),
      sourceRef: String(row.source_ref ?? ''),
      createdAt: String(row.created_at),
    }))
  }

  /** The entities one target is about — the reverse of `mentionsOf`. */
  entitiesFor(scopeIds: string[], targetKind: MentionTarget, targetId: string): BrainEntity[] {
    if (scopeIds.length === 0) return []
    const placeholders = scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT e.* FROM entity_mentions m
      JOIN entities e ON e.id = m.entity_id
      WHERE m.target_kind = ? AND m.target_id = ? AND e.scope_id IN (${placeholders})
      ORDER BY e.name
    `).all(targetKind, targetId, ...scopeIds)
    return (rows as SqlRow[]).map(toEntity)
  }

  list(scopeIds: string[], type?: EntityType): BrainEntity[] {
    if (scopeIds.length === 0) return []
    const placeholders = scopeIds.map(() => '?').join(', ')
    const sql = `SELECT * FROM entities WHERE scope_id IN (${placeholders})${type ? ' AND type = ?' : ''} ORDER BY name`
    const rows = type
      ? this.db.prepare(sql).all(...scopeIds, type)
      : this.db.prepare(sql).all(...scopeIds)
    return (rows as SqlRow[]).map(toEntity)
  }

  get(scopeIds: string[], id: string): BrainEntity | null {
    if (scopeIds.length === 0) return null
    const placeholders = scopeIds.map(() => '?').join(', ')
    const row = this.db.prepare(`SELECT * FROM entities WHERE id = ? AND scope_id IN (${placeholders})`).get(id, ...scopeIds) as SqlRow | undefined
    return row ? toEntity(row) : null
  }

  listProposals(scopeIds: string[]): EntityMergeProposal[] {
    if (scopeIds.length === 0) return []
    const placeholders = scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT p.*, k.name AS keep_name, m.name AS merge_name
      FROM entity_merge_proposals p
      JOIN entities k ON k.id = p.keep_entity_id
      JOIN entities m ON m.id = p.merge_entity_id
      WHERE p.scope_id IN (${placeholders}) AND p.status = 'pending'
      ORDER BY p.created_at DESC
    `).all(...scopeIds)
    return (rows as SqlRow[]).map(row => ({
      id: String(row.id),
      scopeId: String(row.scope_id),
      keepEntityId: String(row.keep_entity_id),
      keepName: String(row.keep_name),
      mergeEntityId: String(row.merge_entity_id),
      mergeName: String(row.merge_name),
      reason: String(row.reason),
      status: String(row.status) as EntityMergeProposal['status'],
      createdAt: String(row.created_at),
    }))
  }

  /**
   * Accepting moves everything onto the kept entity and deletes the other; the
   * whole move is one transaction, because a half-merged entity is worse than
   * either of the two it came from.
   */
  decideProposal(id: string, decision: 'accept' | 'reject'): boolean {
    const row = this.db.prepare("SELECT * FROM entity_merge_proposals WHERE id = ? AND status = 'pending'").get(id) as SqlRow | undefined
    if (!row) return false
    const decidedAt = new Date().toISOString()
    if (decision === 'reject') {
      this.db.prepare('UPDATE entity_merge_proposals SET status = ?, decided_at = ? WHERE id = ?').run('rejected', decidedAt, id)
      return true
    }
    const keep = String(row.keep_entity_id)
    const merge = String(row.merge_entity_id)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE OR IGNORE entity_aliases SET entity_id = ? WHERE entity_id = ?').run(keep, merge)
      this.db.prepare('UPDATE OR IGNORE entity_mentions SET entity_id = ? WHERE entity_id = ?').run(keep, merge)
      // Whatever the UPDATE OR IGNORE could not move was already true of the
      // kept entity, so dropping it loses nothing.
      this.db.prepare('DELETE FROM entity_aliases WHERE entity_id = ?').run(merge)
      this.db.prepare('DELETE FROM entity_mentions WHERE entity_id = ?').run(merge)
      this.db.prepare('DELETE FROM entity_edges WHERE from_entity_id = ? OR to_entity_id = ?').run(merge, merge)
      // Every proposal naming the merged entity goes, including this one. A
      // rejected proposal has to survive -- its UNIQUE(keep, merge) row is what
      // stops the same pair being offered again -- but nothing can be re-offered
      // against an entity that no longer exists, and the rows reference it.
      this.db.prepare('DELETE FROM entity_merge_proposals WHERE keep_entity_id = ? OR merge_entity_id = ?').run(merge, merge)
      this.db.prepare('DELETE FROM entities WHERE id = ?').run(merge)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return true
  }


  /**
   * Gives the Library's people, clients and projects the entities they always
   * were.
   *
   * A vault document carries no phone number or URN, so these resolve by name
   * alone -- which is exactly the case where resolution must not invent a
   * merge. Later, when a WhatsApp thread arrives with a real identifier, the
   * two are proposed rather than joined, and the owner decides.
   *
   * Idempotent: resolving finds what it made last time, and `mention` ignores a
   * duplicate, so re-running costs nothing and changes nothing.
   */
  backfillFromDocuments(scopeIds: string[]): BackfillReport {
    if (scopeIds.length === 0) return { scanned: 0, created: 0, linked: 0 }
    const placeholders = scopeIds.map(() => '?').join(', ')
    const rows = this.db.prepare(`
      SELECT id, scope_id, type, title, path FROM knowledge_documents
      WHERE scope_id IN (${placeholders}) AND valid_to IS NULL
      ORDER BY path
    `).all(...scopeIds) as SqlRow[]

    let created = 0
    let linked = 0
    for (const row of rows) {
      const entityType = DOCUMENT_ENTITY_TYPE[String(row.type)]
      if (!entityType) continue
      const before = this.countIn(String(row.scope_id))
      const entity = this.resolve({ scopeId: String(row.scope_id), type: entityType, name: String(row.title) })
      if (this.countIn(String(row.scope_id)) > before) created += 1
      const mentionsBefore = this.mentionsOf(entity.id, 'document').length
      this.mention(entity.id, 'document', String(row.id), String(row.path))
      if (this.mentionsOf(entity.id, 'document').length > mentionsBefore) linked += 1
    }
    return { scanned: rows.length, created, linked }
  }

  private countIn(scopeId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM entities WHERE scope_id = ?').get(scopeId) as SqlRow
    return Number(row.c ?? 0)
  }

  private findByName(scopeId: string, name: string): BrainEntity | null {
    const rows = this.db.prepare('SELECT * FROM entities WHERE scope_id = ?').all(scopeId) as SqlRow[]
    const target = normaliseName(name)
    const match = rows.find(row => normaliseName(String(row.name)) === target)
    return match ? toEntity(match) : null
  }

  private findByAlias(scopeId: string, identifier: EntityIdentifier): BrainEntity | null {
    const row = this.db.prepare(`
      SELECT e.* FROM entity_aliases a
      JOIN entities e ON e.id = a.entity_id
      WHERE a.alias = ? AND e.scope_id = ?
    `).get(aliasKey(identifier), scopeId) as SqlRow | undefined
    return row ? toEntity(row) : null
  }

  private create(input: ResolveInput, identifier: EntityIdentifier | undefined): BrainEntity {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO entities(id, scope_id, type, name, properties_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.scopeId, input.type, input.name.trim(), '{}', timestamp, timestamp)
    if (identifier) {
      this.db.prepare('INSERT OR IGNORE INTO entity_aliases(id, entity_id, alias, verified) VALUES (?, ?, ?, 1)')
        .run(randomUUID(), id, aliasKey(identifier))
    }
    return { id, scopeId: input.scopeId, type: input.type, name: input.name.trim(), createdAt: timestamp, updatedAt: timestamp }
  }

  private proposeMerge(keep: BrainEntity, merge: BrainEntity, reason: string): void {
    if (keep.id === merge.id || keep.scopeId !== merge.scopeId) return
    this.db.prepare(
      'INSERT OR IGNORE INTO entity_merge_proposals(id, scope_id, keep_entity_id, merge_entity_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), keep.scopeId, keep.id, merge.id, reason, 'pending', new Date().toISOString())
  }
}
