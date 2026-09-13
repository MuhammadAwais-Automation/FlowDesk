# W4 vault importer report

## Implementation

`VaultImporter` recursively reads Markdown files without writing to the vault. It prunes the contracted excluded directories before descent, validates file size and UTF-8, derives document metadata, hashes the exact raw bytes with SHA-256, resolves wiki-links against the discovered file set where unambiguous, and sends every accepted document through `DocumentStorePort.upsert`.

Import status is classified by reading the current stored document before upsert. A missing path counts as imported, a matching content hash counts as unchanged, and a changed hash counts as updated. The upsert still happens in all three cases so the document store remains authoritative for its no-op behavior.

## Live vault measurement

A read-only run against `E:\Claude Workspace\Second-Brain` on 2026-09-13 scanned 156 Markdown files, imported 156 into an in-memory measurement port, and skipped none. The concrete W2 `DocumentStore` is still a stub on this parallel branch, so the optional throwaway-SQLite run was not possible here. No user profile database was opened and no vault file was written.

Type-inference rules fired as follows:

| Rule | Files | Share |
| --- | ---: | ---: |
| Known frontmatter `type` | 3 | 1.9% |
| Directory inference | 125 | 80.1% |
| Fallback `note` | 28 | 17.9% |

The resulting type distribution was:

| Type | Files |
| --- | ---: |
| `skill` | 93 |
| `note` | 28 |
| `project` | 15 |
| `research` | 11 |
| `me` | 5 |
| `client` | 3 |
| `person` | 1 |

The fallback fraction is material: **28 of 156 documents (17.9%) become `note` only because neither a known frontmatter type nor a recognised directory provides a stronger classification.** This is a taxonomy signal for phase 2, not metadata to infer more aggressively.

Although 111 of the 150 included `wiki/` files currently have a frontmatter block (74%), only three files use a `type` value in `KnowledgeDocType`. Most current values are vault-specific labels such as `registry`, `toolkit`, `catalog`, `map`, and `project-lead`, so directory inference carries most of the corpus.

The importer extracted 2,078 non-embed wiki-links. It resolved 233 (11.2%) to canonical vault-relative `.md` paths; the remaining targets were passed through unchanged for W2 to mark unresolved.

The ten largest imported bodies after frontmatter removal were:

| Path | Bytes |
| --- | ---: |
| `log.md` | 90,957 |
| `wiki/ai-tooling/ecc-skill-catalog.md` | 70,168 |
| `wiki/ai-tooling/skills/frontend-ui.md` | 45,221 |
| `wiki/ai-tooling/plugin-skill-catalog.md` | 34,875 |
| `wiki/ai-tooling/skills/testing-qa.md` | 25,635 |
| `wiki/ai-tooling/ecc-agent-catalog.md` | 22,021 |
| `wiki/business/proposals/legjr-ai-website-full-copy-spec.md` | 21,498 |
| `wiki/ai-tooling/skills/security.md` | 21,459 |
| `AGENTS.md` | 19,715 |
| `wiki/projects/twg-trade-finance-platform-phase1-prd.md` | 16,745 |

## Skips and failures

The live run skipped no included file. Tests verify that oversized files and invalid UTF-8 are reported with their vault-relative path and reason without aborting the run. Files below `raw/`, `.obsidian/`, and every other contracted excluded directory are pruned and are not part of `scanned` or `skipped`; they are outside the curated input set.

Store failures are deliberately not described as unreadable vault files: they propagate so database faults cannot be hidden as successful partial imports.

## Idempotency evidence

The fixture test imports all 10 eligible documents on its first run. A second run reports `imported: 0`, `updated: 0`, `unchanged: 10`, and sends the same 10 SHA-256 values through upsert. Changing only `heading.md` then reports exactly one update and nine unchanged documents.

## Differences from the package snapshot

The live corpus still contains 156 included Markdown files, matching the package. Its current frontmatter coverage does not: 111 of 150 `wiki/` files (74%) now begin with frontmatter, versus the package's measured 46%. This does not improve type coverage materially because only three values map to the shared taxonomy. The largest file remains `log.md` and is well below the default 1,000,000-byte limit.
