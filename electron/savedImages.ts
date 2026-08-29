import { readFile, writeFile, mkdir, access } from 'fs/promises'
import { basename, join } from 'path'
import { app } from 'electron'

/**
 * Reads an image FlowDesk already saved to disk.
 *
 * Images arriving from a provider (ChatGPT's generated images, Gemini's) are
 * downloaded once and written to `<userData>/generated-images`, then handed
 * around as `flowdesk-image://<file>.png` URLs — the custom protocol
 * registered in main.ts serves them to the renderer. Until now nothing could
 * turn one of those URLs back into bytes, so the agent could report an image
 * link it had never seen: it described generated images purely from the
 * prompt it had sent, with no way to check what actually came back.
 *
 * Kept separate from main.ts on purpose — main.ts imports Electron's whole
 * app surface and cannot be imported from a test, and the reference parsing
 * below is exactly the part worth testing directly.
 */

export interface SavedImageResult {
  ok: boolean
  error?: string
  bytes?: Buffer
  mimeType?: string
  fileName?: string
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}

/**
 * Reduces any reference the agent might repeat back — the full
 * `flowdesk-image://x.png` URL, a markdown `![alt](flowdesk-image://x.png)`
 * link it copied verbatim, or the bare filename — to a single path segment.
 *
 * `basename` is what makes this traversal-safe: a crafted
 * `flowdesk-image://../../../../etc/passwd` collapses to `passwd`, which
 * simply will not exist in the images directory. Returns null when nothing
 * usable is left, so the caller reports a miss instead of reading a
 * surprising path.
 */
export function parseSavedImageRef(ref: string): string | null {
  let value = String(ref ?? '').trim()
  if (!value) return null

  // ![alt](flowdesk-image://name.png) — take what is inside the parentheses.
  const markdown = value.match(/\(([^)]+)\)\s*$/)
  if (markdown) value = markdown[1].trim()

  value = value.replace(/^flowdesk-image:\/\//i, '')
  // A URL keeps the name in the host when there is no path, and query/hash
  // are not part of a filename either.
  value = value.split(/[?#]/)[0]
  value = decodeURIComponent(value)

  const name = basename(value.replace(/\\/g, '/'))
  if (!name || name === '.' || name === '..') return null
  if (!/\.[a-z0-9]+$/i.test(name)) return null
  return name
}

export function generatedImagesDir(): string {
  return join(app.getPath('userData'), 'generated-images')
}

export async function readSavedImage(ref: string): Promise<SavedImageResult> {
  const fileName = parseSavedImageRef(ref)
  if (!fileName) {
    return { ok: false, error: `not a usable image reference: ${String(ref).slice(0, 120)}` }
  }

  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) return { ok: false, error: `unsupported image type: .${ext}` }

  try {
    const bytes = await readFile(join(generatedImagesDir(), fileName))
    return { ok: true, bytes, mimeType, fileName }
  } catch {
    return {
      ok: false,
      error: `no saved image named "${fileName}" — it may have been generated in a different session, or never saved`,
    }
  }
}

/**
 * Turns a provider-supplied image title into a filename safe to write.
 *
 * The title comes from ChatGPT (`image_gen_title`, e.g. "VX-49 Starfury
 * Blueprint"), so it is untrusted text heading for a real path: it can carry
 * separators, `..`, reserved Windows device names, trailing dots/spaces that
 * Windows silently strips, or simply be enormous. Everything outside a plain
 * allow-list is collapsed, and an empty or reserved result falls back to the
 * caller's own name rather than producing something surprising.
 */
// Characters a filename cannot carry: the path separators, plus everything
// Windows forbids. Built from a list rather than written as a regex literal
// so the backslash needs no escaping and cannot be lost in an edit.
const FORBIDDEN_NAME_CHARS = new Set([...':*?"<>|/', '\\'])

/**
 * Turns a provider-supplied image title into a filename safe to write.
 *
 * The title comes from ChatGPT (`image_gen_title`, e.g. "VX-49 Starfury
 * Blueprint"), so it is untrusted text heading for a real path: it can carry
 * separators, `..`, reserved Windows device names, trailing dots/spaces that
 * Windows silently strips, or simply be enormous. Everything outside a plain
 * allow-list is collapsed, and an empty or reserved result falls back to the
 * caller's own name rather than producing something surprising.
 */
export function safeImageFileName(title: string, ext: string, fallback: string): string {
  const cleanExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : 'png'

  let base = [...String(title ?? '')]
    .map(ch => (ch < ' ' || FORBIDDEN_NAME_CHARS.has(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    // Leading dots/spaces are safe once separators are gone, but they read
    // as junk ("​.. .. etc passwd.png"); trailing ones are worse than untidy,
    // since Windows silently drops them and the path reported to the user
    // would then not match the file on disk.
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .replace(/[. ]+$/, '')

  // CON, PRN, AUX, NUL, COM1-9, LPT1-9 are device names on Windows: a file
  // cannot take one even with an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = ''
  if (!base || base === '.' || base === '..') base = fallback

  return `${base}.${cleanExt}`
}

/**
 * Also writes the image somewhere the user can actually find it.
 *
 * The `flowdesk-image://` copy under userData is what the app renders and
 * what view_saved_image reads, but it lives in a hidden application folder.
 * Google Flow and WhatsApp already save user-facing copies under
 * `Downloads/FlowDesk …`; generated images were the one path that did not,
 * so an image the user was told about was effectively unreachable for them.
 *
 * Best-effort by design: the caller has already saved the internal copy, so
 * a failure here returns null and must not fail the whole turn.
 */
export async function saveImageToDownloads(
  bytes: Buffer,
  ext: string,
  title: string,
  fallbackName: string,
): Promise<string | null> {
  try {
    const dir = join(app.getPath('downloads'), 'FlowDesk ChatGPT')
    await mkdir(dir, { recursive: true })

    const wanted = safeImageFileName(title, ext, fallbackName)
    const dot = wanted.lastIndexOf('.')
    const stem = wanted.slice(0, dot)
    const suffix = wanted.slice(dot)

    // Titles repeat across turns ("Spaceship Blueprint" twice in a row is
    // normal), and silently overwriting an earlier image would lose it.
    for (let n = 0; n < 100; n++) {
      const candidate = join(dir, n === 0 ? wanted : `${stem} (${n})${suffix}`)
      try {
        await access(candidate)
      } catch {
        await writeFile(candidate, bytes)
        return candidate
      }
    }
    return null
  } catch {
    return null
  }
}
