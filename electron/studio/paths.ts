import { join, resolve, sep } from 'path'
import { app } from 'electron'

/**
 * Every filesystem path Studio builds from an id it was handed.
 *
 * Document ids reach the main process from the agent and from the renderer,
 * and one of the operations they drive is a recursive delete. Validating the
 * id shape and then re-checking the resolved path keeps a crafted id from
 * reading, overwriting, or deleting anything outside the documents
 * directory. The same discipline already exists for image filenames in
 * electron/savedImages.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function documentsRoot(): string {
  return resolve(join(app.getPath('userData'), 'studio-documents'))
}

export function isValidDocumentId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id)
}

export function studioPath(id: string, ...segments: string[]): string {
  if (!isValidDocumentId(id)) {
    throw new Error(`Not a valid Studio document id: ${String(id).slice(0, 80)}`)
  }
  const base = resolve(documentsRoot(), id)
  const target = resolve(base, ...segments)
  // Shape validation alone still allows a crafted later segment, and
  // resolve() is the only thing that knows what the path really became.
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('Refusing a Studio path outside its own document directory.')
  }
  return target
}
