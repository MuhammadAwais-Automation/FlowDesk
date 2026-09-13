/**
 * Vault importer — walks a Markdown vault and puts its files into the store.
 *
 * STUB. Implemented by work package W4 — see docs/brain-v2/w4-vault-import.md.
 * Read-only with respect to the vault: it never writes to the user's files.
 */

import type { VaultImportReport } from '../../../src/types/brainKnowledge'
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

const NOT_IMPLEMENTED = 'VaultImporter is not implemented yet — see docs/brain-v2/w4-vault-import.md'

export class VaultImporter {
  constructor(private readonly documents: DocumentStorePort) {}

  import(_input: ImportVaultInput): VaultImportReport {
    // Touches the port so the held dependency survives typecheck until W4 uses it.
    void this.documents
    throw new Error(NOT_IMPLEMENTED)
  }
}
