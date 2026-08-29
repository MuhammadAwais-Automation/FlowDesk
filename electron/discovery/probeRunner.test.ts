import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { runProbeFile } from './probeRunner'

/**
 * The harness evaluates arbitrary JavaScript inside a live, authenticated
 * session, so the failure modes worth locking down are about AIM and
 * CONTAINMENT: a probe must never run somewhere it was not pointed, and a
 * badly behaved probe must never take the runner down with it.
 */

let dir: string

function fakeView(url: string, evaluate: (script: string) => Promise<unknown>): WebContents {
  return { getURL: () => url, executeJavaScript: (s: string) => evaluate(s) } as unknown as WebContents
}

async function probe(name: string, source: string): Promise<string> {
  const path = join(dir, `${name}.js`)
  await writeFile(path, source, 'utf8')
  return path
}

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'fd-probe-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('probe aiming', () => {
  it('refuses to run a probe with no @target rather than picking a page for it', async () => {
    const evaluate = vi.fn()
    const path = await probe('untargeted', 'return 1')
    const result = await runProbeFile(path, { dir, resolveView: () => fakeView('https://x.com', evaluate) })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/@target/)
    // The point: an unaimed probe must not execute ANYWHERE. Running it in
    // whatever view happened to be open could fire it inside the wrong
    // logged-in account entirely.
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('passes the @target substring to the resolver verbatim', async () => {
    const resolveView = vi.fn(() => null)
    const path = await probe('aimed', '// @target linkedin.com\nreturn 1')
    await runProbeFile(path, { dir, resolveView })
    expect(resolveView).toHaveBeenCalledWith('linkedin.com')
  })

  it('reports which URL it actually reached, so a probe that hit the wrong page is visible', async () => {
    const path = await probe('aimed', '// @target linkedin.com\nreturn 1')
    const result = await runProbeFile(path, {
      dir,
      resolveView: () => fakeView('https://www.linkedin.com/feed/', async () => ({ ok: true, value: 1 })),
    })
    expect(result.url).toBe('https://www.linkedin.com/feed/')
    expect(result.target).toBe('linkedin.com')
  })

  it('says what to do when the target site is not open, rather than failing blankly', async () => {
    const path = await probe('aimed', '// @target linkedin.com\nreturn 1')
    const result = await runProbeFile(path, { dir, resolveView: () => null })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no open view matching "linkedin\.com"/)
    expect(result.error).toMatch(/sign in/)
  })
})

describe('probe containment', () => {
  it('wraps the source so await and return work', async () => {
    let received = ''
    const path = await probe('body', '// @target x.com\nreturn 42')
    await runProbeFile(path, {
      dir,
      resolveView: () => fakeView('https://x.com', async script => { received = script; return { ok: true, value: 42 } }),
    })
    expect(received).toContain('async function')
    expect(received).toContain('return 42')
  })

  it('turns a hung probe into a timeout result instead of stalling the runner', async () => {
    const path = await probe('hangs', '// @target x.com\nreturn 1')
    const result = await runProbeFile(path, {
      dir,
      timeoutMs: 40,
      resolveView: () => fakeView('https://x.com', () => new Promise(() => {})),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timed out after 40ms/)
  })

  it('records a thrown evaluation as a result rather than letting it escape', async () => {
    const path = await probe('throws', '// @target x.com\nreturn 1')
    const result = await runProbeFile(path, {
      dir,
      resolveView: () => fakeView('https://x.com', async () => { throw new Error('renderer exploded') }),
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('renderer exploded')
  })

  it('flattens un-cloneable values before they cross the boundary', async () => {
    // A single function or Blob in the return value fails the WHOLE
    // executeJavaScript call with "An object could not be cloned" — during
    // the WhatsApp work that silently destroyed a diagnostic's own report,
    // so a run meant to explain a bug produced nothing at all.
    let script = ''
    const path = await probe('shape', '// @target x.com\nreturn { fn: function nope(){} }')
    await runProbeFile(path, {
      dir,
      resolveView: () => fakeView('https://x.com', async s => { script = s; return { ok: true, value: {} } }),
    })
    expect(script).toContain('__fdSafe')
    expect(script).toContain("'[function '")
  })
})
