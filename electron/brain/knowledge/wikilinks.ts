/**
 * Wikilink parsing, shared by every writer.
 *
 * This lived inside vaultImporter.ts, where only imported vault files got
 * `knowledge_links` rows — documents written by the candidate gate, the
 * compactor and the memories migration had none at all. The retrieval ladder's
 * "follow one pointer" step needs links on every document regardless of who
 * wrote it, so the parsing moved here and `DocumentStore.upsert` derives links
 * when a caller does not supply them.
 */

import { basename, dirname, extname } from 'node:path'

const WIKILINK = /(?<!!)\[\[([^\]]+)\]\]/g

/**
 * Raw `[[target]]` values in document order, `#anchor` and `|alias` stripped.
 * The negative lookbehind skips `![[embeds]]`, which are transclusions rather
 * than references.
 */
export function extractWikiLinkTargets(body: string): string[] {
  const targets: string[] = []
  for (const match of body.matchAll(WIKILINK)) {
    const rawTarget = match[1].split('|', 1)[0].trim()
    if (rawTarget) targets.push(rawTarget)
  }
  return targets
}

function addToIndex(index: Map<string, string[]>, key: string, path: string): void {
  const existing = index.get(key) ?? []
  if (!existing.includes(path)) index.set(key, [...existing, path])
}

/**
 * Lowercased lookup from every way a link might name a file (full path, path
 * without extension, filename, filename without extension) to the real paths
 * that match it. A key with more than one path is ambiguous and resolves to
 * nothing, which is why the values are arrays.
 */
export function buildPathIndex(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const path of paths) {
    const extension = extname(path)
    const filename = basename(path).toLowerCase()
    for (const key of [
      path.toLowerCase(),
      path.slice(0, -extension.length).toLowerCase(),
      filename,
      filename.slice(0, -extname(filename).length),
    ]) {
      addToIndex(index, key, path)
    }
  }
  return index
}

/** Falls back to the raw target when nothing, or more than one thing, matches. */
export function resolveWikiLink(
  rawTarget: string,
  sourcePath: string,
  pathIndex: Map<string, string[]>,
): string {
  const target = rawTarget.trim()
  const pathTarget = target.split('#', 1)[0].replaceAll('\\', '/').replace(/^\.\//, '')
  const sourceRelative = `${dirname(sourcePath).replaceAll('\\', '/')}/${pathTarget}`
    .replace(/^\.\//, '')
  for (const key of [pathTarget, sourceRelative]) {
    const matches = pathIndex.get(key.toLowerCase())
    if (matches?.length === 1) return matches[0]
  }
  return target
}

export function extractWikiLinks(
  body: string,
  sourcePath: string,
  pathIndex: Map<string, string[]>,
): string[] {
  return extractWikiLinkTargets(body).map(target => resolveWikiLink(target, sourcePath, pathIndex))
}
