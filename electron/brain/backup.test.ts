import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactStore } from './artifactStore'
import { BrainDatabase } from './database'
import { BrainBackupManager } from './backup'
import { VaultManager } from './vault'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

describe('Brain portable backup', () => {
  it('round-trips SQLite and curated vault without credentials or raw artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-backup-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
    const memory = database.remember({ scopeId: scope.id, kind: 'preference', text: 'Roman Urdu replies' })
    const vault = new VaultManager(database, join(root, 'vault'))
    vault.writeMemory(memory.id)
    const archive = join(root, 'brain.flowdesk-brain.zip')
    BrainBackupManager.exportArchive(database, vault.root, archive)
    const raw = readFileSync(archive)
    expect(raw.includes(Buffer.from('geminiApiKey'))).toBe(false)
    expect(raw.includes(Buffer.from('artifacts/raw'))).toBe(false)

    const restored = join(root, 'restored')
    BrainBackupManager.extractArchive(archive, restored)
    const restoredDatabase = new BrainDatabase(join(restored, 'brain.sqlite'))
    expect(restoredDatabase.listMemories().map(item => item.text)).toContain('Roman Urdu replies')
    restoredDatabase.close()
    database.close()
  })

  it('rejects path traversal entries before writing anything', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-backup-bad-'))
    roots.push(root)
    const archive = join(root, 'bad.zip')
    writeFileSync(archive, zipSync({ '../escape.txt': strToU8('bad'), 'manifest.json': strToU8('{}') }))
    expect(() => BrainBackupManager.extractArchive(archive, join(root, 'restore'))).toThrow(/unsafe/i)
  })

  it('restores scopes, opportunities, monitors and the curated vault into a fresh profile', () => {
    const source = mkdtempSync(join(tmpdir(), 'flowdesk-backup-v2-'))
    roots.push(source)
    const database = new BrainDatabase(join(source, 'brain.sqlite'))
    const client = database.ensureScope({ type: 'client', externalRef: 'acme', name: 'Acme' })
    const project = database.ensureScope({ type: 'project', externalRef: 'acme-site', name: 'Acme Site', parentId: client.id })
    const opportunity = database.upsertOpportunity({
      scopeId: client.id, fingerprint: 'fingerprint-acme', category: 'direct_lead',
      title: 'direct lead signal for developer', summary: '1 cited signal across 1 platform.',
      score: 82, confidence: 0.7, freshness: '2026-09-05T09:00:00.000Z',
    })
    database.recordOpportunityEvidence({
      opportunityId: opportunity.id, scopeId: client.id, evidenceId: 'evidence-acme', sourceId: null,
      excerpt: 'direct lead signal for developer', confidence: 0.8,
      sourceRef: 'https://acme.test/posts/lead', platform: 'linkedin', observedAt: '2026-09-05T09:00:00.000Z',
    })
    database.registerRecipe({ id: 'linkedin.opportunity_scan', version: 1, title: 'LinkedIn Opportunity Scan', steps: ['capture', 'normalize', 'classify', 'score', 'summarize'] })
    const monitor = database.createMonitor({ scopeId: client.id, recipeId: 'linkedin.opportunity_scan', intervalMinutes: 60, minimumScore: 75 })
    database.grantConsent({ scopeId: client.id, recipeId: 'linkedin.opportunity_scan', provider: 'local-brain', fields: ['post_text'] })
    const memory = database.remember({ scopeId: client.id, kind: 'decision', text: 'Acme prefers fixed-scope retainers' })
    const vault = new VaultManager(database, join(source, 'vault'))
    vault.writeMemory(memory.id)

    const archive = join(source, 'acme.flowdesk-brain.zip')
    BrainBackupManager.exportArchive(database, vault.root, archive)
    database.close()

    // A genuinely fresh profile: a different root with no prior Brain data.
    const fresh = mkdtempSync(join(tmpdir(), 'flowdesk-backup-fresh-'))
    roots.push(fresh)
    const freshBrainRoot = join(fresh, 'brain')
    const { manifest } = BrainBackupManager.restoreAtomic(archive, freshBrainRoot)
    expect(manifest).toMatchObject({ format: 'flowdesk-brain-backup', version: 1, schemaVersion: 1 })

    const restored = new BrainDatabase(join(freshBrainRoot, 'brain.sqlite'))
    expect(restored.listScopes().map(scope => scope.externalRef).sort()).toEqual(['acme', 'acme-site'])
    expect(restored.listScopes().find(scope => scope.externalRef === 'acme-site')?.parentId).toBe(client.id)
    expect(restored.listOpportunities({ scopeId: client.id })).toEqual([
      expect.objectContaining({ title: 'direct lead signal for developer', score: 82, evidenceCount: 1 }),
    ])
    expect(restored.getOpportunityEvidence({ id: opportunity.id, scopeId: client.id })[0]).toMatchObject({
      sourceRef: 'https://acme.test/posts/lead', platform: 'linkedin',
    })
    expect(restored.listMonitors(client.id)).toEqual([
      expect.objectContaining({ id: monitor.id, recipeId: 'linkedin.opportunity_scan', intervalMinutes: 60, minimumScore: 75, status: 'active' }),
    ])
    expect(restored.hasConsent(client.id, 'linkedin.opportunity_scan', 'local-brain')).toBe(true)
    expect(restored.listMemories(client.id).map(item => item.text)).toEqual(['Acme prefers fixed-scope retainers'])
    expect(project.id).toEqual(expect.any(String))

    const restoredVaultFile = join(freshBrainRoot, 'vault', 'Decisions', `decision-${memory.id}.md`)
    expect(existsSync(restoredVaultFile)).toBe(true)
    expect(readFileSync(restoredVaultFile, 'utf8')).toContain('Acme prefers fixed-scope retainers')
    restored.close()
  })

  it('excludes cookies, credentials and raw job artifacts from the archive', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-backup-secrets-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'client', externalRef: 'secrets', name: 'Secrets' })
    const memory = database.remember({ scopeId: scope.id, kind: 'fact', text: 'Curated knowledge only' })
    const vault = new VaultManager(database, join(root, 'vault'))
    vault.writeMemory(memory.id)

    // Sibling directories that a naive "zip the brain folder" backup would sweep in.
    const artifacts = new ArtifactStore(database, join(root, 'artifacts'))
    artifacts.ingestBatch({
      source: 'linkedin', jobId: 'job-secrets', stepId: 'step-secrets', scopeId: scope.id, accountId: null,
      connectorVersion: 'flowdesk-read-v1',
      records: [{ id: 'raw', text: 'RAW_PROVIDER_MESSAGE_BODY', url: 'https://secrets.test/posts/raw' }],
    })
    mkdirSync(join(root, 'sessions'), { recursive: true })
    writeFileSync(join(root, 'sessions', 'Cookies'), 'li_at=COOKIE_VALUE_SECRET')
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ geminiApiKey: 'API_KEY_SECRET', anthropicApiKey: 'TOKEN_SECRET' }))
    // A stray Markdown file outside the vault must not be collected either.
    writeFileSync(join(root, 'NOT_IN_VAULT.md'), 'STRAY_MARKDOWN_SECRET')

    const archive = join(root, 'secrets.flowdesk-brain.zip')
    BrainBackupManager.exportArchive(database, vault.root, archive)
    const bytes = readFileSync(archive)
    for (const secret of ['COOKIE_VALUE_SECRET', 'API_KEY_SECRET', 'TOKEN_SECRET', 'RAW_PROVIDER_MESSAGE_BODY', 'STRAY_MARKDOWN_SECRET']) {
      expect(bytes.includes(Buffer.from(secret))).toBe(false)
    }
    const entries = Object.keys(BrainBackupManager.inspectArchive(archive).files).sort()
    expect(entries).toEqual(['brain.sqlite', 'manifest.json', `vault/Memories/fact-${memory.id}.md`])
    database.close()
  })

  it.each([
    ['absolute path', { '/etc/passwd': strToU8('bad') }],
    ['windows separator', { 'vault\\..\\escape.md': strToU8('bad') }],
    ['unmanaged directory', { 'artifacts/raw/leak.jsonl.gz': strToU8('bad') }],
    ['empty segment', { 'vault//escape.md': strToU8('bad') }],
  ])('rejects an archive carrying an %s entry', (_label, extra) => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-backup-unsafe-'))
    roots.push(root)
    const archive = join(root, 'unsafe.zip')
    writeFileSync(archive, zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'flowdesk-brain-backup', version: 1, schemaVersion: 1, createdAt: new Date().toISOString() })),
      'brain.sqlite': strToU8('not-a-database'),
      ...extra,
    }))
    expect(() => BrainBackupManager.inspectArchive(archive)).toThrow(/unsafe backup entry/i)
    expect(() => BrainBackupManager.extractArchive(archive, join(root, 'restore'))).toThrow(/unsafe backup entry/i)
    expect(existsSync(join(root, 'restore'))).toBe(false)
  })

  it('rejects an incompatible schema version instead of replacing live data', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-backup-schema-'))
    roots.push(root)
    const archive = join(root, 'future.zip')
    writeFileSync(archive, zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'flowdesk-brain-backup', version: 1, schemaVersion: 99, createdAt: new Date().toISOString() })),
      'brain.sqlite': strToU8('not-a-database'),
    }))
    expect(() => BrainBackupManager.inspectArchive(archive)).toThrow(/format or schema is incompatible/i)
  })
})
