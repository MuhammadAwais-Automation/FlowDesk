import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
const { runHealth, shapeOf, worst } = await import('./health')
import type { PlatformSpec } from './spec'

const spec: PlatformSpec = {
  id: 'pin',
  read: { rpc: 'pin.read', params: {} },
  bundle: { view: { tab: 't' }, needles: ['A', 'B'] },
  rehearsals: [{ tool: 'pin_create', rpc: 'pin.create', view: { tab: 't' }, urlPattern: '*', method: 'POST', params: { x: 1 } }],
}

function deps(answers: Record<string, unknown>, dir: string) {
  const invoke = vi.fn(async (m: string) => {
    const a = answers[m]
    if (a instanceof Error) throw a
    return a
  })
  return { invoke, dir, now: () => new Date('2026-10-07T09:00:00Z') }
}

describe('health', () => {
  it('describes shape without values', () => {
    expect(shapeOf({ ok: true, items: [{ id: 'secret', n: 3 }], byId: { 123: 'x' } })).toEqual([
      '$.byId.#:scalar', '$.byId:object', '$.items:array', '$.items[].id:scalar', '$.items[].n:scalar', '$.items[]:object', '$.ok:scalar', '$:object',
    ])
  })

  it('treats a field that is text in one answer and null in the next as the same shape', () => {
    expect(shapeOf({ posts: [{ text: 'hi' }] })).toEqual(shapeOf({ posts: [{ text: null }] }))
    expect(shapeOf({ posts: [{ text: 'hi' }] })).not.toEqual(shapeOf({ posts: [{ body: 'hi' }] }))
  })

  it('ranks statuses', () => {
    expect(worst(['ok', 'skipped', 'warn'])).toBe('warn')
    expect(worst([])).toBe('skipped')
  })

  it('records a baseline on the first good run, then flags a changed build and a lost id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'health-'))
    const first = await runHealth([spec], {}, deps({
      'pin.read': { ok: true, boards: [{ id: '1' }] },
      'dev.bundleScan': { ok: true, versions: ['boq_x_20261004.06_p0'], needles: [{ needle: 'A', found: true }, { needle: 'B', found: true }] },
    }, dir))
    expect(first.status).toBe('ok')
    expect(JSON.parse(await readFile(join(dir, 'baseline.json'), 'utf8')).pin).toMatchObject({ found: ['A', 'B'], checkedAt: '2026-10-07T09:00:00.000Z' })

    const second = await runHealth([spec], {}, deps({
      'pin.read': { ok: true, boards: [{ id: '2' }] },
      'dev.bundleScan': { ok: true, versions: ['boq_x_20261005.07_p0'], needles: [{ needle: 'A', found: true }, { needle: 'B', found: false }] },
    }, dir))
    expect(second.platforms[0].checks[0].status).toBe('ok')
    expect(second.platforms[0].checks[1]).toMatchObject({ status: 'warn' })
    expect(second.platforms[0].checks[1].note).toContain('build changed')
    expect(second.platforms[0].checks[1].note).toContain('no longer found: B')
    // A warning run does not overwrite the good baseline.
    expect(JSON.parse(await readFile(join(dir, 'baseline.json'), 'utf8')).pin.versions).toEqual(['boq_x_20261004.06_p0'])
  })

  it('fails a signed-out platform and skips its other checks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'health-'))
    const d = deps({ 'pin.read': { ok: true, signedIn: false } }, dir)
    const r = await runHealth([spec], { rehearse: true }, d)
    expect(r.platforms[0]).toMatchObject({ status: 'fail', checks: [{ level: 'L1', note: 'signed out' }] })
    expect(d.invoke).toHaveBeenCalledTimes(1)
  })

  it('passes a rehearsal only when the request was built and blocked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'health-'))
    const ok = await runHealth([{ ...spec, bundle: undefined }], { rehearse: true }, deps({
      'pin.read': { ok: true }, 'dev.rehearse': { ok: true, blocked: [{ url: 'https://p.com/resource/BoardResource/create/' }] },
    }, dir))
    expect(ok.platforms[0].checks[1]).toMatchObject({ level: 'L3', status: 'ok' })
    const none = await runHealth([{ ...spec, bundle: undefined }], { rehearse: true }, deps({
      'pin.read': { ok: true }, 'dev.rehearse': { ok: true, blocked: [] },
    }, dir))
    expect(none.platforms[0].checks[1]).toMatchObject({ level: 'L3', status: 'fail' })
  })
})
