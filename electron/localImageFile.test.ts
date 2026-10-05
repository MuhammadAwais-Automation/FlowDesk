import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readLocalImage, sniffImageMime } from './localImageFile'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fd-localimg-'))
  await writeFile(join(dir, 'ok.png'), PNG)
  await writeFile(join(dir, 'photo.JPG'), JPEG)
  await writeFile(join(dir, 'secret.png'), 'OPENAI_API_KEY=not-an-image')
  await writeFile(join(dir, 'notes.txt'), 'hello')
  await writeFile(join(dir, 'big.png'), new Uint8Array(PNG.length + 64).fill(0).map((v, i) => (i < PNG.length ? PNG[i] : v)))
  await mkdir(join(dir, 'folder.png'))
})
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

describe('sniffImageMime', () => {
  it('recognises PNG, JPEG, GIF and WebP by their bytes', () => {
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(GIF)).toBe('image/gif')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
  })
  it('rejects text and truncated headers', () => {
    expect(sniffImageMime(new TextEncoder().encode('not an image'))).toBeNull()
    expect(sniffImageMime(Uint8Array.from([0x89, 0x50]))).toBeNull()
  })
})

describe('readLocalImage', () => {
  it('reads a real image with its sniffed type and file name', async () => {
    const r = await readLocalImage(join(dir, 'ok.png'))
    expect(r.mime).toBe('image/png')
    expect(r.name).toBe('ok.png')
    expect(r.bytes.length).toBe(PNG.length)
  })
  it('accepts an upper-case extension', async () => {
    expect((await readLocalImage(join(dir, 'photo.JPG'))).mime).toBe('image/jpeg')
  })
  it('rejects UNC and device paths before touching them', async () => {
    await expect(readLocalImage('\\\\attacker\\share\\x.png')).rejects.toThrow(/Network and device paths/)
    await expect(readLocalImage('//attacker/share/x.png')).rejects.toThrow(/Network and device paths/)
    await expect(readLocalImage('\\\\?\\C:\\x.png')).rejects.toThrow(/Network and device paths/)
  })
  it('rejects relative paths', async () => {
    await expect(readLocalImage('ok.png')).rejects.toThrow(/absolute/)
    await expect(readLocalImage('../ok.png')).rejects.toThrow(/absolute/)
  })
  it('rejects other file types by extension', async () => {
    await expect(readLocalImage(join(dir, 'notes.txt'))).rejects.toThrow(/Only \.png/)
  })
  it('rejects a non-image renamed to .png', async () => {
    await expect(readLocalImage(join(dir, 'secret.png'))).rejects.toThrow(/not a PNG, JPEG, GIF or WebP/)
  })
  it('rejects files over the size cap', async () => {
    await expect(readLocalImage(join(dir, 'big.png'), 32)).rejects.toThrow(/too large/)
  })
  it('rejects missing files, directories and empty input', async () => {
    await expect(readLocalImage(join(dir, 'missing.png'))).rejects.toThrow(/not found/)
    await expect(readLocalImage(join(dir, 'folder.png'))).rejects.toThrow(/not a file/)
    await expect(readLocalImage('  ')).rejects.toThrow(/empty/)
  })
})
