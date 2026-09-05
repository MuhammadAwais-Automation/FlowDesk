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
})
