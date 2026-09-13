# Brain v2 — parallel build plan

Brain v2 turns FlowDesk's Brain from an opportunity-mining pipeline into a
knowledge system several different agent runtimes can share: a flat manifest
every agent always carries, and documents the agent asks for by name.

This directory contains one work package per agent. They are written to be
executed **in separate git worktrees, in parallel, by different agents**
(Codex, Claude, others) and merged at the end.

---

## Why the work is split this way

Every Brain feature in this codebase normally touches the same six files:

```
electron/brain/database.ts     electron/preload.ts
electron/brain/protocol.ts     src/types/electron.d.ts
electron/brain/service.ts      electron/main.ts
```

Four agents editing those six files in four worktrees produces a conflict in
every one of them. So the shared plumbing is landed **once, first, serially**
(see `00-contracts.md`), and after that **no work package may touch those six
files at all**. Each package owns new files only.

That single rule is what makes the parallelism safe. Everything else here
follows from it.

---

## The packages

| Package | Owns | Depends on | Can start |
|---|---|---|---|
| `w1-manifest.md` | `electron/brain/knowledge/manifest.ts` | DocumentStorePort (interface only) | after contracts |
| `w2-documents.md` | `electron/brain/knowledge/documents.ts` | nothing | after contracts |
| `w3-agent-surface.md` | `electron/agent/brainNavigation.ts` + 2 existing agent files | W1 + W2 interfaces only | after contracts |
| `w4-vault-import.md` | `electron/brain/knowledge/vaultImporter.ts` | DocumentStorePort (interface only) | after contracts |

Every package codes against **interfaces defined in the contracts pass**, and
tests against its own fakes. No package needs another package's
implementation to exist, compile, or pass tests.

W2 is the only real implementation of `DocumentStorePort`. W1 and W4 consume
that port; they must never query `knowledge_*` tables directly.

---

## Worktree setup

Run these from `E:\FlowDesk` after the contracts commit is on `main`:

```bash
git worktree add .worktrees/w1-manifest      -b brain-v2/w1-manifest
git worktree add .worktrees/w2-documents     -b brain-v2/w2-documents
git worktree add .worktrees/w3-agent-surface -b brain-v2/w3-agent-surface
git worktree add .worktrees/w4-vault-import  -b brain-v2/w4-vault-import
```

Give each agent: its own worktree path, its own package file, and
`00-contracts.md` for reference. Nothing else from this conversation.

Each agent installs nothing. `node_modules` is shared via the main checkout;
if a worktree needs it, symlink rather than reinstall — a second
`npm install` will produce `package-lock.json` churn and a guaranteed
conflict.

---

## Rules every package must follow

These are repeated inside each package file. They are the merge contract.

1. **Do not edit any of the six shared files.** If a package believes it
   needs to, it must stop and report why instead of editing.
2. **Do not edit another package's owned files.** Ownership is listed in
   each package's "Files you own" section.
3. **Do not touch** `electron/studio/render.ts`, `electron/studio/render.test.ts`,
   `docs/superpowers/FLOWDESK-TECHNICAL-SUMMARY.md`, or anything under
   `probes/` — these carry unrelated uncommitted work.
4. **Do not run `npm install`** or modify `package.json` / `package-lock.json`.
5. **Test-first.** Write the failing test, watch it fail, then implement.
6. Before finishing: `npx vitest run <your test files>` green, then
   `npm run typecheck` clean, then `git diff --check` clean.
7. Commit on your own branch only. Do not merge, rebase, push, or switch
   branches.
8. Write a short report to `docs/brain-v2/reports/<package>.md` covering what
   you built, any contract detail that turned out wrong, and anything the
   integrator must know.

---

## Merge order

Merge into `main` in this order, running the full suite after each:

```
1. w2-documents      (the port implementation everything else consumes)
2. w1-manifest
3. w4-vault-import
4. w3-agent-surface  (consumes all of the above)
```

After each merge: `npx vitest run` and `npm run typecheck`. A red suite stops
the merge train — fix before continuing, do not merge on top of red.

Because the packages own disjoint files, conflicts should be limited to
`docs/brain-v2/reports/` (if two agents create the directory) and possibly
`vitest.config.ts` (it should not need changing — the test glob already
covers new directories).

---

## What "done" looks like for the whole batch

An agent in any FlowDesk surface can:

1. receive a compact manifest of the whole knowledge corpus (~3.4k tokens for
   the current 156-document vault),
2. call `brain_read_document` to pull exactly the documents it names,
3. call `brain_search_documents` when it does not know the path,

with the real Obsidian vault at `E:\Claude Workspace\Second-Brain` imported as
the document corpus, and **no automatic pre-fetch of Brain context into the
prompt** (that behaviour is removed in W3).

Not in this batch, deliberately: the write gate / Review Inbox, the compactor,
the skills axis, and the graph. Those are phase 2 and depend on this
foundation landing first.
