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

import { dirname, extname } from 'node:path'

const WIKILINK = /(?<!!)\[\[([^\]]+)\]\]/g

/**
 * Raw `[[target]]` values in document order, `#anchor` and `|alias` stripped.
 * The negative lookbehind skips `![[embeds]]`, which are transclusions rather
 * than references.
 */
export function extractWikiLinkTargets(body: string): string[] {
  const targets: string[] = []
  for (const match of body.matchAll(WIKILINK)) {
    // Obsidian's own order is `[[target#anchor|alias]]`, so the alias comes off
    // first and the anchor second. The anchor is a position inside a document,
    // never part of its path — leaving it on produced candidate documents at
    // paths like `me/tools#Setup.md` once Review learned to create them.
    const rawTarget = match[1].split('|', 1)[0].split('#', 1)[0].trim()
    if (rawTarget) targets.push(rawTarget)
  }
  return targets
}

function addToIndex(index: Map<string, string[]>, key: string, path: string): void {
  const existing = index.get(key) ?? []
  if (!existing.includes(path)) index.set(key, [...existing, path])
}

/**
 * Lowercased lookup from every way a link might name a file to the real paths
 * that match it. A key with more than one path is ambiguous and resolves to
 * nothing, which is why the values are arrays.
 *
 * Every *trailing* run of segments is a key, with and without the extension:
 * `wiki/me/profile.md` is findable as `wiki/me/profile.md`, `wiki/me/profile`,
 * `me/profile.md`, `me/profile`, `profile.md` and `profile`. Obsidian resolves
 * by shortest unique suffix, so a vault written against it is full of
 * `[[me/profile]]` for a file two directories deeper. Indexing only the four
 * endpoints -- full path, full path minus extension, filename, filename minus
 * extension -- missed every link that named more than the file but less than
 * the whole path, which in the real store was 1,033 links of 1,104. An
 * unresolved link is an edge the graph never draws.
 */
export function buildPathIndex(paths: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const path of paths) {
    const normalized = path.replaceAll('\\', '/')
    const withExtension = normalized.split('/')
    const withoutExtension = normalized.slice(0, normalized.length - extname(normalized).length).split('/')
    for (let start = 0; start < withExtension.length; start += 1) {
      addToIndex(index, withExtension.slice(start).join('/').toLowerCase(), path)
      addToIndex(index, withoutExtension.slice(start).join('/').toLowerCase(), path)
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
