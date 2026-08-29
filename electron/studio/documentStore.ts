import { mkdir, readdir, readFile, writeFile, rename, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { documentsRoot, isValidDocumentId, studioPath } from './paths'
import { blankDocument, parseArtboards } from './artboards'

/**
 * Filesystem home for Studio documents.
 *
 * `document.html` is the source of truth and `meta.json` is a cache of what
 * it says, which is why every write re-derives the registry from the HTML
 * and why a missing meta.json is rebuilt rather than treated as a lost
 * document. The user can edit the HTML by hand and the app still agrees.
 *
 * Writes are atomic and serialized per document: a plain writeFile truncates
 * before writing, so an export or a canvas reload landing in that window
 * would read a half-written file.
 */

export interface StudioArtboardMeta {
  id: string
  name: string
  width: number
  height: number
}

export interface StudioDocumentMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  artboards: StudioArtboardMeta[]
}

/** Fires after any write, so the Studio page can follow the agent's edits. */
export const studioDocumentChanged = new EventEmitter()

const htmlPath = (id: string) => studioPath(id, 'document.html')
const metaPath = (id: string) => studioPath(id, 'meta.json')

export function assetsDir(id: string): string {
  return studioPath(id, 'assets')
}

/** One promise chain per document, so two writes cannot interleave. */
const writeChains = new Map<string, Promise<unknown>>()

function serialize<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(id) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(run)
  writeChains.set(id, next.catch(() => {}))
  return next
}

async function writeAtomic(target: string, contents: string): Promise<void> {
  const temporary = `${target}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(temporary, contents, 'utf8')
  await rename(temporary, target)
}

export async function readDocumentHtml(id: string): Promise<string | null> {
  if (!isValidDocumentId(id)) return null
  try {
    return await readFile(htmlPath(id), 'utf8')
  } catch {
    return null
  }
}

function registryFrom(html: string): StudioArtboardMeta[] {
  return parseArtboards(html).map(({ id, name, width, height }) => ({ id, name, width, height }))
}

async function readMeta(id: string): Promise<StudioDocumentMeta | null> {
  if (!isValidDocumentId(id)) return null
  try {
    return JSON.parse(await readFile(metaPath(id), 'utf8')) as StudioDocumentMeta
  } catch {
    // Rebuild from the HTML rather than dropping the document: meta.json is
    // only a cache, and losing it must not lose the user's work.
    const html = await readDocumentHtml(id)
    if (html === null) return null
    const now = new Date().toISOString()
    const rebuilt: StudioDocumentMeta = { id, title: id, createdAt: now, updatedAt: now, artboards: registryFrom(html) }
    await writeAtomic(metaPath(id), JSON.stringify(rebuilt, null, 2)).catch(() => {})
    return rebuilt
  }
}

export async function listDocuments(): Promise<StudioDocumentMeta[]> {
  let entries: string[]
  try {
    entries = await readdir(documentsRoot())
  } catch {
    return []
  }
  const metas: StudioDocumentMeta[] = []
  for (const entry of entries) {
    const meta = await readMeta(entry)
    if (meta) metas.push(meta)
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createDocument(title = 'Untitled'): Promise<StudioDocumentMeta> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await mkdir(assetsDir(id), { recursive: true })
  await writeAtomic(htmlPath(id), blankDocument(title))
  const meta: StudioDocumentMeta = { id, title, createdAt: now, updatedAt: now, artboards: [] }
  await writeAtomic(metaPath(id), JSON.stringify(meta, null, 2))
  return meta
}

export function writeDocumentHtml(id: string, html: string): Promise<StudioDocumentMeta> {
  if (!isValidDocumentId(id)) {
    return Promise.reject(new Error(`Not a valid Studio document id: ${String(id).slice(0, 80)}`))
  }
  return serialize(id, async () => {
    const existing = await readMeta(id)
    if (!existing) throw new Error(`No Studio document "${id}".`)
    await writeAtomic(htmlPath(id), html)
    const meta: StudioDocumentMeta = {
      ...existing,
      updatedAt: new Date().toISOString(),
      artboards: registryFrom(html),
    }
    await writeAtomic(metaPath(id), JSON.stringify(meta, null, 2))
    studioDocumentChanged.emit('changed', id)
    return meta
  })
}

export function renameDocument(id: string, title: string): Promise<void> {
  if (!isValidDocumentId(id)) return Promise.reject(new Error('Not a valid Studio document id.'))
  return serialize(id, async () => {
    const existing = await readMeta(id)
    if (!existing) return
    await writeAtomic(metaPath(id), JSON.stringify({ ...existing, title, updatedAt: new Date().toISOString() }, null, 2))
    studioDocumentChanged.emit('changed', id)
  })
}

export function deleteDocument(id: string): Promise<void> {
  if (!isValidDocumentId(id)) {
    return Promise.reject(new Error(`Not a valid Studio document id: ${String(id).slice(0, 80)}`))
  }
  return serialize(id, async () => {
    await rm(studioPath(id), { recursive: true, force: true })
    writeChains.delete(id)
  })
}
