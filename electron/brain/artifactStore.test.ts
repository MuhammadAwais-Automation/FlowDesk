import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainDatabase } from './database'
import { ArtifactStore } from './artifactStore'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

describe('ArtifactStore', () => {
  it('writes referenced compressed raw and normalized batches', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-artifacts-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'workspace', externalRef: 'workspace', name: 'Workspace' })
    const store = new ArtifactStore(database, join(root, 'artifacts'))
    const manifest = store.ingestBatch({
      source: 'linkedin', jobId: 'job-1', stepId: 'capture', scopeId: scope.id, accountId: 'a1', connectorVersion: '1',
      records: [{ id: 'post-1', text: 'Need a developer', url: 'https://example.test/post-1', createdAt: '2026-09-05T00:00:00.000Z' }],
    })
    expect(manifest).toMatchObject({ recordCount: 1, source: 'linkedin' })
    expect(manifest.artifactRefs).toHaveLength(3)
    expect(manifest.artifactRefs.every(reference => existsSync(reference.replace('file://', '')))).toBe(true)
    database.close()
  })
})
