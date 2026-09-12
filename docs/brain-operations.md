# FlowDesk Brain — Operations Guide

Day-to-day operator runbook for the local-first Brain subsystem. Architecture,
guarantees and the data model live in [`brain-architecture.md`](./brain-architecture.md);
this document is the exact click-by-click procedure for each operation.

Two screens carry all of it:

- **Brain** — memories, review inbox, graph, jobs, vault, backup.
- **Intelligence** — sources, consent, monitors, opportunities, decision briefs.

Both screens carry the same **Brain scope** picker in their header. Every read and
write on the screen is filtered to the selected scope. Cross-client and
cross-project reads are refused by the ledger, not just hidden by the UI — check
the picker before interpreting an empty list as "no data".

---

## 1. Scope setup

A scope is the isolation boundary. Global → Workspace → Project/Client → Session.

1. Open **Brain** (or **Intelligence**).
2. Use the **Brain scope** dropdown in the header.
   - `Global` always exists.
   - A `Project` scope is created automatically for the active FlowDesk project
     the first time either screen loads with that project selected.
3. Select the scope you intend to work in. The choice persists across restarts.

Notes:

- Parent memories are inherited by a child scope **only** when the memory is
  marked shareable. Nothing else crosses a scope boundary — not opportunities,
  not evidence, not graph edges, not briefs.
- An Agent turn in normal (non-temporary) mode gets its own `Session` scope
  nested under the active project scope.

## 2. Consent for a private source

A private capture recipe cannot run without consent for the exact
`(scope, recipe, provider)` triple. WhatsApp and LinkedIn are private; LinkedIn
declares **two** recipes and consenting to one is not consent for the other.

1. **Intelligence → Sources**. Each card shows a **Consent** line
   (`Granted` / `Not granted`, or `Unknown` if the consent ledger could not be
   read — treat `Unknown` as not granted).
2. Press the card's run button (**Scan unread** for WhatsApp, **Scan
   opportunities** for LinkedIn).
3. If consent is missing, a **Private source consent required** banner appears at
   the top of the screen showing provider, retention days, destination scope and
   the exact fields requested.
4. Read the banner, then press **Grant consent & run once**.

To revoke: consent is per scope and per recipe in the ledger; revoking makes the
next run park at `waiting_for_approval` instead of capturing. A running job
re-checks consent after the connector returns, so a revoke mid-capture discards
the result rather than storing it.

## 3. Running a recipe

1. **Intelligence → Sources** → **Scan unread** / **Scan opportunities**.
2. Watch progress on **Brain → Jobs**: the job moves
   `queued → running → processing → completed`, with one durable step per stage
   (`capture, normalize, classify, score, summarize`).
3. Press the **Artifact manifest** button on the job row to see the compact
   manifest: record counts, coverage, hashes and citations. Raw provider text is
   never in the manifest.
4. Results land on **Intelligence → Opportunities** and **Brain → Opportunities**.

Job controls on **Brain → Jobs**:

| Situation | Control | Result |
| --- | --- | --- |
| Job is still active | **Cancel** | Steps stop; a late connector result is discarded, not stored. |
| Job is `failed` or `cancelled` | **Retry** | Incomplete steps requeue; completed steps and their checkpoints are reused, so capture is not repeated. |
| `waiting_for_login` | Sign in to the provider in **Accounts**, then **Retry**. | |
| `waiting_for_approval` | Grant consent (section 2), then **Retry**. | |

Transient failures retry automatically at 5s, 30s and 2 minutes before the job
fails. A restart mid-job is safe: expired leases are recovered on startup and the
job resumes from its last checkpoint.

## 4. Reviewing an opportunity

1. **Intelligence → Opportunities**.
2. Filter with the **Opportunity status** dropdown
   (`New`, `Reviewing`, `Qualified`, or all review states).
3. Expand a card to load its **cited evidence** — every signal carries a source
   reference, platform, observed time and a stale marker.
4. Open the cited sources and verify, then press **Qualify** or **Dismiss**.

A dismissal is durable: a dismissed signal is never re-notified by a monitor and
is never reopened by the retention sweep.

## 5. Monitor lifecycle

A monitor runs one recipe on a schedule and resumes the Agent **only** when a new
signal crosses its minimum score. Monitors run inside FlowDesk — there is no
background OS service, and nothing runs while the app is closed.

1. **Intelligence → Monitors**.
2. Fill the form:
   - **Monitor recipe** — only the three runner-owned social recipes are offered.
   - **Monitor interval in minutes** — minimum 15.
   - **Monitor minimum score** — 0–100, default 70.
3. Submit to create it. The monitor starts `Active` with its first window one
   interval away.
4. Per-monitor controls: **Pause** / **Resume**, and **Delete** (which asks for
   **Confirm delete** first).

Notes:

- Consent still applies. A monitor on a private source with no consent captures
  nothing.
