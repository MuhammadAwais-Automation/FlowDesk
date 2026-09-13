import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import {
  KNOWLEDGE_DOC_TYPES,
  type KnowledgeDocType,
  type VaultImportReport,
} from '../../../src/types/brainKnowledge'
import type { DocumentStorePort } from './ports'

export const VAULT_IMPORT_DEFAULT_MAX_FILE_BYTES = 1_000_000

/** Directories that never hold curated knowledge, or must not be read at all. */
export const VAULT_SKIP_DIRECTORIES: readonly string[] = [
  '.git', '.obsidian', '.claude', '.claudian', 'node_modules',
  'raw', 'tmp', 'terminals', 'Excalidraw', 'mcps',
] as const

export interface ImportVaultInput {
  scopeId: string
  vaultRoot: string
  maxFileBytes?: number
}

interface ParsedMarkdown {
  body: string
  frontmatter: Map<string, string>
}

const knownTypes = new Set<string>(KNOWLEDGE_DOC_TYPES)
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function toVaultPath(vaultRoot: string, absolutePath: string): string {
  return relative(vaultRoot, absolutePath).replaceAll('\\', '/')
}

function walkMarkdownFiles(vaultRoot: string): string[] {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!VAULT_SKIP_DIRECTORIES.includes(entry.name)) visit(join(directory, entry.name))
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        files.push(join(directory, entry.name))
      }
    }
  }

  visit(vaultRoot)
  return files.sort((left, right) => (
    toVaultPath(vaultRoot, left).localeCompare(toVaultPath(vaultRoot, right))
  ))
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed.at(-1)
    if ((first === '\'' && last === '\'') || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

function parseMarkdown(text: string): ParsedMarkdown {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!opening) return { body: text, frontmatter: new Map() }

  const restStart = opening[0].length
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(text.slice(restStart))
  if (!closing) return { body: text, frontmatter: new Map() }

  const frontmatterText = text.slice(restStart, restStart + closing.index)
  const frontmatter = new Map<string, string>()
  for (const line of frontmatterText.split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line)
    if (field) frontmatter.set(field[1].toLowerCase(), unquoteYamlScalar(field[2]))
  }

  return {
    frontmatter,
    body: text.slice(restStart + closing.index + closing[0].length),
  }
}

function inferType(path: string, frontmatter: Map<string, string>): KnowledgeDocType {
  const declaredType = frontmatter.get('type')?.toLowerCase()
  if (declaredType && knownTypes.has(declaredType)) return declaredType as KnowledgeDocType

  const lowerPath = path.toLowerCase()
  const mappings: Array<[prefix: string, type: KnowledgeDocType]> = [
    ['wiki/projects/', 'project'],
    ['wiki/clients/', 'client'],
    ['wiki/me/', 'me'],
    ['wiki/research/', 'research'],
    ['wiki/business/', 'research'],
    ['wiki/learning/', 'skill'],
    ['wiki/skills/', 'skill'],
    ['wiki/toolkits/', 'skill'],
    ['wiki/ai-tooling/', 'skill'],
    ['wiki/partners/', 'person'],
    ['wiki/people/', 'person'],
    ['journal/', 'note'],
  ]
  return mappings.find(([prefix]) => lowerPath.startsWith(prefix))?.[1] ?? 'note'
}

function deriveTitle(path: string, body: string, frontmatter: Map<string, string>): string {
  const heading = /^#[ \t]+(.+?)[ \t]*$/m.exec(body)?.[1]
  if (heading) return heading

  const frontmatterTitle = frontmatter.get('title')
  if (frontmatterTitle) return frontmatterTitle

  return basename(path, extname(path)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function truncateAtWordBoundary(text: string, maximumLength: number): string {
  if (text.length <= maximumLength) return text
  const prefix = text.slice(0, maximumLength + 1)
  const boundary = prefix.search(/\s+\S*$/)
  return (boundary > 0 ? prefix.slice(0, boundary) : text.slice(0, maximumLength)).trimEnd()
}

function deriveSummary(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0 && !/^#{1,6}(?:\s|$)/.test(candidate))
  if (!line) return ''

  const cleaned = line.replace(/[\[\]*_`]/g, '').replace(/\s+/g, ' ').trim()
  return truncateAtWordBoundary(cleaned, 110)
}

function addToIndex(index: Map<string, string[]>, key: string, path: string): void {
  const existing = index.get(key) ?? []
  if (!existing.includes(path)) index.set(key, [...existing, path])
}

function buildPathIndex(paths: string[]): Map<string, string[]> {
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

function resolveWikiLink(
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

function extractWikiLinks(
  body: string,
  sourcePath: string,
  pathIndex: Map<string, string[]>,
): string[] {
  const links: string[] = []
  for (const match of body.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)) {
    const rawTarget = match[1].split('|', 1)[0].trim()
    if (rawTarget) links.push(resolveWikiLink(rawTarget, sourcePath, pathIndex))
  }
  return links
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ReadVaultFileResult =
  | { bytes: Buffer; text: string; updatedAt: string }
  | { reason: string }

function readVaultFile(absolutePath: string, maxFileBytes: number): ReadVaultFileResult {
  try {
    const stats = statSync(absolutePath)
    if (stats.size > maxFileBytes) {
      return { reason: `File exceeds maximum size of ${maxFileBytes} bytes` }
    }

    const bytes = readFileSync(absolutePath)
    if (bytes.length > maxFileBytes) {
      return { reason: `File exceeds maximum size of ${maxFileBytes} bytes` }
    }

    try {
      return {
        bytes,
        text: utf8Decoder.decode(bytes),
        updatedAt: stats.mtime.toISOString(),
      }
    } catch {
      return { reason: 'File is not valid UTF-8' }
    }
  } catch (error) {
    return { reason: `Unable to read file: ${failureReason(error)}` }
  }
}

export class VaultImporter {
  constructor(private readonly documents: DocumentStorePort) {}

  import(input: ImportVaultInput): VaultImportReport {
    const startedAt = performance.now()
    const maxFileBytes = input.maxFileBytes ?? VAULT_IMPORT_DEFAULT_MAX_FILE_BYTES
    const absolutePaths = walkMarkdownFiles(input.vaultRoot)
    const vaultPaths = absolutePaths.map((path) => toVaultPath(input.vaultRoot, path))
    const pathIndex = buildPathIndex(vaultPaths)
    const report: VaultImportReport = {
      scanned: absolutePaths.length,
      imported: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      failures: [],
      durationMs: 0,
    }

    for (let index = 0; index < absolutePaths.length; index += 1) {
      const absolutePath = absolutePaths[index]
      const path = vaultPaths[index]
      const readResult = readVaultFile(absolutePath, maxFileBytes)
      if ('reason' in readResult) {
        report.skipped += 1
        report.failures.push({ path, reason: readResult.reason })
        continue
      }

      const parsed = parseMarkdown(readResult.text)
      const contentHash = createHash('sha256').update(readResult.bytes).digest('hex')
      const existing = this.documents.read([input.scopeId], path)
      this.documents.upsert({
        scopeId: input.scopeId,
        path,
        type: inferType(path, parsed.frontmatter),
        title: deriveTitle(path, parsed.body, parsed.frontmatter),
        summary: deriveSummary(parsed.body),
        body: parsed.body,
        origin: 'curated',
        contentHash,
        updatedAt: readResult.updatedAt,
        links: extractWikiLinks(parsed.body, path, pathIndex),
      })

      if (!existing) report.imported += 1
      else if (existing.document.contentHash === contentHash) report.unchanged += 1
      else report.updated += 1
    }

    report.durationMs = performance.now() - startedAt
    return report
  }
}
