import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from './service'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Brain runtime smoke', () => {
  it('starts with FTS5 and reopens its user data database', () => {
    const userDataRoot = mkdtempSync(join(tmpdir(), 'flowdesk-brain-runtime-'))
    roots.push(userDataRoot)
    const databasePath = join(userDataRoot, 'brain', 'brain.sqlite')

    const first = new BrainService(databasePath)
    expect(first.handle({ id: 'first-status', method: 'status', payload: {} })).toMatchObject({ ready: true, fts5: true })
    expect(first.handle({ id: 'first-shutdown', method: 'shutdown', payload: {} })).toEqual({ closed: true })

    const reopened = new BrainService(databasePath)
    expect(reopened.handle({ id: 'reopened-status', method: 'status', payload: {} })).toMatchObject({ ready: true, fts5: true })
    reopened.close()
  })
})
