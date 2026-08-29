import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { renderArtboardPng, renderDocumentPdf } from './render'
import { readDocumentHtml, listDocuments } from './documentStore'
import { parseArtboards } from './artboards'
import { safeImageFileName } from '../savedImages'

/**
 * The only place a rendered artboard becomes a file.
 *
 * Kept apart from render.ts so the agent's screenshot tool can look at an
 * artboard without writing anything, which is what its read-only label has
 * to mean.
 */

async function exportDir(): Promise<string> {
  const dir = join(app.getPath('downloads'), 'FlowDesk Studio')
  await mkdir(dir, { recursive: true })
  return dir
}

export async function exportArtboardPng(documentId: string, artboardId: string): Promise<string> {
  const bytes = await renderArtboardPng(documentId, artboardId)
  const html = await readDocumentHtml(documentId)
  const board = html ? parseArtboards(html).find(b => b.id === artboardId) : null
  // The artboard's own name, not its generated id: the user opens this file
  // in Downloads and has to recognise it.
  const filePath = join(await exportDir(), safeImageFileName(board?.name || artboardId, 'png', artboardId))
  await writeFile(filePath, bytes)
  return filePath
}

export async function exportDocumentPdf(documentId: string): Promise<string> {
  const bytes = await renderDocumentPdf(documentId)
  const title = (await listDocuments()).find(d => d.id === documentId)?.title ?? documentId
  const filePath = join(await exportDir(), safeImageFileName(title, 'pdf', documentId))
  await writeFile(filePath, bytes)
  return filePath
}
