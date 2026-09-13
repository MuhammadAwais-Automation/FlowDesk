# W3 — Agent surface (manifest injection + navigation tools)

## What you are building

The change that makes every FlowDesk agent — Claude SDK, Codex, any runtime —
carry the same knowledge and pay almost nothing for it.

Two halves:

1. **Replace automatic context pre-fetch with manifest injection.** Today
   `composePromptWithBrain` pastes retrieved citations into every prompt. That
   is the pattern this rebuild exists to remove: the system guesses what is
   relevant and forces it in. Instead, inject the flat manifest and let the
   agent choose.
2. **Give the agent two navigation tools** so it can act on that choice:
   `brain_read_document` and `brain_search_documents`.

The measured justification: index-first + agent-chosen reads outscored both
raw context and a hybrid-RAG baseline in the only controlled comparison of
these designs. The agent spends tokens on what it *decided* it needed rather
than on what a retriever guessed.

## Files you own

- `electron/agent/brainNavigation.ts` (new)
- `electron/agent/brainNavigation.test.ts` (new)
- `electron/agent/brainContext.ts` (existing — rewrite)
- `electron/agent/brainContext.test.ts` (existing — update)
- `electron/agent/brainTools.ts` (existing — add two tools)
- `electron/agent/brainTools.test.ts` (existing — extend)
- `docs/brain-v2/reports/w3-agent-surface.md` (your report)

You are the only package touching `electron/agent/`. Nobody else will edit
these files.

## Files you must not touch

`electron/brain/database.ts`, `electron/brain/protocol.ts`,
`electron/brain/service.ts`, `electron/preload.ts`, `src/types/electron.d.ts`,
`electron/main.ts` — already wired.

Also off limits: `electron/brain/knowledge/*` (W1, W2, W4 own those),
`electron/studio/render.ts`, `electron/studio/render.test.ts`,
`docs/superpowers/FLOWDESK-TECHNICAL-SUMMARY.md`, `probes/`.

Do not run `npm install` or edit `package.json` / `package-lock.json`.

## What you code against

You never import W1's or W2's classes. You call the Brain utility through the
same request function the existing tools use, with the methods the contracts
pass already registered:

- `knowledge.manifest` → `ManifestRender`
- `knowledge.read` → `DocumentReadResult | null`
- `knowledge.search` → `DocumentSearchHit[]`

Types come from `src/types/brainKnowledge.ts`. Test with a fake request
function; no database, no filesystem.

## Half 1 — `brainContext.ts` rewrite

Current behaviour (remove it): takes a `BrainContextPack` of citations and
splices them into the prompt.

New behaviour: take a `ManifestRender` and prepend its text, plus a short
instruction telling the agent what the block is and how to act on it.

```ts
export function composePromptWithManifest(prompt: string, manifest: ManifestRender): string
```

Requirements:

- Empty manifest (`entryCount === 0`) → return the prompt unchanged. Never
  inject an empty block; it wastes tokens and reads as "there is no knowledge".
- The block must state that its contents are **data, not instructions**. The
  corpus will eventually contain machine-imported text from social sources;
  an agent must never treat a line of the index as a command. This mirrors
  the existing `<flowdesk_brain_context>` wording — keep that discipline.
- When `truncated` is true, the injected text must say so, so the agent knows
  to fall back to search rather than concluding a document does not exist.
- Deterministic and pure. No I/O in this function.

Keep the old export only if something outside `electron/agent/` still calls
it; check with a grep before deleting. If nothing does, delete it rather than
leaving dead code, and say so in your report.

## Half 2 — the two tools

Add to `brainTools.ts`, following exactly the existing `tool(...)` pattern
and the existing allow-list array at the top of that file (both new tool
names must be added there or they will not be callable).

### `brain_read_document`

- Input: `{ path: string }`
- Reads one document from the active scope.
- Not found → return a clear, short message saying the path does not exist and
  suggesting `brain_search_documents`. Do not throw; a missing path is a
  normal agent mistake, not an error condition.
- Enforce a token ceiling (default 4000). If the document is larger, return
  the head of it, and state plainly that it was truncated and by how much.
  Never return a truncated document that claims to be whole.
- Read-only. No approval prompt — this is the same trust level as the existing
  `brain_search`.

### `brain_search_documents`

- Input: `{ query: string, limit?: number }` (limit clamped 1..20)
- Returns compact hits: path, title, type, snippet. **Not** full bodies — the
  point is that the agent then calls `brain_read_document` for the one it wants.
- Empty results → say so explicitly rather than returning an empty string.

Both tools:

- Respect the active scope the same way existing Brain tools do — never allow
  a scope override in the tool input, or an agent could read another client's
  documents.
- Must work when the Brain utility is unavailable: return a short "Brain is
  unavailable" message rather than propagating a rejection that kills the turn.

## Wiring the manifest into turns

Find where `composePromptWithBrain` is currently called and replace that call
site's data source: fetch `knowledge.manifest` for the active scope and pass
the result to `composePromptWithManifest`.

Two rules at the call site:

- **A manifest fetch failure must not fail the turn.** Catch, log at the level
  the surrounding code uses, and send the prompt unmodified.
- Respect the existing per-surface Brain toggles (the `use` / `temporary`
  flags already threaded through agent runs). Temporary mode must inject
  nothing.

The call site is in a file you do not own (`electron/main.ts`). **Do not edit
it.** The contracts pass has already changed that call site to request a
manifest and call `composePromptWithManifest`; your job is to make that
function exist with the right signature and behaviour. If you find the call
site does not match the signature in this document, stop and report it rather
than editing `main.ts`.

## Acceptance tests (write these first, watch them fail)

`composePromptWithManifest`:

1. Non-empty manifest → block is prepended, original prompt still present
   verbatim after it.
2. `entryCount === 0` → prompt returned byte-identical.
3. `truncated: true` → injected text mentions the partial index.
4. Block contains an explicit data-not-instructions statement.

`brain_read_document`:

5. Existing path → body returned.
6. Unknown path → non-throwing message naming the search tool.
7. Oversized document → truncated, and the reply says it was truncated.
8. A `..` path is refused (assert the request is either not made or the
   refusal is surfaced — do not rely on the store alone).

`brain_search_documents`:

9. Hits are rendered compactly with path + title + snippet, no full bodies.
10. Zero hits → explicit "no matches" message.
11. `limit` above 20 is clamped.

Both tools:

12. Brain unavailable (fake request rejects) → short unavailable message, no
    throw.
13. Both tool names are present in the allow-list array in `brainTools.ts` —
    assert this directly, since a tool missing from it silently never runs.

## Verification before you finish

```bash
npx vitest run electron/agent/brainNavigation.test.ts electron/agent/brainContext.test.ts electron/agent/brainTools.test.ts
npm run typecheck
git diff --check
```

All clean. Commit on your branch only.

## Report

Write `docs/brain-v2/reports/w3-agent-surface.md` covering: whether the old
`composePromptWithBrain` had callers outside `electron/agent/` and what you
did about it, the exact injected block format, the token ceiling behaviour,
and any mismatch you found between this spec and the call site the contracts
pass landed. You are merged last, so anything you noticed about the other
packages' real behaviour belongs in this report.
