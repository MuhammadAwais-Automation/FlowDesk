# W4 — Vault importer

## What you are building

The thing that fills the brain: an importer that walks a real Obsidian vault
of Markdown files and turns each one into a knowledge document in the store.

Target vault (the user's live, daily-used one):
`E:\Claude Workspace\Second-Brain`

Measured shape of it today:

- 156 Markdown files, ~976,000 characters (~244,000 tokens)
- Only **46%** of `wiki/` files carry YAML frontmatter, and it is inconsistent
  (`type` / `area` / `status`, no schema). **No file uses tags.**
- Wiki-link density is uneven: hub pages are link-rich, content pages sparse
- The largest single file is `log.md` at ~22,700 tokens

Design for that reality. An importer that assumes clean frontmatter will
silently import 46% of the vault and skip the rest — and because
`field()`-style lookups return empty rather than throwing, nobody would
notice. Every fallback below exists because of a measured property of this
specific vault.

## Files you own

- `electron/brain/knowledge/vaultImporter.ts` (replace the stub)
- `electron/brain/knowledge/vaultImporter.test.ts` (new)
- `electron/brain/knowledge/__fixtures__/vault/**` (new — small fake vault)
- `docs/brain-v2/reports/w4-vault-import.md` (your report)

## Files you must not touch

`electron/brain/database.ts`, `electron/brain/protocol.ts`,
`electron/brain/service.ts`, `electron/preload.ts`, `src/types/electron.d.ts`,
`electron/main.ts` — already wired.

Also off limits: `manifest.ts`, `documents.ts`, anything under
`electron/agent/`, `electron/studio/render.ts`,
`electron/studio/render.test.ts`,
`docs/superpowers/FLOWDESK-TECHNICAL-SUMMARY.md`, `probes/`.

**Never write to the vault.** This importer is read-only with respect to
`E:\Claude Workspace\Second-Brain`. It is the user's live working vault and
there is a documented incident in this problem space of an agent destroying
5,800 bytes of memory by writing where it meant to read.

Do not run `npm install` or edit `package.json` / `package-lock.json`.

## The contract you implement

```ts
import type { DocumentStorePort } from './ports'
import type { VaultImportReport } from '../../../src/types/brainKnowledge'

export interface ImportVaultInput {
  scopeId: string
  vaultRoot: string
  maxFileBytes?: number     // default 1_000_000
}

export class VaultImporter {
  constructor(private readonly documents: DocumentStorePort) {}
  import(input: ImportVaultInput): VaultImportReport
}
```

You write **no SQL**. Every document goes in through `documents.upsert(...)`.
W2 implements that port in parallel; you depend on the interface only and
test against your own fake.

## Walking the vault

Include `**/*.md` under `vaultRoot`. Skip these directories entirely:

```
.git  .obsidian  .claude  .claudian  node_modules  raw  tmp  terminals  Excalidraw  mcps
```

`raw/` is excluded deliberately: the vault's own `AGENTS.md` defines it as
unprocessed source material that must never be modified, and its contents are
transcripts and clippings, not curated knowledge. Importing it would flood the
manifest with low-value entries.

Skip and count (do not fail the run) any file that is larger than
`maxFileBytes`, unreadable, or not valid UTF-8. Every skip goes in the report
with a reason.

## Deriving each field

**`path`** — vault-relative, forward slashes, no leading `./`.

**`type`** — infer in this order, first match wins:

1. Frontmatter `type:` if present and it maps to a known `KnowledgeDocType`
2. Directory: `wiki/projects/` → `project`, `wiki/clients/` → `client`,
   `wiki/me/` → `me`, `wiki/research/` → `research`, `wiki/skills/` and
   `wiki/toolkits/` and `wiki/ai-tooling/` → `skill`, `wiki/partners/` and
   `wiki/people/` → `person`, `journal/` → `note`
3. Fallback `note`

Record which rule fired for how many files in your report — that number tells
the integrator how much of the corpus is typed by guess rather than by data.

**`title`** — first `# heading`; else frontmatter `title:`; else the filename
without extension, underscores and hyphens turned into spaces.

**`summary`** — the first non-empty line of the body after stripping
frontmatter and headings. Strip Markdown syntax noise (`[`, `]`, `*`, `_`,
backticks). Collapse whitespace, trim to ≤ 110 characters on a word boundary.
Empty is acceptable — never invent a summary. An invented one-liner is worse
than none, because the manifest is the only thing the agent sees before
choosing.

**`body`** — the full file text, frontmatter stripped.

**`contentHash`** — SHA-256 of the raw file bytes. This drives W2's
no-op-on-unchanged path, so it must be stable across runs.

**`origin`** — always `'curated'` for this importer. Everything in the vault
is hand-written by the user. Machine-sourced content arrives through a
different path (phase 2's write gate) and must never be labelled curated.

**`updatedAt`** — file mtime as ISO. Not "now" — the vault has files two
months old and the manifest orders by this.

**`links`** — extract every `[[target]]` and `[[target|alias]]`. Normalise to
a vault-relative `.md` path where you can resolve it against the file list;
pass the raw target through when you cannot. Ignore embeds (`![[...]]`) and
external Markdown links. W2 decides `resolved`.

## Idempotency

Running the import twice in a row must produce
`imported: 0, updated: 0, unchanged: <all>` on the second run. This is the
single most important property — the importer will run repeatedly and a
non-idempotent one will churn every document's `updatedAt`, which silently
destroys manifest ordering.

## Acceptance tests (write these first, watch them fail)

Build a small fixture vault under `__fixtures__/vault/` — roughly a dozen
files covering every case below. Do not test against the real vault in CI;
its contents change.

1. Walks nested directories and imports every `.md`.
2. Skips each excluded directory — assert a file inside `raw/` and one inside
   `.obsidian/` are both absent from the store.
3. Frontmatter `type:` wins over directory inference.
4. Directory inference maps `wiki/projects/x.md` → `project` and
   `wiki/clients/y.md` → `client`.
5. A file with no frontmatter and an unrecognised directory falls back to
   `note` — and is still imported, not skipped.
6. Title: `# Heading` wins; with no heading, frontmatter `title:` is used;
   with neither, the filename is humanised.
7. Summary: skips frontmatter and headings, strips Markdown noise, truncates
   at ≤ 110 on a word boundary.
8. A file whose body is only a heading produces an empty summary and still
   imports.
9. `updatedAt` reflects file mtime, not the current time.
10. Wiki-links: `[[a]]` and `[[b|alias]]` both extracted; `![[c]]` ignored;
    `[text](http://x)` ignored.
11. Idempotency: second run reports all unchanged and calls `upsert` with
    identical `contentHash` values.
12. Changing one fixture file's content makes exactly that one document
    update on the next run.
13. Oversized file is skipped with a reason and does not abort the run.
14. A file with invalid UTF-8 is skipped with a reason and does not abort.
15. `origin` is `'curated'` for every imported document.
16. The report's counts add up: `scanned === imported + updated + unchanged + skipped`.

## Verification before you finish

```bash
npx vitest run electron/brain/knowledge/vaultImporter.test.ts
npm run typecheck
git diff --check
```

All clean. Commit on your branch only.

## Optional, only if everything above is green

Run the importer once against the real vault through a throwaway temp
database (never the user's profile database, never writing to the vault) and
record in your report: how many files imported, the type-inference
distribution, how many links resolved, and the ten largest documents. That
measurement tells the integrator whether the manifest will fit its budget.

## Report

Write `docs/brain-v2/reports/w4-vault-import.md` covering: the type-inference
rule distribution, how many files had usable frontmatter versus fell back,
what you skipped and why, the idempotency evidence, and any vault reality that
contradicted this spec. If a large fraction of the corpus ends up typed
`note` by fallback, say so prominently — that is a signal the taxonomy needs
work before phase 2, not something to paper over.
