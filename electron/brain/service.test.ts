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
