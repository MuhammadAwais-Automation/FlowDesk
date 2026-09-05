import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
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
})
