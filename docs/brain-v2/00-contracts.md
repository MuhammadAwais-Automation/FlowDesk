# Contracts pass (serial — run before any work package starts)

This is the only pass that touches the shared plumbing. It lands types, the
schema v3 migration, the IPC surface, and stub module classes. After it is on
`main`, four packages can run in parallel without touching a shared file.

Owner: the integrator (not a parallel package).

---

## Files this pass touches

Shared plumbing — **this pass is the only thing allowed to edit these**:

- `electron/brain/database.ts` — schema v3 migration + `SCHEMA_VERSION = 3`
- `electron/brain/protocol.ts` — Zod schemas for five new methods
- `electron/brain/service.ts` — five `case` arms delegating to module classes
- `electron/preload.ts` — five renderer methods
- `src/types/electron.d.ts` — their types
- `electron/main.ts` — five `ipcMain.handle` registrations

New files created here as **stubs** (each package then implements its own):

- `src/types/brainKnowledge.ts` — shared domain types
- `electron/brain/knowledge/ports.ts` — the interfaces packages code against
- `electron/brain/knowledge/manifest.ts` — W1 implements
- `electron/brain/knowledge/documents.ts` — W2 implements
- `electron/brain/knowledge/vaultImporter.ts` — W4 implements

---

## Domain types — `src/types/brainKnowledge.ts`

```ts
export type KnowledgeDocType =
  | 'note' | 'project' | 'client' | 'person'
  | 'decision' | 'skill' | 'source' | 'me' | 'research'

/** A document's identity and metadata. The body lives on disk, not here. */
export interface KnowledgeDocument {
  id: string                 // stable hash of scopeId + path
  path: string               // vault-relative, forward slashes, no leading ./
  scopeId: string
  type: KnowledgeDocType
  title: string
  summary: string            // one line, <= 110 chars, no newlines
  contentHash: string
  byteSize: number
  origin: 'curated' | 'machine'
  validFrom: string          // ISO
  validTo: string | null     // null = currently valid; set to supersede
  createdAt: string
  updatedAt: string
}

/** One line of the manifest. */
export interface ManifestEntry {
  path: string
  type: KnowledgeDocType
  title: string
  summary: string
  updatedAt: string
}

/** The compact block injected into an agent prompt. */
export interface ManifestRender {
  text: string
  entryCount: number
  estimatedTokens: number
  truncated: boolean
}

export interface DocumentReadResult {
  path: string
  title: string
  type: KnowledgeDocType
  text: string
  updatedAt: string
  estimatedTokens: number
  truncated: boolean
}

export interface DocumentSearchHit {
  path: string
  title: string
  type: KnowledgeDocType
  snippet: string
  score: number
  updatedAt: string
}

export interface VaultImportReport {
  scanned: number
  imported: number
  updated: number
  unchanged: number
  skipped: number
  failures: Array<{ path: string; reason: string }>
  durationMs: number
}
```

## Ports — `electron/brain/knowledge/ports.ts`

W1 and W4 depend on this interface, never on W2's class.

```ts
import type {
  DocumentSearchHit, KnowledgeDocType, KnowledgeDocument,
} from '../../../src/types/brainKnowledge'

export interface UpsertDocumentInput {
  scopeId: string
  path: string
  type: KnowledgeDocType
  title: string
  summary: string
  body: string
  origin: 'curated' | 'machine'
  updatedAt: string
  links?: string[]           // wiki-link targets, vault-relative paths
}

export interface ListDocumentsInput {
  scopeId: string
  types?: KnowledgeDocType[]
  includeSuperseded?: boolean   // default false → only validTo === null
  limit?: number                // default 1000, max 5000
}

export interface SearchDocumentsInput {
  scopeId: string
  query: string
  types?: KnowledgeDocType[]
  limit?: number                // default 10, max 50
}

export interface DocumentStorePort {
  upsert(input: UpsertDocumentInput): KnowledgeDocument
  list(input: ListDocumentsInput): KnowledgeDocument[]
  read(scopeId: string, path: string): { document: KnowledgeDocument; body: string } | null
  search(input: SearchDocumentsInput): DocumentSearchHit[]
}
```

## Schema v3 — added in `database.ts`

`SCHEMA_VERSION` goes 2 → 3. Migration is additive only (`CREATE TABLE IF NOT
EXISTS` inside the existing transactional migration block), matching how v2
was written.

```sql
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  scope_id TEXT NOT NULL REFERENCES scopes(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'curated',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_id, path)
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
  USING fts5(document_id UNINDEXED, title, summary, body, tokenize='unicode61');

CREATE TABLE IF NOT EXISTS knowledge_links (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  target_path TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  UNIQUE(document_id, target_path)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_scope_type
  ON knowledge_documents(scope_id, type, updated_at DESC);
```

`valid_to` is how a fact is superseded. Nothing in Brain v2 deletes a
document row; a replaced document gets `valid_to` set and a new row takes
over. `list`/`search`/`read` exclude superseded rows unless explicitly asked.

## IPC surface

Protocol methods, service arms, preload methods and `main.ts` handlers, all
landed here so no package edits them:

| Protocol method | Payload | Returns | Implemented by |
|---|---|---|---|
| `knowledge.manifest` | `{ scopeId, types?, tokenBudget? }` | `ManifestRender` | W1 |
| `knowledge.read` | `{ scopeId, path, tokenBudget? }` | `DocumentReadResult \| null` | W2 |
| `knowledge.search` | `{ scopeId, query, types?, limit? }` | `DocumentSearchHit[]` | W2 |
| `knowledge.list` | `{ scopeId, types?, limit? }` | `KnowledgeDocument[]` | W2 |
| `knowledge.importVault` | `{ scopeId, vaultRoot }` | `VaultImportReport` | W4 |

Renderer names: `brainKnowledgeManifest`, `brainKnowledgeRead`,
`brainKnowledgeSearch`, `brainKnowledgeList`, `brainKnowledgeImportVault`.

Constraints enforced in the Zod schemas (so no package has to re-check them):

- `tokenBudget` — integer, 1..8000, default applied by the implementation
- `limit` on search — 1..50; on list — 1..5000
- `path` — non-empty, max 512 chars, and rejected if it contains `..`
  (traversal defence lives at the protocol boundary as well as in W2)
- `vaultRoot` — absolute path, max 4096 chars

`service.ts` constructs the three module classes once and delegates:

```ts
this.documents = new DocumentStore(this.database.handle)
this.manifest  = new ManifestBuilder(this.documents)
this.vault     = new VaultImporter(this.documents)
```

Note this deliberately departs from the existing pattern where all SQL lives
in `database.ts`. Each knowledge module owns its own SQL against the shared
`DatabaseSync` handle. That is what allows four packages to add storage
behaviour without editing one shared file.

## Stubs

Each stub exports the real class name with the real method signatures, and
every method body is:

```ts
throw new Error('not implemented — see docs/brain-v2/wN-*.md')
```

A package's first commit replaces its own stub. No package's stub is
replaced by anyone else.

## Acceptance for this pass

- `npm run typecheck` clean.
- `npx vitest run electron/brain/database.test.ts electron/brain/protocol.test.ts electron/brain/service.test.ts` green.
- New test: migrating a v2 database to v3 creates the three knowledge tables,
  is idempotent on re-open, and leaves existing v2 data intact.
- New test: each of the five protocol methods accepts a valid payload and
  rejects a malformed one (including a `..` path).
- Full suite still green; no behaviour change to any existing feature.
