# The Brain's missing spine — entities, facts, and where data actually comes from

*Design, 2026-09-16. Follows `2026-09-16-brain-ui-redesign-design.md`, which fixed how the Brain is
shown. This one is about what is in it.*

## The problem

The Brain works and is nearly useless for the thing it exists for.

Asked "Yasir Bhai ke baare mein sab kuch dikhao", it cannot answer — not because retrieval is weak
(S1 and S5 made it good) but because nothing in the database knows that `wiki/clients/yasir-bhai.md`,
a WhatsApp conversation with Yasir, and an Intelligence lead from Yasir's company are **about the same
person**. The Brain stores documents. It does not store *who* or *what*.

Four counts from the live database (`AppData/Roaming/FlowDesk/brain/brain.sqlite`), not from memory:

| Table | Rows | Meaning |
|---|---|---|
| `knowledge_documents` | 157 | the Library — works |
| `opportunities` + `evidence` | 93 + 109 | the Intelligence system — works, **and is not connected to the Library at all** |
| `entities` / `entity_edges` | **0** / **0** | tables and writers exist (`database.ts:915`, `:923`); never driven |
| `claims` | **0** | table exists, **no writer anywhere in the codebase** |
| `scopes` | `global:1`, `session:3` | no client scope, no project scope has ever been created |

That last row matters more than it looks: the scope system was the obvious place to hang
"everything about one client", and it has never been used that way. Sections cannot be built on
scopes. They have to be built on something that exists per-person and per-project — which is what
entities are.

And one line of code explains why every capture is shapeless: `sessionCapture.ts:50` hardcodes
`type: 'note'`. Every fact the agent has ever captured landed in the same undifferentiated pile.

## What the owner's own vault already proves

Before proposing a taxonomy, the owner's Second-Brain was inventoried — 213 markdown files at
`E:\Claude Workspace\Second-Brain`. Excluding the 104 files of agent tooling and skill sets
(`wiki/ai-tooling`, `wiki/toolkits`, `wiki/skills`), which are a separate concern:

- `raw/` — 45 files: 26 conversations, 16 YouTube transcripts, 5 articles, and a `processed/` folder
- `wiki/clients` 3, `wiki/partners` 1, `wiki/projects` 15, `wiki/me` 5 — **these are people and things, not papers**
- `wiki/research` 11, `wiki/business` 7, `wiki/learning` 13 — these are documents

The taxonomy below was not imported from a framework. It is the structure the owner already built by
hand, and `raw/processed/` is the evidence that the raw→distilled journey was being done manually,
one file at a time. Current agent-memory practice (Mem0, Zep/Graphiti, Letta) converges on the same
split — episodic, semantic, procedural — which is corroboration, not the source.

## The five layers

| # | Layer | What it is | Existing table | State |
|---|---|---|---|---|
| 1 | **Episode** | what happened, verbatim, never edited | `capture_envelopes` (320), `artifacts/` (168 files), `audit_events` | partly built |
| 2 | **Entity** | who or what — person, org, project, opportunity, topic | `entities`, `entity_aliases`, `entity_edges` | tables + writers exist, **0 rows** |
| 3 | **Fact** | what is true, and for how long | `claims` + `evidence` | `claims` unused, needs validity columns |
| 4 | **Document** | the distilled, readable form | `knowledge_documents` (157) | built |
| 5 | **Procedure** | how to do a thing — templates, playbooks | — | does not exist |

**Nothing here is a new store.** Layers 1, 2 and 4 are already in the schema; layer 3 needs two
columns; layer 5 is a document type, not a table.

### Why episodes are never deleted

An episode is the evidence. A fact that cannot be traced back to the message that produced it is a
rumour, and the whole point of this Brain is that an answer can be checked. Facts change; episodes do
not. Retention is governed per-source by the existing `retentionDays`, and deletion is recorded in
`source_deletions`, which already exists.

### Why facts are superseded, not updated

`knowledge_documents` already uses `valid_from` / `valid_to` for exactly this, and every query in the
knowledge layer already filters `valid_to IS NULL`. `claims` should follow that pattern rather than
inventing a second one. This is what makes "Yasir ka rate June mein kya tha" answerable, and it is
the one thing a key-value memory store can never do.

**`claims` needs `valid_from` and `valid_to` added** — it has only `status` today. That is the single
schema change in this design.

## Entity resolution — the part most likely to go wrong

Everything above depends on deciding that "Yasir Bhai", "Yasir", a WhatsApp number, and a LinkedIn
profile are one person. `entity_aliases` exists for this and is the right home.

This is the classic hard problem and it fails in one direction much worse than the other:

- A **missed match** creates a duplicate entity. Annoying, visible, fixable by merging.
- A **wrong merge** silently mixes two clients' facts. It corrupts the answer, and the owner may never
  notice.

