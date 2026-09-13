# W2 — Document store (upsert, read, search)

## What you are building

The storage and retrieval engine for knowledge documents: the one real
implementation of `DocumentStorePort`. Every other package consumes this and
none of them touch `knowledge_*` tables directly, so this is the foundation —
merge order puts you first.

Two decisions are already made and are not yours to revisit:

- **FTS5 keyword search, no embeddings.** At this corpus scale (hundreds to
  low thousands of documents, dominated by client/project/person names) BM25
  beats dense retrieval on proper-noun-heavy queries, and an embedding index
  adds a re-indexing burden for no measured gain. FTS5 is already in this
  codebase and working.
- **Nothing is deleted.** Superseding sets `valid_to`; the old row stays.

## Files you own

- `electron/brain/knowledge/documents.ts` (replace the stub)
- `electron/brain/knowledge/documents.test.ts` (new)
- `docs/brain-v2/reports/w2-documents.md` (your report)

## Files you must not touch

`electron/brain/database.ts`, `electron/brain/protocol.ts`,
`electron/brain/service.ts`, `electron/preload.ts`, `src/types/electron.d.ts`,
`electron/main.ts` — already wired for you, including the schema.

Also off limits: `manifest.ts`, `vaultImporter.ts`, anything under
`electron/agent/`, `electron/studio/render.ts`,
`electron/studio/render.test.ts`,
`docs/superpowers/FLOWDESK-TECHNICAL-SUMMARY.md`, `probes/`.

Do not run `npm install` or edit `package.json` / `package-lock.json`.

## The contract you implement

`electron/brain/knowledge/ports.ts` defines `DocumentStorePort` with
`upsert`, `list`, `read`, `search`. Implement all four on a class taking the
shared SQLite handle:

```ts
import { DatabaseSync } from 'node:sqlite'

export class DocumentStore implements DocumentStorePort {
  constructor(private readonly db: DatabaseSync) {}
}
```

Schema (already created by the contracts pass — do not alter it):
`knowledge_documents`, `knowledge_fts`, `knowledge_links`.

## Behaviour

### `upsert`

Keyed on `UNIQUE(scope_id, path)`.

- New path → insert, `validFrom = updatedAt`, `validTo = null`, `createdAt` set.
- Existing path, **same `contentHash`** → no write at all. Return the existing
  row unchanged. Import runs repeatedly; unchanged files must not churn the
  table, the FTS index, or `updatedAt`.
- Existing path, **different `contentHash`** → update the row in place
  (title, summary, hash, size, `updatedAt`) and rewrite its FTS entry and its
  links. The row keeps its id.
- `contentHash` is the caller's; compute `byteSize` from the body yourself.
- `links`: replace the document's `knowledge_links` rows wholesale. Mark
  `resolved = 1` when the target path exists as a document in the same scope,
  else 0. Do not create placeholder documents for unresolved links.
- Wrap each upsert in a transaction — document row, FTS row and links must
  move together or not at all.

### `list`

- Default excludes superseded (`valid_to IS NULL`); `includeSuperseded: true`
  returns all.
- `types` filters; absent means all types.
- Order by `type` then `updated_at DESC` — W1's manifest depends on this
  ordering being stable.
- `limit` default 1000, clamp to 5000.
- Hard scope filter on every query. A wrong `scopeId` returns an empty list,
  never another scope's rows.

### `read`

- Returns `{ document, body } | null`. Null when the path does not exist in
  that scope, or exists only as a superseded row.
- **The body comes from the FTS `body` column, not from disk.** The store is
  the source of truth at read time; W4 is responsible for putting current
  content in. This keeps read deterministic and testable with no filesystem.
- Reject any path containing `..`, an absolute path, or a leading `/` —
  return null rather than throwing. The protocol layer also rejects these;
  defence in depth is deliberate because the path can reach here from an
  agent tool call.

### `search`

- FTS5 MATCH over `title`, `summary`, `body`, ranked by bm25.
- **Sanitise the query.** Raw agent text will contain characters FTS5 treats
  as operators (`"`, `*`, `:`, `-`, `^`, `NEAR`). An unsanitised query throws
  an SQLite syntax error and the agent sees a crash instead of no results.
  Tokenise the input and rebuild a safe query — quote each term. An empty
  query after sanitising returns `[]`, not an error.
- `snippet`: use FTS5's `snippet()` so matched terms are visible in context.
  Cap at ~200 characters.
- Scope filter and superseded exclusion apply exactly as in `list`.
- `limit` default 10, clamp to 50.
- `score`: expose bm25 as a positive number where higher = better match
  (SQLite's bm25 returns negative; normalise so callers are not surprised).

## Acceptance tests (write these first, watch them fail)

Use a temporary on-disk or in-memory database built through the real
migration, as `database.test.ts` does.

1. Insert a document, read it back with identical body and metadata.
2. Upsert with the same `contentHash` twice: the row's `updatedAt` does not
   change and no second FTS row appears.
3. Upsert with a changed hash updates content and FTS, and the id is stable.
4. `list` excludes a superseded document; `includeSuperseded: true` includes it.
5. `list` ordering is type, then `updatedAt` descending.
6. Scope isolation: a document in scope A is invisible to `list`, `read` and
   `search` in scope B.
7. `read` returns null for `../etc/passwd`, `/etc/passwd`, and an unknown path.
8. `search` finds a document by a word in its body, and by a word in its title.
9. Search query sanitising: `yasir "bhai* OR` does not throw and returns a
   result set (possibly empty).
10. Empty / whitespace-only query returns `[]`.
11. `snippet` contains the matched term and is ≤ 200 characters.
12. `score` is positive and a better match ranks higher than a worse one.
13. Links: upserting with two wiki-link targets creates two `knowledge_links`
    rows; re-upserting with one target leaves exactly one.
14. A link to an existing document is `resolved = 1`; to a missing one, 0.
15. Upsert failure (e.g. invalid scope) leaves no partial rows — assert the
    document, FTS and link tables are all unchanged.

## Verification before you finish

```bash
npx vitest run electron/brain/knowledge/documents.test.ts electron/brain/database.test.ts
npm run typecheck
git diff --check
```

All clean. Commit on your branch only.

## Report

Write `docs/brain-v2/reports/w2-documents.md` covering: how you sanitise FTS
queries (with the exact rejected/rewritten cases), how you normalised bm25,
the transaction boundaries, and any place this spec was wrong. Note
explicitly whether reading the body from FTS proved workable — if it did not,
say so loudly, because W1 and W4 both assume the store is self-sufficient at
read time.
