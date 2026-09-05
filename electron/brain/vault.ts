import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { BrainMemory, MemoryKind } from '../../src/types/brain'
import { BrainDatabase } from './database'

const DIRECTORIES = ['Inbox', 'Memories', 'People', 'Organizations', 'Projects', 'Clients', 'Opportunities', 'Decisions', 'Procedures', 'Sources'] as const

function directoryFor(kind: MemoryKind) {
  if (kind === 'person') return 'People'
  if (kind === 'organization') return 'Organizations'
  if (kind === 'opportunity') return 'Opportunities'
  if (kind === 'decision' || kind === 'goal') return 'Decisions'
  if (kind === 'procedure') return 'Procedures'
  return 'Memories'
}

function safeYaml(value: string) {
  return JSON.stringify(value)
}

function parseMarkdown(markdown: string) {
  const normalized = markdown.replaceAll('\r\n', '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized)
  if (!match) return null
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    try {
      fields[key] = raw.startsWith('"') ? JSON.parse(raw) as string : raw
    } catch {
      fields[key] = raw
    }
  }
  return { fields, body: match[2].trim() }
}

export class VaultManager {
  private watcher: FSWatcher | null = null
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly database: BrainDatabase, readonly root: string) {
    for (const directory of DIRECTORIES) mkdirSync(join(root, directory), { recursive: true })
  }

  private render(memory: BrainMemory, revision: number) {
    return [
      '---',
      `brain_id: ${memory.id}`,
      `revision: ${revision}`,
      `kind: ${memory.kind}`,
      `scope_id: ${memory.scopeId}`,
      `status: ${memory.status}`,
      `created_at: ${memory.createdAt}`,
      `updated_at: ${memory.updatedAt}`,
      `source_ids: ${safeYaml(memory.sourceRef)}`,
      '---',
      '',
      memory.text,
      '',
    ].join('\n')
  }

  pathFor(memory: BrainMemory) {
    return join(this.root, directoryFor(memory.kind), `${memory.kind}-${memory.id}.md`)
  }

  writeMemory(id: string) {
    const memory = this.database.getMemory(id)
    if (!memory || memory.status === 'deleted') throw new Error('Memory not found')
    const path = this.pathFor(memory)
    writeFileSync(path, this.render(memory, this.database.getMemoryRevision(id)), 'utf8')
    return path
  }

  writeAll() {
    return this.database.listMemories().filter(memory => memory.status === 'accepted').map(memory => this.writeMemory(memory.id))
  }

  reconcileFile(filePath: string): { status: 'unchanged' | 'updated' | 'conflict' | 'imported'; revision?: number } {
    const absolute = resolve(filePath)
    const relativePath = relative(resolve(this.root), absolute)
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath) || extname(absolute).toLowerCase() !== '.md') throw new Error('Vault path is outside the managed vault')
    const parsed = parseMarkdown(readFileSync(absolute, 'utf8'))
    if (!parsed?.fields.brain_id) {
      const inboxPath = join(this.root, 'Inbox', basename(absolute))
      if (absolute !== inboxPath) writeFileSync(inboxPath, readFileSync(absolute))
      return { status: 'imported' }
    }
    const memory = this.database.getMemory(parsed.fields.brain_id)
    if (!memory) return { status: 'imported' }
    const fileRevision = Number(parsed.fields.revision)
    const databaseRevision = this.database.getMemoryRevision(memory.id)
    if (!Number.isInteger(fileRevision) || fileRevision < 1) throw new Error('Vault revision is invalid')
    if (parsed.body === memory.text) {
      if (fileRevision !== databaseRevision) this.writeMemory(memory.id)
      return { status: 'unchanged', revision: databaseRevision }
    }
    if (fileRevision !== databaseRevision) {
      this.database.addVaultConflict({ memoryId: memory.id, filePath: absolute, baseRevision: fileRevision, databaseText: memory.text, fileText: parsed.body })
      return { status: 'conflict', revision: databaseRevision }
    }
    const updated = this.database.reviseMemory(memory.id, parsed.body, `vault://${memory.id}`)
    this.writeMemory(updated.id)
    return { status: 'updated', revision: this.database.getMemoryRevision(memory.id) }
  }

  reconcileAll() {
    const results: Array<{ path: string; status: string }> = []
    for (const directory of DIRECTORIES) {
      const full = join(this.root, directory)
      for (const name of readdirSync(full)) {
        if (name.toLowerCase().endsWith('.md')) {
          const path = join(full, name)
          try {
            results.push({ path, status: this.reconcileFile(path).status })
          } catch {
            results.push({ path, status: 'invalid' })
          }
        }
      }
    }
    return results
  }

  start() {
    if (this.watcher || !existsSync(this.root)) return
    this.watcher = watch(this.root, { recursive: true }, (_event, name) => {
      if (!name || !name.toLowerCase().endsWith('.md')) return
      const path = join(this.root, name)
      const existing = this.timers.get(path)
      if (existing) clearTimeout(existing)
      this.timers.set(path, setTimeout(() => {
        this.timers.delete(path)
        if (existsSync(path)) {
          try { this.reconcileFile(path) } catch { /* surfaced during periodic reconciliation */ }
        }
      }, 300))
    })
  }

  stop() {
    this.watcher?.close()
    this.watcher = null
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  getStatus() {
    return { root: this.root, watching: this.watcher !== null, conflicts: this.database.listVaultConflicts().length }
  }
}
