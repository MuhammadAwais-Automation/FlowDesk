import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportReports, listReports, redact, writeReport } from './reports'

const ctx = (dir: string) => ({ dir, version: '1.0.0', now: () => new Date('2026-10-08T10:00:00Z') })

describe('reports', () => {
  it('masks emails, bearer tokens, key values and long secrets', () => {
    const s = redact('user a.b@gmail.com got 401 with Bearer abc.def-123 at https://x.com/api?key=AIzaSecret&page=2 token eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuv')
    expect(s).not.toMatch(/gmail|abc\.def|AIzaSecret|eyJhbGci/)
    expect(s).toContain('page=2')
    expect(s).toContain('401')
  })

  it('saves the tool, error and argument names but never argument values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reports-'))
    const r = await writeReport({ tool: 'pinterest_create_pin', error: 'board me@x.com not found', note: 'pin did not appear', args: { title: 'My secret title', boardId: '123' } }, ctx(dir))
    const saved = JSON.parse(await readFile(r.path, 'utf8'))
    expect(saved).toMatchObject({ tool: 'pinterest_create_pin', appVersion: '1.0.0', createdAt: '2026-10-08T10:00:00.000Z', argNames: ['title', 'boardId'] })
    expect(JSON.stringify(saved)).not.toContain('My secret title')
    expect(saved.error).not.toContain('me@x.com')
  })

  it('lists newest first and exports reports with the last health check as one zip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reports-'))
    await writeReport({ tool: 'a', error: 'one' }, { ...ctx(dir), now: () => new Date('2026-10-08T10:00:00Z') })
    await writeReport({ tool: 'b', error: 'two' }, { ...ctx(dir), now: () => new Date('2026-10-08T11:00:00Z') })
    await mkdir(join(dir, 'health'), { recursive: true })
    await writeFile(join(dir, 'health', 'last.json'), '{"status":"ok"}')

    expect((await listReports(dir)).map(r => r.tool)).toEqual(['b', 'a'])

    const out = join(dir, 'export.zip')
    const n = await exportReports(dir, out)
    expect(n).toBe(2)
    const files = unzipSync(new Uint8Array(await readFile(out)))
    expect(Object.keys(files).filter(f => f.startsWith('reports/'))).toHaveLength(2)
    expect(strFromU8(files['health-last.json'])).toContain('ok')
    expect(await readdir(join(dir, 'reports'))).toHaveLength(2)
  })
})
