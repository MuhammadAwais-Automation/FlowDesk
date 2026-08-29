import { describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const root = join('/tmp', 'fd-studio-paths')
vi.mock('electron', () => ({ app: { getPath: () => root } }))

const { isValidDocumentId, studioPath, documentsRoot } = await import('./paths')

const VALID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('isValidDocumentId', () => {
  it('accepts a UUID, which is the only shape createDocument produces', () => {
    expect(isValidDocumentId(VALID)).toBe(true)
  })

  it('rejects traversal, absolute paths, and separators', () => {
    // deleteDocument does a recursive remove, so an id that escapes the
    // documents directory is not a bug, it is data loss.
    for (const bad of ['..', '../..', '../../etc', '/etc/passwd', 'C:\\Windows', 'a/b', 'a\\b']) {
      expect(isValidDocumentId(bad), bad).toBe(false)
    }
  })

  it('rejects non-strings and empty input', () => {
    for (const bad of [undefined, null, 42, {}, [], '']) {
      expect(isValidDocumentId(bad)).toBe(false)
    }
  })

  it('rejects a UUID with anything appended', () => {
    expect(isValidDocumentId(`${VALID}/../..`)).toBe(false)
    expect(isValidDocumentId(`${VALID}.bak`)).toBe(false)
  })
})

describe('studioPath', () => {
  it('builds a path inside the documents root', () => {
    expect(studioPath(VALID, 'document.html')).toBe(join(documentsRoot(), VALID, 'document.html'))
  })

  it('throws on an invalid id rather than returning a path', () => {
    expect(() => studioPath('..', 'document.html')).toThrow(/document id/i)
  })

  it('throws when a later segment escapes, not only the id', () => {
    expect(() => studioPath(VALID, '..', '..', 'secrets')).toThrow(/outside/i)
  })
})
