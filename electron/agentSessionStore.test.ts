import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let root = ''

vi.mock('electron', () => ({ app: { getPath: () => root } }))

const store = await import('./agentSessionStore')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fd-sessions-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createSession and listSessions', () => {
  it('creates a session that then appears in the list', async () => {
    const created = await store.createSession('First')
    const all = await store.listSessions()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(created.id)
    expect(all[0].title).toBe('First')
  })

  it('lists most recently updated first', async () => {
    const a = await store.createSession('A')
    const b = await store.createSession('B')
    await store.writeMeta({ ...(await store.readMeta(a.id))!, updatedAt: '2030-01-01T00:00:00.000Z' })
    const all = await store.listSessions()
    expect(all[0].id).toBe(a.id)
    expect(all[1].id).toBe(b.id)
  })

  it('creating a session does not touch another session files', async () => {
    const a = await store.createSession('A')
    await store.appendTurn(a.id, { role: 'user', content: 'hello', toolCalls: [] })
    await store.createSession('B')
    const turns = await store.readTurns(a.id)
    expect(turns).toHaveLength(1)
    expect(turns[0].content).toBe('hello')
  })

  it('returns an empty list when nothing has been created', async () => {
    expect(await store.listSessions()).toEqual([])
  })
})

describe('appendTurn', () => {
  it('appends without rewriting earlier turns', async () => {
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'user', content: 'one', toolCalls: [] })
    const afterFirst = await readFile(join(root, 'agent-sessions', s.id, 'turns.jsonl'), 'utf8')
    await store.appendTurn(s.id, { role: 'assistant', content: 'two', toolCalls: [] })
    const afterSecond = await readFile(join(root, 'agent-sessions', s.id, 'turns.jsonl'), 'utf8')
    expect(afterSecond.startsWith(afterFirst)).toBe(true)
  })

  it('advances turnCount in meta', async () => {
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'user', content: 'one', toolCalls: [] })
    await store.appendTurn(s.id, { role: 'assistant', content: 'two', toolCalls: [] })
    expect((await store.readMeta(s.id))!.turnCount).toBe(2)
  })

  it('preserves the provider that produced an assistant turn', async () => {
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'assistant', content: 'hi', toolCalls: [], provider: 'codex' })
    expect((await store.readTurns(s.id))[0].provider).toBe('codex')
  })
})

describe('readTurns resilience', () => {
  it('loads every complete turn when the final line is a partial write', async () => {
    // A crash mid-append must cost at most the last turn, never the
    // conversation. This is the whole reason the file is append-only JSONL.
    const s = await store.createSession()
    await store.appendTurn(s.id, { role: 'user', content: 'one', toolCalls: [] })
    await store.appendTurn(s.id, { role: 'assistant', content: 'two', toolCalls: [] })
    const path = join(root, 'agent-sessions', s.id, 'turns.jsonl')
    const good = await readFile(path, 'utf8')
    await writeFile(path, good + '{"role":"user","con')
    const turns = await store.readTurns(s.id)
    expect(turns).toHaveLength(2)
    expect(turns[1].content).toBe('two')
  })

  it('returns an empty array for a session directory with no turns file', async () => {
    await mkdir(join(root, 'agent-sessions', 'ghost'), { recursive: true })
    expect(await store.readTurns('ghost')).toEqual([])
  })
})

describe('rename and delete', () => {
  it('renames without losing turns', async () => {
    const s = await store.createSession('Old')
    await store.appendTurn(s.id, { role: 'user', content: 'keep me', toolCalls: [] })
    await store.renameSession(s.id, 'New')
    expect((await store.readMeta(s.id))!.title).toBe('New')
    expect(await store.readTurns(s.id)).toHaveLength(1)
  })

  it('deletes exactly one session', async () => {
    const a = await store.createSession('A')
    const b = await store.createSession('B')
    await store.deleteSession(a.id)
    const all = await store.listSessions()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(b.id)
  })

  it('deleting a session that is already gone is not an error', async () => {
    await expect(store.deleteSession('never-existed')).resolves.toBeUndefined()
  })
})

describe('readMeta', () => {
  it('returns null for an unknown session rather than throwing', async () => {
    expect(await store.readMeta('nope')).toBeNull()
  })
})
