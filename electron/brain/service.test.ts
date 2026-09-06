import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from './service'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('BrainService', () => {
  it('enforces the selected scope through vault conflict dispatch', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const a = service.database.ensureScope({ type: 'client', externalRef: 'a', name: 'A' })
      const b = service.database.ensureScope({ type: 'client', externalRef: 'b', name: 'B' })
      const memory = service.database.remember({ scopeId: a.id, kind: 'fact', text: 'Private A' })
      const id = service.database.addVaultConflict({ memoryId: memory.id, filePath: 'A.md', baseRevision: 1, databaseText: 'Private A', fileText: 'Changed A' })
      expect(service.handle({ id: '1', method: 'listVaultConflicts', payload: { scopeId: b.id } })).toEqual([])
      expect(service.handle({ id: '2', method: 'resolveVaultConflict', payload: { id, scopeId: b.id, resolution: 'file' } })).toBeNull()
      expect(service.database.getMemory(memory.id)?.text).toBe('Private A')
      expect(service.handle({ id: '3', method: 'listVaultConflicts', payload: { scopeId: a.id } })).toHaveLength(1)
      expect(service.handle({ id: '4', method: 'resolveVaultConflict', payload: { id, scopeId: a.id, resolution: 'file' } })).toMatchObject({ text: 'Changed A' })
    } finally { service.close() }
  })

  it('validates and dispatches requests without exposing SQL', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-brain-service-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    const scope = service.handle({ id: '1', method: 'ensureScope', payload: { type: 'workspace', externalRef: 'default', name: 'Default' } }) as { id: string }
    service.handle({ id: '2', method: 'remember', payload: { scopeId: scope.id, kind: 'fact', text: 'FlowDesk is local first' } })
    expect(service.handle({ id: '3', method: 'overview', payload: { scopeId: scope.id } })).toMatchObject({ memories: 1, candidates: 0, jobs: 0 })
    expect(() => service.handle({ id: '4', method: 'rawSql', payload: {} })).toThrow()
    service.close()
  })
})
