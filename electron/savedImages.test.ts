import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/userData' } }))

const { parseSavedImageRef, safeImageFileName } = await import('./savedImages')

describe('parseSavedImageRef', () => {
  it('accepts the flowdesk-image:// URL the pipeline actually produces', () => {
    expect(parseSavedImageRef('flowdesk-image://1e685b76-513c-499b-8599-f6e547a332f4.png'))
      .toBe('1e685b76-513c-499b-8599-f6e547a332f4.png')
  })

  it('accepts the whole markdown link, which is what the agent sees in its own tool result', () => {
    // The worker tool returns "![Friendly Waving Robot Mascot](flowdesk-image://….png)",
    // so the model repeating that verbatim is the likeliest input by far.
    expect(parseSavedImageRef('![Friendly Waving Robot Mascot](flowdesk-image://abc.png)'))
      .toBe('abc.png')
  })

  it('accepts a bare filename', () => {
    expect(parseSavedImageRef('abc.png')).toBe('abc.png')
  })

  it('strips a query string, which the protocol URL may carry', () => {
    expect(parseSavedImageRef('flowdesk-image://abc.png?v=2')).toBe('abc.png')
  })

  /**
   * The reference reaches this function from model output, so it is not
   * trusted input. basename() is the guard: every one of these collapses to
   * a plain name that simply will not exist in the images directory, rather
   * than escaping it.
   */
  it('cannot escape the images directory', () => {
    expect(parseSavedImageRef('flowdesk-image://../../../../etc/passwd.png')).toBe('passwd.png')
    expect(parseSavedImageRef(String.raw`..\..\Windows\System32\config.sys`)).toBe('config.sys')
    expect(parseSavedImageRef('/etc/shadow.png')).toBe('shadow.png')
    expect(parseSavedImageRef('flowdesk-image://%2e%2e%2f%2e%2e%2fsecret.png')).toBe('secret.png')
  })

  it('rejects references with nothing usable left', () => {
    expect(parseSavedImageRef('')).toBeNull()
    expect(parseSavedImageRef('   ')).toBeNull()
    expect(parseSavedImageRef('..')).toBeNull()
    // No extension — would otherwise let a directory name through.
    expect(parseSavedImageRef('flowdesk-image://generated-images')).toBeNull()
  })
})

describe('safeImageFileName', () => {
  it('keeps a normal ChatGPT title readable', () => {
    // A real captured image_gen_title.
    expect(safeImageFileName('VX-49 Starfury Blueprint', 'png', 'fallback'))
      .toBe('VX-49 Starfury Blueprint.png')
  })

  /**
   * The title is provider text going straight into a real path, so these are
   * the cases that must not produce a surprising file location.
   */
  it('strips path separators instead of building a path', () => {
    expect(safeImageFileName('../../etc/passwd', 'png', 'fallback')).toBe('etc passwd.png')
    expect(safeImageFileName(String.raw`..\..\Windows\System32`, 'png', 'fallback'))
      .toBe('Windows System32.png')
  })

  it('strips characters Windows forbids in a name', () => {
    expect(safeImageFileName('a:b*c?d"e<f>g|h', 'png', 'fallback')).toBe('a b c d e f g h.png')
  })

  it('falls back for a Windows reserved device name', () => {
    expect(safeImageFileName('CON', 'png', 'fallback')).toBe('fallback.png')
    expect(safeImageFileName('com1', 'png', 'fallback')).toBe('fallback.png')
  })

  it('drops trailing dots and spaces, which Windows would silently remove', () => {
    // Left in, the reported path would not match the file on disk.
    expect(safeImageFileName('Blueprint...  ', 'png', 'fallback')).toBe('Blueprint.png')
  })

  it('caps the length', () => {
    const name = safeImageFileName('x'.repeat(500), 'png', 'fallback')
    expect(name.length).toBeLessThanOrEqual(84)
    expect(name.endsWith('.png')).toBe(true)
  })

  it('falls back on an empty or unusable title', () => {
    expect(safeImageFileName('', 'png', 'fallback')).toBe('fallback.png')
    expect(safeImageFileName('   ', 'png', 'fallback')).toBe('fallback.png')
    expect(safeImageFileName('..', 'png', 'fallback')).toBe('fallback.png')
  })

  it('refuses a bogus extension rather than writing one', () => {
    expect(safeImageFileName('art', 'png/../sh', 'fallback')).toBe('art.png')
    expect(safeImageFileName('art', 'webp', 'fallback')).toBe('art.webp')
  })
})
