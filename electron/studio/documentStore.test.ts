import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

const store = await import('./documentStore')
const { appendArtboard } = await import('./artboards')

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'fd-studio-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('createDocument and listDocuments', () => {
  it('creates a document that then appears in the list', async () => {
    const created = await store.createDocument('My Carousel')
    const all = await store.listDocuments()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: created.id, title: 'My Carousel' })
    expect(created.artboards).toEqual([])
  })

  it('returns an empty list before anything is created', async () => {
    expect(await store.listDocuments()).toEqual([])
  })
})

describe('writeDocumentHtml', () => {
  it('derives the artboard registry from the HTML that was written', async () => {
    const doc = await store.createDocument('T')
    const html = appendArtboard(
      appendArtboard((await store.readDocumentHtml(doc.id))!, { id: 'a1', name: 'One', width: 1080, height: 1080 }),
      { id: 'a2', name: 'Two', width: 390, height: 844 },
    )
    const meta = await store.writeDocumentHtml(doc.id, html)
    expect(meta.artboards.map(a => a.id)).toEqual(['a1', 'a2'])
    expect(meta.artboards[1]).toMatchObject({ width: 390, height: 844 })
  })

  it('leaves the assets directory untouched', async () => {
    const doc = await store.createDocument()
    await mkdir(store.assetsDir(doc.id), { recursive: true })
    await writeFile(join(store.assetsDir(doc.id), 'keep.png'), 'x')
    await store.writeDocumentHtml(doc.id, '<html><body></body></html>')
    expect(await readFile(join(store.assetsDir(doc.id), 'keep.png'), 'utf8')).toBe('x')
  })

  it('leaves no temporary file behind after a write', async () => {
    // An atomic write renames its temp file into place; a leftover .tmp
    // means the rename never happened and a reader could find it.
    const doc = await store.createDocument()
    await store.writeDocumentHtml(doc.id, '<html><body>done</body></html>')
    const entries = await readdir(join(root, 'studio-documents', doc.id))
    expect(entries.filter(e => e.includes('.tmp'))).toEqual([])
  })

  it('serializes concurrent writes so the file is never a blend of two', async () => {
    const doc = await store.createDocument()
    await Promise.all([
      store.writeDocumentHtml(doc.id, '<html><body>A</body></html>'),
      store.writeDocumentHtml(doc.id, '<html><body>B</body></html>'),
      store.writeDocumentHtml(doc.id, '<html><body>C</body></html>'),
    ])
    expect(['<html><body>A</body></html>', '<html><body>B</body></html>', '<html><body>C</body></html>'])
      .toContain(await store.readDocumentHtml(doc.id))
  })
})

describe('id safety', () => {
  it('refuses to read, write, or delete with a traversing id', async () => {
    expect(await store.readDocumentHtml('../..')).toBeNull()
    await expect(store.writeDocumentHtml('../..', '<html></html>')).rejects.toThrow()
    await expect(store.deleteDocument('../..')).rejects.toThrow()
  })
})

describe('resilience', () => {
  it('rebuilds meta from the HTML when meta.json is missing', async () => {
    const doc = await store.createDocument('Recoverable')
    const html = appendArtboard((await store.readDocumentHtml(doc.id))!, { id: 'z', name: 'Z', width: 100, height: 200 })
    await store.writeDocumentHtml(doc.id, html)
    await rm(join(root, 'studio-documents', doc.id, 'meta.json'))
    const all = await store.listDocuments()
    expect(all).toHaveLength(1)
    expect(all[0].artboards.map(a => a.id)).toEqual(['z'])
  })

  it('returns null for an unknown document rather than throwing', async () => {
    expect(await store.readDocumentHtml('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBeNull()
  })
})

describe('rename and delete', () => {
  it('renames without losing the HTML', async () => {
    const doc = await store.createDocument('Old')
    await store.renameDocument(doc.id, 'New')
    expect((await store.listDocuments())[0].title).toBe('New')
    expect(await store.readDocumentHtml(doc.id)).toContain('fd-artboard')
  })

  it('deletes exactly one document', async () => {
    const a = await store.createDocument('A')
    const b = await store.createDocument('B')
    await store.deleteDocument(a.id)
    expect((await store.listDocuments()).map(d => d.id)).toEqual([b.id])
  })
})

describe('studioDocumentChanged', () => {
  it('fires after a write so the canvas can follow the agent', async () => {
    const doc = await store.createDocument()
    const seen: string[] = []
    store.studioDocumentChanged.on('changed', (id: string) => seen.push(id))
    await store.writeDocumentHtml(doc.id, '<html><body></body></html>')
    expect(seen).toEqual([doc.id])
  })
})
