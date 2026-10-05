import { readFile, stat } from 'fs/promises'
import { basename, extname, isAbsolute } from 'path'

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

// The extension is only a hint the caller chose; the bytes decide what we
// upload, so a text file renamed to .png never leaves the machine.
export function sniffImageMime(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i]
  if (bytes.length >= 4 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (bytes.length >= 4 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif'
  if (bytes.length >= 12
    && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46
    && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp'
  return null
}

// Agent-supplied paths are untrusted: UNC/device paths would make Windows
// authenticate to a remote host (or open a device), so only plain local
// absolute paths to a real image file are read.
export async function readLocalImage(path: string, maxBytes = 25 * 1024 * 1024): Promise<{ bytes: Buffer; mime: string; name: string }> {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Image path is empty')
  if (path.startsWith('\\\\') || path.startsWith('//')) throw new Error('Network and device paths are not allowed for images')
  if (!isAbsolute(path)) throw new Error('Image path must be absolute')
  const ext = extname(path).toLowerCase()
  if (!EXTENSIONS.has(ext)) throw new Error('Only .png, .jpg, .jpeg, .webp and .gif images are allowed')
  let info
  try { info = await stat(path) } catch { throw new Error(`Image file not found: ${path}`) }
  if (!info.isFile()) throw new Error(`Image path is not a file: ${path}`)
  if (info.size > maxBytes) throw new Error(`Image is too large (${info.size} bytes, max ${maxBytes})`)
  const bytes = await readFile(path)
  if (bytes.length > maxBytes) throw new Error(`Image is too large (${bytes.length} bytes, max ${maxBytes})`)
  const mime = sniffImageMime(bytes)
  if (!mime) throw new Error(`File is not a PNG, JPEG, GIF or WebP image: ${path}`)
  return { bytes, mime, name: basename(path) }
}
