import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BrainDatabase, SCHEMA_VERSION } from './database'

/**
 * Version of the ARCHIVE layout — what files a `.flowdesk-brain.zip` contains
 * and how the manifest is shaped. Nothing to do with the SQLite schema version.
 *
 * The two used to share the name `schemaVersion`, and they have since diverged
 * (archive 1, database 2), so an operator reading `manifest.json` saw a "1" that
 * described a v2 database. Worse, the old check was exact equality: bumping the
 * manifest field to "match" a future database version would have rejected every
 * archive ever exported. Both versions are now named for what they version and
 * compared as ranges.
 */
export const ARCHIVE_FORMAT_VERSION = 1

export interface BackupManifest {
  format: 'flowdesk-brain-backup'
  /** Layout of this archive. */
  archiveFormatVersion: number
  /** `PRAGMA user_version` of the SQLite database inside it. */
  databaseSchemaVersion: number
  createdAt: string
}

/** Manifest shape written before the version fields were renamed. */
interface LegacyBackupManifest {
  version?: number
  schemaVersion?: number
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
      const manifest: BackupManifest = {
        format: 'flowdesk-brain-backup',
        archiveFormatVersion: ARCHIVE_FORMAT_VERSION,
        // Read from the database this snapshot was taken from, so the manifest
        // cannot drift away from what the archive actually holds.
        databaseSchemaVersion: database.getStatus().schemaVersion,
        createdAt: new Date().toISOString(),
      }
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
    const raw = JSON.parse(strFromU8(files['manifest.json'])) as Partial<BackupManifest> & LegacyBackupManifest
    if (raw.format !== 'flowdesk-brain-backup') throw new Error('Backup is not a FlowDesk Brain backup')
    // `version` is the pre-rename spelling of the archive format version.
    const archiveFormatVersion = raw.archiveFormatVersion ?? raw.version
    if (!Number.isInteger(archiveFormatVersion) || Number(archiveFormatVersion) < 1) {
      throw new Error('Backup manifest has no usable archive format version')
    }
    // Compared as a range, never for equality: an older archive still restores,
    // and a newer one is refused by name instead of by a mismatched literal.
    if (Number(archiveFormatVersion) > ARCHIVE_FORMAT_VERSION) {
      throw new Error(`Backup archive format version ${archiveFormatVersion} is newer than this FlowDesk build supports (${ARCHIVE_FORMAT_VERSION})`)
    }
    // A database older than this build migrates forward on open; a newer one
    // cannot be migrated backwards, so that is the only rejecting direction.
    // Pre-rename archives carry no database version — their `schemaVersion` was
    // the archive format — and are validated by the health probe instead.
    const databaseSchemaVersion = raw.databaseSchemaVersion
    if (databaseSchemaVersion !== undefined && (!Number.isInteger(databaseSchemaVersion) || databaseSchemaVersion > SCHEMA_VERSION)) {
      throw new Error(`Backup database schema version ${databaseSchemaVersion} is newer than this FlowDesk build supports (${SCHEMA_VERSION})`)
    }
    const manifest: BackupManifest = {
      format: 'flowdesk-brain-backup',
      archiveFormatVersion: Number(archiveFormatVersion),
      databaseSchemaVersion: databaseSchemaVersion ?? 1,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    }
    return { manifest, files }
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

  /**
   * Everything that can reject an archive, done before anything is replaced.
   *
   * Split out of `restoreAtomic` so a caller can validate while its own database
   * is still open and serving: `BrainService.importBackup` has to stop the vault
   * and close the live database before the swap, and a validation failure after
   * that left the utility alive with a dead database, no restart, and no
   * explanation. Returns the staging directory, which the caller must remove.
   */
  static stageArchive(inputPath: string, brainRoot: string) {
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
      return { staging, manifest }
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      throw error
    }
  }

  /** Swaps a validated staging directory in. The caller removes `staging`. */
  static commitStaged(staging: string, brainRoot: string) {
    const parent = dirname(brainRoot)
    const oldDatabase = join(brainRoot, 'brain.sqlite')
    const rollbackDatabase = join(parent, `brain-before-import-${Date.now()}.sqlite`)
    if (existsSync(oldDatabase)) renameSync(oldDatabase, rollbackDatabase)
    rmSync(join(brainRoot, 'brain.sqlite-wal'), { force: true })
    rmSync(join(brainRoot, 'brain.sqlite-shm'), { force: true })
    renameSync(join(staging, 'brain.sqlite'), oldDatabase)
    const oldVault = join(brainRoot, 'vault')
    if (existsSync(oldVault)) rmSync(oldVault, { recursive: true, force: true })
    if (existsSync(join(staging, 'vault'))) renameSync(join(staging, 'vault'), oldVault)
    return { rollbackDatabase }
  }

  static restoreAtomic(inputPath: string, brainRoot: string) {
    const { staging, manifest } = this.stageArchive(inputPath, brainRoot)
    try {
      return { manifest, ...this.commitStaged(staging, brainRoot) }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}
