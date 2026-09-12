import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from './database'
import { VaultManager } from './vault'

const roots: string[] = []

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'flowdesk-vault-'))
  roots.push(root)
  const database = new BrainDatabase(join(root, 'brain.sqlite'))
  const vault = new VaultManager(database, join(root, 'vault'))
  const scope = database.ensureScope({ type: 'workspace', externalRef: 'workspace', name: 'Workspace' })
  return { database, vault, scope }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('VaultManager', () => {
  it('renders accepted memory as deterministic Obsidian-compatible Markdown', () => {
    const { database, vault, scope } = setup()
    const memory = database.remember({ scopeId: scope.id, kind: 'decision', text: 'Use local-first storage' })
    const path = vault.writeMemory(memory.id)
    const markdown = readFileSync(path, 'utf8')
    expect(markdown).toContain(`brain_id: ${memory.id}`)
    expect(markdown).toContain('revision: 1')
    expect(markdown).toContain('kind: decision')
    expect(markdown).toContain('Use local-first storage')
    database.close()
  })

  it('turns a valid external edit into a new database revision', () => {
    const { database, vault, scope } = setup()
    const memory = database.remember({ scopeId: scope.id, kind: 'fact', text: 'Deadline Monday' })
    const path = vault.writeMemory(memory.id)
    writeFileSync(path, readFileSync(path, 'utf8').replace('Deadline Monday', 'Deadline Friday'))
    expect(vault.reconcileFile(path)).toMatchObject({ status: 'updated', revision: 2 })
    expect(database.getMemory(memory.id)?.text).toBe('Deadline Friday')
    expect(readFileSync(path, 'utf8')).toContain('revision: 2')
    database.close()
  })

  it('sends simultaneous database and file edits to conflict review', () => {
    const { database, vault, scope } = setup()
    const memory = database.remember({ scopeId: scope.id, kind: 'fact', text: 'Budget 100' })
    const path = vault.writeMemory(memory.id)
    database.reviseMemory(memory.id, 'Budget 200', 'brain://manual')
    writeFileSync(path, readFileSync(path, 'utf8').replace('Budget 100', 'Budget 300'))
    expect(vault.reconcileFile(path)).toMatchObject({ status: 'conflict' })
    expect(database.listVaultConflicts()).toHaveLength(1)
    database.close()
  })

  it('resolves a conflict to the file edit and republishes the curated copy', () => {
    const { database, vault, scope } = setup()
    const memory = database.remember({ scopeId: scope.id, kind: 'fact', text: 'Budget 100' })
    const path = vault.writeMemory(memory.id)
    database.reviseMemory(memory.id, 'Budget 200', 'brain://manual')
    writeFileSync(path, readFileSync(path, 'utf8').replace('Budget 100', 'Budget 300'))
    vault.reconcileFile(path)
    const [conflict] = database.listVaultConflicts(scope.id) as Array<{ id: string }>

    // A conflict belongs to its scope; another client cannot resolve it.
    const other = database.ensureScope({ type: 'client', externalRef: 'other', name: 'Other' })
    expect(database.resolveVaultConflict(conflict.id, 'file', other.id)).toBeNull()
    expect(database.listVaultConflicts(scope.id)).toHaveLength(1)

    const resolved = database.resolveVaultConflict(conflict.id, 'file', scope.id)
    expect(resolved?.text).toBe('Budget 300')
    vault.writeMemory(memory.id)
    expect(readFileSync(path, 'utf8')).toContain('Budget 300')
    expect(database.listVaultConflicts(scope.id)).toHaveLength(0)
    database.close()
  })

  it('keeps the source locator and content hash in the curated front matter', () => {
    const { database, vault, scope } = setup()
    const provenance = 'artifact://job-a/raw/step-a-0f0f.jsonl.gz#0#sha256=deadbeef'
    const memory = database.remember({ scopeId: scope.id, kind: 'opportunity', text: 'Acme wants a retainer', sourceRef: provenance })
    const markdown = readFileSync(vault.writeMemory(memory.id), 'utf8')
    expect(markdown).toContain(`source_ids: ${JSON.stringify(provenance)}`)
    expect(markdown).toContain('sha256=deadbeef')
    expect(markdown).toContain(`scope_id: ${scope.id}`)
    database.close()
  })

  it('never mirrors raw captured provider content into the vault', () => {
    const { database, vault, scope } = setup()
    const raw = 'RAW_PROVIDER_MESSAGE_BODY from an unread chat'
    database.storeCaptureEnvelope({
      envelopeVersion: 1, source: 'whatsapp', captureType: 'unread', connectorId: 'flowdesk', connectorVersion: 'v1',
      jobId: 'job-a', stepId: 'step-a', scopeId: scope.id, accountId: null, externalId: 'chat-a',
      parentExternalId: null, canonicalUrl: null, observedAt: null, capturedAt: new Date().toISOString(),
      cursor: null, contentHash: 'hash-a', rawPayloadRef: 'artifact://job-a/raw/step-a.jsonl.gz', schemaHint: null,
    })
    const opportunity = database.upsertOpportunity({
      scopeId: scope.id, fingerprint: 'fingerprint-a', category: 'direct_lead',
      title: 'direct lead signal for retainer', summary: '1 cited signal across 1 platform.',
      score: 80, confidence: 0.7, freshness: new Date().toISOString(),
    })
    database.recordOpportunityEvidence({
      opportunityId: opportunity.id, scopeId: scope.id, evidenceId: 'evidence-a', sourceId: null,
      excerpt: 'direct lead signal for retainer', confidence: 0.8,
      sourceRef: 'artifact://job-a/raw/step-a.jsonl.gz#0', platform: 'whatsapp',
    })
    // Only an accepted, curated memory is ever written out.
    const memory = database.remember({ scopeId: scope.id, kind: 'opportunity', text: 'Acme wants a retainer' })
    const written = vault.writeAll()
    expect(written).toHaveLength(1)
    for (const path of written) expect(readFileSync(path, 'utf8')).not.toContain(raw)
    expect(readFileSync(written[0], 'utf8')).toContain('Acme wants a retainer')
    expect(memory.status).toBe('accepted')
    database.close()
  })
})