So: **auto-match only on an exact, verified identifier** — a phone number, a LinkedIn URN, an email.
Everything else — name similarity, nickname, company overlap — proposes a merge into the Review queue
and waits. `entity_aliases.verified` already carries that distinction.

## Where the data comes from

Studio, YT Studio, Jarvis, UniversalChat and the project scaffolding are explicitly out of scope for
this design.

| Surface | Episode | Entity | Fact | Document |
|---|---|---|---|---|
| **Conversations** (WhatsApp + LinkedIn — one thing, two transports) | the thread | the person, their org | rates, promises, deadlines, decisions | — |
| **Agent** (ask_claude / gpt / gemini / grok / perplexity — one job, five providers) | the turn | whoever it was about | what the owner stated directly | research output |
| **NotebookLM** | the question and answer | sources as entities | — | the research note |
| **Intelligence** | the capture (**320 already stored**) | the opportunity, the org | score and why | — |
| **Accounts / Gmail** | — | the owner's own identities | — | — |

The Intelligence row is the cheapest win in this entire design: 93 opportunities and 109 evidence rows
already exist and are already scored. They need connecting, not building.

### The extraction step, and its honest cost

Turning an episode into facts needs a model call. This is the one place in the Brain that is not
deterministic, and it is the one place where token cost can run away, which matters because the whole
S1–S5 series was about cost.

Three rules keep it bounded:

1. **One call per episode, never per query.** Extraction is a write-time cost paid once; retrieval
   stays the deterministic ladder that already measures at 0.207 of naive payload.
2. **Only episodes that plausibly carry a fact.** A "thanks" message gets no call.
3. **The cheapest adequate model**, not the lead agent's.

**This is unmeasured.** The number of episodes per day and the tokens per extraction are both
unknown, and the sensible thing is to measure them on real captures before committing to a model —
the same discipline that killed RRF fusion in S5 when it was measured at 33% against 50%.

## The Review gate

The owner chose that FlowDesk fills the Brain and they never author. So Review is not a side feature —
**it is the only place the owner acts**, and everything else in the Brain is reading.

The existing split is already right and should be reused, not replaced: `explicit-user` content saves
directly, `machine-inferred` waits (`sessionCapture.ts`). Extended to this design:

| Proposed | Gate |
|---|---|
| Fact from something the owner typed | saves directly |
| Fact extracted by a model | Review |
| New entity with a verified identifier | saves directly |
| Entity merge on anything softer | Review |

## What the Brain will show

| Section | Built from | Buildable today? |
|---|---|---|
| **Graph** | entities + edges + document links | no — needs layer 2 |
| **Log** (people, clients, orgs) | entity `person` / `org` | no |
| **Projects** | entity `project` | no |
| **Conversations** | episodes | partly — captures exist, unlinked |
| **Library** | documents | **yes, works now** |
| **Opportunities** | `opportunities` (93) | nearly — needs linking |
| **Review** | candidates + proposed facts + proposed merges | partly |
| **Ask** | the ladder | **yes, works now** |
| **Today** | `audit_events` | **yes** |
| **Health** | maintenance | **yes** |

The graph is for **navigation** — the owner's explicit choice. That changes what it has to be good at:
it never renders the whole database, it renders where you are and what is one or two steps away. The
hairball problem that every source warns about is a problem for *overview* graphs, and the existing
`neighbors()` walk plus `neighborhoodLayout.ts` rings are already most of the navigation variant.

## Order of work, and why

1. **Entities and aliases** — resolution, the Review merge queue, backfill from the 157 documents. Nothing else can start before this.
2. **Link what already exists** — the 93 opportunities and 320 captures to entities. Cheapest visible win; no extraction needed.
3. **Facts** — `valid_from`/`valid_to` on `claims`, the extraction step, the Review gate. Measure cost here.
4. **Conversations** — WhatsApp and LinkedIn as episodes, since they are where facts about clients actually live.
5. **Sections and graph** — last, because each one is a view over layers 1–3 and cannot be built before them.

Typing captures correctly (removing the hardcoded `type: 'note'`) rides along with step 3, since a
fact carries the type its entity implies.

## What this design assumes rather than knows

- That extraction cost is acceptable. Not measured. Step 3 measures it before committing.
- That auto-matching on verified identifiers alone produces few enough duplicates to be tolerable. If
  it does not, the Review queue becomes noisy and the matching rule needs revisiting — but it fails
  safely, toward duplicates rather than corruption.
- That the owner never wants to author. This follows from their explicit choice; if it changes, layer
  4 needs a write path and this design does not provide one.
- That `wiki/toolkits` and `wiki/ai-tooling` (104 files of agent skills) belong in layer 5 rather than
  being a separate system. Deliberately deferred, at the owner's request.
