import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let root = ''
let generatedDir = ''
vi.mock('electron', () => ({ app: { getPath: (key: string) => key === 'downloads' ? join(root, 'downloads') : root } }))

const { addImageToDocument, resolveImageBytes } = await import('./assetStore')
const store = await import('./documentStore')

const VALID_DOC = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fd-studio-assets-'))
  generatedDir = join(root, 'generated-images')
  await mkdir(generatedDir, { recursive: true })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('resolveImageBytes', () => {
  it('reads a flowdesk-image:// reference from the shared generated-images store', async () => {
    await writeFile(join(generatedDir, 'abc.png'), Buffer.from([1, 2, 3]))
    const resolved = await resolveImageBytes('flowdesk-image://abc.png')
    expect(resolved.mimeType).toBe('image/png')
    expect(resolved.bytes).toEqual(Buffer.from([1, 2, 3]))
  })

  it('reads a markdown-wrapped flowdesk-image reference, since that is what the agent often repeats back', async () => {
    await writeFile(join(generatedDir, 'abc.png'), Buffer.from([9]))
    const resolved = await resolveImageBytes('![a title](flowdesk-image://abc.png)')
    expect(resolved.bytes).toEqual(Buffer.from([9]))
  })

  it('reads a plain local file path, the shape Google Flow downloads produce', async () => {
    const filePath = join(root, 'downloads', 'FlowDesk Studio', 'ship.png')
    await mkdir(join(root, 'downloads', 'FlowDesk Studio'), { recursive: true })
    await writeFile(filePath, Buffer.from([5, 6]))
    const resolved = await resolveImageBytes(filePath)
    expect(resolved.mimeType).toBe('image/png')
    expect(resolved.bytes).toEqual(Buffer.from([5, 6]))
  })

  it('refuses an empty source', async () => {
    await expect(resolveImageBytes('')).rejects.toThrow(/no image source/i)
  })

  it('refuses a local path with no recognised image extension', async () => {
    await expect(resolveImageBytes(join(root, 'notes.txt'))).rejects.toThrow(/unsupported image type/i)
  })

  it('refuses a flowdesk-image reference that was never saved', async () => {
    await expect(resolveImageBytes('flowdesk-image://never-existed.png')).rejects.toThrow()
  })

  it('refuses a local path that does not exist', async () => {
    await expect(resolveImageBytes(join(root, 'ghost.png'))).rejects.toThrow(/could not read/i)
  })
})

describe('addImageToDocument', () => {
  it('copies the image into the document assets directory and returns a studio-asset:// url', async () => {
    await store.createDocument('T')
    await writeFile(join(generatedDir, 'abc.png'), Buffer.from([1, 2, 3]))
    const added = await addImageToDocument(VALID_DOC, 'flowdesk-image://abc.png', 'Spaceship blueprint')
    expect(added.url).toBe(`studio-asset://${VALID_DOC}/Spaceship blueprint.png`)
    expect(added.bytes).toBe(3)
    const files = await readdir(store.assetsDir(VALID_DOC))
    expect(files).toContain('Spaceship blueprint.png')
  })

  it('does not overwrite an existing file with the same name, so a second insert keeps the first', async () => {
    await writeFile(join(generatedDir, 'a.png'), Buffer.from([1]))
    await writeFile(join(generatedDir, 'b.png'), Buffer.from([2]))
    const first = await addImageToDocument(VALID_DOC, 'flowdesk-image://a.png', 'Cover')
    const second = await addImageToDocument(VALID_DOC, 'flowdesk-image://b.png', 'Cover')
    expect(first.fileName).not.toBe(second.fileName)
    const files = await readdir(store.assetsDir(VALID_DOC))
    expect(files).toHaveLength(2)
  })

  it('propagates a resolution failure rather than writing a partial file', async () => {
    await expect(addImageToDocument(VALID_DOC, 'flowdesk-image://missing.png', 'X')).rejects.toThrow()
    const files = await readdir(store.assetsDir(VALID_DOC)).catch(() => [])
    expect(files).toEqual([])
  })
})
