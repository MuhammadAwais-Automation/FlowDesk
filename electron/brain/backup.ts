import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BrainDatabase } from './database'

interface BackupManifest {
  format: 'flowdesk-brain-backup'
  version: 1
  schemaVersion: 1
  createdAt: string
}

function collectMarkdown(root: string, current = root): string[] {
  const files: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) files.push(...collectMarkdown(root, path))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path)
  }
  return files
}

function safeArchivePath(path: string) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => part === '..' || part === '')) return false
  return path === 'brain.sqlite' || path === 'manifest.json' || path.startsWith('vault/')
}

export class BrainBackupManager {
  static exportArchive(database: BrainDatabase, vaultRoot: string, outputPath: string) {
    const snapshot = join(dirname(outputPath), `.brain-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
    try {
      database.exportSnapshot(snapshot)
      const manifest: BackupManifest = { format: 'flowdesk-brain-backup', version: 1, schemaVersion: 1, createdAt: new Date().toISOString() }
      const files: Record<string, Uint8Array> = {
        'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
        'brain.sqlite': readFileSync(snapshot),
      }
      for (const path of collectMarkdown(vaultRoot)) {
        const archivePath = `vault/${relative(vaultRoot, path).split(sep).join('/')}`
        files[archivePath] = readFileSync(path)
      }
      writeFileSync(outputPath, zipSync(files, { level: 6 }))
      return { outputPath, fileCount: Object.keys(files).length }
    } finally {
      rmSync(snapshot, { force: true })
    }
  }

  static inspectArchive(inputPath: string) {
    const files = unzipSync(readFileSync(inputPath))
    const names = Object.keys(files)
    const unsafe = names.find(name => !safeArchivePath(name))
    if (unsafe) throw new Error(`Unsafe backup entry: ${unsafe}`)
    if (!files['manifest.json'] || !files['brain.sqlite']) throw new Error('Backup is missing manifest or database')
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Partial<BackupManifest>
    if (manifest.format !== 'flowdesk-brain-backup' || manifest.version !== 1 || manifest.schemaVersion !== 1) throw new Error('Backup format or schema is incompatible')
    return { manifest: manifest as BackupManifest, files }
  }

  static extractArchive(inputPath: string, targetRoot: string) {
    const { manifest, files } = this.inspectArchive(inputPath)
    const absoluteRoot = resolve(targetRoot)
    for (const [name, bytes] of Object.entries(files)) {
      if (name === 'manifest.json') continue
      const destination = resolve(absoluteRoot, name)
      if (destination !== absoluteRoot && !destination.startsWith(`${absoluteRoot}${sep}`)) throw new Error(`Unsafe backup entry: ${name}`)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, bytes)
    }
    return manifest
  }

  static restoreAtomic(inputPath: string, brainRoot: string) {
    const parent = dirname(brainRoot)
    mkdirSync(parent, { recursive: true })
    // Restoring into a profile where Brain has never run is a supported recovery
    // path, and there the brain root itself does not exist yet. Without this the
    // atomic rename below fails with ENOENT after the archive already validated.
    mkdirSync(brainRoot, { recursive: true })
    const staging = mkdtempSync(join(parent, 'brain-import-'))
    try {
      const manifest = this.extractArchive(inputPath, staging)
      const probe = new BrainDatabase(join(staging, 'brain.sqlite'))
      const status = probe.getStatus()
      probe.close()
      if (!status.ready) throw new Error('Backup database failed its health check')
      const oldDatabase = join(brainRoot, 'brain.sqlite')
      const rollbackDatabase = join(parent, `brain-before-import-${Date.now()}.sqlite`)
      if (existsSync(oldDatabase)) renameSync(oldDatabase, rollbackDatabase)
      rmSync(join(brainRoot, 'brain.sqlite-wal'), { force: true })
      rmSync(join(brainRoot, 'brain.sqlite-shm'), { force: true })
      renameSync(join(staging, 'brain.sqlite'), oldDatabase)
      const oldVault = join(brainRoot, 'vault')
      if (existsSync(oldVault)) rmSync(oldVault, { recursive: true, force: true })
      if (existsSync(join(staging, 'vault'))) renameSync(join(staging, 'vault'), oldVault)
      return { manifest, rollbackDatabase }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}
