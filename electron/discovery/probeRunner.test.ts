import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { runProbeFile, parseDirectives, buildProbeScript } from './probeRunner'
import { PROBE_TOOLKIT_SCRIPT } from './probeToolkit'

/**
 * The harness evaluates arbitrary JavaScript inside a live, authenticated
 * session, so the failure modes worth locking down are about AIM,
 * CONTAINMENT, and AUTONOMOUS PRIMITIVES:
 * - A probe must never run somewhere it was not pointed
 * - A badly behaved probe must never take the runner down
 * - Autonomous directives (@file, @goto, @timeout) work reliably
 * - Autonomous toolkit primitives (typing, clicking, files, network capture) are correctly assembled
 */

let dir: string

function fakeView(
  url: string,
  evaluate: (script: string) => Promise<unknown>,
  loadURL?: (url: string) => Promise<void>,
): WebContents {
  return {
    getURL: () => url,
    executeJavaScript: (s: string) => evaluate(s),
    loadURL: loadURL ?? (async () => {}),
  } as unknown as WebContents
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

describe('autonomous directives and host file loading', () => {
  it('parses target, timeout, goto, and multiple file directives', () => {
    const source = `
      // @target tiktok.com
      // @timeout 45000
      // @goto https://www.tiktok.com/tiktokstudio/upload
      // @file video ./sample.mp4
      // @file thumb ./cover.jpg
      return probe.files.video.size
    `
    const directives = parseDirectives(source)
    expect(directives.target).toBe('tiktok.com')
    expect(directives.timeoutMs).toBe(45000)
    expect(directives.goto).toBe('https://www.tiktok.com/tiktokstudio/upload')
    expect(directives.files).toEqual([
      { alias: 'video', path: './sample.mp4' },
      { alias: 'thumb', path: './cover.jpg' },
    ])
  })

  it('reads host file from disk and injects base64 and mime metadata into probe.files', async () => {
    const assetPath = join(dir, 'test-video.mp4')
    await writeFile(assetPath, 'fake-mp4-binary-content', 'utf8')

    let injectedScript = ''
    const probePath = await probe('file-probe', `
      // @target tiktok.com
      // @file media ./test-video.mp4
      return probe.files.media.name
    `)

    const result = await runProbeFile(probePath, {
      dir,
      resolveView: () => fakeView('https://tiktok.com', async script => {
        injectedScript = script
        return { ok: true, value: 'test-video.mp4' }
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.filesInjected).toEqual(['media'])
    expect(injectedScript).toContain('test-video.mp4')
    expect(injectedScript).toContain('video/mp4')
    expect(injectedScript).toContain(Buffer.from('fake-mp4-binary-content').toString('base64'))
  })

  it('fails with a descriptive error when @file target does not exist', async () => {
    const probePath = await probe('missing-file', `
      // @target tiktok.com
      // @file nonexistent ./does-not-exist.mp4
      return 1
    `)

    const result = await runProbeFile(probePath, {
      dir,
      resolveView: () => fakeView('https://tiktok.com', async () => ({ ok: true, value: 1 })),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/could not load @file "nonexistent"/)
  })

  it('navigates view if @goto is specified and differs from current URL', async () => {
    const loadURL = vi.fn(async () => {})
    const probePath = await probe('nav-probe', `
      // @target tiktok.com
      // @goto https://www.tiktok.com/tiktokstudio/upload
      return 1
    `)

    const result = await runProbeFile(probePath, {
      dir,
      resolveView: () => fakeView('https://www.tiktok.com/explore', async () => ({ ok: true, value: 1 }), loadURL),
    })

    expect(result.ok).toBe(true)
    expect(loadURL).toHaveBeenCalledWith('https://www.tiktok.com/tiktokstudio/upload')
  })
})

describe('autonomous probe toolkit script integration', () => {
  it('injects window.probe toolkit into the evaluated script', () => {
    const script = buildProbeScript('return probe.info()')
    expect(script).toContain('window.probe = probe')
    expect(script).toContain('type: async function')
    expect(script).toContain('click: async function')
    expect(script).toContain('setSwitch: async function')
    expect(script).toContain('injectFile: async function')
    expect(script).toContain('captureNetwork: async function')
    expect(script).toContain('waitFor: async function')
  })

  it('contains proper Draft.js / Lexical and native input handling in probe.type', () => {
    expect(PROBE_TOOLKIT_SCRIPT).toContain("document.execCommand('insertText', false, text)")
    expect(PROBE_TOOLKIT_SCRIPT).toContain('HTMLInputElement.prototype')
    expect(PROBE_TOOLKIT_SCRIPT).toContain('HTMLTextAreaElement.prototype')
  })

  it('contains DataTransfer and File construction in probe.injectFile', () => {
    expect(PROBE_TOOLKIT_SCRIPT).toContain('new DataTransfer()')
    expect(PROBE_TOOLKIT_SCRIPT).toContain('new File(')
    expect(PROBE_TOOLKIT_SCRIPT).toContain('input.files = dt.files')
  })

  it('contains full pointer and mouse event dispatch chain in probe.click', () => {
    expect(PROBE_TOOLKIT_SCRIPT).toContain("'pointerdown'")
    expect(PROBE_TOOLKIT_SCRIPT).toContain("'mousedown'")
    expect(PROBE_TOOLKIT_SCRIPT).toContain("'pointerup'")
    expect(PROBE_TOOLKIT_SCRIPT).toContain("'mouseup'")
    expect(PROBE_TOOLKIT_SCRIPT).toContain("'click'")
  })

  it('restores original window.fetch and XMLHttpRequest in finally block of probe.captureNetwork', () => {
    expect(PROBE_TOOLKIT_SCRIPT).toContain('window.fetch = origFetch')
    expect(PROBE_TOOLKIT_SCRIPT).toContain('XMLHttpRequest.prototype.open = origXhrOpen')
    expect(PROBE_TOOLKIT_SCRIPT).toContain('XMLHttpRequest.prototype.send = origXhrSend')
  })
})
