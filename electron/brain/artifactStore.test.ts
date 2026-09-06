import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
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

  it('keeps prior capture envelopes on immutable content-addressed artifacts after a replay changes content', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-artifacts-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'workspace', externalRef: 'workspace', name: 'Workspace' })
    const store = new ArtifactStore(database, join(root, 'artifacts'))
    const first = store.ingestBatch({
      source: 'linkedin', jobId: 'job-1', stepId: 'capture', scopeId: scope.id, accountId: null, connectorVersion: '1',
      records: [{ id: 'post-1', text: 'first private capture' }],
    })
    const second = store.ingestBatch({
      source: 'linkedin', jobId: 'job-1', stepId: 'capture', scopeId: scope.id, accountId: null, connectorVersion: '1',
      records: [{ id: 'post-2', text: 'second private capture' }],
    })
    expect(first.artifactRefs[0]).not.toBe(second.artifactRefs[0])
    expect(gunzipSync(readFileSync(first.artifactRefs[0].replace('file://', ''))).toString()).toContain('first private capture')
    expect(gunzipSync(readFileSync(first.artifactRefs[0].replace('file://', ''))).toString()).not.toContain('second private capture')
    database.close()
  })

  it('keeps private message text only in the retention-governed raw artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-artifacts-'))
    roots.push(root)
    const database = new BrainDatabase(join(root, 'brain.sqlite'))
    const scope = database.ensureScope({ type: 'workspace', externalRef: 'workspace', name: 'Workspace' })
    const store = new ArtifactStore(database, join(root, 'artifacts'))
    const manifest = store.ingestBatch({
      source: 'whatsapp', jobId: 'job-1', stepId: 'capture', scopeId: scope.id, accountId: null, connectorVersion: '1',
      records: [{ id: 'message-1', body: 'private customer sentence' }],
    })
    const normalized = gunzipSync(readFileSync(manifest.artifactRefs[1].replace('file://', ''))).toString()
    expect(normalized).not.toContain('private customer sentence')
    expect(gunzipSync(readFileSync(manifest.artifactRefs[0].replace('file://', ''))).toString()).toContain('private customer sentence')
    database.close()
  })
})
