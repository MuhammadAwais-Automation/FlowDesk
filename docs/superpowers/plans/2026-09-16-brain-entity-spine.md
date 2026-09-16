# Brain Entity Spine — Implementation Plan (E1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Brain a notion of *who and what*, so that everything the Library, the Intelligence system and future captures hold can be gathered under the person, project or organisation it is actually about.

**Architecture:** Entities live in the tables that already exist (`entities`, `entity_aliases`, `entity_edges`) and have never been driven. One new join table connects an entity to anything that mentions it. Resolution matches only on verified identifiers; everything softer proposes a merge for review.

**Tech Stack:** TypeScript, `node:sqlite`, the Brain utility process, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-brain-entity-spine-design.md`

## Scope of this plan

Steps 1 and 2 of the spec's order of work: **entities, resolution, and linking what already exists.**

Facts (`claims` + extraction), conversation capture, and the new sections/graph are **not** in this
plan. They depend on this one and each needs its own measurement — particularly extraction, whose
token cost is unmeasured.

At the end of this plan the database knows who Yasir Bhai is, which documents are about him, and which
opportunities belong to his organisation. Nothing in the UI changes yet.

## Global Constraints

- No new store where a table already exists. `entities`, `entity_aliases`, `entity_edges` are used as they are.
- **Resolution must fail toward duplicates, never toward a wrong merge.** Auto-match only on an exact verified identifier; anything softer is a proposal.
- Scope isolation holds: an entity, alias, edge or mention never crosses a scope. `linkEntities` (`database.ts:923`) already enforces this and is the precedent.
- After every task: `npx vitest run --no-file-parallelism`, `npm run typecheck`, `npm run build`.
- Commit after every task.

---

### Task 1: The mention table and the entity store

**Files:**
- Modify: `electron/brain/database.ts` — `SCHEMA_VERSION` 6 → 7, `entity_mentions` DDL, add to `TABLES`
- Create: `electron/brain/knowledge/entities.ts`
- Create: `electron/brain/knowledge/entities.test.ts`

**Interfaces:**
- Consumes: `BrainDatabase.handle`, and the existing `createEntity` / `linkEntities` shapes in `database.ts:915,923`.
- Produces: `EntityStore` with `resolve`, `mention`, `mentionsOf`, `entitiesFor`, `listProposals`, `decideProposal`.

- [ ] **Step 1: Write the failing tests**

Cover, at minimum:
- `resolve` with a new verified identifier creates an entity and a verified alias
- `resolve` with the same identifier again returns the *same* entity, not a second one
- `resolve` with the same display name but **no** identifier does **not** merge — it creates a separate entity and records a proposal
- a proposal accepted merges the alias onto the kept entity; a proposal rejected leaves both standing
- `mention` is idempotent for the same (entity, kind, target)
- `entitiesFor` returns entities for a document; `mentionsOf` returns targets for an entity
- an entity in scope A is invisible to a query for scope B

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run electron/brain/knowledge/entities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the schema**

In the declarative block of `database.ts`, beside the other entity tables:

```sql
CREATE TABLE IF NOT EXISTS entity_mentions (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(entity_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_target ON entity_mentions(target_kind, target_id);
CREATE TABLE IF NOT EXISTS entity_merge_proposals (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id),
  keep_entity_id TEXT NOT NULL REFERENCES entities(id),
  merge_entity_id TEXT NOT NULL REFERENCES entities(id),
  reason TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT,
  UNIQUE(keep_entity_id, merge_entity_id)
);
```

`target_kind` is a free string rather than three separate join tables: a mention is the same
relationship whether the target is a document, an opportunity or a capture, and three tables would be
three copies of the same query.

Bump `SCHEMA_VERSION` to 7 and add both table names to the `TABLES` const so backups include them.

- [ ] **Step 4: Implement `EntityStore`**

`resolve(input: { scopeId, type, name, identifier?: { kind, value } })`:

1. With an identifier: look up `entity_aliases` for `kind:value` where the entity is in scope. Hit → return it. Miss → create the entity and a **verified** alias.
2. Without an identifier: look for an entity in scope with the same normalised name. Hit → return it (a name is enough to *find* what a name created). Miss → create with an unverified alias.
3. When an identifier-resolved entity and a name-resolved entity both exist and differ, record a proposal rather than merging.

`mention(entityId, targetKind, targetId, sourceRef)` — `INSERT OR IGNORE`, so re-running a backfill is free.

`decideProposal(id, 'accept' | 'reject')` — accept moves aliases and mentions onto the kept entity and deletes the merged one, inside one transaction.

- [ ] **Step 5: Run the tests, then verify and commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git add electron/brain/database.ts electron/brain/knowledge/entities.ts electron/brain/knowledge/entities.test.ts
git commit -m "feat: entity store with identifier-first resolution"
```

---

### Task 2: Protocol arms and service wiring

**Files:**
- Modify: `electron/brain/protocol.ts` — `entity.list`, `entity.get`, `entity.mentions`, `entity.listProposals`, `entity.decideProposal`
- Modify: `electron/brain/service.ts` — construct `EntityStore`, add the cases
- Modify: `src/types/brainKnowledge.ts` — `BrainEntity`, `EntityMention`, `EntityMergeProposal`
- Modify: `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`

**Interfaces:**
- Consumes: `EntityStore` from Task 1, `knowledgeScopeChain` (`service.ts:86`).
- Produces: `api.brainEntityList`, `brainEntityGet`, `brainEntityMentions`, `brainEntityListProposals`, `brainEntityDecideProposal`.

- [ ] **Step 1: Add the protocol arms**, following the shape of the `knowledge.*` arms already in the file, each `.strict()`.
- [ ] **Step 2: Add the service cases**, reading through `knowledgeScopeChain(scopeId)` and writing to the exact scope — the split every other knowledge write already uses.
- [ ] **Step 3: Add the IPC handler, preload line and renderer type** for each arm, exactly as `brainKnowledgeAnswerPack` was added.
- [ ] **Step 4: Verify and commit**

```bash
npx vitest run --no-file-parallelism
npm run typecheck
npm run build
git commit -m "feat: expose entities to the renderer"
```

---

### Task 3: Backfill entities from the 157 documents

**Files:**
- Modify: `electron/brain/knowledge/entities.ts` — `backfillFromDocuments`
- Modify: `electron/brain/protocol.ts`, `electron/brain/service.ts` — `entity.backfill`
- Modify: `electron/brain/knowledge/entities.test.ts`

**Interfaces:**
- Consumes: `knowledge_documents` (`type`, `title`, `path`), `EntityStore.resolve`, `EntityStore.mention`.
- Produces: `backfillFromDocuments(scopeIds): { scanned, created, linked }`.

Document types map to entity types: `client` → `org`, `person` → `person`, `project` → `project`, `me` → `person`. Every other type (`research`, `note`, `skill`, …) creates **no** entity — those are documents *about* things, not things.

- [ ] **Step 1: Write the failing test** — a `client` document creates one org entity and one mention; a `research` document creates none; running twice creates nothing the second time.
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement.** Resolve by title with no identifier (a vault document carries no phone number or URN), then `mention(entity, 'document', documentId, path)`.
- [ ] **Step 4: Run, verify, commit**

```bash
git commit -m "feat: give the Library's people and projects entities"
```

---

### Task 4: Stop throwing away the entities Intelligence already finds

`processIntelligence` builds an entity map keyed on the author's verified handle
(`intelligenceProcessor.ts:304-312`) — which is exactly the identifier-first rule this design needs —
and `recipeDefinitions.ts:126` then discards it with `entities: []`, and `persistIntelligence` never
writes one. 93 opportunities and 109 evidence rows exist with no owner.

**Files:**
- Modify: `electron/brain/intelligenceProcessor.ts` — `persistIntelligence` writes entities and mentions
- Modify: `electron/brain/recipeDefinitions.ts:126` — keep entities out of the *artifact*, still pass them to persistence
- Modify: `electron/brain/intelligenceProcessor.test.ts`

**Interfaces:**
- Consumes: `EntityStore.resolve` with `identifier: { kind: 'handle', value: verifiedHandle }`, `EntityStore.mention(entityId, 'opportunity', opportunityId, sourceRef)`.
- Produces: no new exports; `persistIntelligence` gains an `entities` count in its return.

**The privacy line must not move.** The existing comment at `recipeDefinitions.ts:125` says display
names are kept out of durable derived artifacts deliberately. That stays true: entities go to the
database, not into the gzipped artifact on disk.

- [ ] **Step 1: Write the failing test** — a result with one verified author persists one entity; the same result twice persists one; an author with no verified handle persists none (there is no identifier to trust).
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement**, threading the store into `persistIntelligence`.
- [ ] **Step 4: Run, verify, commit**

```bash
git commit -m "feat: keep the entities the intelligence pipeline already finds"
```

---

## Self-review notes

- **Spec coverage.** Layer 2 (entity) → Tasks 1–4. Resolution rule → Task 1 Step 4. Review gate for merges → Task 1 (proposals) and Task 2 (exposure). Linking what exists → Tasks 3 and 4. Layers 1, 3 and 5, and all UI sections, are explicitly out of scope and named as such.
- **One thing the spec left implicit:** how an entity attaches to a non-document target. This plan settles it — one `entity_mentions` table with a `target_kind` string, rather than a join table per target type.
- **Unverified authors produce no entity** (Task 4). This is a deliberate consequence of the identifier-first rule, and it means some opportunities will stay ownerless until conversation capture gives them a verified identifier. Better ownerless than wrongly owned.
