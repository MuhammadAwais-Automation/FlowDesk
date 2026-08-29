import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { join } from 'path'
import { assetsDir } from './documentStore'
import { readSavedImage, safeImageFileName } from '../savedImages'

/**
 * Copies an already-generated image into a Studio document's own assets/
 * folder, so the document stays self-contained.
 *
 * Deliberately does not generate images itself — ask_chatgpt and Google
 * Flow's tools already do that, each with its own provider-specific API and
 * risk (Flow's is an unofficial internal API). Rebuilding that here would
 * duplicate two very different integrations for no reason: this only needs
 * to turn whatever they already produced into bytes.
 *
 * Not copying — leaving the artboard pointing at flowdesk-image://<uuid> or
 * a Downloads path directly — was the alternative. Rejected because a
 * document that references files outside its own folder breaks the moment
 * one of them is cleaned up or moved, and "the whole document, self-
 * contained" is the property the rest of Studio depends on.
 */

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
}

export interface ResolvedImage {
  bytes: Buffer
  mimeType: string
}

/**
 * Turns an image reference into bytes.
 *
 * Two shapes only, matching what the two provider integrations actually
 * hand the agent: a `flowdesk-image://` reference (ChatGPT's saved images),
 * or a local file path (Google Flow's tools save straight to Downloads —
 * there is no flowdesk-image:// form for those).
 */
export async function resolveImageBytes(source: string): Promise<ResolvedImage> {
  const trimmed = String(source ?? '').trim()
  if (!trimmed) throw new Error('No image source given.')

  if (/flowdesk-image:\/\//i.test(trimmed)) {
    const found = await readSavedImage(trimmed)
    if (!found.ok || !found.bytes || !found.mimeType) {
      throw new Error(found.error ?? 'Could not read that saved image.')
    }
    return { bytes: found.bytes, mimeType: found.mimeType }
  }

  // A local file path — the tool that calls this always requires approval,
  // so the user sees the exact path before anything is read.
  const ext = trimmed.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) throw new Error(`Unsupported image type: .${ext || '(none)'}`)
  try {
    return { bytes: await readFile(trimmed), mimeType }
  } catch {
    throw new Error(`Could not read an image file at "${trimmed}".`)
  }
}

export interface AddedImage {
  url: string
  fileName: string
  bytes: number
  mimeType: string
}

/**
 * Resolves `source`, writes it into `documentId`'s assets/ folder, and
 * returns the `studio-asset://` URL to embed in an `<img src>` via
 * studio_write_html.
 */
export async function addImageToDocument(documentId: string, source: string, altText: string): Promise<AddedImage> {
  const { bytes, mimeType } = await resolveImageBytes(source)
  const ext = EXT_BY_MIME[mimeType] ?? 'png'

  const dir = assetsDir(documentId)
  await mkdir(dir, { recursive: true })

  const wanted = safeImageFileName(altText, ext, 'image')
  const dot = wanted.lastIndexOf('.')
  const stem = wanted.slice(0, dot)
  const suffix = wanted.slice(dot)

  for (let n = 0; n < 100; n++) {
    const fileName = n === 0 ? wanted : `${stem} (${n})${suffix}`
    try {
      await access(join(dir, fileName))
    } catch {
      await writeFile(join(dir, fileName), bytes)
      return { url: `studio-asset://${documentId}/${fileName}`, fileName, bytes: bytes.length, mimeType }
    }
  }
  throw new Error('Could not find a free file name for that image after 100 attempts.')
}