- Every interval missed while FlowDesk was closed collapses into one run; the
  schedule re-anchors forward rather than replaying.
- Re-detecting an unchanged signal notifies once, not once per interval.

## 6. Vault conflicts

The vault is Obsidian-compatible Markdown for accepted, curated knowledge only.
Raw social content is never written there.

1. **Brain → Vault** → **Check status** shows the vault root, watcher state and
   the current conflict count.
2. **Reconcile now** re-reads every managed file: an external edit on an
   unchanged record becomes a new database revision; a file edited at the same
   time as the database becomes a conflict.
3. Each conflict renders side by side as **Brain version** and **File version**.
   Choose **Keep Brain** or **Keep file**.
   - **Keep file** writes the file text back as a new database revision and
     republishes the Markdown.
   - **Keep Brain** discards the file edit and republishes the Markdown.
4. A Markdown file with no `brain_id` front matter is copied into `vault/Inbox/`
   rather than being interpreted as a record.

Conflicts are scope-filtered like everything else; a conflict can only be
resolved from the scope that owns its memory.

## 7. Backup and restore

**Brain → Settings → Backup & portability.**

Export:

1. Press **Export backup** and choose a destination.
2. The `.flowdesk-brain.zip` contains exactly three kinds of entry: `manifest.json`,
   a consistent `brain.sqlite` snapshot, and `vault/**.md`.
3. Credentials, cookies, session data, settings and raw job artifacts are never
   included.

Import (destructive):

1. Press **Import backup** and select the archive.
2. Before anything is replaced, Brain writes a pre-import backup into
   `userData/brain/backups/`.
3. The archive is validated first — unsafe entry paths (absolute, `..`,
   backslash, empty segment, or anything outside `vault/`) and incompatible
   format/schema versions are rejected before a single byte is written.
4. The restored database is health-checked, then the swap happens atomically and
   the previous database is kept alongside as `brain-before-import-<timestamp>.sqlite`.
5. The utility process exits and is restarted automatically. Reopen **Brain** to
   confirm scopes, opportunities, monitors and the vault came back.

Restoring into a profile where Brain has never run is supported — the brain
directory is created as part of the restore.

## 8. Degraded utility recovery

The Brain utility process is the only SQLite writer. If it dies, Electron main
restarts it after 5 seconds, 30 seconds, then 2 minutes. After three failed
starts the client reports `degraded` and stops retrying; the rest of FlowDesk
keeps working.

Recovery order:

1. **Brain → Overview** — if the status line reports not ready or degraded,
   Brain calls are failing, not empty.
2. Restart FlowDesk. A clean start re-spawns the utility and recovers expired job
   leases automatically; interrupted jobs resume from their checkpoints.
3. If it is still degraded, check `userData/brain/` exists and is writable, and
   that `brain.sqlite` is not held open by another process.
4. As a last resort, import the most recent archive from
   `userData/brain/backups/` (section 7). This restores the ledger and curated
   vault; raw job artifacts under `artifacts/` are not part of a backup and are
   not restored.

A degraded Brain never blocks the Agent: automatic context injection is skipped
and the turn proceeds without it.

## 9. Data purge and retention

Raw captures expire **30 days** after capture by default, configurable per recipe
run via the recipe's `retentionDays` parameter. The maintenance sweep runs every
24 hours while FlowDesk is open, and on demand as described below.

What the sweep does when a capture expires:

1. Deletes the capture envelope from the ledger.
2. Deletes the referenced raw artifact file from `userData/brain/artifacts/`.
3. Marks every opportunity citation derived from that source **stale**.
4. Returns any affected opportunity in `new` or `qualified` to **`reviewing`**, so
   a signal that lost its source goes back for human review instead of continuing
   to read as fully sourced. `dismissed` and `converted` are reviewer decisions
   and are never reopened.
5. Leaves accepted knowledge intact — an accepted memory keeps its source locator
   and content hash so provenance stays auditable after the raw text is gone.

Manual deletion:

- **Brain → Memories → Forget** soft-deletes one memory. It becomes a tombstone
  with a `deleted` revision first, so history stays auditable; its retrieval
  chunks are removed immediately so it can no longer be cited.
- **Intelligence → Opportunities → Dismiss** removes a signal from the review
  queue permanently and silences it for every monitor.

To purge everything for a scope, delete its memories and dismiss its
opportunities, then export a fresh backup so the archive no longer carries them.

---

## Release verification

See [`brain-architecture.md`](./brain-architecture.md#verification). The full
operational loop — capture → durable job with restart → cited opportunity →
decision brief → exactly-once Agent continuation, plus scope isolation, retention
and backup — is covered by `electron/brain/operationalAcceptance.test.ts`,
`electron/brain/backup.test.ts` and `electron/brain/vault.test.ts`, all against
throwaway profiles and fixture connectors.
