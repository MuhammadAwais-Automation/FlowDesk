# FlowDesk Brain

FlowDesk Brain is a local-first knowledge and durable-job subsystem. The Electron renderer only receives narrow typed operations. Electron main owns authenticated connector capabilities and confirmations. A dedicated Electron utility process is the only SQLite writer and owns retrieval, memory policy, jobs, vault reconciliation, retention, and backups.

## Storage

Brain data lives under Electron `userData/brain/`:

- `brain.sqlite` is the authoritative structured ledger and uses WAL, foreign keys, migrations, and FTS5.
- `vault/` contains deterministic Obsidian-compatible Markdown for accepted, curated knowledge.
- `artifacts/<jobId>/` contains compressed raw and normalized job output plus compact manifests.
- `backups/` contains automatic pre-import backups.

Raw social messages are never mirrored into the Markdown vault. Credentials, cookies, prompts, and raw provider traffic are never included in logs or portable backups.

## Atlas

Brain → Atlas draws the scope chain as a graph: every active document a point sized by its link count, every resolved wikilink a line, coloured by document type. `knowledge.graph` builds it in the utility process as two flat arrays; resolution is a join there, as everywhere else, so an edge exists when a document sits at that path right now.

It opens **local** — two hops around the selected document — and is never global by default. A whole-store graph is legible under about fifty notes and a hairball past a couple of hundred, and this store passed that already. Global is a deliberate click, and opens with a minimum-link floor and type filters to hand.

Rendering is [sigma.js](https://www.sigmajs.org/) over graphology, both MIT. Cosmograph was rejected on its licence (CC-BY-NC, incompatible with this MIT project) and its engine, `cosmos.gl`, on capability: it renders points and lines but has no built-in labels, and a graph of unnamed dots answers nothing. Sigma renders labels through a density-controlled grid, which is the feature this view is for. The renderer is loaded lazily, so the several megabytes of WebGL cost only a visit to Atlas — and no other surface needs a WebGL context.

## Memory and scope policy

Scopes inherit in this order: Global → Workspace → Project or Client → Session. Cross-project and cross-client reads are hard filtered. Parent memories only inherit when marked shareable.

- Explicit user memories and confirmed decisions are accepted immediately and keep revision history.
- Inferences and external material enter Review Inbox as candidates.
- External material cannot create trusted procedures or system instructions automatically.
- Replacements supersede older claims instead of erasing their history.
- Temporary Agent mode performs no automatic context injection and no durable Brain writes. Explicit read-only search remains available.

Retrieval uses exact metadata matches, FTS5 BM25 ranking, trust/recency/importance boosts, conflict filtering, and deduplication. The default context pack is 1,200 estimated tokens, capped at 2,000 and 12 cited chunks. Raw artifacts are never inserted into prompts.

## Durable jobs

Recipes are versioned and jobs use idempotency keys, step leases, checkpoints, retries, cancellation, and a transactional outbox. Interactive completions create one compact Agent continuation. Background jobs remain silent; actionable-only monitors resume the Agent only when the result is actionable. The Agent does not consume model tokens while a connector or research job is running.

NotebookLM retains its existing public API while its jobs are mirrored into the Brain job ledger. WhatsApp and LinkedIn recipes are read-only and require per-scope, per-recipe consent. Reddit is represented only by a connector capability contract and fixtures; no live Reddit capture or posting is implemented.

`whatsapp.unread_intelligence` is the one recipe that spends model tokens, in its sixth step, `digest`. The first five mine a capture for opportunities and then drop the words, which left everything the chats actually said outside the knowledge store and invisible to retrieval — a scan produced `2 cited signals across 1 platform` and no readable record of what was said. `digest` sends each transcript to Haiku through the `model.digest_chats` capability and proposes the result as a `machine-inferred` candidate, so a chat note reaches the library only once a human accepts it in Review. Electron main owns the prompt and the model choice; a recipe cannot compose its own. The spend is bounded by the capability contract — at most ten chats per run, 4,000 characters each, one call per chat — and by the recipe's own consent, which is unchanged. A capture with no transcript makes no model call at all. Authentication is the local `claude` CLI's subscription login; `ANTHROPIC_API_KEY` is deleted at startup, so no run can become metered API usage.

`whatsapp.list_unread` reads the recent messages of each unread chat, not only the chat list. It answered with one preview line per chat until a real capture showed that line was null for six of eight chats — the newest event in a chat is often a protocol message — so every stage downstream was classifying a chat list rather than a conversation. Electron main performs the per-chat fan-out because it is the only process permitted to touch a connector; the utility process still asks for one capability. At most ten chats are expanded per run, and the transcripts are retention-governed raw capture like every other connector read.

## Recovery

If the utility process crashes, Electron main retries after 5 seconds, 30 seconds, and 2 minutes. After three failed starts, Brain reports degraded while the rest of FlowDesk remains usable. Expired job leases return to retry state on startup.

Use Brain → Settings → Export backup to create a `.flowdesk-brain.zip`. The archive contains a consistent SQLite snapshot, curated vault, and manifest only. Import validates schema and paths, creates a pre-import backup, replaces data atomically, and restarts the utility process. Newer incompatible schemas and unsafe archive paths are rejected.

Raw captures expire after 30 days by default and the window is configurable per recipe run. Accepted knowledge keeps its source locator and hash; deleting a source invalidates dependent derived data — its citations are marked stale and any affected opportunity still in `new` or `qualified` returns to `reviewing` for human review, while a reviewer's `dismissed` or `converted` decision is never reopened. A forgotten memory becomes a tombstone first so history remains auditable.

## Verification

Run before release:

```powershell
npm run typecheck
npm test
npm run build
```

The packaged build must contain `out/main/brainUtility.js` and be able to create the database and vault in the packaged `userData` location.

`electron/brain/operationalAcceptance.test.ts` is the release gate for the operational loop: capture through a fixture connector, a durable job interrupted and resumed across a process restart, a persisted cited opportunity, a reviewer decision, a budgeted decision brief, and exactly one Agent continuation — plus cross-client isolation and the retention sweep. It runs entirely against throwaway profiles and fixture data; no live account and no real `userData` profile is touched.

Operator procedures for every one of these flows are in [`brain-operations.md`](./brain-operations.md).
